#!/usr/bin/env node
/**
 * Backup data bisnis sebelum cleanup rilis v1.0.0.
 *
 * Memerlukan service role key (bypass RLS) HANYA di lingkungan lokal:
 *   RELEASE_SUPABASE_URL
 *   RELEASE_SUPABASE_SERVICE_ROLE_KEY
 *
 * Fallback URL: NEXT_PUBLIC_SUPABASE_URL.
 * Kunci tidak pernah dicetak. Backup ditulis ke artifacts/release/ yang
 * diabaikan Git. Akun auth dan user_metadata TIDAK termasuk backup.
 *
 * Backup membaca count exact + pagination order by id, memeriksa duplikat,
 * dan mencocokkan jumlah. Jika ada kegagalan, proses keluar non-zero tanpa
 * menulis backup "berhasil".
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  BUSINESS_TABLES,
  RELEASE_VERSION,
  assertBackupShape,
  fetchTableRows,
} from "./lib.mjs";

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
  console.error(
    "Backup dibatalkan: set RELEASE_SUPABASE_URL dan " +
      "RELEASE_SUPABASE_SERVICE_ROLE_KEY (service role, jangan commit).",
  );
  process.exit(2);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  const backup = {
    version: RELEASE_VERSION,
    capturedAt: new Date().toISOString(),
    projectHost: new URL(url).host.toLowerCase(),
    tables: {},
    counts: {},
  };
  let total = 0;

  for (const table of BUSINESS_TABLES) {
    const { rows, count } = await fetchTableRows(supabase, table);
    backup.tables[table] = rows;
    backup.counts[table] = count;
    total += rows.length;
    console.log(`${table}: ${rows.length} baris (count ${count})`);
  }

  assertBackupShape(backup, { targetHost: backup.projectHost });

  const stamp = backup.capturedAt.replace(/[:.]/g, "-").replace("Z", "");
  const dir = path.join(process.cwd(), "artifacts", "release");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backup-v1.0.0-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));

  console.log(
    `Backup lengkap: ${total} baris, enam tabel cocok. ` +
      `Berkas: ${path.relative(process.cwd(), file)}`,
  );
  console.log("Simpan berkas ini di luar Git; jangan bagikan kredensial.");
} catch (error) {
  console.error(`Backup GAGAL: ${error.message}`);
  process.exit(1);
}
