#!/usr/bin/env node
// 注册机：用私钥签发 CDK。仅供软件作者本地使用，private.pem 切勿外泄。
// 用法：
//   node keygen.js gen                      永久授权（不过期、不绑机）
//   node keygen.js gen --days 30            30 天有效
//   node keygen.js gen --machine ABCD1234   绑定到指定机器码
//   node keygen.js gen --days 365 --machine ABCD1234 --note "客户张三"
//   node keygen.js init                     重新生成密钥对（会使旧 CDK + 程序内公钥失效，需重打包）
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const PRIV = path.join(DIR, "private.pem");
const PUB = path.join(DIR, "public.pem");

function b64u(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; o[k] = v; }
  }
  return o;
}

function init() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(PRIV, privateKey.export({ type: "pkcs8", format: "pem" }));
  fs.writeFileSync(PUB, publicKey.export({ type: "spki", format: "pem" }));
  console.log("已生成新密钥对：");
  console.log("  私钥 -> keygen/private.pem （保密）");
  console.log("  公钥 -> keygen/public.pem");
  console.log("\n把下面的公钥粘到 license.js 的 PUBLIC_KEY，然后重新打包程序：\n");
  console.log(fs.readFileSync(PUB, "utf8"));
}

function gen(args) {
  if (!fs.existsSync(PRIV)) { console.error("找不到 keygen/private.pem，请先 node keygen.js init"); process.exit(1); }
  if (!args.machine) { console.error("必须指定 --machine 机器码（已启用强制绑定）。客户在程序激活页可看到自己的机器码。"); process.exit(1); }
  const priv = crypto.createPrivateKey(fs.readFileSync(PRIV));
  const payload = { id: crypto.randomBytes(6).toString("hex"), iat: Date.now() };
  if (args.days) payload.exp = Date.now() + Number(args.days) * 86400000;
  payload.m = String(args.machine).trim().toUpperCase();
  if (args.note) payload.note = String(args.note);

  const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = crypto.sign(null, payloadBuf, priv);
  const cdk = "KANET-" + b64u(payloadBuf) + "." + b64u(sig);

  console.log("\n授权码 CDK：\n");
  console.log(cdk);
  console.log("\n内容：");
  console.log("  有效期：" + (payload.exp ? new Date(payload.exp).toLocaleString() : "永久"));
  console.log("  绑定机器码：" + (payload.m || "不绑定（任意机器）"));
  console.log("  备注：" + (payload.note || "-"));
  console.log("  授权ID：" + payload.id);
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));
if (cmd === "init") init();
else if (cmd === "gen") gen(args);
else { console.log("用法：\n  node keygen.js gen [--days N] [--machine 机器码] [--note 备注]\n  node keygen.js init   （重新生成密钥对）"); }
