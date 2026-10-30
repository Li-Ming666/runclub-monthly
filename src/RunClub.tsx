"use client";

import { useEffect, useRef, useState } from "react";
import { extractDistanceCandidates, type Candidate } from "./ocr-candidates";

type Entry = { nickname: string; distanceKm: number };
type Review = { id: string; month: string; nickname: string; distanceKm: number; ocrText: string; createdAt: string };
type View = "submit" | "board" | "review" | "accounts";
type AdminAccount = { username: string; createdAt: string };
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const kmLabel = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export default function RunClub() {
  const [view, setView] = useState<View>("submit");
  const [month, setMonth] = useState(currentMonth);
  const [nickname, setNickname] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [distance, setDistance] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [ocrState, setOcrState] = useState("请上传显示月度累计跑量的截图");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [ocrText, setOcrText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [boardError, setBoardError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [canManageAdmins, setCanManageAdmins] = useState(false);
  const [access, setAccess] = useState(false);
  const [groupCode, setGroupCode] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState("");
  const [review, setReview] = useState<Review[]>([]);
  const [reviewKm, setReviewKm] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState("");
  const [adminLogin, setAdminLogin] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [adminUser, setAdminUser] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [adminError, setAdminError] = useState("");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [currentAdmin, setCurrentAdmin] = useState("");
  const [newAdminUser, setNewAdminUser] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const ocrRequest = useRef(0);

  async function refreshBoard(selectedMonth = month, code = groupCode) {
    try {
      const response = await fetch(`/api/leaderboard?month=${encodeURIComponent(selectedMonth)}`, { cache: "no-store", headers: { "x-group-code": code } });
      const data = await response.json() as { error?: string; entries: Entry[] };
      if (!response.ok) throw new Error(data.error || "榜单加载失败");
      setEntries(data.entries);
      setBoardError("");
    } catch (error) { setBoardError(error instanceof Error ? error.message : "榜单加载失败"); }
  }

  async function refreshReview() {
    try {
      const response = await fetch("/api/review", { cache: "no-store" });
      const data = await response.json() as { error?: string; entries: Review[] };
      if (!response.ok) throw new Error(data.error || "审核列表加载失败");
      setReview(data.entries);
      setReviewKm(Object.fromEntries((data.entries as Review[]).map(item => [item.id, String(item.distanceKm)])));
    } catch (error) { setMessage(error instanceof Error ? error.message : "审核列表加载失败"); }
  }

  async function refreshAccounts() {
    try {
      const response = await fetch("/api/admin/accounts", { cache: "no-store" });
      const data = await response.json() as { error?: string; current?: string; accounts?: AdminAccount[] };
      if (!response.ok) throw new Error(data.error || "账号列表加载失败");
      setCurrentAdmin(data.current || ""); setAccounts(data.accounts || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "账号列表加载失败"); }
  }

  useEffect(() => { if (access) refreshBoard(month); }, [month, access]);
  useEffect(() => {
    fetch("/api/admin/setup", { cache: "no-store" }).then(response => response.json() as Promise<{ needed?: boolean }>).then(data => setSetupNeeded(!!data.needed)).catch(() => {});
    fetch("/api/me", { cache: "no-store" }).then(response => response.json()).then(data => {
      const admin = !!(data as { isAdmin?: boolean }).isAdmin;
      setIsAdmin(admin);
      setCanManageAdmins(!!(data as { canManageAdmins?: boolean }).canManageAdmins);
      if (admin) setAccess(true);
    }).catch(() => {});
    const saved = sessionStorage.getItem("runclub-group-code") || "";
    if (saved) {
      setCodeInput(saved); setGroupCode(saved);
      fetch(`/api/leaderboard?month=${currentMonth()}`, { headers: { "x-group-code": saved } })
        .then(response => { if (response.ok) setAccess(true); else sessionStorage.removeItem("runclub-group-code"); });
    }
  }, []);
  useEffect(() => { if (view === "review" && isAdmin) refreshReview(); }, [view, isAdmin]);
  useEffect(() => { if (view === "accounts" && canManageAdmins) refreshAccounts(); }, [view, canManageAdmins]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function unlock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = codeInput.trim().toUpperCase();
    setCodeError("");
    try {
      const response = await fetch(`/api/leaderboard?month=${currentMonth()}`, { headers: { "x-group-code": code }, cache: "no-store" });
      if (!response.ok) throw new Error("口令不正确，请向群管理员确认");
      sessionStorage.setItem("runclub-group-code", code);
      setGroupCode(code); setAccess(true);
    } catch (error) { setCodeError(error instanceof Error ? error.message : "暂时无法验证口令"); }
  }

  async function signInAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAdminError(""); setBusy(true);
    try {
      const response = await fetch(setupNeeded ? "/api/admin/setup" : "/api/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: adminUser.trim(), password: adminPassword, ...(setupNeeded ? { setupCode: setupCode.trim() } : {}) }),
      });
      const data = await response.json().catch(() => ({ error: "服务器暂时无法处理请求，请稍后重试" })) as { error?: string };
      if (!response.ok) throw new Error(data.error || "登录失败");
      setAdminPassword(""); setSetupCode(""); setSetupNeeded(false); setAdminLogin(false);
      const me = await fetch("/api/me", { cache: "no-store" }).then(response => response.json() as Promise<{ canManageAdmins?: boolean }>);
      setCanManageAdmins(!!me.canManageAdmins); setIsAdmin(true); setAccess(true); setView("review");
    } catch (error) { setAdminError(error instanceof Error ? error.message : "登录失败"); }
    finally { setBusy(false); }
  }

  async function signOutAdmin() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  }

  async function addAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    try {
      const response = await fetch("/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: newAdminUser.trim(), password: newAdminPassword }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "添加失败");
      setNewAdminUser(""); setNewAdminPassword(""); setMessage("管理员账号已添加"); await refreshAccounts();
    } catch (error) { setMessage(error instanceof Error ? error.message : "添加失败"); }
    finally { setBusy(false); }
  }

  async function resetAdminPassword(username: string) {
    const password = resetPasswords[username] || "";
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(username)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json() as { error?: string; needsLogin?: boolean };
      if (!response.ok) throw new Error(data.error || "重置失败");
      if (data.needsLogin) { window.location.reload(); return; }
      setResetPasswords(previous => ({ ...previous, [username]: "" }));
      setMessage(`已重置 ${username} 的密码；该账号的旧登录已失效`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "重置失败"); }
  }

  async function removeAdmin(username: string) {
    if (!window.confirm(`确定移除管理员 ${username} 吗？`)) return;
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(username)}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "移除失败");
      setMessage(`已移除 ${username}`); await refreshAccounts();
    } catch (error) { setMessage(error instanceof Error ? error.message : "移除失败"); }
  }

  async function selectFile(next: File | null) {
    ocrRequest.current += 1;
    const thisRequest = ocrRequest.current;
    setFile(next); setCandidates([]); setDistance(""); setOcrText(""); setConfirmed(false); setMessage("");
    if (!next) { setPreview(""); setOcrState("请上传显示月度累计跑量的截图"); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(next.type) || next.size > 6 * 1024 * 1024) {
      setFile(null); setPreview(""); setOcrState("请选 PNG、JPG 或 WebP，大小不超过 6 MB"); return;
    }
    setPreview(URL.createObjectURL(next));
    setOcrState("正在加载本地识别模型，首次可能需要几秒…");
    let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | undefined;
    try {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker(["eng", "chi_sim"], 1, {
        workerPath: `${location.origin}/ocr/worker.min.js`,
        corePath: `${location.origin}/ocr/core`,
        langPath: `${location.origin}/ocr/lang`,
        workerBlobURL: false,
        logger: event => {
          if (thisRequest === ocrRequest.current && event.status === "recognizing text") {
            setOcrState(`正在识别截图… ${Math.round((event.progress || 0) * 100)}%`);
          }
        },
      });
      const result = await worker.recognize(next, { rotateAuto: true });
      if (thisRequest !== ocrRequest.current) return;
      const text = result.data.text || "";
      const choices = extractDistanceCandidates(text);
      setOcrText(text); setCandidates(choices);
      if (choices.length) {
        setDistance(String(choices[0].value));
        setOcrState(`识别到 ${choices.length} 个候选数值，请核对截图并选择月跑量`);
      } else setOcrState("未找到可靠数值，请对照截图手动填写月跑量");
    } catch {
      if (thisRequest === ocrRequest.current) setOcrState("自动识别暂不可用，请对照截图手动填写，仍可提交审核");
    } finally { if (worker) await worker.terminate(); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !confirmed) return;
    setBusy(true); setMessage("");
    const body = new FormData();
    body.set("nickname", nickname.trim()); body.set("month", month); body.set("distanceKm", distance);
    body.set("screenshot", file); body.set("ocrText", ocrText); body.set("groupCode", groupCode);
    try {
      const response = await fetch("/api/submissions", { method: "POST", body });
      const data = await response.json() as { error?: string; ok?: boolean };
      if (!response.ok) throw new Error(data.error || "提交失败");
      setMessage("提交成功，管理员核对截图后会显示在榜单中。再次提交同月数据可用于更新跑量。");
      setFile(null); setPreview(""); setDistance(""); setCandidates([]); setConfirmed(false); setOcrText("");
      setOcrState("请上传显示月度累计跑量的截图");
      if (isAdmin) refreshReview();
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交失败，请稍后再试"); }
    finally { setBusy(false); }
  }

  async function decide(item: Review, decision: "approve" | "reject") {
    setReviewBusy(item.id); setMessage("");
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(item.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, distanceKm: reviewKm[item.id] }),
      });
      const data = await response.json() as { error?: string; ok?: boolean };
      if (!response.ok) throw new Error(data.error || "审核失败");
      await Promise.all([refreshReview(), refreshBoard()]);
      setMessage(decision === "approve" ? "已通过，榜单已更新" : "已驳回并删除该截图");
    } catch (error) { setMessage(error instanceof Error ? error.message : "审核失败"); }
    finally { setReviewBusy(""); }
  }

  const total = entries.reduce((sum, item) => sum + item.distanceKm, 0);
  const top = Math.max(1, ...entries.map(item => item.distanceKm));

  return <div className="site-shell">
    <header className="hero"><div className="hero-inner"><div><div className="kicker">RUN TOGETHER · MONTH BY MONTH</div><h1>跑友月跑量</h1><p>一张截图，记录这个月跑过的路。群友一起提交，榜单一起更新。</p></div><div className="hero-symbol" aria-hidden="true">↗</div></div></header>
    <main className="container">
      {!access ? <section className="join-panel panel"><div className="section-no">WELCOME / RUN CLUB</div>{adminLogin ? <><h2>{setupNeeded ? "创建首位管理员" : "管理员登录"}</h2><p className="muted">{setupNeeded ? "使用初始化口令设置你自己的管理员账号和密码。" : "使用本站管理员账号和密码登录。"}</p><form onSubmit={signInAdmin}><label className="distance-label">管理员账号<input required minLength={3} maxLength={32} autoComplete="username" value={adminUser} onChange={event => setAdminUser(event.target.value)} placeholder="英文字母开头，3–32 位" /></label><label className="distance-label">密码<input required type="password" minLength={12} maxLength={128} autoComplete={setupNeeded ? "new-password" : "current-password"} value={adminPassword} onChange={event => setAdminPassword(event.target.value)} placeholder="至少 12 位" /></label>{setupNeeded && <label className="distance-label">初始化口令<input required type="password" autoComplete="off" value={setupCode} onChange={event => setSetupCode(event.target.value)} placeholder="站点创建者提供的一次性口令" /></label>}<button className="primary-button" type="submit" disabled={busy}>{busy ? "请稍候…" : setupNeeded ? "创建并进入 →" : "登录并进入 →"}</button></form>{adminError && <p className="error-text" role="alert">{adminError}</p>}<div className="join-admin"><button type="button" className="text-button" onClick={() => { setAdminLogin(false); setAdminError(""); }}>返回跑团入口</button></div></> : <><h2>输入跑团口令</h2><p className="muted">向群管理员获取口令，即可上传截图并查看共享榜单。</p><form onSubmit={unlock}><label className="distance-label">跑团口令<input autoCapitalize="characters" autoComplete="off" value={codeInput} onChange={event => setCodeInput(event.target.value)} placeholder="输入群内分享的口令" /></label><button className="primary-button" type="submit">进入跑团 →</button></form>{codeError && <p className="error-text" role="alert">{codeError}</p>}<div className="join-admin"><button type="button" className="text-button" onClick={() => setAdminLogin(true)}>管理员登录</button></div></>}</section> : <>
      <nav className="tabs" aria-label="页面功能">
        <button className={view === "submit" ? "active" : ""} onClick={() => setView("submit")}>上传截图</button>
        <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>月度榜单</button>
        {isAdmin && <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>管理员审核</button>}
        {canManageAdmins && <button className={view === "accounts" ? "active" : ""} onClick={() => setView("accounts")}>账号管理</button>}
      </nav>
      {message && <div className="notice" role="status">{message}</div>}
      {view === "submit" && <div className="content-grid">
        <section className="panel"><div className="section-no">01 / SUBMIT</div><h2>提交本月跑量</h2><p className="muted">支持高驰、佳明、悦跑圈等月度统计截图。识别结果请自己核对，提交后由管理员复核。</p>
          <form onSubmit={submit}>
            <div className="field-row"><label>群昵称<input required maxLength={32} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="与群内昵称保持一致" /></label><label>统计月份<input required type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div>
            <label className="upload-zone">{preview ? <img src={preview} alt="待提交的跑量截图预览" /> : <span className="upload-icon">↑</span>}<strong>{file ? file.name : "点击上传月度跑量截图"}</strong><small>PNG / JPG / WebP · 不超过 6 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => selectFile(event.target.files?.[0] || null)} /></label>
            <div className="ocr-status" role="status"><span className="pulse" />{ocrState}</div>
            {candidates.length > 0 && <div className="candidate-box"><div className="minor-title">识别候选值 <span>点选月度总跑量</span></div><div className="candidate-list">{candidates.map(candidate => <button type="button" key={candidate.value} className={distance === String(candidate.value) ? "candidate chosen" : "candidate"} onClick={() => { setDistance(String(candidate.value)); setConfirmed(false); }} title={candidate.context}>{kmLabel(candidate.value)} km</button>)}</div></div>}
            <label className="distance-label">确认月跑量 <span>公里</span><input type="number" required min="0.01" max="10000" step="0.01" value={distance} onChange={event => { setDistance(event.target.value); setConfirmed(false); }} placeholder="请对照截图核对数值" /></label>
            <label className="check-row"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>我已核对：截图对应所选月份，月跑量是 <strong>{distance || "—"} km</strong></span></label>
            <button className="primary-button" type="submit" disabled={busy || !file || !confirmed}>{busy ? "正在提交…" : "提交管理员审核 →"}</button>
          </form>
        </section>
        <aside className="side-stack"><div className="side-card accent"><div className="section-no">HOW IT WORKS</div><h3>简单三步</h3><ol><li>打开跑步 App 的<strong>月度统计</strong>页面并截图</li><li>上传截图，核对识别出的公里数</li><li>管理员审核后，跑量进入群榜单</li></ol></div><div className="side-card"><h3>提交说明</h3><p>请截取整个月的累计距离，单次跑步记录无法代表月跑量。昵称和月份相同的后续记录经审核后会更新榜单。</p><p className="small-note">原图仅管理员可查看，用于核对数据；榜单只公开昵称和公里数。</p></div></aside>
      </div>}
      {view === "board" && <section className="panel board-panel"><div className="board-heading"><div><div className="section-no">02 / LEADERBOARD</div><h2>月度榜单</h2><p className="muted">只显示管理员已核对的记录。</p></div><label>统计月份<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label></div><div className="metrics"><div><small>上榜跑友</small><strong>{entries.length}</strong><span>人</span></div><div><small>全员合计</small><strong>{kmLabel(total)}</strong><span>km</span></div></div>{boardError ? <div className="empty">{boardError}</div> : entries.length === 0 ? <div className="empty">这个月还没有审核通过的记录。上传截图，开始第一条跑量记录吧。</div> : <div className="leader-list">{entries.map((item, index) => <div className="leader" key={item.nickname}><span className={`medal medal-${index + 1}`}>{index + 1}</span><strong>{item.nickname}</strong><div className="bar-track"><div style={{ width: `${Math.max(2, item.distanceKm / top * 100)}%` }} /></div><b>{kmLabel(item.distanceKm)} <small>km</small></b></div>)}</div>}</section>}
      {view === "review" && isAdmin && <section className="panel review-panel"><div className="section-no">03 / REVIEW</div><h2>等待审核 <span className="count">{review.length}</span></h2><p className="muted">请比对截图的月份、累计距离和提交数值；可在通过前修正公里数。</p>{review.length === 0 ? <div className="empty">暂时没有待审核的截图。</div> : <div className="review-list">{review.map(item => <article className="review-item" key={item.id}><a href={`/api/image/${item.id}`} target="_blank" rel="noreferrer" className="review-image"><img src={`/api/image/${item.id}`} alt={`${item.nickname} 的跑量截图`} /></a><div className="review-body"><div className="review-meta">{item.month} · {item.createdAt}</div><h3>{item.nickname}</h3><label>核对后跑量（公里）<input type="number" min="0.01" max="10000" step="0.01" value={reviewKm[item.id] ?? ""} onChange={event => setReviewKm(previous => ({ ...previous, [item.id]: event.target.value }))} /></label><details><summary>查看识别文字</summary><pre>{item.ocrText || "无识别文字"}</pre></details><div className="review-actions"><button disabled={reviewBusy === item.id} className="primary-button" onClick={() => decide(item, "approve")}>通过并上榜</button><button disabled={reviewBusy === item.id} className="subtle-button" onClick={() => decide(item, "reject")}>驳回</button></div></div></article>)}</div>}</section>}
      {view === "accounts" && canManageAdmins && <section className="panel accounts-panel"><div className="section-no">04 / ADMIN ACCOUNTS</div><h2>管理员账号</h2><p className="muted">当前登录：{currentAdmin || "加载中"}。这里可添加、重置密码或移除管理员。</p><div className="account-list">{accounts.map(item => <div className="account-row" key={item.username}><strong>{item.username}</strong><span>{item.createdAt}</span><label className="reset-field">新密码<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={resetPasswords[item.username] || ""} onChange={event => setResetPasswords(previous => ({ ...previous, [item.username]: event.target.value }))} placeholder="至少 12 位" /></label><button type="button" disabled={(resetPasswords[item.username] || "").length < 12} className="subtle-button" onClick={() => resetAdminPassword(item.username)}>重置密码</button>{item.username !== currentAdmin && <button type="button" className="subtle-button" onClick={() => removeAdmin(item.username)}>移除</button>}</div>)}</div><form className="add-account" onSubmit={addAdmin}><h3>添加管理员</h3><div className="field-row"><label>新账号<input required minLength={3} maxLength={32} autoComplete="off" value={newAdminUser} onChange={event => setNewAdminUser(event.target.value)} placeholder="英文字母开头" /></label><label>初始密码<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={newAdminPassword} onChange={event => setNewAdminPassword(event.target.value)} placeholder="至少 12 位" /></label></div><button className="primary-button" disabled={busy} type="submit">添加账号</button></form><button type="button" className="text-button signout" onClick={signOutAdmin}>退出管理员登录</button></section>}
      <footer>持跑团口令者可查看昵称与公里数。截图仅管理员可看。{isAdmin ? <> · <button type="button" className="text-button" onClick={signOutAdmin}>退出管理员</button></> : <> · <button type="button" className="text-button" onClick={() => { setAdminLogin(true); setAccess(false); }}>管理员登录</button></>}</footer>
      </>}
    </main>
  </div>;
}

