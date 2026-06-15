// 三种充值类型
const RECHARGE_TYPES = [
  { id: "pro_ph",  label: "20x 菲区 (Pro)",      plan: "chatgptpro",      country: "PH", currency: "PHP" },
  { id: "lite_eg", label: "5x 埃及区 (Pro Lite)", plan: "chatgptprolite",  country: "EG", currency: "EGP" },
  { id: "plus_ph", label: "PLUS 菲区",            plan: "chatgptplusplan", country: "PH", currency: "PHP" }
];

const LS = "kanet_accounts_v1";
const $ = (s) => document.querySelector(s);
const wv = $("#wv");
let accounts = load();
let currentName = "";          // 当前登陆账号的备注名（用于导出文件名）

function load(){ try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } }
function persist(){ localStorage.setItem(LS, JSON.stringify(accounts)); }
function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
function setMsg(html){ $("#msg").innerHTML = html; }                 // 临时提示
function setAcct(html){ $("#acct").innerHTML = html; }               // 常驻账号/订阅状态

// 输入支持：整段 /api/auth/session JSON，或直接 sessionToken
function extractToken(raw){
  raw = (raw || "").trim();
  if (!raw) return { token: "", err: "token 为空" };
  if (raw[0] === "{") {
    try { const j = JSON.parse(raw); const t = (j.sessionToken || "").trim();
      return t ? { token: t } : { token: "", err: "JSON 里没有 sessionToken" };
    } catch { return { token: "", err: "JSON 解析失败（没复制完整）" }; }
  }
  if (raw.startsWith("eyJhbGciOiJSUzI1Ni")) return { token: "", err: "这是 accessToken，请粘 sessionToken 或整段 JSON" };
  return { token: raw };
}

function renderRechargeButtons(){
  const grp = $("#rcGrp");
  grp.querySelectorAll("button").forEach(b => b.remove());
  RECHARGE_TYPES.forEach(rt => {
    const b = document.createElement("button");
    b.className = "rc"; b.textContent = rt.label;
    b.title = `${rt.plan} · ${rt.country}/${rt.currency}`;
    b.onclick = () => doJump(rt);
    grp.appendChild(b);
  });
}

function renderAccounts(){
  const sel = $("#accSel");
  sel.innerHTML = accounts.length
    ? accounts.map((a,i)=>`<option value="${i}">${escapeHtml(a.name||("账号"+(i+1)))}</option>`).join("")
    : `<option value="">（无）</option>`;
}

// 登陆：注入 token + 重载。name 为备注名。save=是否存账号
async function doLogin(rawToken, name, save){
  const { token, err } = extractToken(rawToken);
  if (err) { setMsg(`<span class="pill bad">${escapeHtml(err)}</span>`); return false; }
  setMsg("登陆中…");
  await window.kh.clearSession();
  const r = await window.kh.setToken(token);
  if (!r.ok) { setMsg(`<span class="pill bad">失败：${escapeHtml(r.msg||"")}</span>`); return false; }
  currentName = name || "";
  if (save) {
    const i = accounts.findIndex(a => a.token === token);
    if (i >= 0) accounts[i].name = name; else accounts.push({ name, token });
    persist(); renderAccounts();
  }
  wv.loadURL("https://chatgpt.com/");
  return true;
}

// ① 登陆并保存（备注名必填）
$("#loginBtn").onclick = async () => {
  const name = $("#accName").value.trim();
  if (!name) { setMsg('<span class="pill bad">必须填备注名</span>'); $("#accName").focus(); return; }
  const ok = await doLogin($("#accTok").value, name, true);
  if (ok) { $("#accTok").value = ""; pollAcct(); }
};

// 切换到已保存账号
$("#useAcc").onclick = async () => {
  const i = +$("#accSel").value; const acc = accounts[i];
  if (!acc) { setMsg('<span class="pill bad">没有可用账号</span>'); return; }
  const ok = await doLogin(acc.token, acc.name, false);
  if (ok) pollAcct();
};

$("#delAcc").onclick = () => {
  const i = +$("#accSel").value; if (Number.isNaN(i) || !accounts[i]) return;
  if (!confirm("删除账号「"+accounts[i].name+"」？")) return;
  accounts.splice(i,1); persist(); renderAccounts();
};

$("#updateBtn").onclick = () => { setMsg("检查更新中…"); window.kh.checkUpdate(); };

// 刷新订阅/续费状态（每点一次查一次）
$("#refreshBtn").onclick = async () => {
  setMsg("刷新状态中…");
  const ok = await verifyOnce();
  setMsg(ok ? '<span class="pill ok">状态已刷新</span>' : '<span class="pill warn">未登陆或获取失败</span>');
};

