#!/usr/bin/env node
/**
 * Pulihkan backup v1.0.0 ke Supabase.
 *
 * Pemakaian:
 *   RELEASE_SUPABASE_URL=... RELEASE_SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/release/restore-v1.0.0.mjs artifacts/release/backup-v1.0.0-....json
 *
 * Validasi versi, enam tabel, duplikat id, dan projectHost dilakukan sebelum
 * koneksi/penulisan. Target berbeda ditolak. Kredensial tidak pernah dicetak.
 */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

import {
  RELEASE_VERSION,
  RESTORE_ORDER,
  assertBackupShape,
} from "./lib.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Pemakaian: node scripts/release/restore-v1.0.0.mjs <backup.json>");
  process.exit(2);
}

const url = (
  process.env.RELEASE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ""
).trim();
const serviceKey = (
  process.env.RELEASE_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  ""
).trim();
if (!url || !serviceKey) {
  console.error("Service role key/URL belum diisi. Restore dibatalkan.");
  process.exit(2);
}

let backup;
try {
  backup = JSON.parse(fs.readFileSync(file, "utf8"));
  assertBackupShape(backup, {
    targetHost: url,
    expectedVersion: RELEASE_VERSION,
  });

  for (const table of RESTORE_ORDER) {
    const rows = backup.tables[table];
    if (
      backup.counts &&
      Object.prototype.hasOwnProperty.call(backup.counts, table) &&
      backup.counts[table] !== rows.length
    ) {
      throw new Error(
        `${table}: counts di backup (${backup.counts[table]}) tidak cocok dengan jumlah baris (${rows.length}).`,
      );
    }
  }
} catch (error) {
  console.error(`Validasi backup gagal; tidak ada data ditulis: ${error.message}`);
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CHUNK = 500;

try {
  for (const table of RESTORE_ORDER) {
    const rows = backup.tables[table];
    if (rows.length === 0) {
      console.log(`${table}: 0 baris`);
      continue;
    }
    for (let index = 0; index < rows.length; index += CHUNK) {
      const chunk = rows.slice(index, index + CHUNK);
      const { error } = await supabase
        .from(table)
        .upsert(chunk, { onConflict: "id" });
      if (error) {
        throw new Error(`${table}: ${error.message}`);
      }
    }
    console.log(`${table}: ${rows.length} baris dipulihkan`);
  }
  console.log("Restore selesai; target dan versi sudah divalidasi.");
} catch (error) {
  console.error(`Restore GAGAL: ${error.message}`);
  process.exit(1);
}
