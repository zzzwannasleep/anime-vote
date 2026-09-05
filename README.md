# 拨雪寻春番剧译制投票

组内番剧提名页。管理员发注册链接，组员各自拿一枚密钥进场，选番 + 勾自己能担的岗位 + 写理由，
汇总页按**人手齐整度**排序。多季度并存，每季结束导一份存档进仓库。

替代腾讯文档表单的地方：番剧自带封面、原名、导演、简介、bgm 链接，能搜索、能改、汇总实时可见，
**一眼看出哪部番缺哪个岗位**。

## 怎么用（发群里可以直接抄这段）

1. 点管理员私发给你的**注册链接**，填个名字，当场拿到一枚形如 `7YTY-A2XJ-8S7U` 的密钥。
   **这枚密钥就是你的身份，别转发。** 浏览器会记住，下次直接进；换设备时用它登录。
2. 先在顶部勾好「我能担的岗位」，只需勾一次。
3. **点封面右上角的圆圈**直接提名，你的岗位会自动带上。
   **点卡片本身**会把这部番放大成主面板，完整看导演、原作、制作、简介、标签，
   也能在面板里单独改这部番的岗位和理由。面板里用「上一部 / 下一部」或键盘 ← → 连着翻，Esc 关掉。
4. 都选完点提交。**同一枚密钥再提交会问你要不要覆盖**，改主意随时可以重来，
   换台机器登录也能把上次的票拉回来接着改。
5. 页眉的「复制登录链接」能拿到一条带密钥的链接，收藏起来以后一点就进。**同样别转发。**

勾选和理由实时存在浏览器本地，中途关掉页面不丢。深浅色跟随系统，也能手动切。

## 为什么按人手排，不按提名数排

演示数据里就有这个对比：

```
【按提名数】                          【按人手齐整】
1. 药屋少女的呢喃 第三季  6人          1. FX战士久留美       4人  人手齐了
   缺 翻译/校对/压制                   2. 冰之城墙 第二季     4人  人手齐了
2. FX战士久留美          4人          3. 药屋少女的呢喃 S3   6人  缺 翻译/校对/压制
```

六个人想做药屋，但只有一个肯扛时轴，其余全是「想看」。这种番排热度第一，实际一集也做不出来。
排期看的是人手不是热度，所以汇总页默认把人手齐的番排前面，缺岗的直接标出缺哪几个，方便定向找人。
想看纯热度，点一下「按提名数」切过去。

## 身份：注册链接换密钥，密钥才是入场券

| 凭据 | 谁有 | 能干什么 |
|---|---|---|
| 管理员口令 `ADMIN_PASSWORD` | 只有你 | 进管理页、发/吊销密钥、删票、导出存档 |
| 一次性注册链接 | 私发给某个人 | **只能注册一次**，用掉即作废 |
| 个人密钥 | 每人一枚 | 进站、提名、看汇总。名字绑在密钥上 |

**没有全组共用的口令。** 共享口令那套的问题是：换个名字就能再提名一次，防不住；
口令一旦转发出组，外人也能进。注册链接一人一条、用完作废，谁没注册一目了然。

### 管理页

浏览器打开 `你的域名/admin`，输管理员口令进去，可以：

- 生成注册链接（填数量和备注），逐条私发
- 看哪些链接还没被用、被谁用掉了，作废没用的
- 看已发密钥名单，给忘了密钥的人补发，给离组的人吊销
- 撤掉某人在某一季的票

口令只存在这个页面的内存里，刷新就要重输，不落 localStorage。

### 命令行（批量和对账用）

```bash
node keys.mjs --invite 5          # 生成 5 条注册链接
node keys.mjs 阿绫 老王 Kuro      # 不方便点链接的人，直接给名字建密钥
node keys.mjs --list              # 已发密钥名单
node keys.mjs --revoke 老王       # 吊销（离组、密钥外泄）。他投过的票不受影响

# 对线上环境操作
SITE=https://你的域名 BASE=https://你的域名 node keys.mjs --invite 5
```