$("#logoutBtn").onclick = async () => {
  await window.kh.clearSession(); currentName = "";
  wv.loadURL("https://chatgpt.com/");
  setAcct('<span class="pill warn">未登陆</span>'); setMsg("已退出");
};
$("#homeBtn").onclick = () => wv.loadURL("https://chatgpt.com/");

// 校验一次：读真实订阅+续费状态，更新常驻状态 #acct，返回是否已登陆
async function verifyOnce(){
  try {
    const s = await wv.executeJavaScript(`(async()=>{
      try{
        const d=await(await fetch("/api/auth/session",{cache:"no-store",headers:{"cache-control":"no-cache"}})).json();
        const email=d&&d.user&&d.user.email, acc=d&&d.account&&d.account.id, at=d&&d.accessToken;
        if(!email||!at) return {};
        let sub=null;
        try{ const r=await fetch("/backend-api/subscriptions?account_id="+acc,{headers:{Authorization:"Bearer "+at},cache:"no-store"}); if(r.ok) sub=await r.json(); }catch(e){}
        return {
          e: email,
          plan: (sub&&sub.plan_type) || (d.account&&d.account.planType) || "free",
          renew: sub ? !!sub.will_renew : null,
          period: sub&&sub.billing_period || "",
          until: (sub&&(sub.active_until||sub.next_credit_grant_update)) || ""
        };
      }catch(e){return {}}
    })()`, true);
    if (s && s.e) {
      const nm = currentName ? `（${escapeHtml(currentName)}）` : "";
      const planTxt = `订阅 <span class="pill">${escapeHtml(s.plan)}</span>`;
      let renewTxt = "";
      if (s.renew === true)  renewTxt = ' · <span class="pill ok">续费中</span>';
      else if (s.renew === false) renewTxt = ' · <span class="pill bad">不续费</span>';
      const untilTxt = s.until ? ` · 到期 ${escapeHtml(String(s.until).slice(0,10))}` : "";
      const perTxt = s.period ? ` · ${escapeHtml(s.period)}` : "";
      const ts = new Date().toLocaleTimeString();
      setAcct(`<span class="pill ok">已登陆</span> ${escapeHtml(s.e)}${nm} · ${planTxt}${renewTxt}${perTxt}${untilTxt} <span class="kh-ts">↻ ${ts}</span>`);
      return true;
    }
    return false;
  } catch { return false; }
}

// 登陆后轮询，检测到即更新状态并清掉“登陆中”
let acctTimer = null;
function pollAcct(times = 15){
  setMsg("登陆中…");
  if (acctTimer) clearInterval(acctTimer);
  let n = 0;
  acctTimer = setInterval(async () => {
    n++;
    if (await verifyOnce()) {
      clearInterval(acctTimer); acctTimer = null;
      setMsg('<span class="pill ok">登陆完成</span>');
    } else if (n >= times) {
      clearInterval(acctTimer); acctTimer = null;
      setAcct('<span class="pill warn">未登陆</span> token 可能失效');
      setMsg('<span class="pill bad">未检测到登陆，请检查 token</span>');
    }
  }, 1000);
}

// ② 一键跳转结算
async function doJump(rt){
  setMsg(`创建结算会话（${rt.label}）…`);
  const code = `(async()=>{try{const t=await(await fetch("/api/auth/session")).json();if(!t.accessToken)return{e:"未登陆，请先①登陆"};const body={entry_point:"all_plans_pricing_modal",plan_name:${JSON.stringify(rt.plan)},billing_details:{country:${JSON.stringify(rt.country)},currency:${JSON.stringify(rt.currency)}},checkout_ui_mode:"custom"};const r=await fetch("https://chatgpt.com/backend-api/payments/checkout",{method:"POST",headers:{Authorization:"Bearer "+t.accessToken,"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(d.checkout_session_id){location.href="https://chatgpt.com/checkout/openai_llc/"+d.checkout_session_id;return{ok:1}}return{e:(d.detail&&JSON.stringify(d.detail))||JSON.stringify(d).slice(0,200)};}catch(e){return{e:String(e)}}})()`;
  try {
    const res = await wv.executeJavaScript(code, true);
    if (res && res.ok) setMsg(`<span class="pill ok">已跳转结算</span> ${escapeHtml(rt.label)} — 卡号/地址页面手动填`);
    else setMsg(`<span class="pill bad">${escapeHtml((res&&res.e)||"失败")}</span>`);
  } catch (e) { setMsg(`<span class="pill bad">${escapeHtml(String(e))}</span>`); }
}

