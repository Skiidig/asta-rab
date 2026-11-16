import { RAB_UNITS, calculateItemAmount } from "./rab-calc";
import type { RabUnit } from "../types";

/**
 * Logika import Excel — murni, tanpa React dan tanpa Supabase.
 *
 * Alur: berkas → matriks baris → header (boleh dua baris) → pemetaan kolom →
 * klasifikasi tiap baris menjadi GROUP / SUBGROUP / ITEM_GROUP / ITEM /
 * SUBTOTAL / TOTAL / NOTE, dengan konteks kelompok yang mengikuti urutan baris.
 *
 * Baris judul tidak diimpor sebagai item biaya: nama kelompok hanya disimpan
 * sebagai atribut pada item, dan subtotal dihitung dari item.
 */

/* -------------------------------------------------------------------------- */
/*  Definisi kolom                                                            */
/* -------------------------------------------------------------------------- */

export type ImportFieldKey =
  | "description"
  | "volume"
  | "unit"
  | "unitPrice"
  | "amount";

export interface ImportFieldDefinition {
  key: ImportFieldKey;
  label: string;
  required: boolean;
  hint: string;
  aliases: string[];
}

export const IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: "description",
    label: "Uraian Pekerjaan",
    required: true,
    hint: "Contoh: Uraian, Nama Pekerjaan, Deskripsi",
    aliases: [
      "uraian pekerjaan",
      "uraian kerja",
      "uraian",
      "nama pekerjaan",
      "nama item",
      "jenis pekerjaan",
      "pekerjaan",
      "deskripsi",
      "keterangan",
      "item",
      "description",
      "work item",
    ],
  },
  {
    key: "volume",
    label: "Volume",
    required: true,
    hint: "Contoh: Volume, Qty, Kuantitas",
    aliases: ["volume", "vol", "qty", "quantity", "kuantitas", "jml volume", "jumlah volume"],
  },
  {
    key: "unit",
    label: "Satuan",
    required: false,
    hint: "Contoh: Satuan, Unit, UoM",
    aliases: ["satuan", "unit", "uom", "sat"],
  },
  {
    key: "unitPrice",
    label: "Harga Satuan",
    required: true,
    hint: "Contoh: Harga Satuan, Harga, Harga Unit",
    aliases: [
      "harga satuan",
      "harga unit",
      "harga per satuan",
      "harga",
      "unit price",
      "price",
      "tarif",
      "hs",
    ],
  },
  {
    key: "amount",
    label: "Jumlah Harga",
    required: false,
    hint: "Opsional — dipakai untuk memeriksa subtotal, nilai item tetap dihitung ulang",
    aliases: [
      "jumlah harga",
      "jumlah biaya",
      "total harga",
      "total",
      "amount",
      "subtotal",
      "jumlah",
    ],
  },
];

export type ColumnMapping = Record<ImportFieldKey, number | null>;

export const EMPTY_MAPPING: ColumnMapping = {
  description: null,
  volume: null,
  unit: null,
  unitPrice: null,
  amount: null,
};

/** Huruf kolom Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                    */
/* -------------------------------------------------------------------------- */

/** Bentuk tampilan: huruf kecil, tanpa "(Rp)", tanpa tanda baca ganda. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/rp\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Bentuk pembanding: tanpa spasi sama sekali.
 *
 * Penting untuk header bergaya "U R A I A N   P E K E R J A A N" (huruf
 * berspasi) yang lazim di file Excel buatan tangan.
 */
function compactHeader(value: unknown): string {
  return normalizeHeader(value).replace(/\s+/g, "");
}

function headerScore(header: string, alias: string): number {
  if (!header || !alias) return 0;
  if (header === alias) return 100;
  if (header.startsWith(alias)) return 60;
  if (header.includes(alias)) return 30;
  return 0;
}

/** Gabungkan header dua baris (mis. "Harga Sat" + "(Rp)"). */
export function combineHeaderRows(primary: unknown[], secondary?: unknown[]): unknown[] {
  if (!secondary) return primary;
  const width = Math.max(primary.length, secondary.length);

  return Array.from({ length: width }, (_, column) => {
    const top = primary[column];
    const bottom = secondary[column];
    const topText = top === null || top === undefined ? "" : String(top).trim();
    const bottomText = bottom === null || bottom === undefined ? "" : String(bottom).trim();

    if (!bottomText) return topText;
    if (!topText) return bottomText;
    return `${topText} ${bottomText}`;
  });
}

