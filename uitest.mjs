// 真浏览器 UI 回归：起一个 headless Chromium 打开本地服务，走完整流程并断言布局和动效没崩
// 用法：先 `npx wrangler dev` 并 `node seed.mjs`，再 `node uitest.mjs [--shot]`
//   --shot 额外把截图存到 ./shots/
// 用 --no-proxy-server 启动，因为系统级代理常常把 127.0.0.1 也一起吃掉，浏览器会连不上本地服务
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let ADMIN = process.env.ADMIN_PASSWORD;
if (!ADMIN && existsSync('.dev.vars'))
  ADMIN = (readFileSync('.dev.vars', 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1];
if (!ADMIN) { console.error('没有 ADMIN_PASSWORD，见 .dev.vars.example'); process.exit(2); }
ADMIN = ADMIN.trim();
const SHOT = process.argv.includes('--shot');
const WHO = '__ui_' + Date.now();

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) { console.error('找不到 Chrome/Edge，设 CHROME_PATH 环境变量指向可执行文件'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra); }
};
const post = (path, body) =>
  fetch(BASE + '/api' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ADMIN, ...body }),
  }).then((r) => r.json());

const seasons = await (await fetch(BASE + '/seasons.json')).json();
const CLOSED = (seasons.list.find((s) => s.status === 'closed') || {}).id;
const token = (await post('/invite', { count: 1, note: 'uitest' })).tokens[0];

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|lain\.bgm/.test(m.text())) errors.push(m.text()); });

