// 前端静态自检：不需要起服务，改完 public/ 直接 `node preflight.mjs`
// 挡的是「肉眼看不出、但会让页面退化或直接坏掉」的东西
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra); }
};

const html = readFileSync('public/index.html', 'utf8');
const cfg = JSON.parse(readFileSync('public/config.json', 'utf8'));
const seasons = JSON.parse(readFileSync('public/seasons.json', 'utf8'));

console.log('\n[JS 能不能跑]');
{
  // 一个语法错就整页白屏，而且不会有任何提示，必须静态挡住
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc)[^>]*>([\s\S]*?)<\/script>/g)];
  ok(blocks.length === 1, `内联 script 恰好 1 块（实得 ${blocks.length}）`);
  let syntaxOK = true, err = '';
  try { new Function('gsap', 'Flip', blocks.map((b) => b[1]).join('\n')); }
  catch (e) { syntaxOK = false; err = e.message; }
  ok(syntaxOK, '内联 JS 语法可解析', err);

  for (const dep of ['gsap.min.js', 'Flip.min.js']) {
    ok(existsSync('public/vendor/' + dep) && statSync('public/vendor/' + dep).size > 1000,
       `vendor/${dep} 随包部署（不靠外部 CDN）`);
    ok(html.includes('vendor/' + dep), `index.html 引用了 vendor/${dep}`);
  }
  ok(!/https?:\/\/(cdn|unpkg|cdnjs|jsdelivr)/i.test(html), '没有外部 CDN 依赖（国内访问不稳）');

  // 页面里出现的 $('#x') 都得在 HTML 里真有这个 id，否则运行时 null.onclick 直接白屏
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...new Set([...html.matchAll(/\$\('#([a-zA-Z][\w-]*)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((x) => !ids.has(x));
  ok(!missing.length, `${used.length} 个 $('#id') 全都能在 HTML 里找到`, missing.join(','));
}

console.log('\n[品牌与外观]');
{
  ok(existsSync('public/icon.png') && statSync('public/icon.png').size > 500, '站点图标 icon.png 就位');
  ok(/<link rel="icon" href="icon\.png">/.test(html), 'HTML 声明了 favicon');
  ok((html.match(/<title>([^<]+)<\/title>/) || [])[1] === cfg.title,
     `<title> 与 config.json 标题一致（${cfg.title}）`);

  const dash = [], emoji = [];
  html.split('\n').forEach((ln, i) => {
    if ([...ln].some((c) => c === '—' || c === '–')) dash.push(i + 1);
    if ([...ln].some((c) => {
      const p = c.codePointAt(0);
      return (p >= 0x1f300 && p <= 0x1faff) || (p >= 0x2600 && p <= 0x27bf) || p === 0x2705 || p === 0x26a0;
    })) emoji.push(i + 1);
  });
  ok(!dash.length, '零 em-dash / en-dash', dash.join(','));
  ok(!emoji.length, '零 emoji（图标用真图和 CSS，不用表情符号）', emoji.join(','));

  // 形状锁：全站圆角只允许 var(--r)，唯一例外是圆形角标的 50% 和手机上铺满屏的 0
  const radii = [...html.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
  const offenders = radii.filter((r) => !r.startsWith('var(--r)') && r !== '50%' && r !== '0');
  ok(!offenders.length, `形状锁：${radii.length} 处圆角全部用 var(--r)`, [...new Set(offenders)].join(' | '));
  ok(radii.length > 5, '圆角确实被统一定义过（不是零散硬编码）');
}

console.log('\n[两套主题]');
const themes = {};
{
  const grab = (sel) => {
    const m = html.match(new RegExp(sel.replace(/[[\]]/g, '\\$&') + '\\{([\\s\\S]*?)\\n\\}'));
    return Object.fromEntries([...(m ? m[1] : '').matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
  };
  themes.light = grab(':root');
  themes.dark = grab(':root[data-theme=dark]');

  ok(Object.keys(themes.dark).length > 10, `深色板定义了 ${Object.keys(themes.dark).length} 个变量`);
  // 深色板漏一个变量，那个颜色就悄悄沿用浅色，多半是深底上印浅字
  const holes = Object.keys(themes.dark).filter((k) => !(k in themes.light));
  const leaks = ['bg','sf','sf-2','line','line-2','fg','fg-2','fg-3','ph','brand','acc','acc-h','on-acc','ok','warn','bar','glow','ov']
    .filter((k) => !(k in themes.dark));
  ok(!holes.length, '深色板没有浅色板里不存在的变量', holes.join(','));
  ok(!leaks.length, '关键颜色深色板全都重定义了（漏一个就是深底浅字）', leaks.join(','));

  ok(/data-theme=dark\]\{[\s\S]*?color-scheme:dark/.test(html), '深色主题声明了 color-scheme（滚动条和表单控件才跟着变）');
  ok(/localStorage\.getItem\('theme'\)/.test(html) && /prefers-color-scheme: dark/.test(html),
     '主题默认跟随系统，手动切过之后记住手动的');
  ok(/document\.documentElement\.dataset\.theme/.test(html), 'JS 会在 <html> 上钉住主题（深色只写一份的前提）');
}

console.log('\n[无障碍 · 两套配色都要达标]');
{
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (h) => {
    const c = hex(h).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const norm = (h) => (h && h.length === 4 ? '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h);

  const PAIRS = [
    ['fg', 'bg', '正文'], ['fg-2', 'bg', '次要文字'], ['fg-3', 'bg', '最浅一档文字'],
    ['brand', 'bg', '品牌色'], ['acc', 'sf', '樱色作文字'], ['acc', 'bg', '樱色在底色上'],
    ['ok', 'sf', '人手齐-青'], ['warn', 'sf', '缺岗-琥珀'],
    ['on-acc', 'acc', '主按钮字压在樱色上'], ['ph', 'sf-2', '输入框 placeholder'],
  ];
  for (const [theme, vars] of Object.entries(themes))
    for (const [a, b, label] of PAIRS) {
      const [x, y] = [norm(vars[a]), norm(vars[b])];
      const r = x && y && x[0] === '#' && y[0] === '#' ? cr(x, y) : 0;
      ok(r >= 4.5, `[${theme}] ${label} ${r.toFixed(2)}:1 达 WCAG AA`, x + ' on ' + y);
    }

  ok(/prefers-reduced-motion/.test(html), 'CSS 里处理了 prefers-reduced-motion');
  ok(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(html), 'JS 里也读了（GSAP 会绕过 CSS）');
  ok(/:focus-visible/.test(html), '有 :focus-visible 键盘焦点样式');
  ok(/alt="[^"]/.test(html), '图片有非空 alt');
  ok((html.match(/aria-label=/g) || []).length >= 5, '无文字标签的控件都有 aria-label');
  ok(/role="dialog"[^>]*aria-modal="true"/.test(html), '聚焦面板声明了 dialog + aria-modal');
}

console.log('\n[聚焦面板 · 飞行层]');
{
  // 踩过的坑：原来把卡片里的真实海报节点搬进面板，靠 Flip 做位移。
  // 但它两头的祖先（网格侧 .card、面板侧 #fxPoster）都是 overflow:hidden，
  // 节点飞到半路被裁掉，观感是「原地消失、那边出现」，卡片被视口切一半时最明显。
  // 现在改成 position:fixed 的替身挂在 body 下，绝不能再有裁剪祖先。
  ok(/\.flyer\{position:fixed/.test(html), '飞行替身是 position:fixed');
  ok(/document\.body\.appendChild\(el\)/.test(html), '替身挂在 body 下（.card 和 #fxPoster 都会裁剪，不能挂进去）');
  ok(!/\$\('#fxPoster'\)\.appendChild\(poster\)/.test(html), '不再搬运卡片里的真实海报节点');
  ok(/\.card\.flying \.poster\{visibility:hidden\}/.test(html), '替身在飞时原位那张先藏起来（否则同时出现两张）');
  ok(/scale: to\.width \/ from\.width/.test(html), '用等比 scale 而不是动 width（两端都是 2:3，纯 transform 最省）');

  // 上一版的实测故障：关闭时只有背板淡出，正文和输入框 opacity 全程 1，
  // 直到 display:none 把它们硬切掉，看着就是「字悬在空中等动画跑完」
  const chrome = (html.match(/const CHROME = \[([^\]]*)\]/) || ['', ''])[1];
  for (const part of ['.fx-back', '.fx-sheet', '.fx-body', '.fx-nav', '#fxClose'])
    ok(chrome.includes(part), `关闭时 ${part} 跟着一起淡出`);
  ok(/gsap\.to\(CHROME, \{ opacity: 0/.test(html), '关闭动画确实对整组 CHROME 生效');

  ok(/function lockScroll/.test(html) && /innerWidth - document\.documentElement\.clientWidth/.test(html),
     '锁背景滚动时补回滚动条宽度（不补的话页面横跳，海报落点就偏了）');
  ok(/usable\(from\) \|\| !usable\(to\)/.test(html), '卡片不在视口里就不硬飞，直接落位');

  ok(/function render\(\) \{\s*\n\s*if \(FX !== null\) closeFocus\(true\)/.test(html),
     'render() 第一件事就是把聚焦面板收掉（否则面板里还是旧番）');
  ok(/Escape/.test(html) && /ArrowLeft/.test(html), '面板支持 Esc 关闭、方向键翻页');
  ok(/body\.locked\{overflow:hidden\}/.test(html) && /classList\.add\('locked'\)/.test(html),
     '面板打开时锁住背景滚动');
  ok(/#focus\{[^}]*position:fixed/.test(html), '面板是 fixed 覆盖层，不是把网格行拉长');
  ok(!/\.slot\{overflow:hidden;height:0\}/.test(html), '旧的「卡片内展开岗位区」已经删干净（那个会把整行拉长）');
  ok(/\.poster-slot\{[^}]*aspect-ratio:2\/3/.test(html), '.poster-slot 自己撑住 2/3 比例（海报是 absolute，塌了网格少一格）');

  // from 被中途打断会把「当前值」记成终点，下次再开就卡在半透明
  ok(!/gsap\.from\('\.fx-body/.test(html), '面板入场用 fromTo 而不是 from（打断重开不会卡在半透明）');
}

console.log('\n[响应式]');
{
  ok(/@media \(max-width:760px\)/.test(html), '有移动端断点');
  const mobile = (html.match(/@media \(max-width:760px\)\{([\s\S]*?)\n\}/) || ['', ''])[1];
  ok(/#focus\{padding:0/.test(mobile), '手机上聚焦面板铺满整屏');
  ok(/grid-template-columns:1fr/.test(mobile), '手机上面板从左右分栏改成单列');
  ok(/minmax\(13\d px?/.test(mobile) || /minmax\(1\d\dpx/.test(mobile), '手机上网格列宽收窄');
  ok(/\.mark\{width:34px/.test(mobile), '手机上角标放大到 34px（手指点得中）');
  ok(/100dvh/.test(html) && !/100vh/.test(html), '用 dvh 不用 vh（iOS 地址栏收起时不跳）');
}

console.log('\n[动效实现方式]');
{
  ok(!/addEventListener\(['"]scroll['"]/.test(html), '没有 scroll 事件监听（用 IntersectionObserver）');
  ok(/IntersectionObserver/.test(html), '滚动入场用 IntersectionObserver');
  ok(/Flip\.getState[\s\S]{0,1200}Flip\.from/.test(html), '排序重排用 Flip（getState 后必须配 from）');

  // 踩过的坑：absolute:true 让 .item 脱离文档流，父容器高度瞬间塌陷成 0，
  // 条目糊成一团、页面高度暴跳，表现就是「动效卡住 + 内容重叠」。
  // absolute 本身是对的（交换时互不挤压），但必须和「钉住容器高度」成对出现
  const flipCall = (html.match(/Flip\.from\(state, \{\s*\n\s*absolute[\s\S]{0,500}?\n\s*\}\);/) || [''])[0];
  const usesAbs = /absolute\s*:\s*true/.test(flipCall);
  const locksH = /gsap\.set\(rank, \{ height: lockH \}\)/.test(html) && /clearProps: 'height'/.test(html);
  ok(!usesAbs || locksH, 'Flip 用 absolute 时钉住了容器高度（这两件事必须成对，否则容器塌陷）');
  ok(/let flipping = false/.test(html) && /if \(sortMode === mode \|\| flipping\) return/.test(html),
     '排序有动画锁，连点两个按钮不会让动画打架');

  // 只动 transform / opacity / height，别的属性会触发 layout 抖动
  // 只认属性位置的冒号：三元表达式里的 `flew ? .3 : .22` 也带冒号，会被误当成属性名
  const props = [...html.matchAll(/gsap\.(?:to|from|fromTo|set)\([^)]*?\{([^}]*)\}/g)]
    .flatMap((m) => [...('{' + m[1]).matchAll(/[{,]\s*(\w+)\s*:/g)].map((x) => x[1]));
  const allowed = new Set(['opacity','x','y','scale','scaleX','rotate','height','width','clearProps',
                           'duration','delay','stagger','ease','onUpdate','onComplete','v','targets']);
  const bad = [...new Set(props.filter((p) => !allowed.has(p)))];
  ok(!bad.length, '动画属性都在 transform / opacity / height 白名单内', bad.join(','));
}

console.log('\n[配置与季度自洽]');
{
  ok(Array.isArray(cfg.roles) && cfg.roles.length > 0, `config.json 有 ${cfg.roles.length} 个岗位：${cfg.roles.join(' ')}`);
  ok(cfg.required.every((r) => cfg.roles.includes(r)),
     'required 岗位都在 roles 里（否则出现永远补不齐的幽灵岗）',
     cfg.required.filter((r) => !cfg.roles.includes(r)).join(','));
  ok(new Set(cfg.roles).size === cfg.roles.length, 'roles 无重复');

  ok(seasons.list.length > 0, `seasons.json 登记了 ${seasons.list.length} 季`);
  ok(seasons.list.some((s) => s.id === seasons.current), `current「${seasons.current}」在季度表里`);
  const badId = seasons.list.filter((s) => !/^\d{4}-\d{2}$/.test(s.id));
  ok(!badId.length, '季度 id 都是 YYYY-MM', badId.map((s) => s.id).join(','));
  const badStatus = seasons.list.filter((s) => !['open', 'closed'].includes(s.status));
  ok(!badStatus.length, "季度 status 只能是 open / closed", badStatus.map((s) => s.id + ':' + s.status).join(','));
  const noFile = seasons.list.filter((s) => !existsSync(`public/season/${s.id}.json`));
  ok(!noFile.length, '每一季都有对应的番剧数据文件', noFile.map((s) => s.id).join(','));
  ok(seasons.list.filter((s) => s.status === 'open').length >= 1, '至少有一季是开着的，不然谁都投不了票');

  // 已截止的季度应当有存档：有存档才走「零 KV 读」那条路，没有就悄悄退回 KV
  for (const s of seasons.list.filter((x) => x.status === 'closed')) {
    const f = `public/archive/${s.id}.json`;
    ok(existsSync(f), `${s.id} 已截止且有存档文件（汇总才不消耗 KV）`, f);
    if (existsSync(f)) {
      const a = JSON.parse(readFileSync(f, 'utf8'));
      ok(Array.isArray(a.ballots) && a.ballots.length > 0, `${s.id} 存档里有 ${a.ballots && a.ballots.length} 张原始票面`);
      ok(existsSync(`public/archive/${s.id}.md`), `${s.id} 存档带一份 markdown 表格（GitHub 上直接能看）`);
    }
  }

  for (const s of seasons.list) {
    const d = JSON.parse(readFileSync(`public/season/${s.id}.json`, 'utf8'));
    ok(d.list.length > 0 && d.list.every((a) => a.id && a.name_cn && a.cover),
       `${s.id}: ${d.list.length} 部番，id/名字/封面齐全`);
    ok(d.list.every((a) => Array.isArray(a.staff) && Array.isArray(a.tags)),
       `${s.id}: staff / tags 字段结构正确（聚焦面板直接渲染它俩）`);
    ok(new Set(d.list.map((a) => a.id)).size === d.list.length, `${s.id}: 番剧 id 无重复`);
  }

  // 演示数据里的岗位名必须跟白名单对得上，否则灌进去会被服务端全部丢掉
  if (existsSync('seed.mjs')) {
    const seedRoles = [...readFileSync('seed.mjs', 'utf8').matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      // 只认「纯中文 2 到 4 字」的词，不然理由句子里带个「校对」也会被当成岗位名
      .filter((s) => /^[一-龥]{2,4}$/.test(s) && /翻译|校对|时轴|时间轴|特效|压制|分流|片源|总监|后期/.test(s));
    const stale = [...new Set(seedRoles.filter((r) => !cfg.roles.includes(r)))];
    ok(!stale.length, 'seed.mjs 里的岗位名都在白名单内（改名后不会灌出空岗数据）', stale.join(','));
  }
}

console.log('\n[后端契约]');
{
  const w = readFileSync('src/worker.js', 'utf8');
  ok(!/env\.VOTE_PASSWORD/.test(w), '共享口令已经彻底去掉（那是「换个名字就能重投」的洞）');
  // 又一对「必须成对出现」：默认静态资源在 Worker 之前直出，
  // 光在 worker.js 里写 403 是死代码，必须同时把 /archive/* 交给 Worker 先跑。
  // 实测过：只写 403 时 GET /archive/xxx.json 照样返回 200 全文。
  const guard = /pathname\.startsWith\('\/archive\/'\)/.test(w);
  const routed = /run_worker_first\s*=\s*\[[^\]]*["']\/archive\/\*["']/.test(readFileSync('wrangler.toml', 'utf8'));
  ok(guard, 'worker 里挡了 /archive/ 的直接访问');
  ok(!guard || routed, 'wrangler.toml 把 /archive/* 交给 Worker 先跑（不配这条，上面那个 403 是死代码）');
  // 第三对「必须成对出现」：README 教的是在网页后台填 ADMIN_PASSWORD，
  // 而 wrangler 默认把配置文件当唯一真相源，部署时会删掉后台里手填的 vars/secrets
  // （schema 原话：wrangler *will* override/delete them on its next deploy）。
  // 没有 keep_vars = true，推一次代码口令就没了，管理页当场登不进去。
  const toml = readFileSync('wrangler.toml', 'utf8');
  const dashSecret = /Variables and Secrets/.test(readFileSync('README.md', 'utf8'));
  ok(!dashSecret || /^\s*keep_vars\s*=\s*true/m.test(toml),
     'wrangler.toml 有 keep_vars = true（README 教人在后台填口令，不配这条会被部署删掉）');
  // TOML 的顶层键必须写在所有 [表头] 之前。写到表后面会被算成那个表的字段，
  // wrangler 只吐一句 "Unexpected fields found in ..." 的 WARNING 就继续跑，
  // 配置静默失效——踩过一次：keep_vars 掉进了 [[kv_namespaces]] 里。
  ok(toml.indexOf('keep_vars') < toml.search(/^\[/m),
     'keep_vars 写在第一个 [表头] 之前（掉进表里就只是个被忽略的字段，不报错）');
  // 另一条同类：wrangler 靠 id 存不存在来决定要不要自动开 KV
  // （KVHandler.isFullySpecified() { return !!this.binding.id }）。
  // 填个占位符 id，部署照样成功，但线上一读 KV 就炸——比不填危险得多。
  ok(!/\[\[kv_namespaces\]\][^[]*\bid\s*=/.test(toml),
     'kv_namespaces 没写 id（写了就不会自动开 KV，填占位符更是线上一读就炸）');
  // README 里的站内锚点必须指得到真标题。改标题忘了改链接不会有任何报错，
  // 点下去只是无声地不动——刚把「抓番剧数据」改名时就断了一个。
  const md = readFileSync('README.md', 'utf8');
  const slug = (h) => h.trim().toLowerCase()
    .replace(/[`*_]/g, '').replace(/[^\w一-龥 -]/g, '').replace(/ /g, '-');
  const heads = new Set([...md.matchAll(/^#{2,4} (.+)$/gm)].map((m) => slug(m[1])));
  const dead = [...md.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]).filter((a) => !heads.has(a));
  ok(!dead.length, 'README 的站内锚点都指得到真标题', dead.join(' | '));

  // 工作流跑的脚本得真的存在，重命名脚本忘了改工作流只有推上去才会发现
  const wf = readFileSync('.github/workflows/fetch-anime.yml', 'utf8');
  ok(/node fetch-anime\.mjs/.test(wf) && existsSync('fetch-anime.mjs'), '工作流跑的 fetch-anime.mjs 存在');
  ok(/BANGUMI_TOKEN/.test(readFileSync('fetch-anime.mjs', 'utf8')),
     'fetch-anime.mjs 认 BANGUMI_TOKEN（工作流会把它传进来，脚本不读就是白配）');
  const fa = readFileSync('fetch-anime.mjs', 'utf8');
  // updated 无条件写当前时间的话，每次定时跑都会产出一个只改时间戳的 diff，
  // 工作流里「数据没变化，不提交」那条分支就永远是死代码。
  ok(/updated: unchanged \? prev\.updated : new Date/.test(fa),
     '番剧没变时沿用旧的 updated（否则定时任务每周提交一次空 diff）');
  ok(/数据没变化，不提交/.test(wf), '工作流有「没变化就不提交」的分支');

  const ex = readFileSync('.dev.vars.example', 'utf8');
  ok(/^ADMIN_PASSWORD\s*=\s*(#|$)/m.test(ex),
     '.dev.vars.example 只有变量名没有值（它是一键部署按钮的密钥清单，填了值就等于把口令提交了）');
  ok(/archivedBallots/.test(w) && /season\.status === 'open' \? null : await archivedBallots/.test(w),
     '已截止的季度先读存档，读到就不碰 KV');
  ok(/const source = ballots \? 'archive' : 'kv'/.test(w), 'results 回带数据来源，前端和测试才验得了');
  ok(/pathname === '\/api\/register'/.test(w) && /inv\.used/.test(w), '注册码用一次即作废');
  ok(/pathname === '\/admin'/.test(w), '/admin 直出管理页');
  const guarded = ['/api/invite', '/api/invites', '/api/uninvite', '/api/keys', '/api/revoke', '/api/delete', '/api/claim']
    .filter((ep) => new RegExp("pathname === '" + ep + "'\\) \\{\\n\\s*if \\(!admin\\)").test(w));
  ok(guarded.length === 7, `7 个管理端点第一行就查权限（实得 ${guarded.length}）`);
}

console.log('\n[管理页]');
{
  const ad = readFileSync('public/admin.html', 'utf8');
  const bad = [];
  ad.split('\n').forEach((ln, i) => {
    if ([...ln].some((c) => c === '—' || c === '–')) bad.push('dash:' + (i + 1));
    if ([...ln].some((c) => {
      const p = c.codePointAt(0);
      return (p >= 0x1f300 && p <= 0x1faff) || (p >= 0x2600 && p <= 0x27bf);
    })) bad.push('emoji:' + (i + 1));
  });
  ok(!bad.length, '管理页零 emoji 零 em-dash', bad.join(','));
  const radii = [...ad.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
  ok(radii.every((r) => r.startsWith('var(--r)') || r === '50%'), `管理页形状锁：${radii.length} 处圆角都用 var(--r)`);
  ok(/data-theme=dark/.test(ad), '管理页也跟随系统深色');
  // 查的是真调用，不是注释里提到这个词
  ok(!/localStorage\.(set|get)Item/.test(ad), '管理员口令不进 localStorage（刷新就要重输）');
  let good = true, err = '';
  try { new Function([...ad.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')); }
  catch (e) { good = false; err = e.message; }
  ok(good, '管理页内联 JS 语法可解析', err);
}

console.log('\n[凭据没有泄进仓库]');
{
  // 密钥、口令一旦写进任何一个进版本控制的文件，改最新一版是没用的
  const files = ['public/index.html', 'public/admin.html', 'src/worker.js', 'seed.mjs', 'keys.mjs',
                 'archive.mjs', 'test.mjs', 'uitest.mjs', 'wrangler.toml', 'README.md'];
  const hits = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const txt = readFileSync(f, 'utf8');
    // 允许 local-test-* 这种一眼假的本地占位，其余形如 密码=值 的都要拦
    for (const m of txt.matchAll(/(PASSWORD|passwd|token|secret)\s*[:=]\s*['"]([^'"]{4,})['"]/gi))
      // 放过一眼就知道是假的占位：本地测试口令、模板占位、测试里故意填错的值
      if (!/^local-test-|^换成|PUT_YOUR|^Z{4,}|^wrong-|^x$/.test(m[2])) hits.push(`${f}: ${m[1]} = ${m[2].slice(0, 12)}`);
  }
  ok(!hits.length, '源码里没有硬编码的口令 / token', hits.join(' | '));
  ok(/^\.dev\.vars$/m.test(readFileSync('.gitignore', 'utf8')), '.dev.vars 在 .gitignore 里');
  ok(!existsSync('public/keys.json'), '密钥名单没有被写成文件落进仓库');
  const arc = existsSync('public/archive')
    ? readdirSync('public/archive').map((f) => readFileSync('public/archive/' + f, 'utf8')).join('\n') : '';
  ok(!/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/.test(arc), '存档文件里没有密钥形状的字符串');
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