/** Baris berikutnya terlihat seperti lanjutan header (mis. berisi "(Rp)"). */
export function looksLikeHeaderContinuation(row: unknown[] | undefined): boolean {
  if (!row) return false;
  const filled = row.filter(
    (cell) => cell !== null && cell !== undefined && String(cell).trim() !== "",
  );
  if (filled.length === 0 || filled.length > 4) return false;

  return filled.every((cell) => String(cell).trim().length <= 8);
}

export interface ResolvedHeader {
  labels: unknown[];
  usesSecondRow: boolean;
}

/** Label header efektif pada satu baris (menggabungkan baris lanjutan bila ada). */
export function resolveHeader(
  matrix: unknown[][],
  headerRowIndex: number,
): ResolvedHeader {
  const primary = matrix[headerRowIndex] ?? [];
  const secondary = matrix[headerRowIndex + 1];

  if (looksLikeHeaderContinuation(secondary)) {
    return { labels: combineHeaderRows(primary, secondary), usesSecondRow: true };
  }

  return { labels: primary, usesSecondRow: false };
}

/** Kenali kolom secara otomatis dari label header. */
export function mapColumns(headerRow: unknown[]): ColumnMapping {
  const normalized = headerRow.map(compactHeader);

  const candidates: { key: ImportFieldKey; column: number; score: number }[] = [];

  IMPORT_FIELDS.forEach((field) => {
    const aliases = field.aliases.map(compactHeader).filter(Boolean);
    normalized.forEach((header, column) => {
      const score = Math.max(0, ...aliases.map((alias) => headerScore(header, alias)));
      if (score > 0) candidates.push({ key: field.key, column, score });
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  const usedColumns = new Set<number>();

  for (const candidate of candidates) {
    if (mapping[candidate.key] !== null) continue;
    if (usedColumns.has(candidate.column)) continue;
    mapping[candidate.key] = candidate.column;
    usedColumns.add(candidate.column);
  }

  return mapping;
}

/** Tebak indeks baris header (0-based) dari beberapa baris pertama. */
export function detectHeaderRow(matrix: unknown[][], maxScan = 20): number {
  let bestIndex = 0;
  let bestScore = 0;

  const limit = Math.min(matrix.length, maxScan);

  for (let index = 0; index < limit; index += 1) {
    const { labels } = resolveHeader(matrix, index);
    const mapping = mapColumns(labels);
    const score = Object.values(mapping).filter((value) => value !== null).length;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 2 ? bestIndex : 0;
}

/* -------------------------------------------------------------------------- */
/*  Parsing angka & satuan                                                    */
/* -------------------------------------------------------------------------- */

function stripCurrency(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\brp\.?\s*/gi, "")
    .replace(/\bidr\b/gi, "")
    .trim();
}

/**
 * Angka dari sel Excel/teks (format Indonesia maupun internasional).
 * Negatif, NaN, dan Infinity dianggap tidak valid (`null`).
 */
export function parseSpreadsheetNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  let text = stripCurrency(value);
  if (text === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.includes("-")) negative = true;
  text = text.replace(/[-+]/g, "");
  text = text.replace(/[^\d.,]/g, "");
  if (text === "" || !/\d/.test(text)) return null;
  text = text.replace(/[.,]+$/, "");

  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;

  let normalized: string;

  if (dots > 0 && commas > 0) {
    normalized =
      text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(/,/g, ".")
        : text.replace(/,/g, "");
  } else if (commas > 0) {
    const parts = text.split(",");
    const last = parts[parts.length - 1];
    const isThousands =
      parts.length === 2 && last.length === 3 && parts[0] !== "0" && parts[0].length <= 3;

    normalized = isThousands ? parts.join("") : `${parts.slice(0, -1).join("")}.${last}`;
  } else if (dots > 1) {
    normalized = text.replace(/\./g, "");
  } else {
    const [integerPart, decimalPart = ""] = text.split(".");
    const isThousands =
      decimalPart.length === 3 && integerPart !== "0" && integerPart.length <= 3;
    normalized = isThousands ? integerPart + decimalPart : text;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || negative) return null;

  return parsed;
}

/** Satuan dari file → satuan yang dipakai aplikasi. */
export function normalizeSpreadsheetUnit(value: unknown): {
  unit: RabUnit;
  raw: string;
  recognized: boolean;
} {
  const raw = String(value ?? "").trim();

  // Sel tanpa satuan: tidak ada teks yang bisa dipertahankan, pakai "unit".
  if (!raw) return { unit: "unit", raw, recognized: false };

  const lower = raw.toLowerCase();
  const match = RAB_UNITS.find((unit) => unit.toLowerCase() === lower);
  if (match) return { unit: match, raw, recognized: true };

  // Variasi penulisan satuan umum: "M2", "m²", "m².".
  const compact = lower.replace(/[\s.]/g, "").replace("²", "2").replace("³", "3");
  const normalized = RAB_UNITS.find((unit) => unit.toLowerCase() === compact);
  if (normalized) return { unit: normalized, raw, recognized: true };

  // Satuan kustom (mis. "m'", "Point", "Mtr'", "Nos"): pertahankan teks aslinya,
  // jangan dipaksa menjadi "unit".
  return { unit: raw.slice(0, 24), raw, recognized: false };
}

/* -------------------------------------------------------------------------- */
/*  Klasifikasi baris                                                         */
/* -------------------------------------------------------------------------- */

export type ImportRowKind =
  | "group"
  | "subgroup"
  | "item_group"
  | "item"
  | "subtotal"
  | "total"
  | "note"
  | "problem";

export interface ClassifiedRow {
  rowNumber: number;
  kind: ImportRowKind;
  code: string;
  description: string;
  volume: number | null;
  unit: RabUnit;
  unitRaw: string;
  unitRecognized: boolean;
  unitPrice: number | null;
  /** volume × harga satuan (hanya untuk item). */
  amount: number | null;
  /** Nilai kolom "Jumlah Harga" bila dipetakan. */
  fileAmount: number | null;
  groupName: string | null;
  subgroupName: string | null;
  itemGroupName: string | null;
  sortOrder: number;
  ambiguous: boolean;
  reasons: string[];
}

export interface StructureNode {
  level: 1 | 2 | 3;
  label: string;
  itemCount: number;
  subtotal: number;
}

export interface SubtotalCheck {
  rowNumber: number;
  label: string;
  fileValue: number | null;
  computedValue: number;
  difference: number | null;
  /** Cakupan pembanding: blok subkelompok, seksi, atau seluruh dokumen. */
  scope: "block" | "section" | "document";
}

export interface ImportPlan {
  headerRowNumber: number;
  usesSecondHeaderRow: boolean;
  codeColumn: number | null;
  rows: ClassifiedRow[];
  items: ClassifiedRow[];
  counts: Record<ImportRowKind, number>;
  total: number;
  ambiguous: ClassifiedRow[];
  problems: { rowNumber: number; reasons: string[] }[];
  notes: { rowNumber: number; message: string }[];
  subtotalChecks: SubtotalCheck[];
  skipped: { rowNumber: number; reason: string }[];
  truncated: boolean;
  structure: StructureNode[];
}

export type ImportOverrides = Record<number, ImportRowKind | "skip">;

const SUBTOTAL_PATTERN = /^(sub\s*total|jumlah)\b/i;
const TOTAL_PATTERN =
  /^(total|grand\s*total|jumlah\s+total|jumlah\s+keseluruhan|total\s+keseluruhan)\b/i;
const ADMIN_PATTERN =
  /^(ppn|pph|dibulatkan|pembulatan|terbilang|nb|catatan|diskon|discount|luas\s+lantai|harga\s+per\s+m2)\b/i;

// Hanya angka Romawi yang lazim dipakai sebagai nomor bab. Huruf C/D/M juga
// valid secara Romawi, tetapi di file nyata dipakai sebagai kode kelompok
// (A, B, C, D), sehingga tidak boleh dianggap Romawi.
const ROMAN_PATTERN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;
const LETTER_PATTERN = /^[A-Z]$/;
const LETTER_DOT_PATTERN = /^[A-Z]\.$/;
const LETTER_NUMBER_PATTERN = /^[A-Z]\.\d+(\.\d+)*$/;
const NUMBER_PATTERN = /^\d{1,5}$/;

function labelOf(code: string, description: string): string {
  if (code && description) return `${code} ${description}`.replace(/\s+/g, " ").trim();
  return code || description;
}

function isNumericRow(volume: number | null, unitPrice: number | null): boolean {
  return volume !== null && unitPrice !== null;
}

/** Nilai sel pada kolom tertentu; `null` bila kolom tidak dipetakan. */
function cellAt(row: unknown[], index: number | null): unknown {
  if (index === null) return null;
  return row[index] ?? null;
}

/**
 * Ada baris item (volume + harga numerik) di depan?
 *
 * Dipakai membedakan **total seksi** (dokumen masih berlanjut) dari **rekap
 * akhir** (tidak ada item lagi setelah baris total).
 */
function hasItemAhead(
  matrix: unknown[][],
  mapping: ColumnMapping,
  fromIndex: number,
  lookahead = 100,
): boolean {
  const limit = Math.min(matrix.length, fromIndex + 1 + lookahead);

  for (let index = fromIndex + 1; index < limit; index += 1) {
    const row = matrix[index] ?? [];
    const volume = parseSpreadsheetNumber(cellAt(row, mapping.volume));
    const unitPrice = parseSpreadsheetNumber(cellAt(row, mapping.unitPrice));
    if (volume !== null && unitPrice !== null) return true;
  }

  return false;
}

/**
 * Deteksi kolom kode/penomoran (kolom "NO." pada umumnya).
 *
 * Diperlukan karena kode kelompok kadang berada di kolom nomor (Villa: kolom A)
 * dan kadang di kolom terpisah sebelum uraian (Banjar: kolom B).
 */
export function detectCodeColumn(
  matrix: unknown[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
): number | null {
  const mapped = new Set(
    Object.values(mapping).filter((value): value is number => value !== null),
  );

  const scanFrom = headerRowIndex + 1;
  const scanTo = Math.min(matrix.length, scanFrom + 80);
  const stats = new Map<
    number,
    { digits: number; structural: number; values: Set<string> }
  >();

  for (let index = scanFrom; index < scanTo; index += 1) {
    const row = matrix[index] ?? [];
    row.forEach((cell, column) => {
      if (mapped.has(column)) return;
      const text = String(cell ?? "").trim();
      if (!text) return;

      const entry =
        stats.get(column) ?? { digits: 0, structural: 0, values: new Set<string>() };

      if (NUMBER_PATTERN.test(text)) {
        entry.digits += 1;
        entry.values.add(text);
      } else if (
        ROMAN_PATTERN.test(text) ||
        LETTER_PATTERN.test(text) ||
        LETTER_DOT_PATTERN.test(text) ||
        LETTER_NUMBER_PATTERN.test(text)
      ) {
        entry.structural += 1;
      }

      stats.set(column, entry);
    });
  }

  let best: number | null = null;
  let bestScore = 0;

  for (const [column, entry] of stats) {
    // Kolom berisi satu-dua nilai berulang (mis. kolom diskon 0 / 0,05) bukan
    // kolom penomoran.
    if (entry.structural === 0 && entry.values.size <= 2) continue;

    const score = entry.digits + entry.structural * 4;
    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }

  return bestScore >= 3 ? best : null;
}

export interface ClassifyOptions {
  maxRows?: number;
  overrides?: ImportOverrides;
  codeColumn?: number | null;
}

/**
 * Klasifikasi seluruh baris data.
 *
 * Konteks kelompok mengikuti urutan baris (bukan kode unik), sehingga kode yang
 * dipakai ulang di posisi lain (mis. "A" dua kali di Banjar) memulai kelompok
 * baru dan tidak mencampur item ke kelompok sebelumnya.
 */
export function classifyImportMatrix(
  matrix: unknown[][],
  mapping: ColumnMapping,
  headerRowIndex: number,
  options: ClassifyOptions = {},
): ImportPlan {
  const maxRows = options.maxRows ?? 1000;
  const overrides = options.overrides ?? {};
  const { usesSecondRow } = resolveHeader(matrix, headerRowIndex);
  const codeColumn =
    options.codeColumn !== undefined
      ? options.codeColumn
      : detectCodeColumn(matrix, Math.max(headerRowIndex, 0), mapping);

  const rows: ClassifiedRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  const notes: { rowNumber: number; message: string }[] = [];
  const subtotalChecks: SubtotalCheck[] = [];
  const counts: Record<ImportRowKind, number> = {
    group: 0,
    subgroup: 0,
    item_group: 0,
    item: 0,
    subtotal: 0,
    total: 0,
    note: 0,
    problem: 0,
  };

  let currentGroup: string | null = null;
  let currentGroupCode: string | null = null;
  let currentSubgroup: string | null = null;
  let currentSubgroupCode: string | null = null;
  let currentItemGroup: string | null = null;
  /**
   * Nomor baris pertama blok rekap akhir. Selama NULL, baris TOTAL yang
   * ditemukan diperlakukan sebagai **total seksi** dan klasifikasi berlanjut
   * normal (Villa memiliki "TOTAL JUMLAH BANGUNAN" di tengah dokumen).
   */
  let recapFrom: number | null = null;
  let sectionSum = 0;
  let documentSum = 0;
  /** Item sejak baris subtotal/total terakhir (untuk subtotal lokal). */
  let sinceSubtotal = 0;
  let truncated = false;
  let preservedSubheadings = 0;
  let skippedSubheadings = 0;
  const subheadingCounts = new Map<string, Map<string, number>>();
  const customUnits = new Map<string, number>();
  let emptyUnits = 0;
  const dataStart = headerRowIndex + (usesSecondRow ? 2 : 1);

  for (let index = dataStart; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const rowNumber = index + 1;
    const code = codeColumn === null ? "" : String(row[codeColumn] ?? "").trim();
    const description = String(cellAt(row, mapping.description) ?? "").trim();
    const rawVolume = cellAt(row, mapping.volume);
    const rawPrice = cellAt(row, mapping.unitPrice);
    const rawUnit = cellAt(row, mapping.unit);
    const rawAmount = cellAt(row, mapping.amount);
    const volume = parseSpreadsheetNumber(rawVolume);
    const unitPrice = parseSpreadsheetNumber(rawPrice);
    const fileAmount = parseSpreadsheetNumber(rawAmount);

    const mappedCells = [code, description, rawVolume, rawPrice, rawUnit, rawAmount];
    const isEmpty = mappedCells.every(
      (cell) => cell === null || cell === undefined || String(cell).trim() === "",
    );

    if (isEmpty) {
      skipped.push({ rowNumber, reason: "Baris kosong" });
      continue;
    }

    const label = `${code} ${description}`.replace(/\s+/g, " ").trim();
    const override = overrides[rowNumber];

    let kind: ImportRowKind;

    if (override) {
      kind = override === "skip" ? "note" : override;
    } else if (recapFrom !== null && rowNumber >= recapFrom) {
      kind = "note";
    } else if (TOTAL_PATTERN.test(label)) {
      kind = "total";
    } else if (SUBTOTAL_PATTERN.test(label)) {
      kind = "subtotal";
    } else if (ADMIN_PATTERN.test(label)) {
      kind = "note";
    } else if (isNumericRow(volume, unitPrice)) {
      kind = "item";
    } else if (volume !== null || unitPrice !== null) {
      kind = "problem";
    } else if (ROMAN_PATTERN.test(code) || LETTER_PATTERN.test(code)) {
      // Kode huruf tanpa titik bisa berarti kelompok baru (Banjar: A, B, C, D)
      // atau subkelompok di bawah kelompok romawi (Villa: I → A, B, C).
      const activeRomanGroup =
        LETTER_PATTERN.test(code) &&
        currentGroupCode !== null &&
        ROMAN_PATTERN.test(currentGroupCode);

      kind = activeRomanGroup ? "subgroup" : "group";
    } else if (LETTER_DOT_PATTERN.test(code)) {
      kind = currentGroup ? "subgroup" : "group";
    } else if (LETTER_NUMBER_PATTERN.test(code)) {
      // "K.1" setelah subkelompok "K." adalah judul kelompok item; sedangkan
      // "A.1" pada kelompok "A" adalah subkelompok.
      const childOfSubgroup =
        currentSubgroupCode !== null &&
        currentSubgroupCode.length >= 2 &&
        code.startsWith(currentSubgroupCode);

      kind = childOfSubgroup ? "item_group" : currentGroup ? "subgroup" : "group";
    } else if (NUMBER_PATTERN.test(code)) {
      kind = currentSubgroup || currentGroup ? "item_group" : "group";
    } else if (description.startsWith("-")) {
      // Subjudul "- ..." menjadi kelompok item bila belum ada kelompok item
      // aktif; bila sudah ada (mis. "- Pembesian" di bawah "1 Pek. Ring Balok
      // RB1"), biarkan sebagai catatan agar konteks induk tidak tertimpa.
      const activeIsSubheading = Boolean(currentItemGroup?.startsWith("-"));

      if (currentItemGroup && !activeIsSubheading) {
        kind = "note";
        skippedSubheadings += 1;
      } else if (currentSubgroup || currentGroup) {
        kind = "item_group";
        preservedSubheadings += 1;
      } else {
        kind = "note";
        skippedSubheadings += 1;
      }
    } else if (description) {
      kind = currentSubgroup || currentGroup ? "item_group" : "note";
    } else {
      kind = "note";
    }

    // Total seksi vs rekap akhir: hanya dianggap rekap bila tidak ada item
    // lagi setelah baris total ini.
    if (kind === "total" && !override && recapFrom === null) {
      if (!hasItemAhead(matrix, mapping, index)) {
        recapFrom = rowNumber + 1;
      }
    }

    const unitInfo = normalizeSpreadsheetUnit(rawUnit);
    const reasons: string[] = [];

    if (kind === "problem") {
      if (volume === null) {
        reasons.push(
          rawVolume === null || String(rawVolume ?? "").trim() === ""
            ? "Volume kosong"
            : "Volume bukan angka yang valid",
        );
      }
      if (unitPrice === null) {
        reasons.push(
          rawPrice === null || String(rawPrice ?? "").trim() === ""
            ? "Harga satuan kosong"
            : "Harga satuan bukan angka yang valid",
        );
      }
    }

    if (kind === "item" && !description) {
      kind = "problem";
      reasons.push("Uraian pekerjaan kosong");
    }

    const classified: ClassifiedRow = {
      rowNumber,
      kind,
      code,
      description,
      volume,
      unit: unitInfo.unit,
      unitRaw: unitInfo.raw,
      unitRecognized: unitInfo.recognized,
      unitPrice,
      amount: kind === "item" ? calculateItemAmount({ volume: volume ?? 0, unitPrice: unitPrice ?? 0 }) : null,
      fileAmount,
      groupName: currentGroup,
      subgroupName: currentSubgroup,
      itemGroupName: currentItemGroup,
      sortOrder: rowNumber,
      ambiguous: false,
      reasons,
    };

    if (kind === "group") {
      const own = labelOf(code, description);
      classified.groupName = own;
      currentGroup = own;
      currentGroupCode = code;
      currentSubgroup = null;
      currentSubgroupCode = null;
      currentItemGroup = null;
      sectionSum = 0;
    } else if (kind === "subgroup") {
      const own = labelOf(code, description);
      classified.groupName = currentGroup;
      classified.subgroupName = own;
      currentSubgroup = own;
      currentSubgroupCode = code;
      currentItemGroup = null;
    } else if (kind === "item_group") {
      const own = labelOf(code, description);
      // Subjudul "-" yang berulang dalam subkelompok yang sama diberi nomor
      // agar blok-bloknya tidak tergabung menjadi satu kelompok.
      let groupLabel = own;
      if (description.startsWith("-")) {
        const parentKey = currentSubgroup ?? currentGroup ?? "root";
        const counts = subheadingCounts.get(parentKey) ?? new Map<string, number>();
        const seen = (counts.get(own) ?? 0) + 1;
        counts.set(own, seen);
        subheadingCounts.set(parentKey, counts);
        groupLabel = seen === 1 ? own : `${own} (${seen})`;
      }

      classified.groupName = currentGroup;
      classified.subgroupName = currentSubgroup;
      classified.itemGroupName = groupLabel;
      currentItemGroup = groupLabel;
    }

    if (kind === "item") {
      if (counts.item >= maxRows) {
        truncated = true;
        break;
      }
      // Item hanya menyimpan konteks kelompok yang sedang aktif.
      classified.groupName = currentGroup;
      classified.subgroupName = currentSubgroup;
      classified.itemGroupName = currentItemGroup;

      if (!unitInfo.recognized) {
        if (unitInfo.raw) {
          customUnits.set(unitInfo.unit, (customUnits.get(unitInfo.unit) ?? 0) + 1);
        } else {
          emptyUnits += 1;
        }
      }

      const amount = classified.amount ?? 0;
      sectionSum += amount;
      documentSum += amount;
      sinceSubtotal += amount;
    } else if (kind === "subtotal" || kind === "total") {
      const lastNumber = [...row]
        .map((cell) => parseSpreadsheetNumber(cell))
        .filter((value): value is number => value !== null)
        .pop();

      const fileValue = fileAmount ?? lastNumber ?? null;

      // Cakupan pembanding mengikuti jenis barisnya:
      //  - subtotal lokal  → item dalam blok sejak subtotal sebelumnya;
      //  - total seksi     → seluruh item dalam seksi (sejak GROUP terakhir);
      //  - total dokumen   → seluruh item biaya sejauh ini.
      let scope: SubtotalCheck["scope"];
      let computedValue: number;

      if (kind === "total") {
        const reference = fileValue ?? 0;
        const useSection =
          Math.abs(reference - sectionSum) <= Math.abs(reference - documentSum);
        scope = useSection ? "section" : "document";
        computedValue = useSection ? sectionSum : documentSum;
      } else {
        scope = "block";
        computedValue = sinceSubtotal;
      }

      subtotalChecks.push({
        rowNumber,
        label,
        fileValue,
        computedValue,
        difference: fileValue === null ? null : fileValue - computedValue,
        scope,
      });

      sinceSubtotal = 0;
    }

    counts[kind] += 1;
    rows.push(classified);
  }

  /* --- Ambiguitas: judul yang tidak memiliki item di bawahnya ---------- */
  const headingLevel: Record<string, number> = { group: 1, subgroup: 2, item_group: 3 };
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const level = headingLevel[row.kind];
    if (!level) continue;

    let hasChild = false;
    for (let next = index + 1; next < rows.length; next += 1) {
      const candidate = rows[next];
      const nextLevel = headingLevel[candidate.kind];
      if (nextLevel && nextLevel <= level) break;
      if (candidate.kind === "item") {
        hasChild = true;
        break;
      }
    }

    if (!hasChild) row.ambiguous = true;
  }

  /* --- Catatan agregat -------------------------------------------------- */
  for (const [unit, total] of customUnits) {
    notes.push({
      rowNumber: 0,
      message: `${total} item memakai satuan kustom "${unit}" (dipertahankan apa adanya)`,
    });
  }

  if (emptyUnits > 0) {
    notes.push({
      rowNumber: 0,
      message: `${emptyUnits} item tanpa satuan; dipakai "unit" sebagai nilai awal`,
    });
  }

  if (preservedSubheadings > 0) {
    notes.push({
      rowNumber: 0,
      message: `${preservedSubheadings} subjudul bertanda "-" dipakai sebagai kelompok item`,
    });
  }

  if (skippedSubheadings > 0) {
    notes.push({
      rowNumber: 0,
      message: `${skippedSubheadings} subjudul bertanda "-" tidak disimpan karena sudah ada kelompok item induk`,
    });
  }

  if (recapFrom !== null) {
    notes.push({
      rowNumber: 0,
      message: `Blok rekap akhir mulai baris ${recapFrom} tidak diimpor (hanya total item yang dihitung)`,
    });
  }

  const items = rows.filter((row) => row.kind === "item");

  return {
    headerRowNumber: headerRowIndex + 1,
    usesSecondHeaderRow: usesSecondRow,
    codeColumn,
    rows,
    items,
    counts,
    total: items.reduce((sum, row) => sum + (row.amount ?? 0), 0),
    ambiguous: rows.filter((row) => row.ambiguous),
    problems: rows
      .filter((row) => row.kind === "problem")
      .map((row) => ({ rowNumber: row.rowNumber, reasons: row.reasons })),
    notes,
    subtotalChecks,
    skipped,
    truncated,
    structure: buildStructureTree(items),
  };
}

/** Ringkasan struktur (kelompok → subkelompok → kelompok item) dari item. */
export function buildStructureTree(items: ClassifiedRow[]): StructureNode[] {
  interface Node {
    label: string;
    level: 1 | 2 | 3;
    children: Node[];
    itemCount: number;
    subtotal: number;
  }

  const makeNode = (label: string, level: 1 | 2 | 3): Node => ({
    label,
    level,
    children: [],
    itemCount: 0,
    subtotal: 0,
  });

  const roots: Node[] = [];
  let group: Node | null = null;
  let subgroup: Node | null = null;
  let itemGroup: Node | null = null;

  for (const item of items) {
    // Kelompok: label sama berturut-turut memakai node yang sama; label yang
    // muncul lagi setelah kelompok lain membuat node baru (sesuai urutan sheet).
    if (item.groupName) {
      if (!group || group.label !== item.groupName) {
        group = makeNode(item.groupName, 1);
        roots.push(group);
        subgroup = null;
        itemGroup = null;
      }
    } else {
      group = null;
      subgroup = null;
      itemGroup = null;
    }

    if (group && item.subgroupName) {
      if (!subgroup || subgroup.label !== item.subgroupName) {
        subgroup = makeNode(item.subgroupName, 2);
        group.children.push(subgroup);
        itemGroup = null;
      }
    } else if (!item.subgroupName) {
      subgroup = null;
      itemGroup = null;
    }

    if (subgroup && item.itemGroupName) {
      if (!itemGroup || itemGroup.label !== item.itemGroupName) {
        itemGroup = makeNode(item.itemGroupName, 3);
        subgroup.children.push(itemGroup);
      }
    } else if (!item.itemGroupName) {
      itemGroup = null;
    }

    for (const node of [group, subgroup, itemGroup]) {
      if (!node) continue;
      node.itemCount += 1;
      node.subtotal += item.amount ?? 0;
    }
  }

  const flat: StructureNode[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      flat.push({
        level: node.level,
        label: node.label,
        itemCount: node.itemCount,
        subtotal: node.subtotal,
      });
      walk(node.children);
    }
  };
  walk(roots);

  return flat;
}

/** Saran identitas dari kop workbook (tidak pernah menimpa pilihan pengguna). */
export interface WorkbookMetadata {
  project?: string;
  owner?: string;
  location?: string;
}

const META_LABELS: { key: keyof WorkbookMetadata; pattern: RegExp }[] = [
  { key: "project", pattern: /^(project|proyek)$/i },
  { key: "owner", pattern: /^(owner|pemilik|klien|client)$/i },
  { key: "location", pattern: /^(location|lokasi)$/i },
];

export function detectWorkbookMetadata(
  matrix: unknown[][],
  headerRowIndex: number,
): WorkbookMetadata {
  const meta: WorkbookMetadata = {};
  const limit = Math.min(headerRowIndex, matrix.length);

  for (let index = 0; index < limit; index += 1) {
    const row = matrix[index] ?? [];

    row.forEach((cell, column) => {
      const text = String(cell ?? "").trim();
      if (!text) return;

      for (const label of META_LABELS) {
        if (meta[label.key] || !label.pattern.test(text)) continue;

        for (let next = column + 1; next < row.length; next += 1) {
          const value = String(row[next] ?? "").trim();
          if (!value || value === ":") continue;
          meta[label.key] = value.slice(0, 160);
          break;
        }
      }
    });
  }

  return meta;
}

/* -------------------------------------------------------------------------- */
/*  Membaca berkas (SheetJS dimuat dinamis)                                   */
/* -------------------------------------------------------------------------- */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SHEET_ROWS = 5000;

export interface ParsedWorkbook {
  sheetNames: string[];
  sheets: Record<string, unknown[][]>;
}

interface XlsxModule {
  read: (data: ArrayBuffer | Uint8Array, options?: Record<string, unknown>) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: <T>(sheet: unknown, options: Record<string, unknown>) => T[];
  };
}

async function loadXlsx(): Promise<XlsxModule> {
  const loaded = await import("xlsx-js-style");
  const candidate = (loaded as unknown as { default?: XlsxModule }).default;
  if (candidate && typeof candidate.read === "function") return candidate;
  return loaded as unknown as XlsxModule;
}

/** Baca berkas Excel (.xlsx/.xls) menjadi matriks per sheet. */
export async function parseWorkbookFile(file: File): Promise<ParsedWorkbook> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `Berkas terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maksimal ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    );
  }

  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();

  let workbook: { SheetNames: string[]; Sheets: Record<string, unknown> };
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  } catch {
    throw new Error(
      "Berkas tidak dapat dibaca. Pastikan formatnya .xlsx atau .xls dan tidak rusak.",
    );
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error("Berkas tidak memiliki sheet data.");
  }

  const sheets: Record<string, unknown[][]> = {};
  let hasData = false;

  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    sheets[name] = matrix.slice(0, MAX_SHEET_ROWS);

    if (
      !hasData &&
      matrix.some((row) =>
        row.some(
          (cell) => cell !== null && cell !== undefined && String(cell).trim() !== "",
        ),
      )
    ) {
      hasData = true;
    }
  }

  if (!hasData) {
    throw new Error(
      "Berkas tidak berisi data yang dapat dibaca. Pastikan file Excel tidak rusak atau kosong.",
    );
  }

  return { sheetNames: workbook.SheetNames, sheets };
}
