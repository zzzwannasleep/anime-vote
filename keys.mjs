// 发密钥 / 发注册链接 / 查名单。密钥和链接都私发给本人，别贴群里。
// 平时用管理页更方便（站点 /admin），这个脚本用来批量和对账。
// 用法:
//   node keys.mjs --invite 5         生成 5 条一次性注册链接，发给谁谁自己填名字
//   node keys.mjs 阿绫 老王 Kuro     直接给这几个名字各建一枚（已有的会原样返回，不换新）
//   node keys.mjs --list             列出已经发过的所有密钥
//   node keys.mjs --reset 老王       给这个人换一枚新密钥（他忘了旧的）。旧的立刻失效，票不受影响
//   node keys.mjs --revoke 老王      吊销这个人的密钥（离组、密钥外泄）。他的票不受影响
//   BASE=https://你的域名 node keys.mjs ...   对线上环境操作
//
// 口令从环境变量或 .dev.vars 读，不写死在文件里。
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let ADMIN = process.env.ADMIN_PASSWORD;
if (!ADMIN && existsSync('.dev.vars'))
  ADMIN = (readFileSync('.dev.vars', 'utf8').match(/^ADMIN_PASSWORD=(.*)$/m) || [])[1];
if (!ADMIN) {
  console.error('没有管理员口令。设 ADMIN_PASSWORD 环境变量，或在 .dev.vars 里写一行 ADMIN_PASSWORD=...');
  process.exit(2);
}

const post = (path, body) =>
  fetch(BASE + '/api' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pass: ADMIN, key: ADMIN, ...body }),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));

const names = process.argv.slice(2).filter((s) => !s.startsWith('--'));

if (process.argv.includes('--invite')) {
  const n = Number(process.argv[process.argv.indexOf('--invite') + 1]) || 1;
  const r = await post('/invite', { count: n, note: names.join(' ') });
  if (!r.ok) { console.error('生成失败:', r.error || r.status); process.exit(1); }
  const base = (process.env.SITE || BASE) + '/?j=';
  for (const t of r.tokens) console.log(base + t);
  console.log(`
${r.tokens.length} 条，一条只能注册一个人，用掉即作废。逐条私发。`);
  console.log('线上用: SITE=https://你的域名 BASE=https://你的域名 node keys.mjs --invite 5');
} else if (process.argv.includes('--reset')) {
  // 忘了密钥的人以前只能吊销 + 重新发注册链接，中间他彻底进不来。重置是同一件事的一步到位版
  for (const name of names) {
    const r = await post('/reset', { name });
    if (r.ok) console.log(`${name.padEnd(14)} ${r.key}${r.had ? '   (旧的已失效)' : '   (他本来没有密钥，这是新发的)'}`);
    else console.log(`${name.padEnd(14)} 失败: ${r.error || r.status}`);
  }
  console.log('
私发给本人。旧密钥当场作废，他投过的票一张不动。');
} else if (process.argv.includes('--revoke')) {
  for (const name of names) {
    const r = await post('/revoke', { name });
    console.log(r.ok ? `${name.padEnd(14)} ${r.revoked ? '已吊销' : '本来就没有密钥'}` : `${name.padEnd(14)} 失败: ${r.error || r.status}`);
  }
  console.log('\n票没动。要连票一起删: node archive.mjs export 先留档，再手动调 /api/delete');
} else if (process.argv.includes('--list')) {
  const r = await post('/keys', {});
  if (!r.ok) { console.error('拉取失败:', r.error || r.status); process.exit(1); }
  if (!r.keys.length) console.log('还没有发过任何密钥');
  for (const k of r.keys) console.log(k.name.padEnd(14), k.key);
  console.log(`\n共 ${r.keys.length} 枚`);
} else if (!names.length) {
  console.log('用法: node keys.mjs --invite 5   |   node keys.mjs 名字1 名字2 ...   |   node keys.mjs --list   |   node keys.mjs --reset 名字   |   node keys.mjs --revoke 名字');
} else {
  for (const name of names) {
    const r = await post('/claim', { name });
    if (r.ok) console.log(`${name.padEnd(14)} ${r.key}${r.existing ? '   (之前已领过)' : ''}`);
    else console.log(`${name.padEnd(14)} 失败: ${r.error || r.status}`);
  }
  console.log('\n逐个私发给本人。密钥即身份，进群公示等于没加密。');
}
