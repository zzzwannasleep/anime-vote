// 抓取指定年月的新番 -> public/season/<年>-<月>.json，并把该季登记进 public/seasons.json
// 用法: node fetch-anime.mjs 2027 1 [--all] [--current]
//   --all      连剧场版/OVA 一起要（默认只 TV/WEB）
//   --current  抓完把这一季设为默认打开的季度
//
// 两段式抓取：搜索接口拿列表，再逐部拉 /v0/subjects/{id} 补 staff。
// 详情接口一次只能一部，所以这里会串行几十个请求，慢是正常的——
// 一季只跑一次，结果落成静态文件，运行时不再碰外部 API。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const [year, month] = [process.argv[2] || '2026', process.argv[3] || '10'];
const keepAll = process.argv.includes('--all');
const setCurrent = process.argv.includes('--current');
const UA = 'AnimeVote/1.0 (https://github.com/subteam/voteweb)';

const pad = (n) => String(n).padStart(2, '0');
const SEASON = `${year}-${pad(month)}`;
const LABEL = `${year}年${Number(month)}月`;
const from = `${year}-${pad(month)}-01`;
const to = Number(month) === 12 ? `${Number(year) + 1}-01-01` : `${year}-${pad(Number(month) + 1)}-01`;

const bgm = (path, init) =>
  fetch('https://api.bgm.tv' + path, { ...init, headers: { 'User-Agent': UA, 'Content-Type': 'application/json', ...(init?.headers) } });

/* 1. 列表 */
const all = [];
for (let offset = 0; ; offset += 20) {
  const res = await bgm(`/v0/search/subjects?limit=20&offset=${offset}`, {
    method: 'POST',
    body: JSON.stringify({
      keyword: '',
      sort: 'rank', // bgm 只支持 rank/match/heat/score，date 会 400
      filter: { type: [2], air_date: [`>=${from}`, `<${to}`], nsfw: false },
    }),
  });
  if (!res.ok) throw new Error(`bgm ${res.status}: ${await res.text()}`);
  const { data = [], total = 0 } = await res.json();
  all.push(...data);
  process.stderr.write(`列表 ${all.length}/${total}\n`);
  if (!data.length || all.length >= total) break;
}

const picked = all.filter((s) => keepAll || ['TV', 'WEB'].includes(s.platform));

/* 2. 逐部补 staff。聚焦卡片要展示导演/原作/制作，这些只在详情接口的 infobox 里 */
// infobox 的 key 在不同条目上叫法不一，同义的归成一个显示名，顺序即卡片上的展示顺序
const STAFF_KEYS = [
  ['导演', ['导演', '監督', '总导演']],
  ['原作', ['原作']],
  ['系列构成', ['系列构成', '脚本']],
  ['人物设定', ['人物设定', '角色设定']],
  ['音乐', ['音乐']],
  ['动画制作', ['动画制作', '製作', '制作']],
];
// infobox 的 value 可能是字符串，也可能是 [{v:'甲'},{v:'乙'}]
const flat = (v) => (Array.isArray(v) ? v.map((x) => x?.v).filter(Boolean).join('、') : String(v || ''))
  .replace(/\s+/g, ' ').trim().slice(0, 60);

const list = [];
for (const [i, s] of picked.entries()) {
  let info = {};
  try {
    const r = await bgm(`/v0/subjects/${s.id}`);
    if (r.ok) info = await r.json();
  } catch { /* 单部拉失败不该毁掉整季，留空即可 */ }
  const box = info.infobox || [];
  const staff = STAFF_KEYS
    .map(([label, aliases]) => [label, flat(box.find((b) => aliases.includes(b.key))?.value)])
    .filter(([, v]) => v);

  list.push({
    id: s.id,
    name: s.name,
    name_cn: s.name_cn || s.name,
    date: s.date,
    platform: s.platform,
    eps: info.eps || info.total_episodes || 0,
    score: info.rating?.score || 0,
    cover: s.images?.common || s.images?.medium || 'https://lain.bgm.tv/img/no_icon_subject.png',
    // 聚焦面板要能完整读简介，比列表页那 200 字放宽
    summary: (info.summary || s.summary || '').replace(/\s+/g, ' ').slice(0, 500),
    staff,
    tags: (s.tags || []).slice(0, 8).map((t) => t.name),
    url: `https://bgm.tv/subject/${s.id}`,
  });
  process.stderr.write(`详情 ${i + 1}/${picked.length} ${s.name_cn || s.name}\r`);
  await new Promise((r) => setTimeout(r, 120));   // 别把 bgm 打疼了
}
process.stderr.write('\n');
list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

/* 3. 落盘 + 登记季度 */
if (!existsSync('public/season')) mkdirSync('public/season', { recursive: true });
writeFileSync(`public/season/${SEASON}.json`,
  JSON.stringify({ season: SEASON, label: LABEL, updated: new Date().toISOString(), count: list.length, list }, null, 1));

const SEASONS = 'public/seasons.json';
const cur = existsSync(SEASONS) ? JSON.parse(readFileSync(SEASONS, 'utf8')) : { current: SEASON, list: [] };
const row = cur.list.find((x) => x.id === SEASON);
if (row) row.label = LABEL;
else cur.list.push({ id: SEASON, label: LABEL, status: 'open' });
cur.list.sort((a, b) => b.id.localeCompare(a.id));      // 新的季度排前面
if (setCurrent || !cur.list.some((x) => x.id === cur.current)) cur.current = SEASON;
writeFileSync(SEASONS, JSON.stringify(cur, null, 2));

const withStaff = list.filter((x) => x.staff.length).length;
console.log(`\n${list.length} 部 -> public/season/${SEASON}.json（${withStaff} 部带 staff）`);
console.log(`seasons.json 现有 ${cur.list.length} 季，当前 = ${cur.current}`);