密钥和注册码的字母表去掉了 `0 O 1 I L`，手抄不会认错；输入时大小写、横杠、空格都容错。

## 多季度与存档

季度表在 `public/seasons.json`，页眉的下拉框就是它：

```json
{
  "current": "2026-10",
  "list": [
    { "id": "2026-10", "label": "2026年10月", "status": "open" },
    { "id": "2026-04", "label": "2026年4月",  "status": "closed" }
  ]
}
```

- `status: open` 能投票，`closed` 只能看。截止就把它改成 `closed` 再 `npx wrangler deploy`。
- 投票期的活票在 KV 里按季度分桶（`ballot:<季度>:<名字>`），互不干扰。

开新一季：

```bash
node fetch-anime.mjs 2027 1 --current   # 抓番 + 登记季度 + 设为默认打开
npx wrangler deploy
```

会生成 `public/season/2027-01.json` 并把这一季追加进 `seasons.json`。加 `--all` 连剧场版/OVA 一起要。

### 留档：存档进仓库，顺带省掉 KV

```bash
node archive.mjs export 2026-10
# 把 seasons.json 里这一季改成 closed
npx wrangler deploy
git add public/archive && git commit -m "archive 2026-10"
```

产出两个文件，都在 `public/archive/`：

- `2026-10.json` 完整原始票面，机器可读，能一键回灌
- `2026-10.md` 一张 markdown 表格，GitHub 上直接渲染成表，谁担了什么岗、写了什么理由一目了然

**已截止的季度，汇总直接读这个 json，一次 KV 都不用。** 一个位置办三件事：在仓库里有 git 历史能 diff，
跟着部署一起上线所以线上直接读得到，Worker 挡住直接访问所以内容不裸奔。

误删或重建环境时：`node archive.mjs restore 2026-10` 把档案原样灌回 KV。

> **存档不能裸奔，这里有个必须成对的配置。** 存档放在 `public/` 下才能跟着部署，
> 但默认静态资源会在 Worker 之前直出——只在 `worker.js` 里写 403 是**死代码**，
> 实测 `GET /archive/xxx.json` 照样返回全文。所以 `wrangler.toml` 里必须有
> `run_worker_first = ["/archive/*"]`，把这个路径交给 Worker 先跑。
> `preflight.mjs` 会检查这两件事是否成对，缺一个就报错。

### 为什么不把活票直接写进 GitHub

每投一次就是一次 commit：几个人同时投必然撞车，还得给 Worker 塞一个有仓库写权限的 token
（那个 token 泄漏，整个仓库就归别人了）。投票期用 KV，就近、并发安全、零凭据；
季度结束导一次档，档案带 git 历史、能 diff、能离线看。各取所长。

**存档里只有名字、番剧、岗位、理由，绝不含密钥。** `keys.mjs --list` 的输出不要重定向进仓库里的文件。

## 岗位表：只动 `public/config.json`

```json
{
  "title": "拨雪寻春番剧译制投票",
  "roles": ["翻译", "校对", "时轴", "特效", "压制", "分流"],
  "required": ["翻译", "校对", "时轴", "压制"]
}
```

- `roles`：页面上出现的全部岗位，**服务端也拿它当白名单**，不在表里的岗位提交上来会被丢掉。
- `required`：决定「人手齐了」的判据。特效和分流不是每部都必须，所以没放进去。

改完 `npx wrangler deploy` 生效，代码一行不用动。改岗位名之后跑一遍 `node preflight.mjs`，
它会检查 `seed.mjs` 里的演示数据有没有跟着改，否则灌进去会被白名单全部丢掉。

## 为什么必须用 Workers，不能用 Pages / GitHub Pages

纯静态托管（GitHub Pages、CF Pages 不带 Functions）做不了这个需求：

- **数据没地方存**。静态站只能写浏览器 localStorage，换设备就没了，你也收不到汇总。
- **密钥是假的**。校验逻辑写在前端 JS 里，F12 一开就看见，等于没有。
- **存档挡不住**。静态站没有服务端，`/archive/*.json` 谁都能直接下载。

