const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("path");
const { checkForUpdates } = require("./updater");
const lic = require("./license");

const PARTITION = "persist:chatgpt";
const COOKIE_DOMAIN = "chatgpt.com";
const SESSION_COOKIE = "__Secure-next-auth.session-token";

let mainWin = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "分销充值助手",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  mainWin = win;
  // 授权门：已激活进主界面，否则进激活页
  if (lic.currentStatus().activated) {
    win.loadFile("index.html");
    setTimeout(() => checkForUpdates(win, true), 4000);
  } else {
    win.loadFile("activation.html");
  }
}

ipcMain.handle("check-update", () => { if (mainWin) checkForUpdates(mainWin, false); });
ipcMain.handle("get-version", () => app.getVersion());

// ---- 授权相关 IPC ----
ipcMain.handle("lic-machine-id", () => lic.machineId());
ipcMain.handle("lic-status", () => lic.currentStatus());
ipcMain.handle("lic-activate", (_e, cdk) => {
  const r = lic.verifyCDK(cdk);
  if (r.valid) {
    lic.saveActivation(cdk.trim());
    if (mainWin) mainWin.loadFile("index.html");
    return { ok: true, payload: r.payload };
  }
  return { ok: false, reason: r.reason };
});
ipcMain.handle("lic-deactivate", () => { lic.clearActivation(); if (mainWin) mainWin.loadFile("activation.html"); });

// next-auth 把超长 session token 切成 < 4096B 的多块 cookie，这里复制其分块规则
const CHUNK = 3933; // 4096 - 估算的 cookie 头开销，与 next-auth 一致

async function clearSessionCookies(ses) {
  const names = [SESSION_COOKIE];
  for (let i = 0; i < 20; i++) names.push(`${SESSION_COOKIE}.${i}`);
  for (const n of names) { try { await ses.cookies.remove("https://chatgpt.com", n); } catch (_) {} }
}

// 注入会话 token（用于切换 / 快捷登陆你自己或客户授权的账号）
ipcMain.handle("set-token", async (_e, token) => {
  const ses = session.fromPartition(PARTITION);
  const val = (token || "").trim();
  if (!val) return { ok: false, msg: "token 为空" };
  const base = {
    url: "https://chatgpt.com",
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax"
    // 不设 domain：__Secure- 前缀 cookie 为 host-only，与真实 cookie 一致
  };
  try {
    await clearSessionCookies(ses);
    if (val.length <= CHUNK) {
      await ses.cookies.set({ ...base, name: SESSION_COOKIE, value: val });
    } else {
      let idx = 0;
      for (let p = 0; p < val.length; p += CHUNK, idx++) {
        await ses.cookies.set({ ...base, name: `${SESSION_COOKIE}.${idx}`, value: val.slice(p, p + CHUNK) });
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, msg: String(err) };
  }
});

// 退出 / 清空当前账号会话
ipcMain.handle("clear-session", async () => {
  const ses = session.fromPartition(PARTITION);
  try {
    // 清空整个分区：cookie + localStorage + IndexedDB + 缓存 + Service Worker
    // 否则 ChatGPT 的 SW 会用缓存的旧 /api/auth/session，导致切号后仍显示旧账号/旧订阅
    await ses.clearStorageData();
    await ses.clearCache();
    return { ok: true };
  } catch (err) {
    return { ok: false, msg: String(err) };
  }
});

void COOKIE_DOMAIN;

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
