#!/usr/bin/env node
/**
 * Smoke test CRUD untuk RAB Mini.
 *
 * Menjalankan alur yang sama seperti aplikasi (melalui REST Supabase, tanpa
 * service role key): buat proyek -> buat dokumen RAB -> tambah item -> baca
 * ulang -> ubah item -> hapus proyek (harus meng-cascade dokumen & item).
 *
 * Pemakaian:  node scripts/smoke-crud.mjs
 * Prasyarat:  supabase/schema.sql sudah dijalankan di project Supabase.
 *
 * Semua baris uji memakai awalan "[smoke]" dan dihapus lagi di akhir.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

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

if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY belum diisi di .env.local",
  );
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Setelah RLS aktif, seluruh operasi memerlukan sesi. Isi RLS_EMAIL_A /
 * RLS_PASSWORD_A dengan akun terkonfirmasi agar skrip ini bekerja.
 */
async function signInIfConfigured() {
  const email = process.env.RLS_EMAIL_A;
  const password = process.env.RLS_PASSWORD_A;
  if (!email || !password) return false;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`Gagal masuk sebagai ${email}: ${error.message}`);
    console.error(
      "Isi RLS_EMAIL_A / RLS_PASSWORD_A dengan akun yang sudah dikonfirmasi.",
    );
    process.exit(2);
  }

  return true;
}

const MARK = "[smoke]";
let passed = 0;
const failures = [];