所以密钥校验、岗位白名单、数据读写、存档鉴权都在 Worker 服务端，前端拿不到任何明文口令。
CF 免费额度 10 万请求/天、KV 10 万次读/天，组里这个量级远远用不完，已截止的季度更是完全不碰 KV。

## 部署

全程在 Cloudflare 网页后台点，不用装 wrangler、不用敲命令。
只有第 4 步「抓番剧数据」要在本地跑一次 node——因为它的产物是要提交进仓库的静态文件。

> 后台的按钮文案 Cloudflare 会改，菜单层级一两年不动。
> 下面写的是层级，找不到同名按钮就在那一层找意思相同的那个。

### 1. 建 KV（放投票数据）

后台左侧 **Storage & Databases → KV → Create namespace**，名字填 `VOTES`。

建好后列表里那一行有个 **Namespace ID**，是一串 32 位十六进制，复制它。

### 2. 把这个 id 填进 `wrangler.toml` 并提交

```toml
[[kv_namespaces]]
binding = "VOTES"
id = "刚才复制的那串"      # 替换 PUT_YOUR_KV_ID_HERE
```

**必须填在文件里，不能只在后台点绑定。** 后台手动加的 KV 绑定会被下一次部署整个删掉——
配置文件是绑定的唯一真相源。这一点后面「唯一真相源」那节说清楚了。

Namespace ID 不是凭据，它只是你账号下的一个资源编号，没有 API token 谁也用不了，
可以放心进仓库。要是仍然不想让它出现在提交里：

```bash
git update-index --skip-worktree wrangler.toml   # 本地填、本地留，git 当没看见
```

但这样 Workers Builds 拉到的还是占位符，部署会连不上 KV。所以除非你改用手动上传，
否则还是填进去提交最省事。

### 3. 把仓库接上 Worker

后台 **Workers & Pages → Create → 从 Git 导入**（Import a repository），
授权 GitHub 后选 `zzzwannasleep/anime-vote`，分支 `main`。

它会读仓库根目录的 `wrangler.toml`，自动认出这是个带静态资源的 Worker。构建配置：

| 项 | 填什么 |
|---|---|
| Build command | 留空（这站没有构建步骤，`public/` 就是成品） |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

⚠️ **后台里这个 Worker 的名字必须和 `wrangler.toml` 里的 `name = "anime-vote"` 一致**，
不一致构建会直接失败，报错信息不太好认。

接完之后，以后每次往 `main` 推代码它都会自动重新部署，不用再管。

### 4. 抓番剧数据（本地跑一次，每季一次）

```bash
npm install
node fetch-anime.mjs 2026 10 --current
git add public/season public/seasons.json && git commit -m "2026-10 番剧数据" && git push
```

推上去就自动部署了。数据来自 Bangumi：列表走 `POST /v0/search/subjects`
（按 `air_date` 区间过滤），再逐部拉 `/v0/subjects/{id}` 补导演、原作、制作这些 staff。
都匿名可用，无需 token。一季抓一次落成静态文件，运行时不再碰外部 API。

> 萌娘百科的 MediaWiki API 已被站方禁用（`action-notallowed`），只能爬 HTML，维护成本不值当，没用。

### 5. 设管理员口令

后台 **Workers & Pages → anime-vote → Settings → Variables and Secrets → Add**：

| 项 | 填什么 |
|---|---|
| Type | **Secret**（不是 Text！选 Text 就是明文，后台谁都能看见） |
| Name | `ADMIN_PASSWORD` |
| Value | 你的管理员口令 |

存完点 **Deploy** 让它生效。加密之后后台也看不到明文了，忘了只能改不能查。

这是整个站唯一的一个口令。组员不用它——他们走管理页发的一次性注册链接。

### 6. 开张

打开 `你的域名/admin`，输管理员口令进管理页，发注册链接给组员。

---

### 唯一真相源：哪些东西后台填了会被删

这是这套部署方式唯一的坑，踩了会很难查（站好好的，推一次代码就崩）。

`wrangler.toml` 默认是环境配置的**唯一真相源**，像 terraform 文件一样。
wrangler 自己的配置 schema 原话：

