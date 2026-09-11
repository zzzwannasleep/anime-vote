// 番剧译制提名 · CF Worker
// 静态页由 assets 绑定直出，本文件只处理 /api/*
//
// 身份模型：管理员发注册链接 -> 组员点链接填名字 -> 拿到一枚专属密钥 -> 之后只用密钥进。
//   全组共用一个口令的做法已经去掉了：那种模式下换个名字就能再投一次，防不住，
//   而且口令一旦转发出组，外人就能进。注册链接是一次性的，用了即作废，谁没注册一目了然。
// 明文口令只存在 CF secret 里，前端任何时候都拿不到。
//
// 存储分工：投票期的活票在 KV；季度截止后读仓库里的 public/archive/<季度>.json，
//   一次 KV 都不用。存档文件跟着代码一起部署，所以既在 GitHub 里留了档，线上也直接能读。

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' },
  });

const sha256 = async (s) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// 比较 hash 而非明文：长度恒定，天然抗时序探测
const same = async (input, expected) => !!expected && (await sha256(String(input))) === (await sha256(expected));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 32);

/* 密钥和注册码：字母表去掉了 0/O/1/I/L 这些手抄会认错的字符。
   存取一律用去掉分隔符的大写形式，所以用户粘贴时带不带横杠、大小写都无所谓 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const normKey = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 32);
const prettyKey = (k) => (k.match(/.{1,4}/g) || []).join('-');
const mint = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHABET[b % ALPHABET.length]).join('');

/* 静态配置：岗位白名单和季度表都读 public/ 下的 json，改文件即改配置 */
const CACHE = {};
async function asset(request, env, path) {
  if (!(path in CACHE)) {
    const r = await env.ASSETS.fetch(new URL(path, request.url));
    CACHE[path] = r.ok ? await r.json() : null;
  }
  return CACHE[path];
}
const allowedRoles = async (request, env) => new Set(((await asset(request, env, '/config.json')) || {}).roles || []);
const seasons = (request, env) => asset(request, env, '/seasons.json');

// 已截止的季度：票面直接从仓库里的存档文件读，零 KV 调用
async function archivedBallots(request, env, id) {
  const d = await asset(request, env, '/archive/' + id + '.json');
  return d && Array.isArray(d.ballots) ? d.ballots : null;
}

// 返回 {role, name} 或 null。密钥、管理员口令都从这里进
async function identify(body, env) {
  const raw = String(body.key || body.pass || '');
  if (!raw.trim()) return null;
  if (await same(raw.trim(), env.ADMIN_PASSWORD)) return { role: 'admin', name: '管理员' };
  const key = normKey(raw);
  if (key.length >= 8) {
    const who = await env.VOTES.get('who:' + key, 'json');
    if (who) return { role: 'voter', name: who.name, key };
  }
  await sleep(400); // 猜错就拖一下，挡住暴力枚举
  return null;
}

// 建一枚密钥并跟名字绑定。同名重复建，拿回的永远是同一枚
async function keyFor(env, name) {
  const had = await env.VOTES.get('name:' + name, 'text');
  if (had) return { key: had, existing: true };
  const key = mint(12);
  await env.VOTES.put('who:' + key, JSON.stringify({ name, ts: new Date().toISOString() }));
  await env.VOTES.put('name:' + name, key);
  return { key, existing: false };
}

