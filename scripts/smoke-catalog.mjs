#!/usr/bin/env node
/**
 * Uji Katalog Harga end-to-end terhadap Supabase.
 *
 * Cakupan:
 *   1. Tabel price_catalog tersedia (migration 0003 sudah dijalankan).
 *   2. CRUD katalog milik pengguna A (create/read/update/delete).
 *   3. `updated_at` diperbarui otomatis oleh trigger.
 *   4. Isolasi: pengguna B tidak melihat/mengubah/menghapus katalog A dan
 *      tidak bisa menyisipkan baris atas nama A.
 *   5. Tanpa sesi (anon) katalog tidak terbaca.
 *   6. Snapshot harga: item RAB yang dibuat dari katalog TIDAK berubah saat
 *      harga katalog diubah, dan tidak hilang saat item katalog dihapus.
 *
 * Prasyarat:
 *   - supabase/migrations/0003_price_catalog.sql sudah dijalankan.
 *   - Dua akun terkonfirmasi.
 *
 * Pemakaian (PowerShell):
 *   $env:RLS_EMAIL_A="a@contoh.com"; $env:RLS_PASSWORD_A="rahasia1"
 *   $env:RLS_EMAIL_B="b@contoh.com"; $env:RLS_PASSWORD_B="rahasia2"
 *   node scripts/smoke-catalog.mjs
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
    ].join("\n"),
  );
  process.exit(2);
}

const MARK = "[catalog-smoke]";
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
  console.log("1) Tabel katalog tersedia");
  // ------------------------------------------------------------------------
  const probe = await clientA.from("price_catalog").select("id").limit(1);
  if (probe.error) {
    fail("baca price_catalog", `${probe.error.code} ${probe.error.message}`);
    if (probe.error.code === "PGRST205") {
      console.error(
        "\nTabel belum ada. Jalankan supabase/migrations/0003_price_catalog.sql lebih dulu.\n",
      );
    }
    return finish();
  }
  ok("price_catalog dapat dibaca");

  // ------------------------------------------------------------------------
  console.log("2) Create katalog");
  // ------------------------------------------------------------------------
  const stamp = new Date().toISOString();
  const catalogRows = [
    { user_id: userA.id, name: `${MARK} Semen 50kg`, category: "Material", unit: "zak", unit_price: 65000 },
    { name: `${MARK} Galian Tanah`, category: "Pekerjaan", unit: "m3", unit_price: 95000 },
    { name: `${MARK} Upah Tukang`, category: "Upah", unit: "hari", unit_price: 180000 },
  ];

  const created = await clientA
    .from("price_catalog")
    .insert(catalogRows)
    .select("*");

  if (created.error) {
    fail("insert katalog", created.error.message);
    return finish();
  }
  ok("insert 3 item katalog", `${created.data.length} baris`);

  const first = created.data.find((row) => row.name.includes("Semen"));
  const second = created.data.find((row) => row.name.includes("Galian"));

  if (first.user_id !== userA.id) {
    fail("user_id otomatis", `dapat ${first.user_id}`);
  } else {
    ok("user_id terisi otomatis", first.user_id);
  }

  // Risiko: insert dengan user_id milik orang lain harus ditolak RLS.
  const forged = await clientA
    .from("price_catalog")
    .insert({
      user_id: "11111111-1111-4111-8111-111111111111",
      name: `${MARK} Palsu`,
    })
    .select("id");
  if (!forged.error && forged.data.length > 0) {
    fail("insert dengan user_id orang lain", "berhasil — policy bocor");
    await clientA.from("price_catalog").delete().eq("id", forged.data[0].id);
  } else {
    ok("insert dengan user_id orang lain ditolak", forged.error?.code ?? "0 baris");
  }

  // ------------------------------------------------------------------------
  console.log("3) Read + filter milik sendiri");
  // ------------------------------------------------------------------------
  const ownRead = await clientA
    .from("price_catalog")
    .select("id,name,category,unit,unit_price")
    .like("name", `${MARK}%`);
  if (ownRead.error || ownRead.data.length !== 3) {
    fail("read katalog A", ownRead.error?.message ?? `${ownRead.data.length} baris`);
  } else {
    ok("read katalog A", `${ownRead.data.length} baris`);
  }

  const categoryRead = await clientA
    .from("price_catalog")
    .select("id")
    .eq("category", "Material")
    .like("name", `${MARK}%`);
  if (!categoryRead.error && categoryRead.data.length === 1) {
    ok("filter kategori Material", "1 baris");
  } else {
    fail("filter kategori Material", categoryRead.error?.message ?? `${categoryRead.data.length} baris`);
  }

  // ------------------------------------------------------------------------
  console.log("4) Update + updated_at otomatis");
  // ------------------------------------------------------------------------
  const beforeUpdate = first.updated_at;
  const updated = await clientA
    .from("price_catalog")
    .update({ name: `${MARK} Semen 50kg (edit)`, unit_price: 70000 })
    .eq("id", first.id)
    .select("*")
    .single();

  if (updated.error) {
    fail("update katalog", updated.error.message);
  } else {
    ok("update katalog", `harga ${updated.data.unit_price}`);
    if (updated.data.unit_price !== 70000 && Number(updated.data.unit_price) !== 70000) {
      fail("harga hasil update", String(updated.data.unit_price));
    }
    if (updated.data.updated_at === beforeUpdate) {
      fail("updated_at trigger", "nilai tidak berubah");
    } else {
      ok("updated_at diperbarui trigger");
    }
  }

  // ------------------------------------------------------------------------
  console.log("5) Snapshot harga: katalog -> RAB");
  // ------------------------------------------------------------------------
  const project = await clientA
    .from("projects")
    .insert({ name: `${MARK} Proyek ${stamp}`, status: "planning" })
    .select("id")
    .single();
  if (project.error) {
    fail("insert proyek", project.error.message);
    return finish({ clientA, catalogIds: created.data.map((r) => r.id) });
  }

  const document = await clientA
    .from("rab_documents")
    .insert({ project_id: project.data.id, title: `${MARK} Dokumen` })
    .select("id")
    .single();
  if (document.error) {
    fail("insert dokumen", document.error.message);
    return finish({ clientA, projectId: project.data.id, catalogIds: created.data.map((r) => r.id) });
  }

  const catalogItem = created.data.find((row) => row.name.includes("Galian"));
  const rabItem = await clientA
    .from("rab_items")
    .insert({
      rab_id: document.data.id,
      description: catalogItem.name,
      volume: 2.5,
      unit: catalogItem.unit,
      unit_price: catalogItem.unit_price,
    })
    .select("*")
    .single();
  if (rabItem.error) {
    fail("insert item RAB dari katalog", rabItem.error.message);
    return finish({ clientA, projectId: project.data.id, catalogIds: created.data.map((r) => r.id) });
  }
  ok("item RAB dibuat dari data katalog", `Rp${rabItem.data.unit_price}`);

  // Ubah harga katalog — item RAB harus tetap.
  const priceChange = await clientA
    .from("price_catalog")
    .update({ unit_price: 999999 })
    .eq("id", catalogItem.id);
  if (priceChange.error) fail("ubah harga katalog", priceChange.error.message);

  const afterCatalogChange = await clientA
    .from("rab_items")
    .select("description,unit,unit_price")
    .eq("id", rabItem.data.id)
    .single();
  if (afterCatalogChange.error) {
    fail("baca ulang item RAB", afterCatalogChange.error.message);
  } else if (Number(afterCatalogChange.data.unit_price) !== 95000) {
    fail("snapshot harga", `harga item RAB ikut berubah: ${afterCatalogChange.data.unit_price}`);
  } else {
    ok("harga RAB tidak ikut berubah saat katalog diubah", "tetap 95000");
  }

  // Hapus item katalog — item RAB harus tetap ada.
  const catalogDelete = await clientA.from("price_catalog").delete().eq("id", catalogItem.id);
  if (catalogDelete.error) fail("hapus item katalog", catalogDelete.error.message);

  const afterCatalogDelete = await clientA
    .from("rab_items")
    .select("id")
    .eq("id", rabItem.data.id);
  if (afterCatalogDelete.error) {
    fail("baca item RAB setelah katalog dihapus", afterCatalogDelete.error.message);
  } else if (afterCatalogDelete.data.length !== 1) {
    fail("snapshot saat katalog dihapus", "item RAB hilang");
  } else {
    ok("item RAB tetap ada setelah item katalog dihapus");
  }

  // ------------------------------------------------------------------------
  console.log("6) Isolasi antar pengguna");
  // ------------------------------------------------------------------------
  const clientB = newClient();
  await signIn(clientB, emailB, passwordB, "B");

  const seenByB = await clientB
    .from("price_catalog")
    .select("id")
    .like("name", `${MARK}%`);
  if (!seenByB.error && seenByB.data.length !== 0) {
    fail("B melihat katalog A", `bocor ${seenByB.data.length} baris`);
  } else if (seenByB.error) {
    fail("B membaca katalog", seenByB.error.message);
  } else {
    ok("B tidak melihat katalog A", "0 baris");
  }

  const updateByB = await clientB
    .from("price_catalog")
    .update({ unit_price: 1 })
    .eq("id", second.id)
    .select("id");
  if (updateByB.error) {
    ok("B tidak dapat mengubah katalog A", `ditolak ${updateByB.error.code}`);
  } else if (updateByB.data.length !== 0) {
    fail("B mengubah katalog A", `${updateByB.data.length} baris`);
  } else {
    ok("B tidak dapat mengubah katalog A", "0 baris terpengaruh");
  }

  const deleteByB = await clientB
    .from("price_catalog")
    .delete()
    .eq("id", second.id)
    .select("id");
  if (deleteByB.error) {
    ok("B tidak dapat menghapus katalog A", `ditolak ${deleteByB.error.code}`);
  } else if (deleteByB.data.length !== 0) {
    fail("B menghapus katalog A", `${deleteByB.data.length} baris`);
  } else {
    ok("B tidak dapat menghapus katalog A", "0 baris terpengaruh");
  }

  const anon = newClient();
  const anonRead = await anon.from("price_catalog").select("id").limit(1);
  if (!anonRead.error && (anonRead.data?.length ?? 0) !== 0) {
    fail("anon membaca katalog", `bocor ${anonRead.data.length} baris`);
  } else if (anonRead.error) {
    ok("anon tidak dapat membaca katalog", `ditolak ${anonRead.error.code}`);
  } else {
    ok("anon tidak dapat membaca katalog", "0 baris");
  }

  await clientB.auth.signOut();

  // ------------------------------------------------------------------------
  console.log("7) Hapus katalog A (CRUD lengkap)");
  // ------------------------------------------------------------------------
  const remaining = created.data.map((row) => row.id).filter((id) => id !== catalogItem.id);
  const cleanupCatalog = await clientA.from("price_catalog").delete().in("id", remaining);
  if (cleanupCatalog.error) fail("hapus katalog A", cleanupCatalog.error.message);
  else ok("hapus katalog A", `${remaining.length} baris`);

  const catalogLeft = await clientA
    .from("price_catalog")
    .select("id")
    .like("name", `${MARK}%`);
  if (!catalogLeft.error && catalogLeft.data.length === 0) {
    ok("katalog A bersih", "0 baris");
  } else {
    fail("katalog A bersih", catalogLeft.error?.message ?? `${catalogLeft.data.length} baris`);
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
    if (removed.error) console.log(`  (pembersihan proyek gagal: ${removed.error.message})`);
    else console.log("  (data uji proyek/dokumen/item dibersihkan)");
  }

  console.log(`\nHasil: ${passed} lulus, ${failures.length} gagal`);
  if (failures.length > 0) {
    for (const line of failures) console.log(`  - ${line}`);
    process.exit(1);
  }
  console.log("Katalog harga, isolasi data, dan snapshot harga terverifikasi.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nError tak terduga:", error.message ?? error);
  process.exit(1);
});