> By default, the Wrangler configuration file is the source of truth for your
> environment configuration, like a terraform file. If you change your vars in
> the dashboard, wrangler **will** override/delete them on its next deploy.

也就是说每次部署都是"把配置文件里写的推上去，配置文件里没写的删掉"。
而第 5 步的口令恰恰是在后台填的。所以 `wrangler.toml` 里有这一行：

```toml
keep_vars = true
```

**这行删了，第一次推代码就会把 `ADMIN_PASSWORD` 删掉，管理页当场登不进去。**
它让部署保留后台里的 vars 和 secrets（在 wrangler 里这个开关同时管这两样）。

它保不住的是**绑定**——KV、R2、D1 这些。所以 KV 的 id 只能写在配置文件里（第 2 步）。
一句话记法：

| 在后台填的 | 推代码之后 |
|---|---|
| Secrets / 变量 | ✅ 留着（靠 `keep_vars = true`） |
| KV / R2 / D1 绑定 | ❌ 被删，必须写进 `wrangler.toml` |
| 路由、自定义域 | ❌ 被删，必须写进 `wrangler.toml` |

### 附：命令行部署

不想点网页的话，等价的一套：

```bash
npm install
npx wrangler login
npx wrangler kv namespace create VOTES   # 输出的 id 填进 wrangler.toml
npx wrangler secret put ADMIN_PASSWORD   # 交互式输入，不落磁盘、不进仓库
node fetch-anime.mjs 2026 10 --current
npx wrangler deploy
```

命令行下 `keep_vars = true` 不影响这套流程——`wrangler secret put` 本来就是单独一次
API 调用，不经过部署。留着它是为了让网页那条路也走得通。

## 本地调试与自检

```bash
cp .dev.vars.example .dev.vars   # 填一个本地测试用的管理员口令
npx wrangler dev                 # http://localhost:8787
node seed.mjs                    # 灌 6 个假成员的提名，用来预览汇总页效果
node keys.mjs --invite 1         # 生成一条注册链接，自己走一遍注册流程

node preflight.mjs       # 116 项前端静态自检，不用起服务
node test.mjs            # 72 项后端端到端自检
node uitest.mjs --shot   # 80 项真浏览器 UI 回归，截图存 shots/
npm run check            # 三套连跑
```

三套自检各管一段，别互相替代：

- **preflight** 挡肉眼看不出的退化：JS 语法错（会整页白屏）、`$('#id')` 指向不存在的元素、
  **两套配色**各自的对比度、深色板漏定义变量、混进 emoji、圆角不统一、动画属性触发重排、
  外部 CDN 依赖、季度表与数据文件对不上、已截止的季度缺存档、存档守卫与路由配置没成对、
  源码里混进明文口令。
- **test** 管服务端：注册码一次性、密钥登录、名字不可伪造、覆盖确认、脏数据、岗位白名单、
  权限分级、季度回落、已截止季度走存档、存档不许裸奔。
- **uitest** 起一个真的 headless 浏览器走完整流程，管**前两者都测不到的东西**：
  **飞行替身逐帧走过多少个位置**（动画到底看不看得见）、关闭时正文有没有跟着淡出、
  聚焦面板会不会把网格拉长、条目重排后会不会重叠、深浅色是否真换了底色、
  手机上有没有横向溢出、提名按钮是否被挤出首屏、管理页发链接是否可用。
  改动画或布局必跑这个。找不到浏览器时设 `CHROME_PATH` 指向 chrome.exe 或 msedge.exe。

> `npx wrangler dev` 对 `public/` 的热重载有几秒延迟，刚改完就跑 uitest 可能测到旧页面，等一下或重启 dev。
> 改过 `wrangler.toml` 必须重启 dev，配置不热重载。

**已知的测试盲区**：跨季度的 KV 隔离只在源码层面校验（key 带季度前缀），
两季各自灌真数据再交叉验证的用例还没写。

## 聚焦面板是怎么做的（改动画前先读这段）

