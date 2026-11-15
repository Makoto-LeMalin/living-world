/**
 * 提交前密钥扫描。
 * 用法：node scripts/check-secrets.mjs
 *
 * 跳过 .env*（真实密钥所在），但 .env.example 会扫，防止把真 key 写进模板。
 */
import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".cassette"]);
const PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,
  /DEEPSEEK_API_KEY\s*=\s*sk-[A-Za-z0-9]{10,}/g,
];

const root = process.cwd();
let hits = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;

    const base = entry.name;
    if (base.startsWith(".env") && base !== ".env.example") continue;
    if (!/\.(ts|js|mjs|cjs|json|md|ya?ml|txt|example)$/.test(base)) continue;

    const text = fs.readFileSync(full, "utf8");
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match) {
        hits++;
        console.log(`SECRET? ${path.relative(root, full)} :: ${match[0].slice(0, 12)}…`);
        break;
      }
    }
  }
}

walk(root);
console.log(hits === 0 ? "ok: no secret pattern found" : `fail: ${hits} file(s) need review`);
process.exitCode = hits === 0 ? 0 : 1;
