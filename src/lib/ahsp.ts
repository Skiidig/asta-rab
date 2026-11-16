import type { AhspAnalysisDetail, AhspComponent, AhspResourceCategory, RabUnit } from "@/types";

/**
 * AHSP — konstanta, perhitungan, dan helper murni.
 *
 * Tidak ada koefisien maupun harga bawaan: seluruh angka berasal dari input
 * pengguna. Modul ini tidak menyentuh React maupun Supabase sehingga rumusnya
 * bisa diuji langsung.
 *
 * Perhitungan memakai bilangan bulat:
 *   - koefisien disimpan sebagai mikro (× 1e6, sesuai numeric(18,6)),
 *   - harga disimpan sebagai sen (× 100, sesuai numeric(16,2)),
 *   - biaya komponen = (koefisien_mikro × harga_sen) / 1e6, dibulatkan ke sen,
 *   - total = penjumlahan bilangan bulat sen (tanpa akumulasi galat).
 */

export const AHSP_CATEGORIES = [
  "Persiapan",
  "Tanah",
  "Pondasi",
  "Struktur",
  "Dinding",
  "Atap",
  "Plafon",
  "Lantai",
  "Finishing",
  "Instalasi",
  "Lainnya",
] as const;

export type AhspCategory = (typeof AHSP_CATEGORIES)[number];

export const DEFAULT_AHSP_CATEGORY: AhspCategory = "Lainnya";

export const AHSP_RESOURCE_CATEGORIES: AhspResourceCategory[] = [
  "Material",
  "Tenaga kerja",
  "Peralatan",
];

export const DEFAULT_AHSP_RESOURCE_CATEGORY: AhspResourceCategory = "Material";

export interface AhspAnalysisInput {
  name: string;
  category: string;
  unit: RabUnit;
  description: string;
}

export interface AhspComponentInput {
  catalogItemId: string | null;
  resourceName: string;
  resourceCategory: AhspResourceCategory;
  unit: RabUnit;
  coefficient: number;
  unitPrice: number;
}

/* -------------------------------------------------------------------------- */
/*  Aritmetika bilangan bulat                                                 */
/* -------------------------------------------------------------------------- */

// Literal BigInt (`0n`) tidak tersedia pada target ES2017 di tsconfig, jadi
// konstanta dibuat lewat pemanggilan BigInt(). Nilai dan hasilnya identik.
const MICRO_PER_UNIT = BigInt(1_000_000);
const CENTS_PER_UNIT = BigInt(100);
const ZERO = BigInt(0);
const TWO = BigInt(2);

