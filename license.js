// 授权校验（离线签名方案）
// CDK 由注册机用私钥签发；本模块用内置公钥验签。无私钥无法伪造 CDK。
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

// 内置公钥（可公开）。私钥只在注册机 keygen/private.pem，切勿外泄。
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADyvCO5W81FnDciE2HDVHQpakRH9t6Uzzbtvir9wC7AY=
-----END PUBLIC KEY-----`;

const PREFIX = "KANET";

// 机器指纹：主机名 + 首个非内网 MAC + 平台 + CPU 型号，取 hash 前 16 位
function machineId() {
  const ifs = os.networkInterfaces();
  let mac = "";
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== "00:00:00:00:00:00") { mac = ni.mac; break; }
    }
    if (mac) break;
  }
  const raw = [os.hostname(), mac, os.platform(), (os.cpus()[0] || {}).model || ""].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16).toUpperCase();
}

function b64uToBuf(s) { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"); }

// 解析并验签 CDK。返回 {valid, reason, payload}
function verifyCDK(cdk) {
  try {
    if (!cdk) return { valid: false, reason: "空" };
    // 格式：KANET-<payloadB64u>.<sigB64u>
    const parts = cdk.trim().replace(new RegExp("^" + PREFIX + "-"), "").split(".");
    if (parts.length !== 2) return { valid: false, reason: "格式错误" };
    const payloadBuf = b64uToBuf(parts[0]);
    const sigBuf = b64uToBuf(parts[1]);
    const ok = crypto.verify(null, payloadBuf, PUBLIC_KEY, sigBuf);
    if (!ok) return { valid: false, reason: "签名无效（伪造或损坏）" };
    const payload = JSON.parse(payloadBuf.toString("utf8"));
    // 过期
    if (payload.exp && Date.now() > payload.exp) {
      return { valid: false, reason: "已过期（" + new Date(payload.exp).toLocaleString() + "）", payload };
    }
    // 机器绑定
    if (payload.m && payload.m !== machineId()) {
      return { valid: false, reason: "机器码不匹配（本机 " + machineId() + "）", payload };
    }
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: "解析失败：" + e.message };
  }
}

function licenseFile() { return path.join(app.getPath("userData"), "license.json"); }

function saveActivation(cdk) {
  try { fs.writeFileSync(licenseFile(), JSON.stringify({ cdk, ts: Date.now() })); return true; } catch { return false; }
}
function loadActivation() {
  try { return JSON.parse(fs.readFileSync(licenseFile(), "utf8")); } catch { return null; }
}
function clearActivation() { try { fs.unlinkSync(licenseFile()); } catch {} }

// 当前是否已激活（读本地存储并复验）
function currentStatus() {
  const a = loadActivation();
  if (!a || !a.cdk) return { activated: false };
  const r = verifyCDK(a.cdk);
  return { activated: r.valid, reason: r.reason, payload: r.payload, cdk: a.cdk };
}

module.exports = { verifyCDK, machineId, saveActivation, loadActivation, clearActivation, currentStatus };
