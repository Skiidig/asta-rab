/**
 * Helper bersama untuk operasi rilis v1.0.0.
 *
 * Dipisahkan dari CLI agar backup/restore/verifikasi bisa diuji dengan klien
 * tiruan. Tidak ada kredensial yang dibaca atau dicetak di modul ini.
 */

export const RELEASE_VERSION = "1.0.0";

export const BUSINESS_TABLES = [
  "projects",
  "rab_documents",
  "rab_items",
  "price_catalog",
  "ahsp_analyses",
  "ahsp_components",
];

export const RESTORE_ORDER = BUSINESS_TABLES;

export function normalizeHost(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function assertRows(table, rows) {
  if (!Array.isArray(rows)) {
    throw new Error(`${table}: backup tidak berisi array baris.`);
  }
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id) {
      throw new Error(`${table}: ada baris tanpa id yang valid.`);
    }
    if (ids.has(row.id)) {
      throw new Error(`${table}: id duplikat ${row.id}.`);
    }
    ids.add(row.id);
  }
}

/**
 * Validasi backup sebelum restore. Semua pemeriksaan dilakukan sebelum klien
 * database dibuat/ditulis; target berbeda tidak boleh menerima penulisan.
 */
export function assertBackupShape(
  backup,
  { targetHost, expectedVersion = RELEASE_VERSION } = {},
) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new Error("Berkas backup bukan objek JSON yang valid.");
  }
  if (backup.version !== expectedVersion) {
    throw new Error(
      `Versi backup tidak cocok: ${backup.version ?? "(tidak ada)"}, ` +
        `diharapkan ${expectedVersion}.`,
    );
  }
  if (!backup.tables || typeof backup.tables !== "object") {
    throw new Error("Backup tidak memiliki bagian tables.");
  }

  for (const table of BUSINESS_TABLES) {
    if (!Object.prototype.hasOwnProperty.call(backup.tables, table)) {
      throw new Error(`Backup tidak lengkap: tabel ${table} tidak ada.`);
    }
    assertRows(table, backup.tables[table]);
    if (
      backup.counts &&
      Object.prototype.hasOwnProperty.call(backup.counts, table) &&
      backup.counts[table] !== backup.tables[table].length
    ) {
      throw new Error(
        `${table}: count di backup (${backup.counts[table]}) tidak cocok ` +
          `dengan jumlah baris (${backup.tables[table].length}).`,
      );
    }
  }

  if (targetHost) {
    if (typeof backup.projectHost !== "string" || !backup.projectHost) {
      throw new Error("Backup tidak memiliki projectHost.");
    }
    const source = normalizeHost(backup.projectHost);
    const target = normalizeHost(targetHost);
    if (!source || !target || source !== target) {
      throw new Error(
        `Target restore berbeda dari backup (${source || "?"} vs ${target || "?"}).`,
      );
    }
  }

  return backup;
}

export function requireCount(value, table) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${table}: count database tidak valid (${String(value)}).`);
  }
  return value;
}

/** Hitung exact count; null/undefined/NaN dianggap gagal. */
export async function countTableRows(client, table) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) throw new Error(`${table}: ${error.message ?? "gagal menghitung"}`);
  return requireCount(count, table);
}

/**
 * Baca seluruh baris dengan pagination berurutan berdasarkan primary key.
 * Jumlah yang terkumpul harus sama dengan exact count dan ID tidak boleh
 * duplikat. Melempar error (bukan mengembalikan hasil parsial) jika gagal.
 */
export async function fetchTableRows(client, table, { pageSize = 1000 } = {}) {
  const expected = await countTableRows(client, table);
  const rows = [];
  const ids = new Set();

  for (let from = 0; from < expected; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`${table}: ${error.message ?? "gagal membaca"}`);
    if (!Array.isArray(data)) {
      throw new Error(`${table}: respons pagination bukan array.`);
    }

    for (const row of data) {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id) {
        throw new Error(`${table}: baris tanpa id yang valid.`);
      }
      if (ids.has(row.id)) {
        throw new Error(`${table}: id duplikat ${row.id} saat pagination.`);
      }
      ids.add(row.id);
      rows.push(row);
    }

    if (data.length === 0) break;
  }

  if (rows.length !== expected) {
    throw new Error(
      `${table}: jumlah terkumpul ${rows.length} tidak sama dengan count ${expected}.`,
    );
  }

  return { rows, count: expected };
}