function ok(label, detail = "") {
  passed += 1;
  console.log(`  OK   ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, error) {
  const message =
    error && typeof error === "object"
      ? [error.message, error.details, error.hint].filter(Boolean).join(" — ")
      : String(error);
  failures.push(`${label}: ${message}`);
  console.log(`  FAIL ${label} — ${message}`);
}

/** Hentikan eksekusi dengan pesan tabel belum ada. */
function explainMissingTable(error) {
  if (error?.code === "PGRST205") {
    console.error(
      "\nTabel belum ada di Supabase. Jalankan supabase/schema.sql di SQL Editor lebih dulu.\n",
    );
    return true;
  }
  if (error?.code === "42501") {
    console.error(
      "\nAkses ditolak (RLS). Pastikan kebijakan pada supabase/schema.sql sudah diterapkan.\n",
    );
    return true;
  }
  return false;
}

async function main() {
  const stamp = new Date().toISOString();
  const projectName = `${MARK} Proyek ${stamp}`;
  let projectId = null;

  console.log(`Supabase: ${url}`);
  const signedIn = await signInIfConfigured();
  console.log(
    signedIn
      ? `Sesi: ${process.env.RLS_EMAIL_A}`
      : "Sesi: anon (RLS belum aktif / tidak ada kredensial)",
  );
  console.log("1) Projects — create");
  const projectInsert = await supabase
    .from("projects")
    .insert({
      name: projectName,
      client: "Klien Uji",
      location: "Jakarta",
      date: "2026-11-14",
      status: "planning",
    })
    .select("*")
    .single();

  if (projectInsert.error) {
    fail("insert project", projectInsert.error);
    if (explainMissingTable(projectInsert.error)) return;
    return finish();
  }
  projectId = projectInsert.data.id;
  ok("insert project", projectId);

  console.log("2) Projects — read back");
  const projectRead = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (projectRead.error) fail("select project", projectRead.error);
  else if (projectRead.data.name !== projectName) fail("select project", "nama tidak cocok");
  else ok("select project", projectRead.data.status);

  console.log("3) Projects — update");
  const projectUpdate = await supabase
    .from("projects")
    .update({ name: `${projectName} (edit)`, status: "active" })
    .eq("id", projectId)
    .select("*")
    .single();
  if (projectUpdate.error) fail("update project", projectUpdate.error);
  else if (projectUpdate.data.status !== "active") fail("update project", "status tidak berubah");
  else ok("update project", projectUpdate.data.status);

  console.log("4) RAB documents — create");
  const documentInsert = await supabase
    .from("rab_documents")
    .insert({
      project_id: projectId,
      title: `${MARK} Dokumen Uji`,
      date: "2026-11-14",
    })
    .select("*")
    .single();
  if (documentInsert.error) {
    fail("insert document", documentInsert.error);
    return finish(projectId);
  }
  const documentId = documentInsert.data.id;
  ok("insert document", documentId);

  console.log("5) RAB items — batch insert");
  const itemRows = [
    { rab_id: documentId, description: "Galian tanah", volume: 12.5, unit: "m3", unit_price: 95000 },
    { rab_id: documentId, description: "Pondasi batu kali", volume: 8, unit: "m3", unit_price: 1250000 },
    { rab_id: documentId, description: "Plester dinding", volume: 120.75, unit: "m2", unit_price: 65000 },
  ];
  const itemInsert = await supabase.from("rab_items").insert(itemRows).select("*");
  if (itemInsert.error) {
    fail("insert items", itemInsert.error);
    return finish(projectId);
  }
  if (itemInsert.data.length !== itemRows.length) {
    fail("insert items", `harus ${itemRows.length} baris, dapat ${itemInsert.data.length}`);
  } else {
    ok("insert items", `${itemInsert.data.length} baris`);
  }
  const firstItemId = itemInsert.data[0].id;

  console.log("6) RAB items — read (urutan created_at, id)");
  const itemRead = await supabase
    .from("rab_items")
    .select("*")
    .eq("rab_id", documentId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (itemRead.error) fail("select items", itemRead.error);
  else if (itemRead.data.length !== itemRows.length) fail("select items", `dapat ${itemRead.data.length}`);
  else ok("select items", `${itemRead.data.length} baris`);

  console.log("7) RAB items — update volume & harga");
  const itemUpdate = await supabase
    .from("rab_items")
    .update({ volume: 15, unit_price: 100000, description: "Galian tanah (edit)" })
    .eq("id", firstItemId)
    .select("*")
    .single();
  if (itemUpdate.error) fail("update item", itemUpdate.error);
  else if (Number(itemUpdate.data.volume) !== 15) fail("update item", `volume ${itemUpdate.data.volume}`);
  else ok("update item", `volume=${itemUpdate.data.volume} harga=${itemUpdate.data.unit_price}`);

  console.log("8) RAB documents — update judul");
  const documentUpdate = await supabase
    .from("rab_documents")
    .update({ title: `${MARK} Dokumen Uji (edit)` })
    .eq("id", documentId)
    .select("*")
    .single();
  if (documentUpdate.error) fail("update document", documentUpdate.error);
  else if (!documentUpdate.data.title.includes("(edit)")) fail("update document", "judul tidak berubah");
  else ok("update document", documentUpdate.data.title);

  console.log("9) RAB items — delete satu baris");
  const itemDelete = await supabase
    .from("rab_items")
    .delete()
    .eq("id", itemInsert.data[1].id);
  if (itemDelete.error) fail("delete item", itemDelete.error);
  else {
    const afterDelete = await supabase.from("rab_items").select("id").eq("rab_id", documentId);
    if (afterDelete.error) fail("verifikasi delete item", afterDelete.error);
    else if (afterDelete.data.length !== itemRows.length - 1) fail("delete item", "jumlah baris tidak sesuai");
    else ok("delete item", `sisa ${afterDelete.data.length} baris`);
  }

  console.log("10) Hapus proyek — cascade ke dokumen & item");
  const projectDelete = await supabase.from("projects").delete().eq("id", projectId);
  if (projectDelete.error) {
    fail("delete project", projectDelete.error);
    return finish(null);
  }
  projectId = null;

  const orphanDocs = await supabase.from("rab_documents").select("id").eq("project_id", documentInsert.data.project_id);
  const orphanItems = await supabase.from("rab_items").select("id").eq("rab_id", documentId);
  if (orphanDocs.error) fail("verifikasi cascade dokumen", orphanDocs.error);
  else if (orphanDocs.data.length !== 0) fail("cascade dokumen", `masih ada ${orphanDocs.data.length} dokumen`);
  else if (orphanItems.error) fail("verifikasi cascade item", orphanItems.error);
  else if (orphanItems.data.length !== 0) fail("cascade item", `masih ada ${orphanItems.data.length} item`);
  else ok("cascade delete", "dokumen & item ikut terhapus");

  return finish();
}

async function finish(projectIdToClean) {
  if (projectIdToClean) {
    const cleanup = await supabase.from("projects").delete().eq("id", projectIdToClean);
    if (cleanup.error) console.log(`  (pembersihan gagal: ${cleanup.error.message})`);
    else console.log("  (data uji dibersihkan)");
  }

  console.log(`\nHasil: ${passed} lulus, ${failures.length} gagal`);
  if (failures.length > 0) {
    for (const line of failures) console.log(`  - ${line}`);
    process.exit(1);
  }
  console.log("Semua langkah CRUD berhasil.");
  process.exit(0);
}

const randomTag = randomUUID().slice(0, 8);
console.log(`Smoke test CRUD RAB Mini (${randomTag})\n`);

main().catch((error) => {
  console.error("Error tak terduga:", error);
  process.exit(1);
});
