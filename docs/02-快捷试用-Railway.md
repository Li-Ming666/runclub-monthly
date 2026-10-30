# 方案二：最快看到线上效果（Railway）

> ✅ **推荐先走这条。** 2026-10-31 从大陆网络实测：`railway.com` 和 `*.up.railway.app` 都能正常打开（ClawCloud 控制台打不开）。

Railway 用 GitHub 账号登录，直接连你的仓库、用仓库里的 `Dockerfile` 构建，**不需要先构建镜像**，5 分钟能出一个 `https://xxx.up.railway.app` 地址。

新账号有 **30 天试用、一次性 $5 额度**；试用结束后是 Free 计划（每月 $1 额度、0.5 GB 内存、0.5 GB 持久卷）。$1/月 跑 24 小时不间断的服务大概只够十几天，所以它适合「先上线看看效果」，长期使用请看 [方案三](03-服务器部署.md)。

本仓库：<https://github.com/Li-Ming666/runclub-monthly>（`main` 分支的 CI 和镜像构建都已通过，`railway.json` 已就位）。

---

## 1. 登录

1. 打开 <https://railway.com>，点 **Login**，用 GitHub 授权。
2. 连接 GitHub 后建议到 <https://railway.com/verify> 完成账号验证，否则会是「受限试用」，出站网络和端口被限制。

## 2. 新建项目

1. **New Project** → **Deploy from GitHub repo** → 选中你的 `runclub-monthly` 仓库。
2. Railway 会自动识别根目录的 `Dockerfile` 并开始构建（`railway.json` 里已配好健康检查和重启策略）。
3. 构建完会显示部署成功，但此时还没有公网地址。

## 3. 加持久卷（不要跳过）

1. 在服务页面按 **+**（或右侧 **Volumes**）→ **Add Volume**。
2. Mount path 填：`/data`
3. 保存后服务会自动重启一次。

不加卷的话，每次重新部署 SQLite 数据库和截图都会丢。

## 4. 加环境变量

服务页面 → **Variables** → **New Variable**，逐条添加：

```
GROUP_CODE=你发给微信群的口令
ADMIN_SETUP_CODE=一长串随机字符，只给自己
DATA_DIR=/data
PORT=3000
```

> `PORT` 建议显式设置成 3000，并在 **Settings → Networking** 里把目标端口也设为 3000，避免平台自动探测出错。

## 5. 生成公网地址

1. **Settings → Networking** → **Public Networking** → **Generate Domain**。
2. 得到形如 `https://runclub-monthly-production.up.railway.app` 的地址。
3. 建议回到 **Variables** 加一条 `PUBLIC_ORIGIN=https://这个地址`，然后重新部署一次。

## 6. 验证

1. 浏览器打开 `你的地址/api/health`，应该是 `{"ok":true,"storage":true}`。
2. 打开首页 →「管理员登录」→ 用 `ADMIN_SETUP_CODE` 创建负责人 → 加审核人 → 手机流量走一遍完整流程。

## 7. 费用与额度提醒

- 试用期 30 天内 $5 额度，够跑约半个月到一个月（按 0.5 GB 内存 24 小时算）。
- 试用结束后如果不升级，账号转为 Free 计划：每月 $1 额度，服务可能月中被暂停；**试用期创建的卷会在额度到期 30 天后删除**。
- 所以：Railway 当「预览环境」用，确定要长期用就迁移到自己的服务器 —— 同一个镜像、同样的 4 个环境变量，把 `/data` 卷里的 `runclub.sqlite` 和 `images/` 拷过去就行（见 [维护与备份](04-维护与备份.md)）。
