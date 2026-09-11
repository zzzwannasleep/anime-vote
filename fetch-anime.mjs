// 抓取指定年月的新番 -> public/season/<年>-<月>.json，并把该季登记进 public/seasons.json
// 用法: node fetch-anime.mjs 2027 1 [--all] [--current] [--world]
//   --all      连剧场版/OVA 一起要（默认只 TV/WEB）
//   --current  抓完把这一季设为默认打开的季度
//   --world    连非日本的动画一起要（默认只留日漫）
//
// 两段式抓取：搜索接口拿列表，再逐部拉 /v0/subjects/{id} 补 staff。
// 详情接口一次只能一部，所以这里会串行几十个请求，慢是正常的——
// 一季只跑一次，结果落成静态文件，运行时不再碰外部 API。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const [year, month] = [process.argv[2] || '2026', process.argv[3] || '10'];
const keepAll = process.argv.includes('--all');
const keepWorld = process.argv.includes('--world');
const setCurrent = process.argv.includes('--current');
const UA = 'AnimeVote/1.0 (https://github.com/zzzwannasleep/anime-vote)';
// bgm 的这两个接口都匿名可用（实测 200，带个瞎编的 token 也照样 200，它压根不看）。
// 留这个口子只是给 CI 用：GitHub Actions 出口 IP 是共享的，真被限流了
// 就去仓库 Settings -> Secrets 加一条 BANGUMI_TOKEN，不加也能跑。
const TOKEN = process.env.BANGUMI_TOKEN || '';

const pad = (n) => String(n).padStart(2, '0');
const SEASON = `${year}-${pad(month)}`;
const LABEL = `${year}年${Number(month)}月`;
const from = `${year}-${pad(month)}-01`;
const to = Number(month) === 12 ? `${Number(year) + 1}-01-01` : `${year}-${pad(Number(month) + 1)}-01`;

const bgm = (path, init) =>
  fetch('https://api.bgm.tv' + path, { ...init, headers: {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
    ...(init?.headers),
  } });

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

/* 只留日漫。bgm 的 type=2 里混着美漫、法国动画、国产动画，条目结构跟日本番一模一样，
   platform 也照样是 TV / WEB，光按 platform 过滤分不开：2026-10 那一季就漏进来
   探险时光、降世神通、极恶老大、闹鬼酒店、Dreamland 五部。

   判据按「看字形分不分得出来」拆成两档，一刀切会误杀：
     中文圈和韩国的条目，staff 名单也是汉字，跟日文名长得一模一样，
       字形帮不上忙，只能认标签 -> 硬否决。
     欧美的条目字形就分得开（staff 全是拉丁字母），所以标签只当补充证据，
       可以被日文 staff 推翻。必须能推翻：Cyberpunk: Edgerunners 是 TRIGGER 做的日本番，
       但它被一堆人同时打了「日本」和「欧美」两个标签，硬否决就会把它误杀。
   制作名单里出现假名/汉字，是最硬的产地证据，比用户随手打的标签可信得多。
   残留的缺口：没有任何产地标签、标题又是纯中文的国产番会漏进来。
   bgm 上这类基本都被标过「国产」，真漏了就往 CJK_REGION 里补一条。 */
const CJK_REGION = /^(中国|中国大陆|中国动画|国产|国产动画|国漫|台湾|香港|港台|韩国|韩国动画|韩国动漫|韩漫改)$/;
const WEST = /^(欧美|美漫|美国|美国动画|英国|英国动画|法国|法国动画|德国|加拿大|西班牙|意大利|爱尔兰|俄罗斯|波兰|丹麦|巴西|印度|泰国|越南)$/;
const JP_CHAR = /[\u3040-\u30ff\u3400-\u9fff]/;          // 假名或汉字
const isJP = (s, staff) => {
  const tags = (s.tags || []).map((t) => t.name);
  if (tags.some((t) => CJK_REGION.test(t))) return false;
  if (staff.some(([, v]) => JP_CHAR.test(v))) return true;
  return !tags.some((t) => WEST.test(t)) && JP_CHAR.test(s.name || '');
};

const list = [];
const dropped = [];
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

  if (!keepWorld && !isJP(s, staff)) {
    dropped.push(s.name_cn || s.name);
    process.stderr.write(`非日漫，跳过 ${s.name_cn || s.name}\n`);
    continue;
  }

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
const OUT = `public/season/${SEASON}.json`;
// updated 无条件写当前时间的话，定时任务每周都会提交一个只改时间戳的空 diff，
// 工作流里那句「数据没变化，不提交」就永远轮不到——番剧没变就沿用旧时间戳。
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const unchanged = prev && JSON.stringify(prev.list) === JSON.stringify(list);
writeFileSync(OUT, JSON.stringify({
  season: SEASON,
  label: LABEL,
  updated: unchanged ? prev.updated : new Date().toISOString(),
  count: list.length,
  list,
}, null, 1));

const SEASONS = 'public/seasons.json';
const cur = existsSync(SEASONS) ? JSON.parse(readFileSync(SEASONS, 'utf8')) : { current: SEASON, list: [] };
const row = cur.list.find((x) => x.id === SEASON);
if (row) row.label = LABEL;
else cur.list.push({ id: SEASON, label: LABEL, status: 'open' });
cur.list.sort((a, b) => b.id.localeCompare(a.id));      // 新的季度排前面
if (setCurrent || !cur.list.some((x) => x.id === cur.current)) cur.current = SEASON;
writeFileSync(SEASONS, JSON.stringify(cur, null, 2));

const withStaff = list.filter((x) => x.staff.length).length;
console.log(`\n${list.length} 部 -> ${OUT}（${withStaff} 部带 staff${unchanged ? '，跟上次一模一样' : ''}）`);
console.log(`seasons.json 现有 ${cur.list.length} 季，当前 = ${cur.current}`);
// 把筛掉的打出来，误伤了当场看得见（真误伤就 --world 重跑一次）
if (dropped.length) console.log(`筛掉 ${dropped.length} 部非日本动画：${dropped.join('、')}`);
