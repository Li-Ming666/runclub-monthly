# 方案一：免费上线（ClawCloud Run）

目标：**不买服务器、不买域名、不花钱**，拿到一个 `https://xxxx.clawcloudrun.com` 的公开地址，能发给微信群。

ClawCloud Run 是一个跑 Docker 镜像的托管平台：GitHub 账号注册满 180 天，每月送 $5 额度；支持挂持久卷（数据库和截图不会丢），也支持设置环境变量。注意它是免费平台，稳定性一般，长期使用请看 [方案三](03-服务器部署.md)。

---

## 0. 前置（10 分钟）

1. 代码已经推到 GitHub 仓库，`main` 分支的 Actions 里「构建并发布 Docker 镜像」是绿勾（本仓库 2026-10-30 已构建通过）。
2. 到仓库 **Packages** → `runclub-monthly` → **Package settings** → 可见性改成 **Public**。
3. 记下你的镜像地址，格式固定：

   ```
   ghcr.io/你的GitHub用户名/runclub-monthly:latest
   ```

   用户名和仓库名都要小写。**本仓库的实际地址**：

   ```
   ghcr.io/li-ming666/runclub-monthly:latest
   ```

---

## 1. 注册并登录

1. 打开 <https://run.claw.cloud>
2. 点 **Continue with GitHub**，用你的 GitHub 账号授权登录。
3. 登录后在控制台右上角可切换语言为中文。

> 如果 GitHub 账号注册不满 180 天，可能拿不到每月免费额度，那么这个方案不适合你，请直接用 [方案二 Railway](02-快捷试用-Railway.md) 或 [方案三 自己的服务器](03-服务器部署.md)。

---

## 2. 创建应用

左侧菜单进入 **App Launchpad**（应用启动台）→ **Create App**（创建应用），按下面填写：

| 字段 | 填什么 |
| --- | --- |
| Image Name（镜像） | `ghcr.io/你的GitHub用户名/runclub-monthly:latest` |
| Container Port（容器端口） | `3000` |
| Public Access（公网访问） | **打开**，会自动生成一个 https 地址 |
| Region（区域） | `Japan` 或 `US-West`；大陆移动网络实测美西更稳 |
| CPU / Memory | `0.5 Core / 512 MiB` 起步；额度吃紧可降到 `0.25 / 256 MiB` |
| Replicas | `1` |

**不要**在这一步填 `npm start` 之类的启动命令，镜像里已经写好了。

---

## 3. 加持久卷（关键，别跳过）

在创建页面的 **Storage / Volume** 区域：

- 大小：`1 GiB`（够存几百张截图）
- **Mount Path（挂载路径）：`/data`**

这一步的作用：把容器里的 `/data` 目录换成独立磁盘。不加卷的话，应用一重启，投稿和管理员账号就全没了。

---

## 4. 加环境变量

在 **Environment Variables** 里逐条添加（没有引号）：

```
GROUP_CODE=你发给微信群的口令
ADMIN_SETUP_CODE=一长串随机字符，只给自己
DATA_DIR=/data
PORT=3000
```

- `GROUP_CODE`：群友输入的口令，能看榜单、能提交。
- `ADMIN_SETUP_CODE`：只用于创建第一位管理员，**不要发群**。
- 随机字符生成（Windows PowerShell）：

  ```powershell
  -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  ```

可选：部署完拿到公网地址后，再补一条 `PUBLIC_ORIGIN=https://你的地址`，更严格（不填也能用）。

---

## 5. 部署并验证

1. 点 **Deploy**，等 1–2 分钟（首次拉镜像约 200 MB，慢一点正常）。
2. 打开平台给的公网地址，浏览器直接访问 `你的地址/api/health`，应返回：

   ```json
   {"ok":true,"storage":true}
   ```

3. 打开首页 →「管理员登录」→ 用 `ADMIN_SETUP_CODE` 创建负责人账号（字母开头，3–32 位；密码 ≥ 12 位）。
4. 登录后进「账号管理」加其他审核人。
5. 手机上用**移动网络**走一遍完整流程：输口令 → 传截图 → 核对月份和公里数 → 提交 → 管理员审核 → 榜单出现。

---

## 6. 免费平台的注意事项

- **每月至少登录一次控制台**，否则免费资源可能被回收（平台对免费用户的活跃度检查）。
- 额度是「每月 $5」，超了会被暂停，可在控制台看用量；闲置时可以把应用 **Pause**（暂停不收 CPU/内存费，只收存储费）。
- 平台偶尔抖动，重要成绩请定期导出：负责人登录后访问 `/api/admin/export` 保存 JSON。
- 想换成自己的域名：在应用的 **Custom Domain** 里绑定，然后到域名 DNS 加一条 CNAME 指向平台给的地址。

---

## 7. 以后改代码怎么更新

1. 本地改完 `git push`。
2. 等 Actions 里镜像构建完成（约 3–5 分钟）。
3. 回到 ClawCloud 应用页面点 **Redeploy / Update**，拉取新的 `latest` 镜像。

数据库和截图在 `/data` 卷里，重新部署不会清空。
