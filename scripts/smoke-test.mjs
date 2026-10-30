// 对已部署的站点做冒烟测试：
//   node scripts/smoke-test.mjs https://你的站点 GROUP_CODE
// 检查项：健康检查、未授权榜单被拒、带口令榜单可用、首页可访问。
const [base, groupCode] = process.argv.slice(2);
if (!base) {
  console.error("用法：node scripts/smoke-test.mjs <站点地址> <跑团口令>");
  process.exit(1);
}
const root = base.replace(/\/+$/, "");
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

const health = await fetch(`${root}/api/health`).then(r => r.status === 200 && r.json()).catch(() => null);
check("健康检查", !!health?.ok, health ? JSON.stringify(health) : "无响应");

const home = await fetch(`${root}/`)
  .then(r => (r.ok ? r.text() : ""))
  .catch(() => "");
check("首页", typeof home === "string" && home.includes("跑友"), typeof home === "string" && home ? `${home.length} 字节` : "无响应");

const denied = await fetch(`${root}/api/leaderboard?month=2026-10`);
check("无口令访问榜单被拒绝", denied.status === 403, `HTTP ${denied.status}`);

if (groupCode) {
  const month = new Date().toISOString().slice(0, 7);
  const allowed = await fetch(`${root}/api/leaderboard?month=${month}`, { headers: { "x-group-code": groupCode } });
  check("带口令访问榜单", allowed.status === 200, `HTTP ${allowed.status}`);
}

const setup = await fetch(`${root}/api/admin/setup`).then(r => r.json()).catch(() => null);
check("管理员初始化状态可读", typeof setup?.needed === "boolean", JSON.stringify(setup));

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
