#!/usr/bin/env node
/**
 * Uji AHSP end-to-end terhadap Supabase.
 *
 * Cakupan:
 *   1. Tabel ahsp_analyses & ahsp_components tersedia (migration 0004).
 *   2. CRUD analisis dan komponen (termasuk updated_at otomatis).
 *   3. Isolasi antar pengguna: B tidak melihat/mengubah/menghapus data A dan
 *      tidak bisa menyisipkan komponen ke analisis A.
 *   4. Tanpa sesi (anon) data AHSP tidak terbaca.
 *   5. Snapshot katalog -> komponen: ubah harga katalog tidak mengubah
 *      komponen; hapus item katalog tidak menghapus komponen
 *      (catalog_item_id menjadi NULL, nilai tetap).
 *   6. Snapshot AHSP -> RAB: ubah analisis tidak mengubah item RAB lama.
 *
 * Prasyarat:
 *   - migrations 0003 & 0004 sudah dijalankan.
 *   - Dua akun terkonfirmasi.
 *
 * Pemakaian (PowerShell):
 *   $env:RLS_EMAIL_A="a@contoh.com"; $env:RLS_PASSWORD_A="rahasia1"
 *   $env:RLS_EMAIL_B="b@contoh.com"; $env:RLS_PASSWORD_B="rahasia2"
 *   node scripts/smoke-ahsp.mjs
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
      "Kredensial uji belum diset:",
      "  RLS_EMAIL_A, RLS_PASSWORD_A, RLS_EMAIL_B, RLS_PASSWORD_B",
    ].join("\n"),
  );
  process.exit(2);
}

const MARK = "[ahsp-smoke]";
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

/** Rumus yang sama dengan src/lib/ahsp.ts (bilangan bulat sen). */
function costCents(coefficient, unitPrice) {
  const micro = BigInt(Math.round(Math.max(0, Number(coefficient)) * 1_000_000));
  const cents = BigInt(Math.round(Math.max(0, Number(unitPrice)) * 100));
  if (micro === 0n || cents === 0n) return 0n;
  return (micro * cents + 500_000n) / 1_000_000n;
}

function totalRupiah(components) {
  const cents = components.reduce(
    (sum, c) => sum + costCents(c.coefficient, c.unit_price),
    0n,
  );
  return Number(cents) / 100;
}

