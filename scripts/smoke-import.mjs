#!/usr/bin/env node
/**
 * Uji jalur database untuk Import Excel.
 *
 * Yang diuji (persis seperti `importDocument` di aplikasi):
 *   1. Membuat dokumen RAB baru pada proyek milik pengguna (bukan menimpa).
 *   2. Menyisipkan item secara bertahap (batch 200) dan memastikan semuanya masuk.
 *   3. Total item sama dengan volume × harga satuan (dihitung ulang).
 *   4. Dokumen lama tidak berubah setelah import.
 *   5. Pengguna lain (B) tidak dapat melihat/mengubah dokumen hasil import (RLS).
 *   6. Cleanup: dokumen hasil import dihapus, data lama tetap.
 *
 * Prasyarat: migration 0002–0004 sudah dijalankan, dua akun terkonfirmasi.
 *
 * Pemakaian (PowerShell):
 *   $env:RLS_EMAIL_A="a@contoh.com"; $env:RLS_PASSWORD_A="rahasia1"
 *   $env:RLS_EMAIL_B="b@contoh.com"; $env:RLS_PASSWORD_B="rahasia2"
 *   node scripts/smoke-import.mjs
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function readEnvLocal() {
  const env = {};
  let text = "";
  try {
    text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    console.error("Tidak dapat membaca .env.local");
    process.exit(2);
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

const env = readEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const emailA = process.env.RLS_EMAIL_A;
const passwordA = process.env.RLS_PASSWORD_A;
const emailB = process.env.RLS_EMAIL_B;
const passwordB = process.env.RLS_PASSWORD_B;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY belum diisi.");
  process.exit(2);
}
if (!emailA || !passwordA || !emailB || !passwordB) {
  console.error(
    "Kredensial uji belum diset: RLS_EMAIL_A, RLS_PASSWORD_A, RLS_EMAIL_B, RLS_PASSWORD_B",
  );
  process.exit(2);
}

const MARK = "[import-smoke]";
const CHUNK = 200;
let passed = 0;
const failures = [];

const ok = (label, detail = "") => {
  passed += 1;
  console.log(`  OK   ${label}${detail ? ` — ${detail}` : ""}`);
};
const fail = (label, detail) => {
  failures.push(`${label}: ${detail}`);
  console.log(`  FAIL ${label} — ${detail}`);
};

function newClient() {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(client, email, password, who) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Gagal masuk sebagai ${who}: ${error.message}`);
  return data.user;
}

function amount(volume, unitPrice) {
  return Math.round(volume * unitPrice * 100) / 100;
}

async function main() {
  console.log(`Supabase: ${url}`);
  console.log(`A = ${emailA}\nB = ${emailB}\n`);

  const clientA = newClient();
  await signIn(clientA, emailA, passwordA, "A");
  ok("login pengguna A");

  // Proyek + dokumen lama (tidak boleh berubah karena import).
  const project = await clientA
    .from("projects")
    .insert({ name: `${MARK} Proyek`, status: "planning" })
    .select("id")
    .single();
  if (project.error) {
    fail("insert proyek", project.error.message);
    return finish();
  }

  const existing = await clientA
    .from("rab_documents")
    .insert({ project_id: project.data.id, title: `${MARK} Dokumen Lama` })
    .select("id")
    .single();
  if (existing.error) {
    fail("insert dokumen lama", existing.error.message);
    return finish({ clientA, projectId: project.data.id });
  }

  const existingItem = await clientA
    .from("rab_items")
    .insert({
      rab_id: existing.data.id,
      description: "Item lama",
      volume: 1,
      unit: "ls",
      unit_price: 500000,
    })
    .select("*")
    .single();
  if (existingItem.error) {
    fail("insert item lama", existingItem.error.message);
  }

  // ---------------------------------------------------------------
  console.log("1) Import: dokumen baru + item bertahap (batch 200)");
  // ---------------------------------------------------------------
  const imported = await clientA
    .from("rab_documents")
    .insert({
      project_id: project.data.id,
      title: `${MARK} Hasil Import`,
      date: new Date().toISOString().slice(0, 10),
    })
    .select("*")
    .single();

  if (imported.error) {
    fail("insert dokumen hasil import", imported.error.message);
    return finish({ clientA, projectId: project.data.id });
  }
  ok("dokumen baru dibuat", imported.data.id);

  const rows = Array.from({ length: 250 }, (_, index) => ({
    rab_id: imported.data.id,
    description: `${MARK} Pekerjaan ${index + 1}`,
    volume: 1 + (index % 5) * 0.5,
    unit: "m3",
    unit_price: 100000 + index,
    group_name: `I GROUP ${Math.floor(index / 100) + 1}`,
    subgroup_name: `A.${Math.floor(index / 20) + 1} SUBGROUP`,
    item_group_name: index % 10 === 0 ? `Item Group ${index}` : null,
    sort_order: index + 1,
  }));

  const base = Date.now();
  for (let index = 0; index < rows.length; index += CHUNK) {
    const chunk = rows.slice(index, index + CHUNK).map((row, offset) => ({
      ...row,
      created_at: new Date(base + index + offset).toISOString(),
    }));
    const inserted = await clientA.from("rab_items").insert(chunk).select("id");
    if (inserted.error) {
      fail(`insert batch ${index / CHUNK + 1}`, inserted.error.message);
      return finish({ clientA, projectId: project.data.id, importId: imported.data.id });
    }
  }
  ok("250 item terkirim dalam 2 batch");

  const readBack = await clientA
    .from("rab_items")
    .select(
      "description,volume,unit_price,group_name,subgroup_name,item_group_name,sort_order",
    )
    .eq("rab_id", imported.data.id)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (readBack.error) {
    fail("baca item hasil import", readBack.error.message);
  } else if (readBack.data.length !== rows.length) {
    fail("jumlah item", `${readBack.data.length} dari ${rows.length}`);
  } else {
    ok("jumlah item sesuai", `${readBack.data.length} baris`);
  }

  // Kolom struktur (migrasi 0005) harus terbaca kembali apa adanya.
  const firstItem = (readBack.data ?? [])[0];
  const groupItem = (readBack.data ?? []).find((row) => row.sort_order === 11);

  if (!firstItem) {
    fail("kolom struktur", "tidak ada baris terbaca");
  } else {
    if (firstItem.group_name !== "I GROUP 1") {
      fail("group_name", `dapat ${firstItem.group_name}`);
    } else if (firstItem.subgroup_name !== "A.1 SUBGROUP") {
      fail("subgroup_name", `dapat ${firstItem.subgroup_name}`);
    } else if (firstItem.sort_order !== 1) {
      fail("sort_order", `dapat ${firstItem.sort_order}`);
    } else if (groupItem?.item_group_name !== "Item Group 10") {
      fail("item_group_name", `dapat ${groupItem?.item_group_name}`);
    } else {
      ok("kolom struktur terbaca kembali", "group/subgroup/item_group/sort_order");
    }

    const ordered = (readBack.data ?? []).every(
      (row, index) => row.sort_order === index + 1,
    );
    if (!ordered) fail("urutan sort_order", "tidak berurutan");
    else ok("urutan item mengikuti sort_order");
  }

  const totalFromDb = (readBack.data ?? []).reduce(
    (sum, row) => sum + amount(Number(row.volume), Number(row.unit_price)),
    0,
  );
  const totalExpected = rows.reduce(
    (sum, row) => sum + amount(row.volume, row.unit_price),
    0,
  );
  if (Math.abs(totalFromDb - totalExpected) > 0.01) {
    fail("total hasil import", `${totalFromDb} vs ${totalExpected}`);
  } else {
    ok("total = Σ volume × harga satuan", `Rp${totalExpected.toLocaleString("id-ID")}`);
  }

  // ---------------------------------------------------------------
  console.log("2) Dokumen lama tidak berubah");
  // ---------------------------------------------------------------
  const oldDoc = await clientA
    .from("rab_documents")
    .select("title")
    .eq("id", existing.data.id)
    .single();
  const oldItems = await clientA
    .from("rab_items")
    .select("id")
    .eq("rab_id", existing.data.id);

  if (oldDoc.error || oldItems.error) {
    fail("baca dokumen lama", oldDoc.error?.message ?? oldItems.error?.message);
  } else if (oldDoc.data.title !== `${MARK} Dokumen Lama` || oldItems.data.length !== 1) {
    fail("dokumen lama utuh", `judul="${oldDoc.data.title}" item=${oldItems.data.length}`);
  } else {
    ok("dokumen lama utuh", "judul & 1 item tidak berubah");
  }

  // ---------------------------------------------------------------
  console.log("3) Isolasi antar pengguna");
  // ---------------------------------------------------------------
  const clientB = newClient();
  await signIn(clientB, emailB, passwordB, "B");

  const seenByB = await clientB
    .from("rab_documents")
    .select("id")
    .eq("id", imported.data.id);
  if (!seenByB.error && seenByB.data.length !== 0) {
    fail("B melihat dokumen hasil import", `${seenByB.data.length} baris`);
  } else {
    ok("B tidak melihat dokumen hasil import", seenByB.error?.code ?? "0 baris");
  }

  const itemsByB = await clientB
    .from("rab_items")
    .select("id")
    .eq("rab_id", imported.data.id);
  if (!itemsByB.error && itemsByB.data.length !== 0) {
    fail("B melihat item hasil import", `${itemsByB.data.length} baris`);
  } else {
    ok("B tidak melihat item hasil import", itemsByB.error?.code ?? "0 baris");
  }

  const deleteByB = await clientB
    .from("rab_documents")
    .delete()
    .eq("id", imported.data.id)
    .select("id");
  if (deleteByB.error) {
    ok("B tidak dapat menghapus dokumen A", `ditolak ${deleteByB.error.code}`);
  } else if (deleteByB.data.length !== 0) {
    fail("B menghapus dokumen A", `${deleteByB.data.length} baris`);
  } else {
    ok("B tidak dapat menghapus dokumen A", "0 baris terpengaruh");
  }

  await clientB.auth.signOut();

  // ---------------------------------------------------------------
  console.log("4) Cleanup");
  // ---------------------------------------------------------------
  const deleteImport = await clientA
    .from("rab_documents")
    .delete()
    .eq("id", imported.data.id)
    .select("id");
  if (deleteImport.error) {
    fail("hapus dokumen hasil import", deleteImport.error.message);
  } else {
    const orphans = await clientA
      .from("rab_items")
      .select("id")
      .eq("rab_id", imported.data.id);
    if (!orphans.error && orphans.data.length === 0) {
      ok("hapus dokumen menghapus itemnya", "0 item tersisa");
    } else {
      fail("cascade item", orphans.error?.message ?? `${orphans.data.length} tersisa`);
    }
  }

  return finish({ clientA, projectId: project.data.id });
}

async function finish(cleanup) {
  if (cleanup?.clientA && cleanup.projectId) {
    const removed = await cleanup.clientA
      .from("projects")
      .delete()
      .eq("id", cleanup.projectId)
      .select("id");
    if (removed.error) console.log(`  (pembersihan gagal: ${removed.error.message})`);
    else console.log("  (proyek & dokumen uji dibersihkan)");
  }

  console.log(`\nHasil: ${passed} lulus, ${failures.length} gagal`);
  if (failures.length > 0) {
    for (const line of failures) console.log(`  - ${line}`);
    process.exit(1);
  }
  console.log("Import Excel: pembuatan dokumen baru, batch item, dan RLS terverifikasi.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nError tak terduga:", error.message ?? error);
  process.exit(1);
});