// ③ 一键导出 sub2api 导入 JSON（格式与官方转换器一致）
function toSub2(s){
  const email = (s.user && s.user.email) || "";
  const now = Date.now();
  const expISO = s.expires || "";
  const expMs = expISO ? Date.parse(expISO) : 0;
  return {
    exported_at: new Date().toISOString(),
    proxies: [],
    accounts: [{
      name: email,
      platform: "openai",
      type: "oauth",
      concurrency: 10,
      priority: 1,
      credentials: {
        access_token: s.accessToken || "",
        chatgpt_account_id: (s.account && s.account.id) || "",
        chatgpt_user_id: (s.user && s.user.id) || "",
        email,
        expires_at: expISO,
        expires_in: expMs ? Math.floor((expMs - now) / 1000) : 0,
        plan_type: (s.account && s.account.planType) || ""
      },
      extra: {
        email,
        email_key: email.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        name: email,
        auth_provider: s.authProvider || "openai",
        source: "chatgpt_web_session",
        last_refresh: new Date().toISOString()
      }
    }]
  };
}

function download(text, filename){
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$("#exportBtn").onclick = async () => {
  setMsg("读取 session…");
  try {
    const s = await wv.executeJavaScript(`fetch("/api/auth/session").then(r=>r.json()).catch(()=>null)`, true);
    if (!s || !s.accessToken) { setMsg('<span class="pill bad">未登陆或读取失败</span>'); return; }
    const fname = (currentName || (s.user && s.user.email) || "account").replace(/[^\w.-]+/g, "_") + ".sub2api.json";
    download(JSON.stringify(toSub2(s), null, 2), fname);
    setMsg(`<span class="pill ok">已导出</span> ${escapeHtml(fname)}`);
  } catch (e) { setMsg(`<span class="pill bad">${escapeHtml(String(e))}</span>`); }
};

// ④ 一键退订续费：直接调 /backend-api/subscriptions/cancel（已从前端代码验证签名）
//    失败则兜底打开官方 Stripe 客户门户
$("#cancelBtn").onclick = async () => {
  if (!confirm("取消当前账号的订阅续费？\n停止下次扣费，当前周期内仍可用。")) return;
  setMsg("退订中…");
  const code = `(async()=>{
    try{
      const d=await(await fetch("/api/auth/session",{cache:"no-store"})).json();
      if(!d.accessToken)return{e:"未登陆"};
      const acc=d.account&&d.account.id;
      const H={Authorization:"Bearer "+d.accessToken,"Content-Type":"application/json"};
      const r=await fetch("/backend-api/subscriptions/cancel",{method:"POST",headers:H,body:JSON.stringify({account_id:acc,cancellation_outcome:"deactivate"})});
      let b; try{b=await r.json()}catch(e){b=await r.text()}
      // 复核真实续费状态：以 will_renew 为准，不轻信 200
      let will=null;
      try{ const s=await fetch("/backend-api/subscriptions?account_id="+acc,{headers:H,cache:"no-store"}); if(s.ok){const sj=await s.json(); will=!!sj.will_renew;} }catch(e){}
      return {status:r.status, body:b, will_renew:will};
    }catch(e){return{e:String(e)}}
  })()`;
  try {
    const res = await wv.executeJavaScript(code, true);
    if (res && res.e) { setMsg(`<span class="pill bad">出错：${escapeHtml(res.e)}</span>`); return; }
    if (res && res.will_renew === false) {
      setMsg('<span class="pill ok">已退订（已确认 will_renew=false）</span>');
      setTimeout(verifyOnce, 800);
    } else {
      // 没真正生效：显示原始返回，并打开官方门户兜底
      const raw = escapeHtml(JSON.stringify(res && res.body !== undefined ? res.body : res).slice(0, 220));
      setMsg(`<span class="pill bad">退订未生效(HTTP ${escapeHtml(String(res&&res.status))}, will_renew=${escapeHtml(String(res&&res.will_renew))})</span> ${raw}`);
      setTimeout(verifyOnce, 800);
    }
  } catch (e) { setMsg(`<span class="pill bad">${escapeHtml(String(e))}</span>`); }
};

// 页面加载完成后刷新常驻状态（只在没有正在轮询时，避免互相打架）
wv.addEventListener("did-finish-load", () => {
  const u = wv.getURL();
  if (/chatgpt\.com/.test(u) && !acctTimer) verifyOnce();
});

// 显示当前版本，便于确认是否更新成功
window.kh.getVersion().then(v => { const e = $("#ver"); if (e) e.textContent = "v" + v; document.title = "分销充值助手 v" + v; }).catch(() => {});

renderRechargeButtons();
renderAccounts();
setAcct('<span class="pill warn">未登陆</span>');
setMsg("①填备注名+粘 token 登陆，再②充值。提取JSON=导出 sub2api 格式。");
