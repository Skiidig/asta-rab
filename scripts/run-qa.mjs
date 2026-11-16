#!/usr/bin/env node
/**
 * Jalankan skrip smoke/QA dan simpan stdout+stderr ke
 * `artifacts/qa/logs/<nama>-<timestamp>.log`.
 *
 * Pemakaian:
 *   node scripts/run-qa.mjs scripts/smoke-crud.mjs
 *   node scripts/run-qa.mjs scripts/smoke-auth-rls.mjs
 *
 * Argumen setelah nama skrip diteruskan apa adanya.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { qaPath, qaStamp, repoRoot } from "./qa-paths.mjs";

const script = process.argv[2];
if (!script) {
  console.error(
    "Pemakaian: node scripts/run-qa.mjs <scripts/smoke-*.mjs> [argumen...]",
  );
  process.exit(2);
}

const scriptPath = path.resolve(repoRoot, script);
if (!fs.existsSync(scriptPath)) {
  console.error(`Skrip tidak ditemukan: ${scriptPath}`);
  process.exit(2);
}

const name = path.basename(scriptPath, path.extname(scriptPath));
const logPath = qaPath("logs", `${name}-${qaStamp()}.log`);
const log = fs.createWriteStream(logPath, { flags: "a" });
log.write(`# ${name} — ${new Date().toISOString()}\n`);

const child = spawn(process.execPath, [scriptPath, ...process.argv.slice(3)], {
  cwd: repoRoot,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
}

child.on("close", (code) => {
  log.end(() => {
    console.log(`\nLog QA: ${path.relative(repoRoot, logPath)}`);
    process.exit(code ?? 1);
  });
});
