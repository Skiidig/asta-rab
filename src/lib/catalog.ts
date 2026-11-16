import type { CatalogItem, RabUnit } from "@/types";

/**
 * Katalog harga — konstanta & helper murni (tanpa React, tanpa Supabase).
 *
 * Kategori disimpan sebagai teks bebas di database; daftar di bawah adalah
 * pilihan bawaan yang tampil di formulir. Menambah kategori cukup dengan
 * menambah satu entri di `CATALOG_CATEGORIES` — tidak perlu migration.
 */
export const CATALOG_CATEGORIES = [
  "Material",
  "Pekerjaan",
  "Upah",
  "Alat",
  "Lainnya",
] as const;

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

export const DEFAULT_CATALOG_CATEGORY: CatalogCategory = "Material";

export interface CatalogItemInput {
  name: string;
  category: string;
  unit: RabUnit;
  unitPrice: number;
  description: string;
}

export interface CatalogFilter {
  /** Kata kunci nama item (tidak peka huruf besar/kecil). */
  query?: string;
  /** Kategori yang dipilih, atau `"all"`/kosong untuk semua. */
  category?: string;
}

/** Filter daftar katalog berdasarkan nama dan kategori. */
export function filterCatalogItems(
  items: CatalogItem[],
  filter: CatalogFilter = {},
): CatalogItem[] {
  const needle = (filter.query ?? "").trim().toLowerCase();
  const category = (filter.category ?? "").trim();

  return items.filter((item) => {
    const matchesCategory =
      category === "" || category === "all" || item.category === category;
    const matchesQuery =
      needle.length === 0 || item.name.toLowerCase().includes(needle);

    return matchesCategory && matchesQuery;
  });
}

/**
 * Pilihan kategori untuk filter/formulir: kategori bawaan ditambah kategori
 * lain yang sudah dipakai data pengguna, agar katalog lama tetap bisa difilter.
 */
export function catalogCategoryOptions(items: CatalogItem[] = []): string[] {
  const options: string[] = [...CATALOG_CATEGORIES];

  for (const item of items) {
    const category = item.category.trim();
    if (category && !options.includes(category)) options.push(category);
  }

  return options;
}

/** Pastikan kategori selalu punya nilai yang bisa disimpan. */
export function normalizeCatalogCategory(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "Lainnya";
}

/**
 * Nilai yang disalin ke item RAB saat memilih dari katalog (snapshot).
 *
 * Sengaja hanya mengembalikan field yang memang disimpan di `rab_items`;
 * tidak ada id katalog yang ikut, sehingga tidak ada ketergantungan data.
 */
export function catalogItemToWorkItemPreset(item: CatalogItem) {
  return {
    description: item.name,
    unit: item.unit,
    unitPrice: item.unitPrice,
  };
}
