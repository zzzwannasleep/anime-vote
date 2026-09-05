// 季度留档：把一季的投票结果落成仓库里的文件，提交进 git 就是永久档案。
// 用法:
//   node archive.mjs export 2026-10     导出到 public/archive/2026-10.json 和 .md
//   node archive.mjs restore 2026-10    把档案回灌进 KV（重建环境、误删时用）
//   BASE=https://你的域名 node archive.mjs export 2026-10
//
// 存档落在 public/archive/，一个位置办三件事：
//   1. 在仓库里 -> git 有历史、能 diff、markdown 在 GitHub 上直接渲染成表
//   2. 跟着 wrangler deploy 一起上线 -> 已截止的季度汇总直接读它，一次 KV 都不用
//   3. Worker 挡住了 /archive/* 的直接访问 -> 里面的名字和理由不会裸奔，仍要凭密钥走 /api/results
// 为什么不把活票直接写进 GitHub：每投一次就是一次 commit，几个人同时投必然撞车，
// 还要给 Worker 塞一个有仓库写权限的 token。投票期用 KV，截止后导一次档，各取所长。
//
// 档案里只有名字、番剧、岗位、理由。密钥绝不写进任何文件——它是身份凭据。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let ADMIN = process.env.ADMIN_PASSWORD;
if (!ADMIN && existsSync('.dev.vars'))
  ADMIN = (readFileSync('.dev.vars', 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1];
if (!ADMIN) {
  console.error('没有管理员口令。设 ADMIN_PASSWORD 环境变量，或在 .dev.vars 里写一行 ADMIN_PASSWORD=...');
  process.exit(2);
}

const [cmd, seasonArg] = process.argv.slice(2);
const seasons = JSON.parse(readFileSync('public/seasons.json', 'utf8'));
const SEASON = seasonArg || seasons.current;
const meta = seasons.list.find((s) => s.id === SEASON);
if (!meta) { console.error(`seasons.json 里没有 ${SEASON}`); process.exit(2); }

const post = (path, body) =>
  fetch(BASE + '/api' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ADMIN, season: SEASON, ...body }),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));

const cfg = JSON.parse(readFileSync('public/config.json', 'utf8'));
const anime = JSON.parse(readFileSync(`public/season/${SEASON}.json`, 'utf8'));
const BY = new Map(anime.list.map((a) => [a.id, a]));
const DIR = 'public/archive';
const FILE = `${DIR}/${SEASON}.json`;

if (cmd === 'export') {
  const r = await post('/results', {});
  if (!r.ok) { console.error('拉取失败:', r.error || r.status); process.exit(1); }
  if (!r.ballots) { console.error('服务端没返回原始票面，确认用的是管理员口令'); process.exit(1); }

  const rows = r.tally
    .map((t) => ({
      id: t.id,
      name: (BY.get(t.id) || {}).name_cn || '#' + t.id,
      url: (BY.get(t.id) || {}).url || '',
      votes: t.votes,
      miss: cfg.required.filter((role) => !(t.roles[role] || []).length),
      roles: t.roles,
      reasons: t.reasons,
    }))
    .sort((a, b) => a.miss.length - b.miss.length || b.votes - a.votes);

  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify({
    season: SEASON, label: meta.label, status: meta.status,
    exportedAt: new Date().toISOString(),
    roles: cfg.roles, required: cfg.required,
    voters: r.voters, ballots: r.ballots, tally: rows,
  }, null, 1));

  // 再出一份 markdown：档案是给人看的，json 是给机器回灌的
  const md = [
    `# ${meta.label} 译制提名存档`,
    '',
    `导出时间 ${new Date().toISOString().slice(0, 10)} ｜ ${r.voters.length} 人提名 ｜ ${rows.length} 部番上榜 ｜ ${rows.filter((x) => !x.miss.length).length} 部人手齐`,
    '',
    `| # | 番剧 | 提名 | 人手 | ${cfg.roles.join(' | ')} |`,
    `|---|---|---|---|${cfg.roles.map(() => '---').join('|')}|`,
    ...rows.map((t, i) =>
      `| ${i + 1} | [${t.name}](${t.url}) | ${t.votes} | ${t.miss.length ? '缺 ' + t.miss.join('/') : '齐'} | ` +
      cfg.roles.map((role) => (t.roles[role] || []).join('、') || '').join(' | ') + ' |'),
    '',
    '## 提名理由',
    '',
    ...rows.filter((t) => t.reasons.length).flatMap((t) => [
      `**${t.name}**`, '',
      ...t.reasons.map((x) => `- ${x.name}：${x.reason}`), '',
    ]),
  ].join('\n');
  writeFileSync(`${DIR}/${SEASON}.md`, md);

  console.log(`${FILE}  ${r.ballots.length} 张票`);
  console.log(`${DIR}/${SEASON}.md    ${rows.length} 部番`);
  console.log(`\n把 seasons.json 里 ${SEASON} 的 status 改成 closed 再部署，`);
  console.log('这一季的汇总就改从存档读，一次 KV 都不用。');
  console.log(`提交进 git 完成留档：git add public/archive && git commit -m "archive ${SEASON}"`);
} else if (cmd === 'restore') {
  if (!existsSync(FILE)) { console.error(`没有 ${FILE}`); process.exit(2); }
  const arc = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const b of arc.ballots) {
    const r = await post('/vote', { name: b.name, picks: b.picks, overwrite: true });
    console.log(r.ok ? `OK  ${b.name} ${b.picks.length} 部` : `失败 ${b.name}: ${r.error}`);
  }
  console.log(`\n${arc.ballots.length} 张票已回灌到 ${SEASON}`);
} else {
  console.log('用法: node archive.mjs export|restore [季度]');
}
