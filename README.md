# 跑友月跑量 · 共享榜单（可部署版）

群友上传高驰 / 佳明 / 悦跑圈 App 的月度跑量截图，浏览器本地 OCR 识别候选公里数，管理员审核通过后进入共享榜单。

**这是个完整的前后端应用**：Express + SQLite + 本地截图存储。数据库、截图、管理员账号都在你自己的服务器上，不依赖任何第三方站点。因此它需要一个能长期运行进程、并且有持久磁盘的地方 —— GitHub Pages 这类纯静态托管跑不了它。

- 前端：React 19 + Vite（构建后由 Express 同源托管）
- 后端：Express 5 + `node:sqlite`（Node 24 内置，不用另外装数据库）
- OCR：tesseract.js，模型文件在 `public/ocr/`，全部同源自托管，群友不需要访问国外 CDN
- 数据：`$DATA_DIR/runclub.sqlite`（投稿、管理员、会话、登录限制）+ `$DATA_DIR/images/`（原始截图）

---

## 一、先在本机跑起来（3 分钟，不花钱）

```powershell
# Windows PowerShell，在项目根目录
$env:GROUP_CODE="换成你的跑团口令"
$env:ADMIN_SETUP_CODE="换成你的初始化口令"
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:3000>，点「管理员登录」→ 用 `ADMIN_SETUP_CODE` 创建首位管理员 → 上传一张截图试一遍。

改前端代码时用开发模式（热更新，`/api` 自动代理到 3000）：先 `npm start` 跑后端，再另开一个终端 `npm run dev`，访问 <http://127.0.0.1:5173>。

---

## 二、部署方式怎么选

| 方案 | 费用 | 需要什么 | 数据持久 | 大陆访问 | 适合 |
| --- | --- | --- | --- | --- | --- |
| **ClawCloud Run**（[教程](docs/01-免费上线-ClawCloud.md)） | 0 元（GitHub 账号满 180 天，每月送 $5 额度） | GitHub 账号 | ✅ 挂载卷 | 一般（选日本/美西区域） | **想零成本先上线** |
| **Railway**（[教程](docs/02-快捷试用-Railway.md)） | 首 30 天送 $5，之后 Free 计划每月 $1 额度 | GitHub 账号 | ✅ 挂载卷 | 一般 | 想最快看到线上效果 |
| **自己的服务器**（[教程](docs/03-服务器部署.md)） | 约 25 元/月（腾讯云香港轻量） | 服务器 + 域名 | ✅ 本机磁盘 | 较好 | 长期给微信群用 |
| **家里电脑 / 内网** | 0 元 | 一台常开的电脑 | ✅ 本地磁盘 | 需内网穿透 | 自己人小范围试 |

> 免费平台的额度政策会变，以各平台官网当时显示为准。真正长期给几十人用，建议最后落到一台便宜的香港服务器 —— 三种方案用的是**同一个镜像、同一套环境变量**，迁移只要 10 分钟。

---

## 三、把代码放到 GitHub（所有方案的共同第一步）

```powershell
git init
git add .
git commit -m "跑友月跑量：可部署版"
git branch -M main
git remote add origin https://github.com/你的用户名/runclub-monthly.git
git push -u origin main
```

推送成功后，仓库里自动发生两件事（`.github/workflows/` 已配好）：

1. **CI**：每次 push 跑 `tsc --noEmit` + `vite build`，代码坏了会有红叉。
2. **镜像发布**：把整个应用打成 Docker 镜像，推到 `ghcr.io/你的用户名/runclub-monthly:latest`（仓库 Actions 页面可见日志）。

第一次构建完成后，到仓库首页右侧 **Packages** → `runclub-monthly` → **Package settings** → 把可见性改成 **Public**（免费云平台要匿名拉这个镜像）。

> 仓库设为 Public 也没关系：口令、密码都不在代码里，全部由平台的环境变量注入。

---

## 四、必须设置的 4 个环境变量

| 变量 | 例子 | 说明 |
| --- | --- | --- |
| `GROUP_CODE` | `yuepao2026` | 群友输入的口令，能看榜单、能提交。**发到微信群** |
| `ADMIN_SETUP_CODE` | 一长串随机字符 | 只用来创建第一位管理员。**不要发群** |
| `DATA_DIR` | `/data` | 数据库和截图的存放目录，**云平台必须把持久卷挂到这个路径** |
| `PORT` | `3000` | 容器端口，显式设置更保险 |

可选：`PUBLIC_ORIGIN=https://你的域名`。不填也能用（服务端用请求 Host 校验同源），填上更严格。

生成随机口令（Windows PowerShell）：

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
```

---

## 五、上线后的固定动作

1. 打开站点 →「管理员登录」→ 用 `ADMIN_SETUP_CODE` 创建**负责人**账号（3–32 位、字母开头，密码 ≥ 12 位）。
2. 「账号管理」给其他审核人建独立账号，不要共用密码。
3. 用**手机移动网络**（不要 WiFi）完整走一遍：输口令 → 传截图 → OCR → 提交 → 登录审核 → 榜单出现。
4. 确认无误后，把**站点地址 + 跑团口令**发到微信群；初始化口令不要发。

日常维护、备份、换口令见 [docs/04-维护与备份.md](docs/04-维护与备份.md)。

---

## 六、目录说明

```
├─ src/                   前端（RunClub.tsx、OCR 候选规则、样式）
├─ public/ocr/            自托管 tesseract 模型（约 47 MB）
├─ server/index.mjs       Express 服务：上传、审核、账号、榜单、SQLite
├─ Dockerfile             多阶段构建，产出运行镜像
├─ compose.yaml           服务器自建镜像 + Caddy（HTTPS）
├─ compose.ghcr.yaml      服务器直接拉 GHCR 镜像 + Caddy
├─ Caddyfile              Caddy 反向代理（自动申请证书）
├─ config.env.example     服务器部署用的配置模板
├─ railway.json           Railway 平台配置
├─ .github/workflows/     CI、镜像发布、SSH 部署
└─ docs/                  三种部署方式的详细中文步骤
```

## 七、安全模型（一句话版）

- 管理员密码：PBKDF2-SHA-256 + 随机盐 + 100,000 次迭代，只存哈希。
- 会话：`HttpOnly` + `SameSite=Strict` Cookie，7 天有效，重置密码立即失效。
- 登录失败：同一账号 15 分钟内最多 10 次。
- 截图：只通过管理员会话保护的 `/api/image/:id` 读取，不公开目录。
- 所有写操作校验 `Origin`，防跨站提交。