/** Nilai non-negatif, `NaN`/negatif menjadi 0. */
export function normalizeNonNegative(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function toScaled(value: number, scale: number): bigint {
  const safe = normalizeNonNegative(value);
  return BigInt(Math.round(safe * scale));
}

/** Koefisien → bilangan bulat mikro (× 1e6). */
export function coefficientToMicro(value: number): bigint {
  return toScaled(value, 1_000_000);
}

/** Harga dasar → bilangan bulat sen (× 100). */
export function priceToCents(value: number): bigint {
  return toScaled(value, 100);
}

/**
 * Biaya satu komponen dalam sen: round(koefisien × harga × 100).
 *
 * Dibulatkan ke sen terdekat (setengah ke atas) memakai aritmetika BigInt,
 * sehingga `0,1 × 3` menghasilkan tepat 0,30 dan bukan 0,30000000000000004.
 */
export function componentCostCents(coefficient: number, unitPrice: number): bigint {
  const micro = coefficientToMicro(coefficient);
  const cents = priceToCents(unitPrice);
  if (micro === ZERO || cents === ZERO) return ZERO;

  return (micro * cents + MICRO_PER_UNIT / TWO) / MICRO_PER_UNIT;
}

/** Biaya satu komponen dalam rupiah (2 desimal). */
export function componentCost(coefficient: number, unitPrice: number): number {
  return Number(componentCostCents(coefficient, unitPrice)) / Number(CENTS_PER_UNIT);
}

export interface AhspCostInput {
  coefficient: number;
  unitPrice: number;
}

/** Total biaya seluruh komponen dalam sen. */
export function totalCostCents(components: AhspCostInput[]): bigint {
  return components.reduce(
    (sum, component) => sum + componentCostCents(component.coefficient, component.unitPrice),
    ZERO,
  );
}

/** Total biaya seluruh komponen dalam rupiah. */
export function totalCost(components: AhspCostInput[]): number {
  return Number(totalCostCents(components)) / Number(CENTS_PER_UNIT);
}

export interface AhspGroup {
  category: AhspResourceCategory;
  components: AhspComponent[];
  subtotalCents: bigint;
  subtotal: number;
}

/** Kelompokkan komponen per kategori dengan subtotal, urut tetap. */
export function groupComponents(components: AhspComponent[]): AhspGroup[] {
  return AHSP_RESOURCE_CATEGORIES.map((category) => {
    const members = components.filter(
      (component) => component.resourceCategory === category,
    );

    return {
      category,
      components: members,
      subtotalCents: totalCostCents(members),
      subtotal: totalCost(members),
    };
  }).filter((group) => group.components.length > 0);
}

/* -------------------------------------------------------------------------- */
/*  Helper tampilan & pemilihan                                               */
/* -------------------------------------------------------------------------- */

export interface AhspFilter {
  query?: string;
  category?: string;
}

/** Filter analisis berdasarkan nama pekerjaan dan kategori. */
export function filterAhspAnalyses<T extends { name: string; category: string }>(
  analyses: T[],
  filter: AhspFilter = {},
): T[] {
  const needle = (filter.query ?? "").trim().toLowerCase();
  const category = (filter.category ?? "").trim();

  return analyses.filter((analysis) => {
    const matchesCategory =
      category === "" || category === "all" || analysis.category === category;
    const matchesQuery =
      needle.length === 0 || analysis.name.toLowerCase().includes(needle);

    return matchesCategory && matchesQuery;
  });
}

/** Kategori untuk filter/formulir: bawaan + yang sudah dipakai data. */
export function ahspCategoryOptions(
  analyses: { category: string }[] = [],
): string[] {
  const options: string[] = [...AHSP_CATEGORIES];

  for (const analysis of analyses) {
    const category = analysis.category.trim();
    if (category && !options.includes(category)) options.push(category);
  }

  return options;
}

export function normalizeAhspCategory(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "Lainnya";
}

export function normalizeResourceCategory(value: unknown): AhspResourceCategory {
  return AHSP_RESOURCE_CATEGORIES.includes(value as AhspResourceCategory)
    ? (value as AhspResourceCategory)
    : DEFAULT_AHSP_RESOURCE_CATEGORY;
}

/**
 * Tebakan awal kategori komponen AHSP dari kategori item katalog.
 *
 * Hanya nilai awal yang bisa diubah pengguna; katalog memakai kategori bebas
 * (Material/Pekerjaan/Upah/Alat/Lainnya) sedangkan AHSP memakai tiga kelompok
 * biaya.
 */
export function resourceCategoryFromCatalogCategory(
  category: string,
): AhspResourceCategory {
  const text = category.trim().toLowerCase();

  if (text === "upah" || text.includes("tenaga") || text.includes("buruh")) {
    return "Tenaga kerja";
  }
  if (text === "alat" || text.includes("peralatan") || text.includes("mesin")) {
    return "Peralatan";
  }
  return "Material";
}

/**
 * Nilai yang disalin ke item RAB saat memilih pekerjaan dari AHSP.
 *
 * Harga satuan = total analisis (hasil perhitungan komponen). Setelah masuk RAB,
 * nilainya independen: perubahan analisis tidak mengubah item RAB tersebut.
 */
export function ahspAnalysisToWorkItemPreset(analysis: AhspAnalysisDetail) {
  return {
    description: analysis.name,
    unit: analysis.unit,
    unitPrice: totalCost(analysis.components),
  };
}

/** Total harga satuan sebuah analisis (rupiah). */
export function analysisTotal(analysis: { components: AhspComponent[] }): number {
  return totalCost(analysis.components);
}
