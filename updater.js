// 自定义半自动更新器：查 GitHub Releases → 比对版本 → 人工确认下载 → 打开安装包
// 无需代码签名，Win / Mac 通用。
const { app, dialog, shell, BrowserWindow } = require("electron");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

// 仓库地址：建仓后填成 "owner/repo"，或用环境变量覆盖
const REPO = process.env.KANET_REPO || "lianqing123/kanet-recharge-app";

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "kanet-app", ...headers } }, (res) => {
      // 跟随重定向（GitHub 资源会跳到对象存储）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpsGet(res.headers.location, headers));
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

function download(url, dest, win) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const go = (u) => {
      https.get(u, { headers: { "User-Agent": "kanet-app" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(res.headers.location);
        }
        if (res.statusCode !== 200) { reject(new Error("下载失败 HTTP " + res.statusCode)); return; }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let got = 0;
        res.on("data", (c) => {
          got += c.length;
          if (total && win && !win.isDestroyed()) win.setProgressBar(got / total);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => { if (win && !win.isDestroyed()) win.setProgressBar(-1); resolve(dest); }));
      }).on("error", (e) => { fs.unlink(dest, () => {}); reject(e); });
    };
    go(url);
  });
}

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function pickAsset(assets) {
  const isMac = process.platform === "darwin";
  const arch = process.arch; // arm64 / x64
  if (isMac) {
    return assets.find(a => /\.dmg$/i.test(a.name) && a.name.includes(arch))
        || assets.find(a => /\.dmg$/i.test(a.name));
  }
  return assets.find(a => /\.exe$/i.test(a.name) && /setup/i.test(a.name))
      || assets.find(a => /\.exe$/i.test(a.name));
}

async function checkForUpdates(win, silent) {
  if (REPO.startsWith("OWNER/")) {
    if (!silent) dialog.showMessageBox(win, { type: "warning", message: "更新仓库未配置", detail: "请在 updater.js 里把 REPO 改成你的 owner/repo。" });
    return;
  }
  try {
    const { status, body } = await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`, { Accept: "application/vnd.github+json" });
    if (status !== 200) { if (!silent) dialog.showMessageBox(win, { type: "error", message: "检查更新失败", detail: "HTTP " + status }); return; }
    const rel = JSON.parse(body);
    const latest = rel.tag_name || "";
    if (!latest || cmpVer(latest, app.getVersion()) <= 0) {
      if (!silent) dialog.showMessageBox(win, { type: "info", message: "已是最新版本", detail: "当前 v" + app.getVersion() });
      return;
    }
    const r = await dialog.showMessageBox(win, {
      type: "info", buttons: ["下载更新", "稍后"], defaultId: 0, cancelId: 1,
      title: "发现新版本",
      message: `新版本 ${latest} 可用（当前 v${app.getVersion()}）`,
      detail: (rel.body || "").slice(0, 400)
    });
    if (r.response !== 0) return;

    const asset = pickAsset(rel.assets || []);
    if (!asset) { shell.openExternal(rel.html_url); return; }

    const dest = path.join(os.tmpdir(), asset.name);
    await download(asset.browser_download_url, dest, win);

    const r2 = await dialog.showMessageBox(win, {
      type: "info", buttons: ["打开安装包", "稍后"], defaultId: 0,
      title: "下载完成",
      message: "新版本已下载",
      detail: process.platform === "darwin"
        ? "打开后把 App 拖进「应用程序」覆盖旧版即可。"
        : "打开后按提示安装（会覆盖旧版）。"
    });
    if (r2.response === 0) { shell.openPath(dest); }
  } catch (e) {
    if (!silent) dialog.showMessageBox(win, { type: "error", message: "检查更新出错", detail: String(e) });
  }
}

module.exports = { checkForUpdates };