点卡片时，海报要「长」成主面板，视线才不断。**但不能搬运卡片里那个真实的海报节点**：
它两头的祖先（网格侧 `.card`、面板侧 `#fxPoster`）都是 `overflow:hidden`，
节点飞到半路会被裁掉，观感就是「原地消失、那边出现」，卡片被视口切一半时最明显。

现在的做法是起一层 `position:fixed` 的替身挂在 `body` 下，零裁剪祖先，落地即销毁。
两端海报都是 2:3，所以等比 `scale` 就够，全程只动 transform。配套的三件事：

- 关闭时**整块面板一起淡出**（背板、正文、输入框、翻页键、关闭键），
  不能只淡背板——否则字会悬在原地等飞行跑完才被 `display:none` 硬切掉。
- 锁背景滚动时要**补回滚动条宽度**，不补的话页面横向一跳，海报落点就偏了。
- 卡片不在视口里就别硬飞，直接落位更干净。

这几条 `preflight.mjs` 和 `uitest.mjs` 都在盯着，改坏了会报。

## 生成可分享的静态预览

```bash
node make-preview.mjs preview.html            # 单文件，双击就能看
node make-preview.mjs preview.html --artifact # 剥掉外层骨架，适合贴到托管平台
```

把当前 UI 和演示数据打成一个自带数据的 HTML，交互逻辑一行不改，只是把数据源换成内嵌、
GSAP 换成 CDN、跳过注册和密钥。用来给没装环境的人看效果，或者在本地服务连不上的环境里排查前端问题。

## 规则与已知边界

- 注册链接是一次性的，**谁先点谁占用**，所以要逐条私发，别发群里。
- 没勾岗位的番只计入意向、不计入人手，提交时会提醒你。
- 任何持密钥的人都能看汇总和所有人的理由，不需要先提名。原始票面只有管理员拿得到。
- 「复制登录链接」得到的链接**等于密钥**，转发出去等于把身份给别人。密钥放在 `#` 后面，
  不会发给服务器也不会进 Referer，读完立刻从地址栏抹掉。

## 文件

| 文件 | 作用 |
|---|---|
| `public/index.html` | 整个前端，无依赖无构建 |
| `public/admin.html` | 管理控制台，`你的域名/admin` |
| `public/config.json` | **岗位表**，改这里就改岗位 |
| `public/seasons.json` | **季度表**，哪几季、哪季默认打开、哪季截止 |
| `public/season/<季度>.json` | 该季番剧数据，由 fetch-anime.mjs 生成 |
| `public/archive/<季度>.json/.md` | 季度存档。提交进 git 就是永久留档，线上也直接读它 |
| `public/icon.png` | 站标，同时用作 favicon |
| `public/vendor/` | GSAP 3.15 本体，随包部署不走外部 CDN |
| `src/worker.js` | 注册码 + 密钥体系 + 岗位白名单 + 分季存储 + 存档鉴权 |
| `fetch-anime.mjs` | 从 Bangumi 抓番剧列表和 staff |
| `keys.mjs` | 发注册链接 / 发密钥 / 查名单 / 吊销 |
| `archive.mjs` | 导出与回灌季度存档 |
| `preflight.mjs` | 前端静态自检 |
| `test.mjs` | 后端端到端自检 |
| `uitest.mjs` | 真浏览器 UI 回归 |
| `seed.mjs` | 灌演示数据 |
| `make-preview.mjs` | 打包成单文件静态预览 |

口令只存在 CF secret 和本地 `.dev.vars`（已 gitignore），密钥只存在 KV 和各人自己手上，
仓库里不含任何明文凭据。

---

## 许可

本项目以 **GNU AGPL v3** 发布，全文见 [LICENSE](LICENSE)。

AGPL 和 GPL 的区别就在"网络"两个字上：谁把这份代码改一改架成网站给别人用，
哪怕一个二进制都没分发出去，也得把改过的源码交出来。
这站本来就是一个跑在别人浏览器里的投票页，用 AGPL 才堵得住"拿走改个名闭源上线"。

自己搭一份、改岗位表、改配色、换季度，随便；改完继续开源就行。
