/**
 * 依赖方向检查：把 docs/DEPENDENCIES.md 的硬规则落成 CI 门。
 *
 * 规则：
 * 1. src/ 不能 import demos/
 * 2. src/contracts 只能 import 自己
 * 3. engine/ 不能 import llm/、harness/、src/
 * 4. src/host 不能 import DSH/宿主路径（当前尚无 host，先留检查）
 *
 * 只做静态文本扫描；不解析 TypeScript 类型，不联网。
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();
const IMPORT_RE = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

function workspacePath(absPath) {
  return relative(ROOT, absPath).split(sep).join("/");
}

function importsOf(file) {
  const text = readFileSync(file, "utf8");
  const specs = [];
  for (const match of text.matchAll(IMPORT_RE)) specs.push(match[1] ?? match[2]);
  return specs;
}

const errors = [];
let scanned = 0;

const srcFiles = walk(join(ROOT, "src"));
for (const file of srcFiles) {
  const relFile = workspacePath(file);
  scanned++;
  for (const spec of importsOf(file)) {
    if (!spec.startsWith(".")) continue;
    const target = workspacePath(resolve(dirname(file), spec));
    if (target.startsWith("demos/")) errors.push(`${relFile} 反向依赖 demo: ${spec}`);
    if (relFile.startsWith("src/contracts/") && !target.startsWith("src/contracts/")) {
      errors.push(`${relFile} 的 contracts 不允许依赖实现: ${spec}`);
    }
    if (relFile.startsWith("src/host/") && /dsh|deepseek-harness/i.test(spec)) {
      errors.push(`${relFile} 把宿主类型带进领域层: ${spec}`);
    }
  }
}

const engineFiles = walk(join(ROOT, "engine"));
for (const file of engineFiles) {
  const relFile = workspacePath(file);
  scanned++;
  for (const spec of importsOf(file)) {
    if (!spec.startsWith(".")) continue;
    const target = workspacePath(resolve(dirname(file), spec));
    if (target.startsWith("llm/") || target.startsWith("harness/") || target.startsWith("src/")) {
      errors.push(`${relFile} 的内核依赖过重: ${spec}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ok: no dependency violation (${scanned} files)`);
