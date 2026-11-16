#!/usr/bin/env node
/**
 * Uji isolasi data antar pengguna (RLS) untuk RAB Mini.
 *
 * Yang diuji:
 *   1. `projects.user_id` terisi otomatis dari sesi (default auth.uid()).
 *   2. Pengguna B tidak dapat MELIHAT proyek pengguna A.
 *   3. Pengguna B tidak dapat MENGUBAH atau MENGHAPUS proyek A.
 *   4. Pengguna B tidak dapat MENGUBAH atau MENGHAPUS dokumen & item A,
 *      dan tidak dapat menyisipkan dokumen ke proyek A.
 *   5. Tanpa sesi (anon) tidak ada data yang terbaca dan penulisan ditolak.
 *   6. Data A tetap utuh setelah percobaan B, lalu A menghapusnya sendiri
 *      (cascade) sebagai pembersihan.
 *
 * Prasyarat:
 *   - supabase/migrations/0002_auth_ownership.sql sudah dijalankan.
 *   - Dua akun yang SUDAH terkonfirmasi (project ini mewajibkan konfirmasi
 *     email, jadi akun hasil signup belum bisa dipakai sebelum dikonfirmasi).
 *
 * Pemakaian (PowerShell):
 *   $env:RLS_EMAIL_A="a@contoh.com"; $env:RLS_PASSWORD_A="rahasia1"
 *   $env:RLS_EMAIL_B="b@contoh.com"; $env:RLS_PASSWORD_B="rahasia2"
 *   node scripts/smoke-auth-rls.mjs
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
    [
      "Kredensial uji belum diset. Isi variabel berikut lalu jalankan ulang:",
      "  RLS_EMAIL_A, RLS_PASSWORD_A, RLS_EMAIL_B, RLS_PASSWORD_B",
      "",
      "Gunakan dua akun berbeda yang sudah dikonfirmasi emailnya.",
    ].join("\n"),
  );
  process.exit(2);
}

const MARK = "[rls]";
let passed = 0;
const failures = [];

function ok(label, detail = "") {
  passed += 1;
  console.log(`  OK   ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
  console.log(`  FAIL ${label} — ${detail}`);
}

function newClient() {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(client, email, password, who) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(
      `Gagal masuk sebagai ${who}: ${error.message}` +
        (/email not confirmed/i.test(error.message)
          ? " (konfirmasi email akun ini lebih dulu)"
          : ""),
    );
  }

  return data.user;
}

async function main() {
  console.log(`Supabase: ${url}`);
  console.log(`A = ${emailA}\nB = ${emailB}\n`);

  const clientA = newClient();
  const userA = await signIn(clientA, emailA, passwordA, "A");
  ok("login pengguna A", userA.id);

  // ------------------------------------------------------------------------
  console.log("1) A membuat proyek — user_id harus terisi otomatis");
  // ------------------------------------------------------------------------
  const projectName = `${MARK} Proyek A ${new Date().toISOString()}`;
  const created = await clientA
    .from("projects")
    .insert({ name: projectName, status: "planning" })
    .select("*")
    .single();

  if (created.error) {
    fail("insert proyek A", created.error.message);
    if (created.error.code === "PGRST204" || /user_id/.test(created.error.message)) {
      console.error(
        "\nKolom user_id tampaknya belum ada. Jalankan supabase/migrations/0002_auth_ownership.sql lebih dulu.\n",
      );
    }
    return finish();
  }

  const projectId = created.data.id;
  if (created.data.user_id !== userA.id) {
    fail("user_id otomatis", `dapat ${created.data.user_id}, harusnya ${userA.id}`);
  } else {
    ok("user_id terisi otomatis", created.data.user_id);
  }

  // ------------------------------------------------------------------------
  console.log("2) A membuat dokumen RAB + item");
  // ------------------------------------------------------------------------
  const doc = await clientA
    .from("rab_documents")
    .insert({ project_id: projectId, title: `${MARK} Dokumen A` })
    .select("*")
    .single();
  if (doc.error) {
    fail("insert dokumen A", doc.error.message);
    return finish({ clientA, projectId });
  }
  ok("insert dokumen A", doc.data.id);

  const item = await clientA
    .from("rab_items")
    .insert({
      rab_id: doc.data.id,
      description: `${MARK} Pekerjaan A`,
      volume: 2,
      unit: "m3",
      unit_price: 500000,
    })
    .select("*")
    .single();
  if (item.error) {
    fail("insert item A", item.error.message);
    return finish({ clientA, projectId });
  }
  ok("insert item A", item.data.id);

  // ------------------------------------------------------------------------
  console.log("3) A membaca datanya sendiri");
  // ------------------------------------------------------------------------
  const ownRead = await clientA
    .from("projects")
    .select("id,name", { count: "exact" })
    .eq("id", projectId);
  if (ownRead.error || ownRead.data.length !== 1) {
    fail("A melihat proyeknya", ownRead.error?.message ?? `${ownRead.data.length} baris`);
  } else {
    ok("A melihat proyeknya", `${ownRead.count ?? ownRead.data.length} baris`);
  }

  // ------------------------------------------------------------------------
  console.log("4) B tidak boleh melihat data A");
  // ------------------------------------------------------------------------
  const clientB = newClient();
  const userB = await signIn(clientB, emailB, passwordB, "B");
  ok("login pengguna B", userB.id);

  const seenByB = await clientB
    .from("projects")
    .select("id")
    .eq("id", projectId);
  if (seenByB.error) {
    fail("B membaca proyek A", seenByB.error.message);
  } else if (seenByB.data.length !== 0) {
    fail("B membaca proyek A", `bocor: ${seenByB.data.length} baris terlihat`);
  } else {
    ok("B tidak melihat proyek A", "0 baris");
  }

  const docSeenByB = await clientB
    .from("rab_documents")
    .select("id")
    .eq("id", doc.data.id);
  if (!docSeenByB.error && docSeenByB.data.length !== 0) {
    fail("B membaca dokumen A", `bocor: ${docSeenByB.data.length} baris`);
  } else if (docSeenByB.error) {
    fail("B membaca dokumen A", docSeenByB.error.message);
  } else {
    ok("B tidak melihat dokumen A", "0 baris");
  }

  const itemSeenByB = await clientB
    .from("rab_items")
    .select("id")
    .eq("id", item.data.id);
  if (!itemSeenByB.error && itemSeenByB.data.length !== 0) {
    fail("B membaca item A", `bocor: ${itemSeenByB.data.length} baris`);
  } else if (itemSeenByB.error) {
    fail("B membaca item A", itemSeenByB.error.message);
  } else {
    ok("B tidak melihat item A", "0 baris");
  }

  // ------------------------------------------------------------------------
  console.log("5) B tidak boleh mengubah/menghapus data A");
  // ------------------------------------------------------------------------
  const updateByB = await clientB
    .from("projects")
    .update({ name: `${MARK} DIBUAT OLEH B` })
    .eq("id", projectId)
    .select("id");
  if (updateByB.error) {
    ok("B tidak dapat UPDATE proyek A", `ditolak: ${updateByB.error.code ?? "error"}`);
  } else if (updateByB.data.length !== 0) {
    fail("B UPDATE proyek A", `${updateByB.data.length} baris berubah`);
  } else {
    ok("B tidak dapat UPDATE proyek A", "0 baris terpengaruh");
  }

  const updateItemByB = await clientB
    .from("rab_items")
    .update({ unit_price: 1 })
    .eq("id", item.data.id)
    .select("id");
  if (updateItemByB.error) {
    ok("B tidak dapat UPDATE item A", `ditolak: ${updateItemByB.error.code ?? "error"}`);
  } else if (updateItemByB.data.length !== 0) {
    fail("B UPDATE item A", `${updateItemByB.data.length} baris berubah`);
  } else {
    ok("B tidak dapat UPDATE item A", "0 baris terpengaruh");
  }

  const insertDocByB = await clientB
    .from("rab_documents")
    .insert({ project_id: projectId, title: `${MARK} Sisipan B` })
    .select("id");
  if (!insertDocByB.error && insertDocByB.data.length > 0) {
    fail("B menyisipkan dokumen ke proyek A", "berhasil — policy INSERT bocor");
    await clientB.from("rab_documents").delete().eq("id", insertDocByB.data[0].id);
  } else {
    ok(
      "B tidak dapat menyisipkan dokumen ke proyek A",
      `ditolak: ${insertDocByB.error?.code ?? "0 baris"}`,
    );
  }

  const deleteByB = await clientB
    .from("projects")
    .delete()
    .eq("id", projectId)
    .select("id");
  if (deleteByB.error) {
    ok("B tidak dapat DELETE proyek A", `ditolak: ${deleteByB.error.code ?? "error"}`);
  } else if (deleteByB.data.length !== 0) {
    fail("B DELETE proyek A", `${deleteByB.data.length} baris terhapus`);
  } else {
    ok("B tidak dapat DELETE proyek A", "0 baris terpengaruh");
  }

  // ------------------------------------------------------------------------
  console.log("6) Data A harus tetap utuh");
  // ------------------------------------------------------------------------
  const stillThere = await clientA
    .from("projects")
    .select("id,name,user_id")
    .eq("id", projectId)
    .single();
  if (stillThere.error) {
    fail("data A masih ada", stillThere.error.message);
  } else if (stillThere.data.name !== projectName) {
    fail("data A tidak berubah", `nama jadi "${stillThere.data.name}"`);
  } else {
    ok("data A utuh setelah percobaan B", stillThere.data.name);
  }

  // ------------------------------------------------------------------------
  console.log("7) Tanpa sesi (anon) ditolak");
  // ------------------------------------------------------------------------
  const anon = newClient();
  const anonRead = await anon.from("projects").select("id").eq("id", projectId);
  if (!anonRead.error && anonRead.data.length !== 0) {
    fail("anon membaca proyek", `bocor: ${anonRead.data.length} baris`);
  } else if (anonRead.error) {
    ok("anon tidak dapat membaca", `ditolak: ${anonRead.error.code ?? "error"}`);
  } else {
    ok("anon tidak dapat membaca", "0 baris");
  }

  const anonInsert = await anon
    .from("projects")
    .insert({ name: `${MARK} anon` })
    .select("id");
  if (!anonInsert.error && anonInsert.data.length > 0) {
    fail("anon menyisipkan proyek", "berhasil — policy INSERT bocor");
  } else {
    ok(
      "anon tidak dapat menyisipkan",
      `ditolak: ${anonInsert.error?.code ?? "0 baris"}`,
    );
  }

  await clientB.auth.signOut();
  return finish({ clientA, projectId });
}

async function finish(cleanup) {
  if (cleanup?.clientA && cleanup.projectId) {
    const removed = await cleanup.clientA
      .from("projects")
      .delete()
      .eq("id", cleanup.projectId)
      .select("id");

    if (removed.error) {
      console.log(`  (pembersihan gagal: ${removed.error.message})`);
    } else {
      console.log("  (data uji A dihapus, cascade ke dokumen & item)");
    }
  }

  console.log(`\nHasil: ${passed} lulus, ${failures.length} gagal`);
  if (failures.length > 0) {
    for (const line of failures) console.log(`  - ${line}`);
    process.exit(1);
  }
  console.log("Isolasi data antar pengguna (RLS) terverifikasi.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nError tak terduga:", error.message ?? error);
  process.exit(1);
});