async function readBallots(env, season) {
  const out = [];
  let cursor;
  do {
    const page = await env.VOTES.list({ prefix: `ballot:${season}:`, cursor });
    const rows = await Promise.all(page.keys.map((k) => env.VOTES.get(k.name, 'json')));
    out.push(...rows.filter(Boolean));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
}

async function listPrefix(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.VOTES.list({ prefix, cursor });
    for (const k of page.keys) out.push(k.name.slice(prefix.length));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (!pathname.startsWith('/api/')) {
      // 存档文件跟着静态资源一起部署，但不能裸奔：里面有全组的名字和理由，
      // 必须凭密钥走 /api/results 拿
      if (pathname.startsWith('/archive/'))
        return json({ error: '存档要凭密钥从 /api/results 取' }, 403);
      if (pathname === '/admin') return env.ASSETS.fetch(new URL('/admin.html', request.url));
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!env.ADMIN_PASSWORD) return json({ error: '服务端未设置 ADMIN_PASSWORD，见 README' }, 500);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: '请求格式错误' }, 400);
    }

    /* 注册：拿管理员发的一次性注册码换密钥。这是唯一一个不需要凭据的入口，
       但注册码用一次就作废，所以链接转发出去也顶多被抢注一个名额 */
    if (pathname === '/api/register') {
      const token = normKey(body.token);
      const name = normName(body.name);
      if (!token) return json({ error: '注册链接不完整' }, 400);
      if (!name) return json({ error: '填个名字，密钥跟名字绑定' }, 400);
      const inv = await env.VOTES.get('inv:' + token, 'json');
      if (!inv) { await sleep(400); return json({ error: '注册链接无效，找管理员再要一个' }, 401); }
      if (inv.used) return json({ error: `这个链接已经被「${inv.used}」用掉了` }, 409);

      const { key, existing } = await keyFor(env, name);
      await env.VOTES.put('inv:' + token, JSON.stringify({ ...inv, used: name, usedAt: new Date().toISOString() }));
      return json({ ok: true, name, key: prettyKey(key), existing });
    }

    const me = await identify(body, env);
    if (!me) return json({ error: '密钥不对，或者还没注册' }, 401);
    const admin = me.role === 'admin';

    const all = await seasons(request, env);
    const season = all.list.find((s) => s.id === body.season) || all.list.find((s) => s.id === all.current) || all.list[0];
    if (!season) return json({ error: '还没有任何季度，先跑 fetch-anime.mjs' }, 500);

    if (pathname === '/api/auth')
      return json({ ok: true, role: me.role, name: me.name, seasons: all.list, current: all.current });

    if (pathname === '/api/vote') {
      // 名字来自密钥，前端不再填。只有管理员能代填（archive 回灌、seed 造数据用）
      const name = admin && body.name ? normName(body.name) : me.name;
      if (!name) return json({ error: '密钥没绑定名字' }, 400);
      if (season.status !== 'open' && !admin)
        return json({ error: `「${season.label}」已经截止了` }, 403);

      const allow = await allowedRoles(request, env);
      const picks = (Array.isArray(body.picks) ? body.picks : [])
        .map((p) => ({
          id: Number(p.id),
          // 岗位只认 config.json 里的，别的一律丢掉
          roles: [...new Set((Array.isArray(p.roles) ? p.roles : []).filter((r) => allow.has(r)))],
          reason: String(p.reason || '').trim().slice(0, 300),
        }))
        .filter((p) => Number.isInteger(p.id) && p.id > 0);
      if (!picks.length) return json({ error: '至少选一部' }, 400);
      // 同一部番在同一张票里只算一次
      const seen = new Set();
      const uniq = picks.filter((p) => !seen.has(p.id) && seen.add(p.id));

      const kvKey = `ballot:${season.id}:${name}`;
      const prev = await env.VOTES.get(kvKey, 'json');
      if (prev && !body.overwrite) return json({ error: 'exists', conflict: true, prevAt: prev.ts }, 409);

      await env.VOTES.put(kvKey, JSON.stringify({ name, picks: uniq, ts: new Date().toISOString() }));
      return json({ ok: true, replaced: !!prev, season: season.id });
    }

    if (pathname === '/api/results') {
      // 截止的季度优先读存档，读到了就一次 KV 都不碰
      let ballots = season.status === 'open' ? null : await archivedBallots(request, env, season.id);
      const source = ballots ? 'archive' : 'kv';
      if (!ballots) ballots = await readBallots(env, season.id);

      const tally = {};
      for (const b of ballots)
        for (const p of b.picks) {
          const t = (tally[p.id] ||= { id: p.id, votes: 0, roles: {}, reasons: [] });
          t.votes++;
          for (const r of p.roles || []) (t.roles[r] ||= []).push(b.name);
          if (p.reason) t.reasons.push({ name: b.name, reason: p.reason });
        }
      return json({
        ok: true,
        role: me.role,
        me: me.name,
        season: season.id,
        closed: season.status !== 'open',
        source,
        mine: (ballots.find((b) => b.name === me.name) || {}).picks || null,
        voters: ballots.map((b) => ({ name: b.name, ts: b.ts, count: b.picks.length })),
        tally: Object.values(tally),
        // 原始票面只给管理员，archive.mjs 靠它做无损留档（汇总是聚合过的，回灌不回来）
        ...(admin ? { ballots } : {}),
      });
    }

    /* 以下都是管理员专用。闸门放在每个分支里，未知路径才不会被误报成 403 */

    // 撤票
    if (pathname === '/api/delete') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      const name = normName(body.name);
      if (!name) return json({ error: '请填名字' }, 400);
      await env.VOTES.delete(`ballot:${season.id}:${name}`);
      return json({ ok: true });
    }

    // 直接发密钥（批量、给不方便点链接的人）
    if (pathname === '/api/claim') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      const name = normName(body.name);
      if (!name) return json({ error: '填个名字，密钥跟名字绑定' }, 400);
      const { key, existing } = await keyFor(env, name);
      return json({ ok: true, name, key: prettyKey(key), existing });
    }

    // 生成一次性注册链接
    if (pathname === '/api/invite') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      const count = Math.min(Math.max(Number(body.count) || 1, 1), 30);
      const note = String(body.note || '').trim().slice(0, 40);
      const ts = new Date().toISOString();
      const out = [];
      for (let i = 0; i < count; i++) {
        const token = mint(10);
        await env.VOTES.put('inv:' + token, JSON.stringify({ ts, note, used: null }));
        out.push(token);
      }
      return json({ ok: true, tokens: out });
    }

    // 注册链接用掉没有、还剩几个
    if (pathname === '/api/invites') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      const tokens = await listPrefix(env, 'inv:');
      const rows = await Promise.all(tokens.map(async (t) => ({ token: t, ...(await env.VOTES.get('inv:' + t, 'json')) })));
      return json({ ok: true, invites: rows.sort((a, b) => (b.ts || '').localeCompare(a.ts || '')) });
    }

    // 作废一个还没用的注册链接
    if (pathname === '/api/uninvite') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      await env.VOTES.delete('inv:' + normKey(body.token));
      return json({ ok: true });
    }

    // 吊销某人的密钥（离组、密钥外泄）。票不动，需要连票一起删就再调 /api/delete
    if (pathname === '/api/revoke') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      const name = normName(body.name);
      if (!name) return json({ error: '请填名字' }, 400);
      const key = await env.VOTES.get('name:' + name, 'text');
      if (key) await env.VOTES.delete('who:' + key);
      await env.VOTES.delete('name:' + name);
      return json({ ok: true, revoked: !!key });
    }

    /* 重置某人的密钥：旧的立刻作废，换一枚新的交给他。票一张不动。
       吊销是「这个人不该再进来」，重置是「这个人还在，只是把密钥忘了」——
       忘了密钥的人以前只能等管理员吊销再重新发一条注册链接，中间他是彻底进不来的 */
    if (pathname === '/api/reset') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      const name = normName(body.name);
      if (!name) return json({ error: '请填名字' }, 400);
      const old = await env.VOTES.get('name:' + name, 'text');
      if (old) await env.VOTES.delete('who:' + old);
      await env.VOTES.delete('name:' + name);
      const { key } = await keyFor(env, name);
      return json({ ok: true, name, key: prettyKey(key), had: !!old });
    }

    // 发过哪些密钥。补发、对名单用
    if (pathname === '/api/keys') {
      if (!admin) return json({ error: '需要管理员口令' }, 403);
      const names = await listPrefix(env, 'name:');
      const out = await Promise.all(names.map(async (n) => ({ name: n, key: prettyKey(await env.VOTES.get('name:' + n, 'text') || '') })));
      return json({ ok: true, keys: out.filter((k) => k.key).sort((a, b) => a.name.localeCompare(b.name)) });
    }

    return json({ error: 'not found' }, 404);
  },
};
