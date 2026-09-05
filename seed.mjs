// 灌一批模拟提名，用来预览汇总页的真实效果（只对本地 dev 用）
// 用法: node seed.mjs [季度]        灌数据，季度默认取 seasons.json 的 current
//       node seed.mjs clear [季度]  清掉这批模拟数据
// 走管理员口令，因为只有管理员能代填名字（正常组员的名字是从自己的密钥来的）
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const ADMIN = process.env.ADMIN_PASSWORD || 'local-test-admin';

const clear = process.argv[2] === 'clear';
const arg = clear ? process.argv[3] : process.argv[2];
const seasons = await (await fetch(BASE + '/seasons.json')).json();
const SEASON = arg || seasons.current;

const post = (path, body) =>
  fetch(BASE + '/api' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pass: ADMIN, season: SEASON, ...body }),
  }).then((r) => r.json());

const { list } = await (await fetch(BASE + '/season/' + SEASON + '.json')).json();
const id = (i) => list[i].id;

// 数据故意造成两种排序结果截然不同，否则演示不出「按人手齐整」的意义：
//   4 号是全场提名最多的热门番，但六个人里只有一个肯扛时轴，其余全是「想看」
//   0 号和 2 号提名数不高，但岗位配齐了，明天就能开工
const PEOPLE = [
  { name: '阿绫',   picks: [[0, ['翻译', '校对']], [1, ['翻译']], [3, ['翻译']], [4, []], [5, ['校对']]], why: { 0: '原作看过，术语我熟', 4: '想看，但这季排不开了' } },
  { name: '老王',   picks: [[0, ['压制', '分流']], [1, ['压制']], [2, ['压制', '分流']], [4, []]], why: { 2: '这部有 BD 源，画质能拉满' } },
  { name: 'Kuro',  picks: [[0, ['时轴']], [2, ['时轴', '特效']], [4, ['时轴']]], why: { 4: '时轴我来，但得有人翻' } },
  { name: '小林',   picks: [[0, ['特效', '分流']], [1, ['校对']], [2, ['翻译', '校对']], [4, []]], why: { 1: '想练手，愿意跟校对学' } },
  { name: '默默',   picks: [[2, ['压制']], [3, ['翻译', '校对']], [4, []], [6, ['翻译']]], why: { 3: '这季最想做的一部' } },
  { name: '路人甲', picks: [[4, []], [5, []], [7, []]], why: { 4: '单纯想看，没岗位可担' } },
];

if (clear) {
  for (const p of PEOPLE) await post('/delete', { name: p.name });
  console.log(`已清掉 ${SEASON} 的 ${PEOPLE.length} 条模拟提名`);
} else {
  for (const p of PEOPLE) {
    const picks = p.picks.map(([i, roles]) => ({ id: id(i), roles, reason: p.why[i] || '' }));
    const r = await post('/vote', { name: p.name, picks, overwrite: true });
    console.log(r.ok ? `OK  ${p.name} 提名了 ${picks.length} 部` : `失败 ${p.name}: ${r.error}`);
  }
  console.log(`\n${SEASON} 已灌好。打开 ${BASE} 切到「汇总」看效果，清数据用: node seed.mjs clear`);
}
