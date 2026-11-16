import type { RabWorkItem, RabUnit } from "@/types";

/**
 * Pure RAB calculations and input parsing.
 *
 * Kept free of React and formatting so the rules are easy to read, reuse, and
 * test. All values are plain numbers (IDR), never formatted strings.
 */

/** Units offered in the editor's unit picker. */
export const RAB_UNITS: RabUnit[] = [
  "m2",
  "m3",
  "m",
  "m1",
  "kg",
  "unit",
  "ls",
  "titik",
  "set",
  "hari",
  "bh",
  "zak",
  "batang",
  "lembar",
];

/** Sensible defaults for a newly added row. */
export const NEW_WORK_ITEM_DEFAULTS = {
  description: "",
  volume: 1,
  unit: "m2" as RabUnit,
  unitPrice: 0,
};

/**
 * Amount for one line item: `volume × unitPrice`.
 * Invalid input (NaN, negative, Infinity) is treated as zero.
 */
export function calculateItemAmount(item: Pick<RabWorkItem, "volume" | "unitPrice">) {
  const volume = sanitizeNumber(item.volume);
  const unitPrice = sanitizeNumber(item.unitPrice);
  return volume * unitPrice;
}

/** Sum of all line-item amounts — the document's total RAB. */
export function calculateRabTotal(items: Pick<RabWorkItem, "volume" | "unitPrice">[]) {
  return items.reduce((total, item) => total + calculateItemAmount(item), 0);
}

/** Number of line items that contain any content. */
export function countFilledItems(items: RabWorkItem[]) {
  return items.filter((item) => item.description.trim().length > 0).length;
}

/**
 * Clamp a numeric input to a safe, non-negative number.
 * `NaN`/`Infinity`/negative values become `0`.
 */
export function sanitizeNumber(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Parse a user-entered numeric string.
 *
 * Accepts Indonesian-style formatting (`1.500`, `2,5`) as well as plain
 * numbers (`1500`, `2.5`). Returns `null` for empty input so callers can
 * distinguish "not filled yet" from a real zero.
 *
 * Rules:
 *  - `,` is always a decimal separator.
 *  - A single `.` followed by 1–2 digits is a decimal separator (`2.5`);
 *    otherwise dots are thousands separators (`1.500` → 1500).
 *  - `dotAsDecimal` untuk volume/koefisien: satu titik selalu desimal, jadi
 *    `0.333333` / `169.423201` tidak berubah menjadi angka ribuan.
 *  - Negative values are rejected (return `null`).
 */
export function parseNumberInput(
  raw: string,
  options: { dotAsDecimal?: boolean } = {},
): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Keep digits, separators and a leading minus so we can reject negatives.
  const cleaned = trimmed.replace(/[^\d.,-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  if (cleaned.startsWith("-")) return null;

  let normalized: string;

  if (cleaned.includes(",")) {
    // Comma is the decimal mark; dots are thousands separators.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (options.dotAsDecimal) {
    // Besaran (volume/koefisien): titik pertama adalah desimal; titik
    // berikutnya dianggap pemisah ribuan yang tidak dipakai untuk besaran.
    const first = cleaned.indexOf(".");
    normalized =
      first === -1
        ? cleaned
        : `${cleaned.slice(0, first)}.${cleaned.slice(first + 1).replace(/\./g, "")}`;
  } else {
    const dotCount = (cleaned.match(/\./g) ?? []).length;
    const looksDecimal = dotCount === 1 && /\.\d{1,2}$/.test(cleaned);
    normalized = looksDecimal ? cleaned : cleaned.replace(/\./g, "");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Format a number the way Indonesian users write it: `1.500`, `2,5`. */
export function formatNumberInput(value: number) {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value);
}
