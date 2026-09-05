// 由 public/index.html 生成一个自带数据的单文件静态预览，用来在没有 Worker 的环境里看 UI 和动效
// 用法：先 `npx wrangler dev` 起服务并 `node seed.mjs`，再 `node make-preview.mjs [输出路径] [--artifact]`
// 交互逻辑一行不改，只把数据源换成内嵌、把 GSAP 换成 CDN，这样预览里看到的行为就是产品的行为
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let ADMIN = process.env.ADMIN_PASSWORD;
if (!ADMIN && existsSync('.dev.vars'))
  ADMIN = (readFileSync('.dev.vars', 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1];
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'preview.html';
const GSAP_VER = '3.15.0';

const cfg = JSON.parse(readFileSync('public/config.json', 'utf8'));
const seasons = JSON.parse(readFileSync('public/seasons.json', 'utf8'));
const SEASON = process.env.SEASON || seasons.current;
const anime = JSON.parse(readFileSync(`public/season/${SEASON}.json`, 'utf8'));
const icon = 'data:image/png;base64,' + readFileSync('public/icon.png').toString('base64');

const results = await fetch(BASE + '/api/results', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: ADMIN, season: SEASON }),
}).then((r) => r.json());
if (!results.ok) throw new Error('拉不到汇总数据，先起 wrangler dev 并跑 node seed.mjs');
delete results.ballots;        // 预览里不需要原始票面，也别把它带进一个会被转发的文件

// 预览只带上榜的番 + 补足到 18 部，够看网格、聚焦面板和排序，文件也不至于太大
const onBoard = new Set(results.tally.map((t) => t.id));
const list = [...anime.list.filter((a) => onBoard.has(a.id)),
              ...anime.list.filter((a) => !onBoard.has(a.id))].slice(0, 18);

let html = readFileSync('public/index.html', 'utf8');

// 1. GSAP 换成 CDN（字节数与本地 vendor 完全一致，是同一份构建）
for (const f of ['gsap.min.js', 'Flip.min.js'])
  html = html.replace(`<script src="vendor/${f}"></script>`,
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/${GSAP_VER}/${f}"></script>`);

// 2. 图标内联，预览是单文件
html = html.split('href="icon.png"').join(`href="${icon}"`).split('src="icon.png"').join(`src="${icon}"`);

// 3. 数据源换成内嵌，其余逻辑原样
const mock = `<script>window.__P__=${JSON.stringify({
  cfg, seasons, anime: { ...anime, list }, results,
})};</script>\n`;
html = html.replace('<script src="https://cdnjs', mock + '<script src="https://cdnjs');

html = html.replace(/const api = async \(path, body\) => \{[\s\S]*?\n\};/,
`const api = async (path) => {
  await new Promise((r) => setTimeout(r, 140));           // 装一点网络延迟，好看出按钮的加载态
  if (path === '/results') return window.__P__.results;
  if (path === '/auth') return { ok: true, role: 'voter', name: '预览',
    seasons: window.__P__.seasons.list, current: window.__P__.seasons.current };
  if (path === '/register') return { ok: true, name: '预览', key: 'DEMO-DEMO-DEMO' };
  return { ok: true };
};`);

html = html.replace("fetch('config.json').then((r) => r.json())", 'Promise.resolve(window.__P__.cfg)');
html = html.replace("fetch('season/' + SEASON + '.json').then((r) => r.json())", 'Promise.resolve(window.__P__.anime)');
// 启动分支整段换掉：预览版没有后端，直接进站。
// 这一段是 index.html 末尾的 if/else if，改了那边这里会 throw，不会静默留一半
{
  const START = 'if (INVITE) {';
  const at = html.indexOf(START);
  const end = html.indexOf('\n}', html.indexOf('} else if', at)) + 2;
  if (at < 0 || end < 2) throw new Error('index.html 的启动分支变了，make-preview 要跟着改');
  html = html.slice(0, at) + "enter('preview');   // 预览版跳过注册和密钥" + html.slice(end);
}

// 预览里提交没有后端，别让人以为真提交了
html = html.replace("btn.textContent = '提交中';",
  "btn.textContent = '提交中';\n    if (window.__P__) { alert('这是预览版，提交不会真的写入数据'); btn.disabled = false; btn.textContent = '提交'; return; }");

// --artifact：剥掉外层骨架，因为 Artifact 平台会自己包 doctype/html/head/body
if (process.argv.includes('--artifact')) {
  const cut = html.indexOf('<title>');
  html = html.slice(cut)
    .replace(/<link rel="(apple-touch-)?icon"[^>]*>/g, '')
    .replace(/<\/head>|<body>|<\/body>|<\/html>/g, '')
    .trim();
}
writeFileSync(OUT, html);
console.log(`${OUT}  ${(html.length / 1024).toFixed(0)} KB  ·  ${SEASON} · ${list.length} 部番剧 · ${results.voters.length} 人提名数据`);