async function main() {
  console.log(`Supabase: ${url}`);
  console.log(`A = ${emailA}\nB = ${emailB}\n`);

  const clientA = newClient();
  const userA = await signIn(clientA, emailA, passwordA, "A");
  ok("login pengguna A", userA.id);

  /* ------------------------------------------------------------------ */
  console.log("1) Tabel AHSP tersedia");
  const probe = await clientA.from("ahsp_analyses").select("id").limit(1);
  if (probe.error) {
    fail("baca ahsp_analyses", `${probe.error.code} ${probe.error.message}`);
    if (probe.error.code === "PGRST205") {
      console.error(
        "\nTabel belum ada. Jalankan supabase/migrations/0004_ahsp.sql lebih dulu.\n",
      );
    }
    return finish();
  }
  ok("ahsp_analyses dapat dibaca");

  /* ------------------------------------------------------------------ */
  console.log("2) CRUD analisis AHSP");
  const created = await clientA
    .from("ahsp_analyses")
    .insert({
      name: `${MARK} Pondasi Batu Kali`,
      category: "Pondasi",
      unit: "m3",
      description: "Analisis uji",
    })
    .select("*")
    .single();

  if (created.error) {
    fail("insert analisis", created.error.message);
    return finish();
  }
  const analysisId = created.data.id;
  if (created.data.user_id !== userA.id) {
    fail("user_id otomatis", `dapat ${created.data.user_id}`);
  } else {
    ok("analisis dibuat dengan pemilik otomatis", analysisId);
  }

  const updatedAnalysis = await clientA
    .from("ahsp_analyses")
    .update({ name: `${MARK} Pondasi Batu Kali (edit)` })
    .eq("id", analysisId)
    .select("*")
    .single();
  if (updatedAnalysis.error) {
    fail("update analisis", updatedAnalysis.error.message);
  } else if (updatedAnalysis.data.updated_at === created.data.updated_at) {
    fail("updated_at analisis", "tidak berubah");
  } else {
    ok("update analisis + trigger updated_at");
  }

  /* ------------------------------------------------------------------ */
  console.log("3) CRUD komponen");
  const componentRows = [
    { resource_name: "Batu kali", resource_category: "Material", unit: "m3", coefficient: 1.2, unit_price: 250000 },
    { resource_name: "Semen", resource_category: "Material", unit: "zak", coefficient: 0.35, unit_price: 65000 },
    { resource_name: "Pekerja", resource_category: "Tenaga kerja", unit: "hari", coefficient: 1.5, unit_price: 120000 },
    { resource_name: "Molen", resource_category: "Peralatan", unit: "hari", coefficient: 0.1, unit_price: 350000 },
  ];

  const insertedComponents = await clientA
    .from("ahsp_components")
    .insert(componentRows.map((row) => ({ analysis_id: analysisId, ...row })))
    .select("*");

  if (insertedComponents.error) {
    fail("insert komponen", insertedComponents.error.message);
    return finish({ clientA, analysisId });
  }
  ok("insert 4 komponen", `${insertedComponents.data.length} baris`);

  const expectedTotal = totalRupiah(componentRows);
  const dbTotal = totalRupiah(insertedComponents.data);
  if (Math.abs(dbTotal - expectedTotal) > 0.001) {
    fail("total AHSP", `dapat ${dbTotal}, harusnya ${expectedTotal}`);
  } else {
    ok("total AHSP sesuai rumus", `Rp${expectedTotal}`);
  }

  const firstComponent = insertedComponents.data[0];
  const updatedComponent = await clientA
    .from("ahsp_components")
    .update({ coefficient: 1.5 })
    .eq("id", firstComponent.id)
    .select("*")
    .single();
  if (updatedComponent.error) {
    fail("update komponen", updatedComponent.error.message);
  } else if (Number(updatedComponent.data.coefficient) !== 1.5) {
    fail("update koefisien", updatedComponent.data.coefficient);
  } else if (updatedComponent.data.updated_at === firstComponent.updated_at) {
    fail("updated_at komponen", "tidak berubah");
  } else {
    ok("update koefisien + trigger updated_at");
  }

  /* ------------------------------------------------------------------ */
  console.log("4) Snapshot katalog -> komponen AHSP");
  const catalogItem = await clientA
    .from("price_catalog")
    .insert({
      name: `${MARK} Pasir`,
      category: "Material",
      unit: "m3",
      unit_price: 180000,
    })
    .select("*")
    .single();
  if (catalogItem.error) {
    fail("insert item katalog", catalogItem.error.message);
    return finish({ clientA, analysisId });
  }

  const fromCatalog = await clientA
    .from("ahsp_components")
    .insert({
      analysis_id: analysisId,
      catalog_item_id: catalogItem.data.id,
      resource_name: catalogItem.data.name,
      resource_category: "Material",
      unit: catalogItem.data.unit,
      coefficient: 0.45,
      unit_price: catalogItem.data.unit_price,
    })
    .select("*")
    .single();
  if (fromCatalog.error) {
    fail("insert komponen dari katalog", fromCatalog.error.message);
  } else {
    ok("komponen dari katalog dibuat", `Rp${fromCatalog.data.unit_price}`);
  }

  const priceChange = await clientA
    .from("price_catalog")
    .update({ unit_price: 999000 })
    .eq("id", catalogItem.data.id);
  if (priceChange.error) fail("ubah harga katalog", priceChange.error.message);

  const afterPriceChange = await clientA
    .from("ahsp_components")
    .select("unit_price")
    .eq("id", fromCatalog.data.id)
    .single();
  if (afterPriceChange.error) {
    fail("baca komponen setelah katalog diubah", afterPriceChange.error.message);
  } else if (Number(afterPriceChange.data.unit_price) !== 180000) {
    fail("snapshot harga katalog", `berubah jadi ${afterPriceChange.data.unit_price}`);
  } else {
    ok("harga komponen tidak ikut berubah", "tetap 180000");
  }

  const catalogDelete = await clientA
    .from("price_catalog")
    .delete()
    .eq("id", catalogItem.data.id);
  if (catalogDelete.error) fail("hapus item katalog", catalogDelete.error.message);

  const afterCatalogDelete = await clientA
    .from("ahsp_components")
    .select("id,catalog_item_id,resource_name,unit_price")
    .eq("id", fromCatalog.data.id)
    .single();
  if (afterCatalogDelete.error) {
    fail("komponen setelah katalog dihapus", afterCatalogDelete.error.message);
  } else if (afterCatalogDelete.data.catalog_item_id !== null) {
    fail("catalog_item_id setelah hapus", String(afterCatalogDelete.data.catalog_item_id));
  } else if (Number(afterCatalogDelete.data.unit_price) !== 180000) {
    fail("nilai komponen setelah katalog dihapus", afterCatalogDelete.data.unit_price);
  } else {
    ok("komponen tetap ada (catalog_item_id NULL, nilai utuh)");
  }

  /* ------------------------------------------------------------------ */
  console.log("5) Snapshot AHSP -> item RAB");
  const project = await clientA
    .from("projects")
    .insert({ name: `${MARK} Proyek`, status: "planning" })
    .select("id")
    .single();
  if (project.error) {
    fail("insert proyek", project.error.message);
    return finish({ clientA, analysisId });
  }

  const document = await clientA
    .from("rab_documents")
    .insert({ project_id: project.data.id, title: `${MARK} Dokumen` })
    .select("id")
    .single();
  if (document.error) {
    fail("insert dokumen", document.error.message);
    return finish({ clientA, analysisId, projectId: project.data.id });
  }

  const currentComponents = await clientA
    .from("ahsp_components")
    .select("coefficient,unit_price")
    .eq("analysis_id", analysisId);
  const analysisTotalBefore = totalRupiah(currentComponents.data ?? []);

  const rabItem = await clientA
    .from("rab_items")
    .insert({
      rab_id: document.data.id,
      description: `${MARK} Pondasi Batu Kali`,
      volume: 2,
      unit: "m3",
      unit_price: analysisTotalBefore,
    })
    .select("*")
    .single();
  if (rabItem.error) {
    fail("insert item RAB dari AHSP", rabItem.error.message);
    return finish({ clientA, analysisId, projectId: project.data.id });
  }
  ok("item RAB dibuat dari total AHSP", `Rp${analysisTotalBefore}`);

  // Ubah analisis: koefisien komponen pertama dinaikkan.
  await clientA
    .from("ahsp_components")
    .update({ coefficient: 9 })
    .eq("id", firstComponent.id);

  const rabAfter = await clientA
    .from("rab_items")
    .select("unit_price")
    .eq("id", rabItem.data.id)
    .single();
  if (rabAfter.error) {
    fail("baca item RAB", rabAfter.error.message);
  } else if (Number(rabAfter.data.unit_price) !== analysisTotalBefore) {
    fail("snapshot AHSP", `harga RAB berubah jadi ${rabAfter.data.unit_price}`);
  } else {
    ok("harga item RAB tidak ikut berubah saat analisis diubah");
  }

  /* ------------------------------------------------------------------ */
  console.log("6) Isolasi antar pengguna");
  const clientB = newClient();
  await signIn(clientB, emailB, passwordB, "B");

  const seenByB = await clientB
    .from("ahsp_analyses")
    .select("id")
    .eq("id", analysisId);
  if (!seenByB.error && seenByB.data.length !== 0) {
    fail("B melihat analisis A", `${seenByB.data.length} baris`);
  } else if (seenByB.error) {
    fail("B membaca analisis", seenByB.error.message);
  } else {
    ok("B tidak melihat analisis A", "0 baris");
  }

  const updateByB = await clientB
    .from("ahsp_analyses")
    .update({ name: `${MARK} diubah B` })
    .eq("id", analysisId)
    .select("id");
  if (updateByB.error) {
    ok("B tidak dapat mengubah analisis A", `ditolak ${updateByB.error.code}`);
  } else if (updateByB.data.length !== 0) {
    fail("B mengubah analisis A", `${updateByB.data.length} baris`);
  } else {
    ok("B tidak dapat mengubah analisis A", "0 baris terpengaruh");
  }

  const deleteComponentByB = await clientB
    .from("ahsp_components")
    .delete()
    .eq("id", firstComponent.id)
    .select("id");
  if (deleteComponentByB.error) {
    ok("B tidak dapat menghapus komponen A", `ditolak ${deleteComponentByB.error.code}`);
  } else if (deleteComponentByB.data.length !== 0) {
    fail("B menghapus komponen A", `${deleteComponentByB.data.length} baris`);
  } else {
    ok("B tidak dapat menghapus komponen A", "0 baris terpengaruh");
  }

  const insertByB = await clientB
    .from("ahsp_components")
    .insert({
      analysis_id: analysisId,
      resource_name: `${MARK} sisipan B`,
      resource_category: "Material",
      unit: "m3",
      coefficient: 1,
      unit_price: 1000,
    })
    .select("id");
  if (!insertByB.error && insertByB.data.length > 0) {
    fail("B menyisipkan komponen ke analisis A", "berhasil — policy bocor");
    await clientB.from("ahsp_components").delete().eq("id", insertByB.data[0].id);
  } else {
    ok("B tidak dapat menyisipkan komponen ke analisis A", `ditolak ${insertByB.error?.code ?? "0 baris"}`);
  }

  const anon = newClient();
  const anonRead = await anon.from("ahsp_analyses").select("id").limit(1);
  if (!anonRead.error && (anonRead.data?.length ?? 0) !== 0) {
    fail("anon membaca AHSP", `bocor ${anonRead.data.length} baris`);
  } else if (anonRead.error) {
    ok("anon tidak dapat membaca AHSP", `ditolak ${anonRead.error.code}`);
  } else {
    ok("anon tidak dapat membaca AHSP", "0 baris");
  }

  await clientB.auth.signOut();

  /* ------------------------------------------------------------------ */
  console.log("7) Hapus analisis (cascade komponen)");
  const deleteAnalysis = await clientA
    .from("ahsp_analyses")
    .delete()
    .eq("id", analysisId)
    .select("id");
  if (deleteAnalysis.error) {
    fail("hapus analisis", deleteAnalysis.error.message);
  } else {
    const orphans = await clientA
      .from("ahsp_components")
      .select("id")
      .eq("analysis_id", analysisId);
    if (!orphans.error && orphans.data.length === 0) {
      ok("hapus analisis menghapus komponennya", "0 komponen tersisa");
    } else {
      fail("cascade komponen", orphans.error?.message ?? `${orphans.data.length} tersisa`);
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
    if (removed.error) console.log(`  (pembersihan proyek gagal: ${removed.error.message})`);
    else console.log("  (proyek/dokumen/item uji dibersihkan)");
  }
  if (cleanup?.clientA && cleanup.analysisId) {
    await cleanup.clientA.from("ahsp_analyses").delete().eq("id", cleanup.analysisId);
  }

  console.log(`\nHasil: ${passed} lulus, ${failures.length} gagal`);
  if (failures.length > 0) {
    for (const line of failures) console.log(`  - ${line}`);
    process.exit(1);
  }
  console.log("AHSP: CRUD, isolasi RLS, dan snapshot harga terverifikasi.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nError tak terduga:", error.message ?? error);
  process.exit(1);
});
