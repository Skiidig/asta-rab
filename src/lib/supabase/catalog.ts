import { normalizeCatalogCategory, type CatalogItemInput } from "@/lib/catalog";
import { RAB_UNITS, sanitizeNumber } from "@/lib/rab-calc";
import type { CatalogItem, RabUnit } from "@/types";

import { getSupabaseClient } from "./client";

/**
 * Akses data katalog harga (`public.price_catalog`).
 *
 * Semua query tunduk pada RLS: baris selalu milik pengguna yang sedang masuk,
 * dan `user_id` diisi otomatis oleh database (`default auth.uid()`).
 */

export interface CatalogRow {
  id: string;
  user_id: string;
  name: string;
  category: string;
  unit: string;
  unit_price: number | string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function asText(value: string | null | undefined) {
  return value ?? "";
}

function asNonNegativeNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function asUnit(value: string): RabUnit {
  return RAB_UNITS.includes(value as RabUnit) ? (value as RabUnit) : "unit";
}

export function mapCatalogRow(row: CatalogRow): CatalogItem {
  return {
    id: row.id,
    name: asText(row.name).trim() || "Tanpa nama",
    category: normalizeCatalogCategory(row.category),
    unit: asUnit(row.unit),
    unitPrice: asNonNegativeNumber(row.unit_price),
    description: asText(row.description),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

interface SupabaseErrorLike {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

function describeError(error: SupabaseErrorLike | null) {
  if (!error) return "";
  return [error.message, error.details, error.hint]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" — ");
}

function catalogError(action: string, error: SupabaseErrorLike | null) {
  // Tabel belum dibuat (migration 0003 belum dijalankan): beri langkah perbaikan
  // yang jelas, bukan pesan mentah dari PostgREST.
  if (error?.code === "PGRST205") {
    return new Error(
      "Tabel katalog harga belum ada di database. Jalankan " +
        "supabase/migrations/0003_price_catalog.sql di Supabase SQL Editor, " +
        "lalu muat ulang halaman ini.",
    );
  }

  const detail = describeError(error);
  return new Error(`Gagal ${action}.${detail ? ` ${detail}` : ""}`);
}

function catalogColumns(input: CatalogItemInput) {
  return {
    name: input.name.trim(),
    category: normalizeCatalogCategory(input.category),
    unit: input.unit,
    unit_price: sanitizeNumber(input.unitPrice),
    description: input.description.trim() || null,
  };
}

/** Daftar katalog milik pengguna, urut nama. */
export async function fetchCatalogItems(): Promise<CatalogItem[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("price_catalog")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw catalogError("memuat katalog harga", error);

  return ((data ?? []) as CatalogRow[]).map(mapCatalogRow);
}

export async function createCatalogItemRecord(
  input: CatalogItemInput,
): Promise<CatalogItem> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("price_catalog")
    .insert(catalogColumns(input))
    .select("*")
    .single();

  if (error) throw catalogError("menyimpan item katalog", error);
  if (!data) throw new Error("Item katalog tersimpan tetapi tidak dapat dibaca kembali.");

  return mapCatalogRow(data as CatalogRow);
}

export async function updateCatalogItemRecord(
  id: string,
  input: CatalogItemInput,
): Promise<CatalogItem> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("price_catalog")
    .update(catalogColumns(input))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw catalogError("memperbarui item katalog", error);
  if (!data) throw new Error("Item katalog tidak ditemukan.");

  return mapCatalogRow(data as CatalogRow);
}

export async function deleteCatalogItemRecord(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("price_catalog").delete().eq("id", id);
  if (error) throw catalogError("menghapus item katalog", error);
}