if (SHOT && !existsSync('shots')) mkdirSync('shots');
const shot = async (name) => { if (SHOT) await page.screenshot({ path: `shots/${name}.png`, fullPage: false }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let myKey = '';
try {
  console.log('\n[注册链接]');
  await page.goto(BASE + '/?j=' + token, { waitUntil: 'networkidle2', timeout: 20000 });
  ok(await page.$eval('#paneLogin', (el) => el.classList.contains('hide')), '带注册码进来直接停在注册面板');
  ok(!(await page.$eval('#paneReg', (el) => el.classList.contains('hide'))), '注册面板可见');
  ok(await page.$('#cpass') === null, '进门页没有共享口令输入框了');
  await page.type('#rname', WHO);
  await page.click('#reg');
  await page.waitForFunction(() => !document.getElementById('keyBox').classList.contains('hide'), { timeout: 10000 });
  myKey = await page.$eval('#keyVal', (el) => el.textContent.trim());
  ok(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(myKey), '注册后当场拿到密钥', myKey);
  /* 上一版这里是等 1.8 秒自动跳进站，密钥在屏幕上一闪就没了，文案还说浏览器记住了。
     实际只记在 localStorage 里，换设备就没；密钥字段又写着 autocomplete=off，
     密码管理器也收录不了。组员第二天集体登不进来。现在必须他自己点一下 */
  await wait(2200);
  ok(await page.$eval('#gate', (el) => !el.classList.contains('hide')), '密钥停在屏幕上，不会自己跳走');
  ok(await page.$eval('#keyVal', (el) => el.textContent.trim()) === myKey, '两秒后密钥还看得见');
  const field = await page.$eval('#key', (el) => ({ type: el.type, ac: el.autocomplete, val: el.value }));
  ok(field.type === 'password' && field.ac === 'current-password',
     '密钥字段是 type=password + autocomplete=current-password（密码管理器才认）', field.type + '/' + field.ac);
  ok(field.val === myKey, '登录表单已经填好，点进入时是一次真的表单提交');
  ok(await page.$eval('#uname', (el) => el.value).then((v) => v.length > 0), '配套的用户名字段也填上了');
  await shot('1-注册');

  console.log('\n[进门]');
  await page.click('#keyGo');                                          // 「我已存好，进入」
  await page.waitForSelector('#app:not(.hide)', { timeout: 12000 });
  await wait(1400);
  ok(await page.$eval('#gate', (el) => el.classList.contains('hide')), '密钥通过后进门页收起');
  ok((await page.title()).includes('拨雪寻春'), '标题是「拨雪寻春番剧译制投票」');
  ok(await page.$eval('#meName', (el) => el.textContent) === WHO, '页眉直接显示密钥绑定的名字，不用再填 ID');
  ok(await page.$$eval('#season option', (e) => e.length) >= 1, '季度选择器有选项');

  console.log('\n[被要求删掉的东西真的不在了]');
  {
    const text = await page.$eval('#app', (el) => el.innerText);
    ok(!text.includes('先勾岗位'), '「先勾岗位，之后选番会自动带上」已删除');
    ok(!text.includes('尚未选择'), '「尚未选择」已删除');
    ok(await page.$('#who') === null, '提名页不再有「你的名字 / ID」输入框');
    const roles = await page.$$eval('#myRoles .chip', (els) => els.map((e) => e.textContent));
    ok(!roles.includes('片源') && !roles.includes('总监'), '岗位表里没有片源和总监', roles.join(','));
    ok(roles.includes('时轴') && roles.includes('压制'), '岗位是「时轴」「压制」而不是旧名', roles.join(','));
  }

  console.log('\n[深色 / 浅色]');
  {
    const read = () => page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.body).color,
    }));
    const a = await read();
    await page.click('#theme');
    await wait(400);
    const b = await read();
    ok(a.theme !== b.theme, `主题按钮切换生效（${a.theme} -> ${b.theme}）`);
    ok(a.bg !== b.bg && a.fg !== b.fg, '底色和字色都真的换了', a.bg + ' -> ' + b.bg);
    const dark = b.theme === 'dark' ? b : a;
    const lum = (c) => c.match(/\d+/g).slice(0, 3).reduce((s, x) => s + +x, 0) / 3;
    ok(lum(dark.bg) < 70, `深色模式底色确实是深的（灰度 ${Math.round(lum(dark.bg))}）`, dark.bg);
    await shot('2-深色');
    ok(await page.evaluate(() => localStorage.getItem('theme')) === b.theme, '手动切过的主题记进 localStorage');
    if (b.theme === 'dark') { await page.click('#theme'); await wait(300); }
  }

  console.log('\n[提名页]');
  const cards = await page.$$eval('.card', (els) => els.length);
  ok(cards > 0, `番剧卡片渲染了 ${cards} 张`);
  const invisible = await page.$$eval('.card', (els) =>
    els.filter((e) => e.getBoundingClientRect().top < window.innerHeight && +getComputedStyle(e).opacity < 0.9).length);
  ok(invisible === 0, '首屏卡片入场动画已结束（没有卡在半透明）', String(invisible));

  await page.click('#myRoles .chip');
  await page.click('.card .mark');
  await wait(500);
  ok(await page.$eval('#focus', (el) => el.classList.contains('hide')), '点角标只提名，不打开聚焦面板');
  ok(await page.$eval('.card', (el) => el.classList.contains('on')), '角标点一下就选中了');
  ok(await page.$eval('#n', (el) => el.textContent) === '1', '已选计数变成 1');

  console.log('\n[聚焦动画 · 飞行层真的看得见]');
  let openedCn = '';
  {
    // 上一版的故障：海报节点被搬进面板，两头的 overflow:hidden 把飞行途中的它裁光，
    // 观感是「原地消失、那边出现」；卡片被视口切一半时最明显。这里逐帧量它到底动没动。
    await page.evaluate(() => {
      const c = document.querySelectorAll('.card')[8];
      scrollTo(0, c.getBoundingClientRect().top + scrollY - innerHeight + 120);   // 故意让它被切一半
    });
    await wait(500);
    const probe = await page.evaluate(async () => {
      const card = document.querySelectorAll('.card')[8];
      const halfCut = card.getBoundingClientRect().bottom > innerHeight;
      const gridH0 = document.getElementById('grid').getBoundingClientRect().height;

      const fr = [];
      let run = true;
      const s = () => {
        if (!run) return;
        const f = document.querySelector('.flyer');
        if (f) { const b = f.getBoundingClientRect(); fr.push([Math.round(b.top), Math.round(b.left), Math.round(b.width)]); }
        requestAnimationFrame(s);
      };
      requestAnimationFrame(s);
      card.querySelector('.poster img').click();
      await new Promise((r) => setTimeout(r, 1000));
      run = false;

      // 替身有没有落进会裁剪它的祖先里
      const probeEl = document.createElement('div');
      probeEl.className = 'flyer';
      document.body.appendChild(probeEl);
      const clips = [];
      for (let n = probeEl.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const st = getComputedStyle(n);
        if (st.overflow !== 'visible' && st.position !== 'static') clips.push(n.tagName + ':' + st.overflow);
      }
      probeEl.remove();

      return {
        halfCut, gridH0, clips,
        frames: fr.length,
        distinct: new Set(fr.map((f) => f[0] + ',' + f[1])).size,
        last: fr[fr.length - 1],
        gridH1: document.getElementById('grid').getBoundingClientRect().height,
        panelPosterW: document.getElementById('fxPoster').getBoundingClientRect().width,
        cardPosters: card.querySelectorAll('.poster').length,
        imgOpacity: +getComputedStyle(document.getElementById('fxImg')).opacity,
        panelW: document.querySelector('.fx-card').getBoundingClientRect().width,
        vw: innerWidth,
        cn: document.getElementById('fxCn').textContent,
        staff: document.getElementById('fxStaff').innerText,
        sum: document.getElementById('fxSum').textContent.length,
      };
    });
    openedCn = probe.cn;
    ok(probe.halfCut, '这张卡片确实被视口切成了一半（最容易翻车的那种）');
    ok(probe.frames > 10, `飞行替身出现了 ${probe.frames} 帧`);
    ok(probe.distinct > 10, `替身走过 ${probe.distinct} 个不同位置（动画真的看得见，不是瞬移）`);
    ok(probe.last && Math.abs(probe.last[2] - probe.panelPosterW) < 6,
       `替身落点尺寸对上面板海报（${probe.last && probe.last[2]}px vs ${Math.round(probe.panelPosterW)}px）`);
    ok(!probe.clips.length, '替身没有任何裁剪祖先', probe.clips.join(','));
    ok(Math.abs(probe.gridH1 - probe.gridH0) < 2, `网格高度纹丝不动（${Math.round(probe.gridH0)}px）`);
    ok(probe.cardPosters === 1, '卡片里的海报还在原处（不再搬走）');
    ok(probe.imgOpacity > 0.9, '替身落地后面板海报接上了');
    ok(probe.panelW / probe.vw > 0.5, `面板占 ${Math.round(probe.panelW / probe.vw * 100)}% 视口宽度，是「主导」`);
    ok(probe.cn.length > 0, '面板显示番剧名：' + probe.cn);
    ok(/导演|原作|制作|staff/.test(probe.staff), '面板显示制作名单', probe.staff.slice(0, 30).replace(/\n/g, ' '));
    ok(probe.sum > 5, `面板显示简介（${probe.sum} 字）`);
    await shot('3-聚焦');

    await page.click('#fxNext');
    await wait(700);
    const nxt = await page.$eval('#fxCn', (el) => el.textContent);
    ok(nxt !== openedCn, `下一部切到了「${nxt}」`);
    await page.keyboard.press('ArrowLeft');
    await wait(700);
    ok(await page.$eval('#fxCn', (el) => el.textContent) === openedCn, '方向键能翻回上一部');

    const chipsOn = () => page.$$eval('#fxRoles .chip', (els) => els.filter((e) => !e.disabled).length);
    const picked = () => page.evaluate(() => PICK.has(FX));
    const was = await picked();
    await page.click('#fxPick');
    await wait(400);
    ok(await picked() !== was, '面板里的提名按钮能切换这部番的提名状态');
    ok((await chipsOn()) > 0 === (await picked()), '提名了岗位 chip 才可点，取消了就变灰');
    if (!(await picked())) { await page.click('#fxPick'); await wait(400); }
    const added = await page.evaluate(() => {
      const c = [...document.querySelectorAll('#fxRoles .chip')].find((x) => !x.classList.contains('on'));
      if (c) c.click();
      return c ? c.dataset.r : null;
    });
    await wait(300);
    ok(added && await page.evaluate((r) => PICK.get(FX).roles.has(r), added), '在面板里新勾的岗位存进了这部番', String(added));
  }

  console.log('\n[关闭动画 · 正文必须跟着一起淡出]');
  {
    // 用户报的就是这个：背板没了，字和输入框还悬在原地，等动画跑完才被硬切掉
    const c = await page.evaluate(async () => {
      const op = [];
      let run = true;
      const s = () => {
        if (!run) return;
        op.push({
          body: +getComputedStyle(document.querySelector('.fx-body')).opacity,
          sheet: +getComputedStyle(document.querySelector('.fx-sheet')).opacity,
          poster: +getComputedStyle(document.querySelector('.fx-poster')).opacity,
          nav: +getComputedStyle(document.querySelector('.fx-nav')).opacity,
          flyer: !!document.querySelector('.flyer'),
          hidden: document.getElementById('focus').classList.contains('hide'),
        });
        requestAnimationFrame(s);
      };
      const gridH0 = document.getElementById('grid').getBoundingClientRect().height;
      requestAnimationFrame(s);
      document.getElementById('fxClose').click();
      await new Promise((r) => setTimeout(r, 1000));
      run = false;
      const vis = op.filter((x) => !x.hidden);
      const card = document.querySelectorAll('.card')[8];
      return {
        bodyMin: Math.min(...op.map((x) => x.body)),
        navMin: Math.min(...op.map((x) => x.nav)),
        sheetMin: Math.min(...op.map((x) => x.sheet)),
        posterMin: Math.min(...op.map((x) => x.poster)),
        posterAtHide: (vis[vis.length - 1] || {}).poster,
        bodyAtHide: (vis[vis.length - 1] || {}).body,
        flyerFrames: op.filter((x) => x.flyer).length,
        hidden: op[op.length - 1].hidden,
        gridH0, gridH1: document.getElementById('grid').getBoundingClientRect().height,
        posters: card.querySelectorAll('.poster').length,
        posterVis: getComputedStyle(card.querySelector('.poster')).visibility,
        overflow: getComputedStyle(document.body).overflow,
        padRight: document.body.style.paddingRight,
      };
    });
    ok(c.hidden, '面板关掉了');
    ok(c.bodyMin <= 0.1, `正文淡到了 ${c.bodyMin.toFixed(2)}（上一版全程是 1，被硬切）`);
    ok(c.navMin <= 0.1, `翻页按钮淡到了 ${c.navMin.toFixed(2)}`);
    ok(c.sheetMin <= 0.1, `背板淡到了 ${c.sheetMin.toFixed(2)}`);
    // 用户报的「退出时封面的黑色底卡在那」：海报槽自带底色又不在淡出组里，
    // 别人都淡完了它还是全不透明，直到 display:none 把它硬切掉
    ok(c.posterMin <= 0.1, `海报槽也淡到了 ${c.posterMin.toFixed(2)}（原来全程是 1，退场时就是一块底色卡在那）`);
    ok(c.posterAtHide <= 0.1, `面板被隐藏那一刻海报槽已经是 ${c.posterAtHide}`);
    ok(c.bodyAtHide <= 0.1, `面板被隐藏那一刻正文已经是 ${c.bodyAtHide}（不是悬在原地突然消失）`);
    ok(c.flyerFrames > 10, `回程替身飞了 ${c.flyerFrames} 帧`);
    ok(Math.abs(c.gridH1 - c.gridH0) < 2, '关闭后网格高度回到原样');
    ok(c.posters === 1 && c.posterVis === 'visible', '卡片海报恢复可见，且只有一张');
    ok(c.overflow !== 'hidden' && !c.padRight, '背景恢复可滚动，滚动条补偿也撤掉了');
  }

  console.log('\n[聚焦面板 · 开场第一帧不许闪]');
  {
    /* 报的是「点开时封面会闪现一下，底色也提前冒出来，整块主卡片还会再闪一下」。
       根因是一个：上一版先 remove('hide') 把面板放出来，再 gsap.set opacity 0，
       中间那一帧面板是全亮的。所以这里只看「面板可见的第一帧」，那一帧必须还是透明的 */
    const f = await page.evaluate(async () => {
      const card = document.querySelectorAll('.card')[4];
      scrollTo(0, card.getBoundingClientRect().top + scrollY - 300);
      await new Promise((r) => setTimeout(r, 400));
      const fr = [];
      let run = true;
      const s = () => {
        if (!run) return;
        fr.push({
          back: +getComputedStyle(document.querySelector('.fx-back')).opacity,
          img: +getComputedStyle(document.getElementById('fxImg')).opacity,
          poster: +getComputedStyle(document.querySelector('.fx-poster')).opacity,
          hidden: document.getElementById('focus').classList.contains('hide'),
        });
        requestAnimationFrame(s);
      };
      requestAnimationFrame(s);
      document.querySelectorAll('.card')[4].querySelector('.poster img').click();
      await new Promise((r) => setTimeout(r, 1100));
      run = false;
      const vis = fr.filter((x) => !x.hidden);
      const last = vis[vis.length - 1] || {};
      return {
        n: vis.length, first: vis[0] || {}, last,
        // 底色一路涨上去就行，中途不能先冲到 1 再回落
        backMaxEarly: Math.max(...vis.slice(0, 3).map((x) => x.back)),
        imgMaxEarly: Math.max(...vis.slice(0, 3).map((x) => x.img)),
      };
    });
    ok(f.n > 10, `开场采到 ${f.n} 帧`);
    ok(f.first.back <= 0.15, `面板可见的第一帧底色还是透明的（${f.first.back}）`);
    ok(f.first.img <= 0.15, `第一帧封面没有抢跑（${f.first.img}）`);
    ok(f.backMaxEarly <= 0.5 && f.imgMaxEarly <= 0.5,
       `前三帧底色和封面都还在淡入途中（${f.backMaxEarly} / ${f.imgMaxEarly}）`);
    ok(f.last.back > 0.9 && f.last.img > 0.9 && f.last.poster > 0.9,
       '动画跑完底色、海报槽、封面都到位');
    await page.click('#fxClose');
    await wait(800);
  }

  console.log('\n[聚焦面板 · 被顶栏压住的卡片]');
  {
    /* 工具栏是 sticky 的，会压住它底下卡片的上沿。替身是 z-index 80 的 fixed 层，
       直接盖过工具栏，从被压住的位置起飞观感就是「越过顶栏突然出现」。
       现在起飞前先把卡片滚出遮挡范围，起飞那一帧必须整个在工具栏下面 */
    const b = await page.evaluate(async () => {
      const bar = document.querySelector('#voteView .bar');
      const card = document.querySelectorAll('.card')[20];
      const h = bar.getBoundingClientRect().height;
      scrollTo(0, card.getBoundingClientRect().top + scrollY - h + 22);   // 故意让上沿钻到工具栏下面
      await new Promise((r) => setTimeout(r, 400));
      const barBottom = bar.getBoundingClientRect().bottom;
      const covered = card.querySelector('.poster').getBoundingClientRect().top < barBottom - 1;
      let firstTop = null;
      let run = true;
      const s = () => {
        if (!run) return;
        const f = document.querySelector('.flyer');
        if (f && firstTop === null) firstTop = f.getBoundingClientRect().top;
        requestAnimationFrame(s);
      };
      requestAnimationFrame(s);
      card.querySelector('.poster img').click();
      await new Promise((r) => setTimeout(r, 1400));
      run = false;
      return {
        covered, barBottom, firstTop,
        startTop: card.querySelector('.poster').getBoundingClientRect().top,
        opened: !document.getElementById('focus').classList.contains('hide'),
      };
    });
    ok(b.covered, '这张卡片的上沿确实被工具栏压住了');
    ok(b.opened, '照样点得开');
    // 起飞点只有替身的第一帧量得准：卡片自己的位置在锁滚动补滚动条宽度后还会再挪一次
    ok(b.firstTop !== null, '照样飞了（不是退化成原地淡入）');
    ok(b.firstTop !== null && b.firstTop >= b.barBottom - 2,
       `替身起飞那一帧整个在工具栏下面（${b.firstTop && Math.round(b.firstTop)} vs 栏底 ${Math.round(b.barBottom)}）`);
    await page.click('#fxClose');
    await wait(800);
  }

  console.log('\n[汇总页 · 排序重排]');
  await page.evaluate(() => scrollTo(0, 0));
  await page.click('#tabRes');
  await page.waitForSelector('#resView:not(.hide)', { timeout: 8000 });
  await wait(1600);
  ok(await page.$$eval('.item', (els) => els.length) > 1, '汇总列表渲染出来了');
  await shot('4-汇总');

  const probe = await page.evaluate(async () => {
    const rank = document.getElementById('rank');
    const baseH = rank.getBoundingClientRect().height;
    let minH = Infinity, frames = 0, running = true;
    const sample = () => {
      if (!running) return;
      frames++;
      minH = Math.min(minH, rank.getBoundingClientRect().height);
      requestAnimationFrame(sample);
    };
    const before = [...rank.children].map((e) => e.dataset.id).join(',');
    requestAnimationFrame(sample);
    document.getElementById('sortVotes').click();
    await new Promise((r) => setTimeout(r, 1400));
    running = false;
    const rs = [...rank.children].map((e) => e.getBoundingClientRect());
    let endOverlap = 0;
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++)
        endOverlap = Math.max(endOverlap, Math.min(rs[i].bottom, rs[j].bottom) - Math.max(rs[i].top, rs[j].top));
    return { baseH, minH, endOverlap, frames, before,
             after: [...rank.children].map((e) => e.dataset.id).join(','),
             endH: rank.getBoundingClientRect().height,
             absLeft: [...rank.children].filter((e) => getComputedStyle(e).position === 'absolute').length };
  });
  ok(probe.frames > 10, `动画期间采到 ${probe.frames} 帧（页面没卡死）`);
  ok(probe.before !== probe.after, '排序按钮确实改变了条目顺序');
  ok(probe.endOverlap <= 2, `动画落定后无重叠（${probe.endOverlap.toFixed(1)}px）`);
  ok(probe.absLeft === 0, '动画结束没有条目残留 position:absolute');
  ok(probe.minH >= probe.baseH * 0.9, `容器高度全程稳定（最低 ${Math.round(probe.minH)}px / 初始 ${Math.round(probe.baseH)}px）`);
  ok(Math.abs(probe.endH - probe.baseH) < 3, '动画结束高度回到初始值');

  await page.evaluate(() => {
    document.getElementById('sortReady').click();
    document.getElementById('sortVotes').click();
    document.getElementById('sortReady').click();
  });
  await wait(1400);
  const ov = await page.evaluate(() => {
    const rs = [...document.getElementById('rank').children].map((e) => e.getBoundingClientRect());
    let m = 0;
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++)
        m = Math.max(m, Math.min(rs[i].bottom, rs[j].bottom) - Math.max(rs[i].top, rs[j].top));
    return m;
  });
  ok(ov <= 2, `连点三次后仍无重叠（${ov.toFixed(1)}px）`);

  console.log('\n[已截止的季度走仓库存档]');
  {
    if (CLOSED) {
      await page.evaluate((s) => {
        const el = document.getElementById('season');
        el.value = s;
        el.dispatchEvent(new Event('change'));
      }, CLOSED);
      await wait(2400);
      ok(await page.$$eval('.item', (e) => e.length) > 0, '已截止季度的汇总读出来了（数据来自仓库存档）');
      await page.evaluate(() => document.getElementById('tabVote').click());
      await wait(1400);
      const st = await page.evaluate(() => ({
        closedTip: !document.getElementById('closedTip').classList.contains('hide'),
        submitDisabled: document.getElementById('submit').disabled,
        cards: document.querySelectorAll('.card').length,
      }));
      ok(st.closedTip, `切到 ${CLOSED} 显示「本季已截止」`);
      ok(st.submitDisabled, '已截止的季度提交按钮是禁用的');
      ok(st.cards > 0, `${CLOSED} 的番剧照样能浏览（${st.cards} 张）`);
      await shot('5-存档季度');
      await page.evaluate((s) => {
        const el = document.getElementById('season');
        el.value = s;
        el.dispatchEvent(new Event('change'));
      }, seasons.current);
      await wait(2200);
    } else {
      for (let i = 0; i < 4; i++) ok(true, '（没有已截止的季度，跳过）');
    }
  }

  console.log('\n[可收藏的登录链接]');
  {
    const p2 = await browser.newPage();
    await p2.goto(BASE + '/#k=' + myKey, { waitUntil: 'networkidle2', timeout: 20000 });
    await p2.waitForSelector('#app:not(.hide)', { timeout: 12000 });
    await wait(900);
    ok(await p2.$eval('#meName', (el) => el.textContent) === WHO, '带 #k= 的链接直接进站，不用输密钥');
    ok(!(await p2.evaluate(() => location.hash)), '密钥读完立刻从地址栏抹掉（不留在历史记录里）');
    await p2.close();
  }

  console.log('\n[手输密钥登录]');
  {
    /* 用户报的就是这条路走不通：注册时密钥没留住，第二天要手输却进不去。
       而在此之前整套 uitest 没有一条覆盖「打开首页、手动输密钥、回车」这条最基本的路，
       全靠注册自动跳转和 #k= 链接绕过去了，所以它坏了也没人发现 */
    const p4 = await browser.newPage();
    await p4.setViewport({ width: 1100, height: 900 });
    await p4.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });
    await p4.evaluate(() => localStorage.clear());
    await p4.reload({ waitUntil: 'networkidle2', timeout: 20000 });
    await wait(500);
    ok(await p4.$eval('#gate', (el) => !el.classList.contains('hide')), '没有记住密钥时停在进门页');
    await p4.type('#key', myKey);
    await p4.keyboard.press('Enter');                       // 表单提交，不再靠 keydown 手动转发
    await p4.waitForSelector('#app:not(.hide)', { timeout: 12000 });
    await wait(600);
    ok(await p4.$eval('#meName', (el) => el.textContent) === WHO, '手输密钥 + 回车能进站');
    ok(await p4.evaluate(() => localStorage.getItem('vk')) === myKey, '进站后这台浏览器记住了密钥');

    await p4.evaluate(() => { localStorage.clear(); });
    await p4.reload({ waitUntil: 'networkidle2', timeout: 20000 });
    await wait(500);
    await p4.type('#key', 'ZZZZ-ZZZZ-ZZZZ');
    await p4.click('#enter');
    await wait(1800);
    ok((await p4.$eval('#gateErr', (el) => el.textContent)).length > 0, '密钥不对时有提示，不是白屏');
    ok(await p4.$eval('#app', (el) => el.classList.contains('hide')), '密钥不对时进不去');
    // localStorage 是整个 origin 共享的，上面两下 clear() 连主页面的密钥一起清掉了。
    // 后面手机布局那节还要靠它自动进站，走之前放回去
    await p4.evaluate((k) => localStorage.setItem('vk', k), myKey);
    await p4.close();
  }

  console.log('\n[管理页]');
  {
    const p3 = await browser.newPage();
    await p3.setViewport({ width: 1100, height: 900 });
    await p3.goto(BASE + '/admin', { waitUntil: 'networkidle2', timeout: 20000 });
    ok(await p3.$('#pw') !== null, '管理页先要口令');
    await p3.type('#pw', 'wrong-password-' + Date.now());
    await p3.click('#go');
    await wait(1500);
    ok((await p3.$eval('#gateErr', (el) => el.textContent)).length > 0, '错口令进不去');
    ok(await p3.$eval('#app', (el) => el.classList.contains('hide')), '错口令时控制台仍然隐藏');
    await p3.evaluate(() => { document.getElementById('pw').value = ''; });
    await p3.type('#pw', ADMIN);
    await p3.click('#go');
    await p3.waitForSelector('#app:not(.hide)', { timeout: 10000 });
    await wait(1000);
    ok(true, '管理员口令进得去');
    await p3.evaluate(() => { document.getElementById('cnt').value = '2'; });
    await p3.type('#note', 'uitest批次');
    await p3.click('#mk');
    await wait(1400);
    const links = (await p3.$eval('#out', (el) => el.innerText)).trim().split('\n').filter(Boolean);
    ok(links.length === 2, `生成了 ${links.length} 条注册链接`);
    ok(links.every((l) => l.includes('/?j=')), '链接形如 站点/?j=注册码', links[0]);
    ok((await p3.$eval('#invites', (el) => el.innerText)).includes('未使用'), '未使用的注册链接列在下面');
    ok((await p3.$eval('#keys', (el) => el.innerText)).includes(WHO), '已发密钥名单里有刚注册的人');

    /* 重置密钥。以前忘了密钥只能「吊销 + 重发一条注册链接」，中间人是彻底进不来的，
       换条链接还要重填名字，票也就断了。这里走一遍管理页上的按钮，确认拿到的是新密钥、
       旧的当场作废。用一个一次性的名字测，别把上面注册那位的密钥换掉 */
    const RS = WHO + '_reset';
    const claimed = await post('/claim', { name: RS });
    p3.on('dialog', (d) => d.accept());
    await p3.evaluate(() => loadKeys());
    await p3.waitForSelector('[data-rs="' + RS + '"]', { timeout: 8000 });
    await p3.click('[data-rs="' + RS + '"]');
    await wait(1400);
    const msg = await p3.$eval('#msg', (el) => el.textContent);
    const fresh = (msg.match(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/) || [])[0];
    ok(!!fresh && fresh !== claimed.key, '管理页上点重置，当场给出一枚新密钥', fresh);
    ok((await p3.$eval('#keys', (el) => el.innerText)).includes(fresh || 'x'), '名单里也换成新的了');
    const oldTry = await fetch(BASE + '/api/auth', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: claimed.key }),
    });
    ok(oldTry.status === 401, '旧密钥立刻登不进来了', String(oldTry.status));
    await post('/revoke', { name: RS });

    await shot('6-管理页');
    await p3.close();
  }

  console.log('\n[手机布局]');
  {
    // puppeteer 改 isMobile 会重载页面，所以重载后要重新等它凭 localStorage 里的密钥进站
    await page.setViewport({ width: 375, height: 780, isMobile: true, hasTouch: true });
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForSelector('#app:not(.hide)', { timeout: 15000 });
    await wait(1800);
    ok(await page.$eval('#meName', (el) => el.textContent) === WHO, '重开页面靠浏览器记住的密钥自动进站');
    await page.evaluate(() => { scrollTo(0, 0); document.getElementById('tabVote').click(); });
    await wait(1600);
    const m = await page.evaluate(() => ({
      hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cols: getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length,
      mark: document.querySelector('.mark').getBoundingClientRect().width,
    }));
    ok(m.hScroll <= 1, `没有横向溢出（多出 ${m.hScroll}px）`);
    ok(m.cols >= 2, `375px 宽下网格还有 ${m.cols} 列`);
    ok(m.mark >= 34, `角标 ${Math.round(m.mark)}px，手指点得中`);
    await shot('7-手机提名');

    await page.evaluate(() => document.querySelector('.card .poster img').click());
    await page.waitForFunction(() => !document.getElementById('focus').classList.contains('hide'), { timeout: 6000 });
    await wait(1100);
    const f = await page.evaluate(() => {
      const r = document.querySelector('.fx-card').getBoundingClientRect();
      const cta = document.getElementById('fxPick').getBoundingClientRect();
      return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight,
               overflowY: getComputedStyle(document.querySelector('.fx-body')).overflowY,
               hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
               ctaBottom: cta.bottom, ctaW: cta.width };
    });
    ok(f.w >= f.vw - 1 && f.h >= f.vh - 1, `面板在手机上铺满整屏（${Math.round(f.w)}x${Math.round(f.h)}）`);
    ok(f.overflowY === 'auto' || f.overflowY === 'scroll', '面板正文区可滚动，长简介不会被切掉');
    ok(f.hScroll <= 1, '面板打开时也没有横向溢出');
    ok(f.ctaBottom > 0 && f.ctaBottom <= f.vh, `提名按钮在手机首屏内（底边 ${Math.round(f.ctaBottom)} / 视口 ${f.vh}）`);
    ok(f.ctaW > 200, `提名按钮铺满一行（${Math.round(f.ctaW)}px）`);
    await shot('8-手机聚焦');
    await page.keyboard.press('Escape');
    await wait(800);
  }

  console.log('\n[控制台]');
  ok(errors.length === 0, '页面没有 JS 报错', errors.slice(0, 3).join(' | '));
} finally {
  // 先清数据再关浏览器：关完再发 fetch，Windows 上会在句柄回收中途触发 libuv 断言
  for (const s of seasons.list) await post('/delete', { name: WHO, season: s.id }).catch(() => {});
  await post('/revoke', { name: WHO }).catch(() => {});
  const inv = await post('/invites', {}).catch(() => ({ invites: [] }));
  for (const t of inv.invites || [])
    if (/uitest/.test(t.note || '')) await post('/uninvite', { token: t.token }).catch(() => {});
  await browser.close();
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} passed, ${fail} failed`);
if (SHOT) console.log('截图在 ./shots/\n'); else console.log('');
process.exitCode = fail ? 1 : 0;
