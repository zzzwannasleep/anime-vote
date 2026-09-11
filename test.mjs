// 端到端自检：先 `npx wrangler dev` 起服务，再 `node test.mjs`
// 用的是 .dev.vars 里的本地管理员口令，跑完会清掉自己写入的票、密钥和注册码
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let ADMIN = process.env.ADMIN_PASSWORD;
if (!ADMIN && existsSync('.dev.vars'))
  ADMIN = (readFileSync('.dev.vars', 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1];
if (!ADMIN) { console.error('没有 ADMIN_PASSWORD，见 .dev.vars.example'); process.exit(2); }
ADMIN = ADMIN.trim();
const MARK = '__test_' + Date.now();

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra); }
};
const post = async (path, body) => {
  const r = await fetch(BASE + '/api' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const invite = async (note) => (await post('/invite', { key: ADMIN, count: 1, note })).json.tokens[0];

console.log('\n[静态资源]');
const CFG = await (await fetch(BASE + '/config.json')).json();
const SEASONS = await (await fetch(BASE + '/seasons.json')).json();
const SEASON = SEASONS.current;
const CLOSED = (SEASONS.list.find((s) => s.status === 'closed') || {}).id;
{
  const r = await fetch(BASE + '/');
  ok(r.ok && (await r.text()).includes('拨雪寻春'), 'GET / 返回投票页');
  const a = await fetch(BASE + '/admin');
  ok(a.ok && (await a.text()).includes('管理控制台'), 'GET /admin 返回管理页');
  ok(CFG.roles?.length > 0 && CFG.required?.length > 0, `config.json: ${CFG.roles.length} 个岗位，${CFG.required.length} 个必需`);
  ok(CFG.required.every((r) => CFG.roles.includes(r)), 'required 岗位都在 roles 里（不会出现永远缺的幽灵岗）');
  ok(SEASONS.list?.length > 0 && SEASONS.list.some((s) => s.id === SEASON), `seasons.json: ${SEASONS.list.length} 季，current=${SEASON}`);
  const j = await (await fetch(BASE + '/season/' + SEASON + '.json')).json();
  ok(j.list?.length > 0, `GET /season/${SEASON}.json 有 ${j.list?.length} 部番剧`);
  ok(j.list.every((x) => x.id && x.name_cn && x.cover), '每部番剧字段完整(id/name_cn/cover)');
  ok(j.list.some((x) => x.staff?.length), '番剧带 staff（聚焦面板要显示导演/原作）');
}
const [R0, R1, R2] = CFG.roles;   // 拿前三个真实岗位来测

console.log('\n[存档不许裸奔]');
{
  // 存档在 public/ 下才能跟着部署，但里面是全组的名字和理由。
  // 默认静态资源会在 Worker 之前直出，所以 wrangler.toml 必须把 /archive/* 交给 Worker 先跑
  if (CLOSED) {
    const j = await fetch(BASE + '/archive/' + CLOSED + '.json');
    ok(j.status === 403, `直接 GET /archive/${CLOSED}.json -> 403`, String(j.status));
    const m = await fetch(BASE + '/archive/' + CLOSED + '.md');
    ok(m.status === 403, `直接 GET /archive/${CLOSED}.md -> 403`, String(m.status));
  } else {
    ok(true, '（当前没有已截止的季度，跳过存档访问检查）');
    ok(true, '（同上）');
  }
}

console.log('\n[注册：一次性链接换密钥]');
const N1 = MARK + '_甲', N2 = MARK + '_乙';
let K1 = '', K2 = '', T1 = '';
{
  ok((await post('/invite', { key: 'wrong-' + MARK, count: 1 })).status === 401, '非管理员生成注册码 -> 401');
  T1 = await invite('测试');
  ok(/^[0-9A-Z]{10}$/.test(T1 || ''), '管理员拿到一条注册码', T1);

  ok((await post('/register', { token: T1, name: '' })).status === 400, '注册不填名字 -> 400');
  ok((await post('/register', { token: 'ZZZZZZZZZZ', name: N1 })).status === 401, '瞎编的注册码 -> 401');

  const a = await post('/register', { token: T1, name: N1 });
  K1 = a.json.key;
  ok(a.status === 200 && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(K1 || ''), '注册换到一枚密钥', K1);
  ok(!/[01OIL]/.test(K1.replace(/-/g, '')), '密钥不含 0/1/O/I/L 这些手抄会认错的字符', K1);

  const again = await post('/register', { token: T1, name: MARK + '_抢注' });
  ok(again.status === 409, '同一条注册码用第二次 -> 409（用掉即作废）', String(again.status));

  const T2 = await invite('测试2');
  const b = await post('/register', { token: T2, name: N2 });
  K2 = b.json.key;
  ok(b.status === 200 && K2 && K2 !== K1, '第二条注册码换到另一枚密钥');

  const list = await post('/invites', { key: ADMIN });
  const row = list.json.invites.find((x) => x.token === T1);
  ok(row && row.used === N1, `管理员能看到 ${T1} 被「${row && row.used}」用掉了`);
  ok(list.json.invites.some((x) => x.token === T2 && !x.used) === false, 'T2 也已标记为已用');

  const T3 = await invite('作废测试');
  await post('/uninvite', { key: ADMIN, token: T3 });
  ok((await post('/register', { token: T3, name: MARK + '_丁' })).status === 401, '作废后的注册码不能再用');
}

console.log('\n[登录]');
{
  ok((await post('/auth', {})).status === 401, '空密钥 -> 401');
  ok((await post('/auth', { key: 'ZZZZ-ZZZZ-ZZZZ' })).status === 401, '没发过的密钥 -> 401');
  ok((await post('/auth', { key: T1 })).status === 401, '注册码不能当密钥用');

  const v = await post('/auth', { key: K1 });
  ok(v.status === 200 && v.json.role === 'voter' && v.json.name === N1, '密钥 -> role=voter，名字自动带出来', v.json.name);
  ok(v.json.seasons?.length > 0 && v.json.current === SEASON, '登录时把季度表一起返回');

  const lower = await post('/auth', { key: K1.toLowerCase().replace(/-/g, ' ') });
  ok(lower.status === 200 && lower.json.name === N1, '密钥大小写、横杠、空格都容错');

  ok((await post('/auth', { key: ADMIN })).json.role === 'admin', '管理员口令 -> role=admin');
  ok((await fetch(BASE + '/api/auth')).status === 405, 'GET /api/auth -> 405（只收 POST）');
  ok((await post('/nope', { key: K1 })).status === 404, '未知 api 路径 -> 404');
}

console.log('\n[提名：名字来自密钥，不再手填]');
{
  ok((await post('/vote', { picks: [{ id: 1 }] })).status === 401, '不带密钥提名 -> 401');
  ok((await post('/vote', { key: K1, picks: [] })).status === 400, '一部都不选 -> 400');

  const a = await post('/vote', {
    key: K1, season: SEASON,
    picks: [{ id: 111, roles: [R0, R1], reason: '想做这部' }, { id: 222, roles: [] }],
  });
  ok(a.status === 200 && a.json.ok && !a.json.replaced, '首次提名成功（带岗位）');
  ok(a.json.season === SEASON, '返回里带季度（票是按季度分桶存的）');

  // 关键：普通用户就算在 body 里塞 name，也只能记在自己名下
  await post('/vote', { key: K1, name: '我是别人_' + MARK, overwrite: true,
    picks: [{ id: 111, roles: [R1], reason: '改主意了' }, { id: 333, roles: [R2] }] });

  const dup = await post('/vote', { key: K1, picks: [{ id: 111, roles: [R0] }] });
  ok(dup.status === 409 && dup.json.conflict, '同一密钥重复提交 -> 409 要求确认覆盖');

  const dirty = await post('/vote', {
    key: K2,
    picks: [
      { id: 111, roles: [R0, R0, '伪造岗位_' + MARK, 123, null] },  // 重复 + 非法
      { id: 111, roles: [R2] },                                      // 同 id 重复条目
      { id: 'abc' }, { id: -5 },                                     // 非法 id
      { id: 333, roles: [R1], reason: 'x'.repeat(500) },             // 超长理由
    ],
  });
  ok(dirty.status === 200, '脏数据不会 500');

  if (CLOSED) {
    const T = await invite('截止测试');
    const K = (await post('/register', { token: T, name: MARK + '_戊' })).json.key;
    const r = await post('/vote', { key: K, season: CLOSED, picks: [{ id: 111 }] });
    ok(r.status === 403, `往已截止的 ${CLOSED} 投票 -> 403`, String(r.status));
    await post('/revoke', { key: ADMIN, name: MARK + '_戊' });
  } else {
    ok(true, '（没有已截止的季度，跳过）');
  }
}

console.log('\n[汇总统计]');
{
  const r = await post('/results', { key: K1, season: SEASON });
  ok(r.status === 200, '拉取汇总成功');
  ok(r.json.source === 'kv', '进行中的季度从 KV 读', r.json.source);
  const t = Object.fromEntries(r.json.tally.map((x) => [x.id, x]));

  ok(t[111]?.votes === 2, '111 有 2 人提名', JSON.stringify(t[111]?.votes));
  ok(t[222] === undefined, '甲覆盖后 222 不再计入（旧数据没残留）');
  ok(!r.json.tally.some((x) => x.id === -5 || Number.isNaN(x.id)), '非法 id 被过滤掉');

  ok((t[111].roles[R1] || []).includes(N1), `覆盖后甲的岗位是「${R1}」`, JSON.stringify(t[111].roles));
  ok(!Object.values(t[111].roles).flat().some((n) => n.includes('我是别人')), '伪造的 name 没生效，票还记在密钥主人名下');
  ok(!(t[111].roles[R0] || []).includes(N1), `甲原来的「${R0}」岗位没残留`);
  ok((t[111].roles[R0] || []).filter((n) => n === N2).length === 1, '同一人同岗位不会重复计数（去重生效）');
  ok(!Object.keys(t[111].roles).some((k) => k.includes(MARK)), '伪造岗位被服务端白名单挡掉', JSON.stringify(Object.keys(t[111].roles)));
  ok(!Object.keys(t[111].roles).some((k) => !CFG.roles.includes(k)), '统计里出现的岗位都在 config.json 白名单内');

  const long = (t[333].reasons || []).find((x) => x.name === N2);
  ok(long && long.reason.length === 300, '超长理由被截断到 300 字', long?.reason.length);
  ok(t[111].reasons.some((x) => x.name === N1 && x.reason === '改主意了'), '理由跟着覆盖后的数据走');

  // 换台机器登录要能把上次的票拉回来接着改，靠的就是这个字段
  ok(Array.isArray(r.json.mine) && r.json.mine.some((p) => p.id === 111), 'mine 带回本人上次提交的票');
  ok(r.json.me === N1, 'results 里回带自己的名字');
  ok(r.json.ballots === undefined, '普通用户拿不到别人的原始票面');

  const adm = await post('/results', { key: ADMIN, season: SEASON });
  ok(Array.isArray(adm.json.ballots) && adm.json.ballots.length >= 2, '管理员拿得到原始票面（archive 无损留档靠它）');
}

console.log('\n[已截止的季度走仓库存档，零 KV]');
{
  if (CLOSED) {
    const arc = JSON.parse(readFileSync(`public/archive/${CLOSED}.json`, 'utf8'));
    const r = await post('/results', { key: K1, season: CLOSED });
    ok(r.json.source === 'archive', `${CLOSED} 的汇总来源是 archive 而不是 kv`, r.json.source);
    ok(r.json.closed === true, `${CLOSED} 标记为已截止`);
    ok(r.json.voters.length === arc.ballots.length,
       `汇总人数与存档一致（${r.json.voters.length} vs ${arc.ballots.length}）`);
    const fromArc = new Set(arc.ballots.flatMap((b) => b.picks.map((p) => p.id)));
    ok(r.json.tally.every((t) => fromArc.has(t.id)), '汇总里的番全部来自存档文件');
    ok(!/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(JSON.stringify(arc)), '存档里没有密钥');
  } else {
    for (let i = 0; i < 5; i++) ok(true, '（没有已截止的季度，跳过）');
  }
}

console.log('\n[权限]');
{
  for (const [ep, body] of [['/delete', { name: N1 }], ['/keys', {}], ['/revoke', { name: N2 }],
                            ['/reset', { name: N2 }], ['/claim', { name: 'x' }],
                            ['/invite', { count: 1 }], ['/invites', {}],
                            ['/uninvite', { token: T1 }]])
    ok((await post(ep, { key: K1, ...body })).status === 403, `普通密钥调 ${ep} -> 403`);

  const list = await post('/keys', { key: ADMIN });
  ok(list.status === 200 && list.json.keys.some((k) => k.name === N1), '管理员能列出已发密钥');
  ok(!JSON.stringify(list.json).includes(ADMIN), '密钥名单里不含管理员口令本身');

  ok((await post('/delete', { key: ADMIN, name: N1, season: SEASON })).status === 200, '管理员删票 -> 200');
  const r = await post('/results', { key: ADMIN, season: SEASON });
  ok(!r.json.voters.some((v) => v.name === N1), '删掉的提名不再出现在汇总里');

  /* 重置密钥：组员忘了自己那枚时的唯一出路。以前只能「吊销 + 重新发一条注册链接」，
     中间他是彻底进不来的，而且换条链接就换个名字，票也就断了。
     重置保持名字不变，所以他之前投的票接着算 */
  const before = (await post('/results', { key: ADMIN, season: SEASON }))
    .json.voters.find((v) => v.name === N2);
  const rs = await post('/reset', { key: ADMIN, name: N2 });
  ok(rs.status === 200 && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(rs.json.key || '') && rs.json.key !== K2,
     '管理员重置密钥，换回一枚新的', rs.json.key);
  ok(rs.json.had === true, '返回里标明他本来就有密钥（区分「重置」和「第一次发」）');
  ok((await post('/auth', { key: K2 })).status === 401, '重置后旧密钥立刻登不进来');
  const reauth = await post('/auth', { key: rs.json.key });
  ok(reauth.status === 200 && reauth.json.name === N2, '新密钥登进来还是同一个人', reauth.json.name);
  K2 = rs.json.key;
  const after = (await post('/results', { key: K2, season: SEASON }))
    .json.voters.find((v) => v.name === N2);
  ok(!!before && !!after && before.count === after.count, '重置不动他投过的票', `${before?.count} -> ${after?.count}`);
  ok(Array.isArray((await post('/results', { key: K2, season: SEASON })).json.mine), '新密钥照样能把自己的票拉回来改');

  const rev = await post('/revoke', { key: ADMIN, name: N1 });
  ok(rev.status === 200 && rev.json.revoked, '管理员能吊销密钥');
  ok((await post('/auth', { key: K1 })).status === 401, '吊销之后原密钥立刻登不进来');
}

// 清场：测试数据不留在 KV 里
for (const n of [N2, MARK + '_抢注', MARK + '_丁']) {
  await post('/delete', { key: ADMIN, name: n, season: SEASON });
  await post('/revoke', { key: ADMIN, name: n });
}
for (const t of (await post('/invites', { key: ADMIN })).json.invites || [])
  if (/测试|作废|截止/.test(t.note || '')) await post('/uninvite', { key: ADMIN, token: t.token });

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
