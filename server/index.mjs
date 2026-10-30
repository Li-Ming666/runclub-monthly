import express from "express";
import multer from "multer";
import { DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Callback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const imageDir = path.join(dataDir, "images");
await mkdir(imageDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "runclub.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, month TEXT NOT NULL, nickname TEXT NOT NULL, nickname_key TEXT NOT NULL,
  distance_km REAL NOT NULL, screenshot_key TEXT NOT NULL, image_type TEXT NOT NULL,
  ocr_text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS submissions_month_status_idx ON submissions(month,status);
CREATE INDEX IF NOT EXISTS submissions_status_created_idx ON submissions(status,created_at);
CREATE TABLE IF NOT EXISTS admin_accounts (
  username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_username_idx ON admin_sessions(username);
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  username TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL
);
`);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "8kb" }));
app.use("/api", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 5 } });
const cookieName = "runclub_admin";
const sessionSeconds = 7 * 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const sha256 = value => createHash("sha256").update(value).digest("hex");
const validUsername = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{2,31}$/.test(value);
const validPassword = value => typeof value === "string" && value.length >= 12 && value.length <= 128;
const validMonth = value => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const cleanNickname = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 32) : "";
const distanceKm = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 10000 ? Math.round(n * 100) / 100 : null;
};
function equalSecrets(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function sameOrigin(req) {
  const origin = req.get("origin");
  if (typeof origin !== "string" || !origin) return false;
  if (process.env.PUBLIC_ORIGIN) return origin === process.env.PUBLIC_ORIGIN;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}
function needOrigin(req, res) {
  if (sameOrigin(req)) return true;
  res.status(403).json({ error: "请从本站页面操作" });
  return false;
}
function sessionToken(req) {
  const raw = req.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}
function currentAdmin(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return db.prepare("SELECT a.username, a.is_owner AS isOwner FROM admin_sessions s JOIN admin_accounts a ON a.username = s.username WHERE s.token_hash = ? AND s.expires_at > ?")
    .get(sha256(token), nowSeconds()) || null;
}
function requireAdmin(req, res) {
  const admin = currentAdmin(req);
  if (!admin) res.status(403).json({ error: "需要管理员登录" });
  return admin;
}
function requireOwner(req, res) {
  const admin = currentAdmin(req);
  if (!admin || admin.isOwner !== 1) res.status(403).json({ error: "仅站点负责人可管理账号" });
  return admin?.isOwner === 1 ? admin : null;
}
function hasGroupAccess(req, supplied) {
  return !!currentAdmin(req) || (!!process.env.GROUP_CODE && equalSecrets(typeof supplied === "string" ? supplied : req.get("x-group-code"), process.env.GROUP_CODE));
}
async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: (await pbkdf2(password, Buffer.from(salt, "hex"), 100_000, 32, "sha256")).toString("hex") };
}
function setSession(res, username, req) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO admin_sessions(token_hash,username,expires_at) VALUES (?,?,?)").run(sha256(token), username, nowSeconds() + sessionSeconds);
  res.cookie(cookieName, token, { httpOnly: true, sameSite: "strict", secure: process.env.PUBLIC_ORIGIN?.startsWith("https://") || req.secure, maxAge: sessionSeconds * 1000, path: "/" });
}

app.get("/api/admin/setup", (_req, res) => {
  res.json({ needed: !db.prepare("SELECT 1 FROM admin_accounts LIMIT 1").get() });
});
app.post("/api/admin/setup", async (req, res) => {
  if (!needOrigin(req, res)) return;
  const { username, password, setupCode } = req.body || {};
  if (!validUsername(username) || !validPassword(password)) return res.status(400).json({ error: "账号需为 3–32 位英文字母、数字、下划线或短横线，密码至少 12 位" });
  if (!process.env.ADMIN_SETUP_CODE || !equalSecrets(setupCode, process.env.ADMIN_SETUP_CODE)) return res.status(403).json({ error: "初始化口令不正确" });
  const name = username.toLowerCase();
  const { salt, hash } = await passwordHash(password);
  const result = db.prepare("INSERT INTO admin_accounts(username,password_hash,password_salt,is_owner) SELECT ?,?,?,1 WHERE NOT EXISTS (SELECT 1 FROM admin_accounts)").run(name, hash, salt);
  if (!result.changes) return res.status(409).json({ error: "管理员已初始化，请直接登录" });
  setSession(res, name, req);
  res.status(201).json({ ok: true, username: name });
});
app.post("/api/admin/login", async (req, res) => {
  if (!needOrigin(req, res)) return;
  const { username, password } = req.body || {};
  if (!validUsername(username) || typeof password !== "string") return res.status(401).json({ error: "账号或密码不正确" });
  const name = username.toLowerCase(), now = nowSeconds();
  const attempt = db.prepare("SELECT count,window_start AS windowStart FROM admin_login_attempts WHERE username = ?").get(name);
  if (attempt && now - attempt.windowStart < 900 && attempt.count >= 10) return res.status(429).json({ error: "尝试次数过多，请 15 分钟后再试" });
  const account = db.prepare("SELECT password_hash AS hash,password_salt AS salt FROM admin_accounts WHERE username = ?").get(name);
  const correct = account && equalSecrets((await passwordHash(password, account.salt)).hash, account.hash);
  if (!correct) {
    db.prepare("INSERT INTO admin_login_attempts(username,count,window_start) VALUES (?,1,?) ON CONFLICT(username) DO UPDATE SET count=CASE WHEN ?-window_start>=900 THEN 1 ELSE count+1 END,window_start=CASE WHEN ?-window_start>=900 THEN ? ELSE window_start END")
      .run(name, now, now, now, now);
    return res.status(401).json({ error: "账号或密码不正确" });
  }
  db.prepare("DELETE FROM admin_login_attempts WHERE username = ?").run(name);
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
  setSession(res, name, req);
  res.json({ ok: true, username: name });
});
app.post("/api/admin/logout", (req, res) => {
  if (!needOrigin(req, res)) return;
  const token = sessionToken(req);
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sha256(token));
  res.clearCookie(cookieName, { httpOnly: true, sameSite: "strict", secure: process.env.PUBLIC_ORIGIN?.startsWith("https://") || req.secure, path: "/" });
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => {
  const admin = currentAdmin(req);
  res.json({ isAdmin: !!admin, canManageAdmins: admin?.isOwner === 1 });
});
app.get("/api/admin/accounts", (req, res) => {
  const admin = requireOwner(req, res);
  if (!admin) return;
  res.json({ current: admin.username, accounts: db.prepare("SELECT username,created_at AS createdAt FROM admin_accounts ORDER BY created_at,username").all() });
});
app.post("/api/admin/accounts", async (req, res) => {
  if (!requireOwner(req, res) || !needOrigin(req, res)) return;
  const { username, password } = req.body || {};
  if (!validUsername(username) || !validPassword(password)) return res.status(400).json({ error: "账号需为 3–32 位英文字母、数字、下划线或短横线，密码至少 12 位" });
  const name = username.toLowerCase();
  if (db.prepare("SELECT 1 FROM admin_accounts WHERE username = ?").get(name)) return res.status(409).json({ error: "账号已存在" });
  const { salt, hash } = await passwordHash(password);
  db.prepare("INSERT INTO admin_accounts(username,password_hash,password_salt) VALUES (?,?,?)").run(name, hash, salt);
  res.status(201).json({ ok: true, username: name });
});
app.patch("/api/admin/accounts/:username", async (req, res) => {
  const admin = requireOwner(req, res);
  if (!admin || !needOrigin(req, res)) return;
  const name = req.params.username.toLowerCase();
  if (!validUsername(name) || !validPassword(req.body?.password)) return res.status(400).json({ error: "新密码至少 12 位，最多 128 位" });
  const { salt, hash } = await passwordHash(req.body.password);
  const result = db.prepare("UPDATE admin_accounts SET password_hash=?,password_salt=? WHERE username=?").run(hash, salt, name);
  if (!result.changes) return res.status(404).json({ error: "账号不存在" });
  db.prepare("DELETE FROM admin_sessions WHERE username=?").run(name);
  res.json({ ok: true, needsLogin: admin.username === name });
});
app.delete("/api/admin/accounts/:username", (req, res) => {
  const admin = requireOwner(req, res);
  if (!admin || !needOrigin(req, res)) return;
  const name = req.params.username.toLowerCase();
  if (!validUsername(name)) return res.status(400).json({ error: "账号格式不正确" });
  if (admin.username === name) return res.status(400).json({ error: "不能删除当前登录的账号" });
  const result = db.prepare("DELETE FROM admin_accounts WHERE username=? AND is_owner=0").run(name);
  if (!result.changes) return res.status(409).json({ error: "账号不存在或不能删除负责人" });
  db.prepare("DELETE FROM admin_sessions WHERE username=?").run(name);
  res.json({ ok: true });
});

app.get("/api/admin/export", (req, res) => {
  const admin = requireOwner(req, res);
  if (!admin) return;
  const accounts = db.prepare("SELECT username,is_owner AS isOwner,created_at AS createdAt FROM admin_accounts ORDER BY created_at").all();
  const submissions = db.prepare("SELECT id,month,nickname,distance_km AS distanceKm,status,created_at AS createdAt,reviewed_at AS reviewedAt FROM submissions ORDER BY created_at").all();
  const stamp = new Date().toISOString().slice(0, 10);
  res.set("Content-Disposition", `attachment; filename="runclub-${stamp}.json"`);
  res.json({ exportedAt: new Date().toISOString(), accounts, submissions });
});

app.get("/api/leaderboard", (req, res) => {
  if (!hasGroupAccess(req)) return res.status(403).json({ error: "跑团口令不正确" });
  const month = req.query.month;
  if (!validMonth(month)) return res.status(400).json({ error: "月份格式不正确" });
  const entries = db.prepare("SELECT nickname,distance_km AS distanceKm FROM submissions WHERE month=? AND status='approved' ORDER BY distance_km DESC,nickname COLLATE NOCASE ASC LIMIT 500").all(month);
  res.json({ month, entries });
});
app.post("/api/submissions", (req, res, next) => { if (needOrigin(req, res)) next(); }, upload.single("screenshot"), async (req, res) => {
  if (!hasGroupAccess(req, req.body.groupCode)) return res.status(403).json({ error: "跑团口令不正确" });
  const nickname = cleanNickname(req.body.nickname), month = req.body.month, km = distanceKm(req.body.distanceKm);
  if (!nickname || !validMonth(month) || km === null) return res.status(400).json({ error: "请检查昵称、月份和跑量" });
  const nicknameKey = nickname.toLocaleLowerCase();
  const pending = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE month=? AND nickname_key=? AND status='pending'").get(month, nicknameKey);
  if (pending.count >= 3) return res.status(429).json({ error: "这个昵称本月已有 3 条待审核记录，请等管理员处理后再提交" });
  const file = req.file;
  if (!file || file.size < 100) return res.status(400).json({ error: "请选择不超过 6 MB 的跑量截图" });
  const b = file.buffer;
  const type = b[0] === 0x89 && b.subarray(1,4).toString() === "PNG" ? "image/png"
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg"
    : b.subarray(0,4).toString() === "RIFF" && b.subarray(8,12).toString() === "WEBP" ? "image/webp" : null;
  if (!type) return res.status(400).json({ error: "仅支持 PNG、JPG 或 WebP 截图" });
  const id = randomUUID(), screenshotKey = `runs/${month}/${id}`;
  const filePath = path.join(imageDir, screenshotKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, b, { flag: "wx" });
  try {
    db.prepare("INSERT INTO submissions(id,month,nickname,nickname_key,distance_km,screenshot_key,image_type,ocr_text,status) VALUES (?,?,?,?,?,?,?,?, 'pending')")
      .run(id, month, nickname, nicknameKey, km, screenshotKey, type, String(req.body.ocrText || "").slice(0,3000));
  } catch (error) { await unlink(filePath); throw error; }
  res.status(201).json({ ok: true, id, status: "pending" });
});
app.get("/api/review", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const entries = db.prepare("SELECT id,month,nickname,distance_km AS distanceKm,ocr_text AS ocrText,created_at AS createdAt FROM submissions WHERE status='pending' ORDER BY created_at ASC LIMIT 200").all();
  res.json({ entries });
});
app.post("/api/review/:id", async (req, res) => {
  if (!requireAdmin(req, res) || !needOrigin(req, res)) return;
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: "记录编号不正确" });
  const decision = req.body?.decision;
  if (decision !== "approve" && decision !== "reject") return res.status(400).json({ error: "审核操作不正确" });
  const item = db.prepare("SELECT month,nickname_key AS nicknameKey,screenshot_key AS screenshotKey FROM submissions WHERE id=? AND status='pending'").get(id);
  if (!item) return res.status(409).json({ error: "这条记录已处理或不存在" });
  if (decision === "reject") {
    db.prepare("UPDATE submissions SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(id);
    await unlink(path.join(imageDir, item.screenshotKey)).catch(() => {});
    return res.json({ ok: true });
  }
  const km = distanceKm(req.body?.distanceKm);
  if (km === null) return res.status(400).json({ error: "请填写有效跑量" });
  const old = db.prepare("SELECT screenshot_key AS screenshotKey FROM submissions WHERE month=? AND nickname_key=? AND status='approved'").all(item.month,item.nicknameKey);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE submissions SET status='superseded',reviewed_at=CURRENT_TIMESTAMP WHERE month=? AND nickname_key=? AND status='approved'").run(item.month,item.nicknameKey);
    db.prepare("UPDATE submissions SET status='approved',distance_km=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").run(km,id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  await Promise.allSettled(old.map(row => unlink(path.join(imageDir, row.screenshotKey))));
  res.json({ ok: true });
});
app.get("/api/image/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(400).json({ error: "记录编号不正确" });
  const item = db.prepare("SELECT screenshot_key AS screenshotKey,image_type AS imageType FROM submissions WHERE id=? AND status IN ('pending','approved')").get(req.params.id);
  if (!item) return res.status(404).json({ error: "截图不存在" });
  const filePath = path.join(imageDir, item.screenshotKey);
  try { await stat(filePath); } catch { return res.status(404).json({ error: "截图不存在" }); }
  res.set({ "Content-Type": item.imageType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  createReadStream(filePath).pipe(res);
});

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, storage: !!dataDir });
});

app.use(express.static(path.join(root, "dist"), { index: false }));
app.get("/", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: "图片过大或上传字段不正确，截图不能超过 6 MB" });
  console.error(error);
  res.status(500).json({ error: "服务器暂时无法处理请求，请稍后重试" });
});

const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => console.log(`Runclub listening on ${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    server.close(() => {
      try { db.close(); } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
