const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let win = null;
let keyOverride = null; // 用户手动选择的私钥路径

// 整体模式：内嵌私钥（构建时注入，gitignore，不进公开仓库）
let EMBEDDED_KEY = null;
try { EMBEDDED_KEY = require("./embedded-key.js"); } catch (_) { EMBEDDED_KEY = null; }

function createWindow() {
  win = new BrowserWindow({
    width: 560, height: 620, title: "授权注册机",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile("keygen.html");
}

// 私钥查找：用户指定 > 可执行文件同目录 > resources > 开发目录
function keyPath() {
  const cands = [
    keyOverride,
    path.join(path.dirname(app.getPath("exe")), "private.pem"),
    path.join(process.resourcesPath || "", "private.pem"),
    path.join(__dirname, "..", "keygen", "private.pem")
  ].filter(Boolean);
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch (_) {} }
  return null;
}

function b64u(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

ipcMain.handle("key-status", () => {
  if (EMBEDDED_KEY) return { found: true, integrated: true, path: "内置私钥" };
  const p = keyPath(); return { found: !!p, integrated: false, path: p || "" };
});

function getPrivateKey() {
  if (EMBEDDED_KEY) return crypto.createPrivateKey(EMBEDDED_KEY);
  const p = keyPath();
  if (!p) return null;
  return crypto.createPrivateKey(fs.readFileSync(p));
}

ipcMain.handle("pick-key", async () => {
  const r = await dialog.showOpenDialog(win, { title: "选择 private.pem 私钥", properties: ["openFile"], filters: [{ name: "PEM", extensions: ["pem"] }] });
  if (!r.canceled && r.filePaths[0]) { keyOverride = r.filePaths[0]; return { found: true, path: keyOverride }; }
  return { found: !!keyPath(), path: keyPath() || "" };
});

ipcMain.handle("gen-cdk", (_e, opts) => {
  try {
    if (!opts.machine || !String(opts.machine).trim()) return { ok: false, reason: "必须填写机器码（已启用强制绑定）" };
    const priv = getPrivateKey();
    if (!priv) return { ok: false, reason: "无可用私钥（未内置且未选择 private.pem）" };
    const payload = { id: crypto.randomBytes(6).toString("hex"), iat: Date.now() };
    if (opts.days) payload.exp = Date.now() + Number(opts.days) * 86400000;
    payload.m = String(opts.machine).trim().toUpperCase();
    if (opts.note) payload.note = String(opts.note).trim();
    const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
    const sig = crypto.sign(null, payloadBuf, priv);
    const cdk = "KANET-" + b64u(payloadBuf) + "." + b64u(sig);
    return { ok: true, cdk, exp: payload.exp || null, machine: payload.m || "", note: payload.note || "", id: payload.id };
  } catch (e) { return { ok: false, reason: String(e) }; }
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
