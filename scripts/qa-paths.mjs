#!/usr/bin/env node
/**
 * Lokasi bersama untuk artefak pengujian.
 *
 * Semua hasil QA masuk ke `artifacts/qa/{screenshots,exports,logs}` — bukan ke
 * root proyek. Folder dibuat otomatis saat dipakai.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

export const qaRoot = path.join(repoRoot, "artifacts", "qa");

export function qaPath(kind, name) {
  const dir = path.join(qaRoot, kind);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

/** Timestamp aman untuk nama berkas, mis. 2026-11-16T00-30-00. */
export function qaStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-").replace("Z", "");
}
