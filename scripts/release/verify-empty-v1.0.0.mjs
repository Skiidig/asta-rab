#!/usr/bin/env node
/**
 * Verifikasi tabel bisnis kosong setelah cleanup v1.0.0.
 * Memerlukan service role key; hanya menghitung, tidak menulis.
 *
 * Count null/tidak valid adalah kegagalan, bukan nol.
 */

import { createClient } from "@supabase/supabase-js";

import { BUSINESS_TABLES, countTableRows } from "./lib.mjs";

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
  console.error("URL/service role belum diisi. Verifikasi dibatalkan.");
  process.exit(2);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = false;
for (const table of BUSINESS_TABLES) {
  try {
    const count = await countTableRows(supabase, table);
    if (count !== 0) failed = true;
    console.log(`${table}: ${count}`);
  } catch (error) {
    failed = true;
    console.error(`${table}: GAGAL — ${error.message}`);
  }
}

if (failed) {
  console.error("Verifikasi gagal: tabel belum kosong atau count tidak valid.");
  process.exit(1);
}
console.log("Semua tabel bisnis kosong (count valid = 0).");
