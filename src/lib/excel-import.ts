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

export type NumberFormatMode = "auto" | "id-ID" | "en-US";

export type NumericFieldRole = "volume" | "money";

export interface NumberFormatConfig {
  /** Format teks untuk kolom Volume / kuantitas. */
  volume: NumberFormatMode;
  /** Format teks untuk kolom moneter (Harga Satuan, Jumlah Harga, subtotal/total). */
  money: NumberFormatMode;
}

export const DEFAULT_NUMBER_FORMAT_CONFIG: NumberFormatConfig = {
  volume: "auto",
  money: "auto",
};

export function resolveNumberFormatConfig(
  input?: NumberFormatMode | Partial<NumberFormatConfig>,
): NumberFormatConfig {
  if (!input) return { ...DEFAULT_NUMBER_FORMAT_CONFIG };
  if (typeof input === "string") {
    return { volume: input, money: input };
  }
  return {
    volume: input.volume ?? "auto",
    money: input.money ?? "auto",
  };
}

/** Pilih mode format teks sesuai peran kolom (`volume` vs moneter). */
export function numberFormatForField(
  field: ImportFieldKey,
  formats: NumberFormatConfig,
): NumberFormatMode {
  if (field === "volume") return formats.volume;
  if (field === "unitPrice" || field === "amount") return formats.money;
  return "auto";
}

export type NumberParseStatus =
  | "empty"
  | "ok"
  | "negative"
  | "ambiguous"
  | "invalid";

export interface ParsedNumberResult {
  status: NumberParseStatus;
  value: number | null;
  raw: string;
}

const BARE_DASH_PATTERN = /^[-–—]+$/;
const PLAIN_INTEGER_PATTERN = /^\d+$/;
const CLEAN_NUMERIC_TOKEN_PATTERN = /^\d+(?:[.,]\d+)*$/;
const LEADING_ZERO_DECIMAL_PATTERN = /^0[.,]\d+$/;
const ID_THOUSANDS_ONLY_PATTERN = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const ID_MULTI_THOUSANDS_PATTERN = /^[1-9]\d{0,2}(?:\.\d{3}){2,}$/;
const ID_THOUSANDS_DECIMAL_PATTERN = /^[1-9]\d{0,2}(?:\.\d{3})+,\d+$/;
const ID_DECIMAL_ONLY_PATTERN = /^\d+,\d+$/;
const EN_THOUSANDS_ONLY_PATTERN = /^[1-9]\d{0,2}(?:,\d{3})+$/;
const EN_MULTI_THOUSANDS_PATTERN = /^[1-9]\d{0,2}(?:,\d{3}){2,}$/;
const EN_THOUSANDS_DECIMAL_PATTERN = /^[1-9]\d{0,2}(?:,\d{3})+\.\d+$/;
const EN_DECIMAL_ONLY_PATTERN = /^\d+\.\d+$/;
const AMBIGUOUS_SINGLE_COMMA_PATTERN = /^[1-9]\d{0,2},\d{3}$/;
const AMBIGUOUS_SINGLE_DOT_PATTERN = /^[1-9]\d{0,2}\.\d{3}$/;

function isBareDash(value: unknown): boolean {
  return typeof value === "string" && BARE_DASH_PATTERN.test(value.trim());
}

function parseUnsignedNumericToken(
  token: string,
  mode: NumberFormatMode,
): { status: "ok" | "ambiguous" | "invalid"; normalized: string | null } {
  if (!CLEAN_NUMERIC_TOKEN_PATTERN.test(token)) {
    return { status: "invalid", normalized: null };
  }

  if (PLAIN_INTEGER_PATTERN.test(token)) {
    return { status: "ok", normalized: token };
  }

  // Desimal berawalan nol tunggal ("0.500", "0,500", "0.234", "0,234") selalu
  // tak ambigu secara matematis karena nol tidak pernah menjadi grup ribuan.
  if (LEADING_ZERO_DECIMAL_PATTERN.test(token)) {
    return { status: "ok", normalized: token.replace(",", ".") };
  }

  if (mode === "id-ID") {
    if (ID_DECIMAL_ONLY_PATTERN.test(token)) {
      return { status: "ok", normalized: token.replace(",", ".") };
    }
    if (ID_THOUSANDS_ONLY_PATTERN.test(token)) {
      return { status: "ok", normalized: token.replace(/\./g, "") };
    }
    if (ID_THOUSANDS_DECIMAL_PATTERN.test(token)) {
      return {
        status: "ok",
        normalized: token.replace(/\./g, "").replace(",", "."),
      };
    }
    return { status: "invalid", normalized: null };
  }

  if (mode === "en-US") {
    if (EN_DECIMAL_ONLY_PATTERN.test(token)) {
      return { status: "ok", normalized: token };
    }
    if (EN_THOUSANDS_ONLY_PATTERN.test(token)) {
      return { status: "ok", normalized: token.replace(/,/g, "") };
    }
    if (EN_THOUSANDS_DECIMAL_PATTERN.test(token)) {
      return { status: "ok", normalized: token.replace(/,/g, "") };
    }
    return { status: "invalid", normalized: null };
  }

  // mode === "auto" (ketat: tidak pernah menebak pemisah tunggal 3 digit)
  const dots = (token.match(/\./g) ?? []).length;
  const commas = (token.match(/,/g) ?? []).length;

  if (dots > 0 && commas > 0) {
    if (ID_THOUSANDS_DECIMAL_PATTERN.test(token)) {
      return {
        status: "ok",
        normalized: token.replace(/\./g, "").replace(",", "."),
      };
    }
    if (EN_THOUSANDS_DECIMAL_PATTERN.test(token)) {
      return { status: "ok", normalized: token.replace(/,/g, "") };
    }
    return { status: "invalid", normalized: null };
  }

  if (dots > 1) {
    return ID_MULTI_THOUSANDS_PATTERN.test(token)
      ? { status: "ok", normalized: token.replace(/\./g, "") }
      : { status: "invalid", normalized: null };
  }

  if (commas > 1) {
    return EN_MULTI_THOUSANDS_PATTERN.test(token)
      ? { status: "ok", normalized: token.replace(/,/g, "") }
      : { status: "invalid", normalized: null };
  }

  if (commas === 1) {
    if (AMBIGUOUS_SINGLE_COMMA_PATTERN.test(token)) {
      return { status: "ambiguous", normalized: null };
    }
    return { status: "ok", normalized: token.replace(",", ".") };
  }

  if (dots === 1) {
    if (AMBIGUOUS_SINGLE_DOT_PATTERN.test(token)) {
      return { status: "ambiguous", normalized: null };
    }
    return { status: "ok", normalized: token };
  }

  return { status: "invalid", normalized: null };
}

/**
 * Analisis angka dari sel Excel atau teks secara ketat.
 *
 * - Sel angka Excel (`typeof value === "number"`) selalu dibaca sesuai nilai
 *   aslinya tanpa terpengaruh `mode` format teks.
 * - Pada mode `"auto"` (bawaan), teks dengan pemisah tunggal + 3 digit seperti
 *   `"1,234"` atau `"1.234"` ditandai `"ambiguous"` dan tidak pernah ditebak.
 * - Notasi rupiah Indonesia berakhiran `,-` (mis. `"Rp 150.000,-"`) diterima
 *   sebagai `,00` pada mode `"auto"` dan `"id-ID"`.
 */
export function inspectSpreadsheetNumber(
  value: unknown,
  mode: NumberFormatMode = "auto",
): ParsedNumberResult {
  if (value === null || value === undefined) {
    return { status: "empty", value: null, raw: "" };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { status: "invalid", value: null, raw: String(value) };
    }
    if (value < 0) {
      return { status: "negative", value: null, raw: String(value) };
    }
    return {
      status: "ok",
      value: value === 0 ? 0 : value,
      raw: String(value === 0 ? 0 : value),
    };
  }

  if (typeof value !== "string") {
    return { status: "invalid", value: null, raw: String(value) };
  }

  const raw = value.replace(/\u00a0/g, " ").trim();
  if (raw === "") {
    return { status: "empty", value: null, raw: "" };
  }

  let text = raw;
  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  if (text.startsWith("-")) {
    if (negative) return { status: "invalid", value: null, raw };
    negative = true;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  text = text.replace(/^(?:rp\.?|idr)(?=\s|[\d+-]|$)\s*/i, "").trim();

  if (text.startsWith("-")) {
    if (negative) return { status: "invalid", value: null, raw };
    negative = true;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  text = text.replace(/\s+idr$/i, "").trim();

  // Notasi mata uang Indonesia berakhiran ",-" (mis. "Rp 150.000,-" → "150.000,00").
  if (/\d,-$/.test(text)) {
    text = `${text.slice(0, -1)}00`;
  }

  const token = parseUnsignedNumericToken(text, mode);

  if (token.status === "invalid") {
    return { status: "invalid", value: null, raw };
  }

  if (negative) {
    return { status: "negative", value: null, raw };
  }

  if (token.status === "ambiguous" || token.normalized === null) {
    return { status: "ambiguous", value: null, raw };
  }

  const parsed = Number(token.normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { status: "invalid", value: null, raw };
  }

  return { status: "ok", value: parsed === 0 ? 0 : parsed, raw };
}

/**
 * Angka dari sel Excel/teks (format Indonesia maupun internasional).
 * Kosong, negatif, ambigu, tidak valid, NaN, dan Infinity mengembalikan `null`.
 */
export function parseSpreadsheetNumber(
  value: unknown,
  mode: NumberFormatMode = "auto",
): number | null {
  const result = inspectSpreadsheetNumber(value, mode);
  return result.status === "ok" ? result.value : null;
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
  fileStatus: NumberParseStatus;
  fileRaw: string;
  computedValue: number;
  difference: number | null;
  /** Cakupan pembanding: blok subkelompok, seksi, atau seluruh dokumen. */
  scope: "block" | "section" | "document";
}

export function isUnreadableSubtotalCheck(check: SubtotalCheck): boolean {
  return (
    check.fileStatus === "ambiguous" ||
    check.fileStatus === "negative" ||
    check.fileStatus === "invalid"
  );
}

export function hasSubtotalWarning(check: SubtotalCheck): boolean {
  return (
    isUnreadableSubtotalCheck(check) ||
    (check.difference !== null && Math.abs(check.difference) > 0.5)
  );
}

export interface ImportProblem {
  rowNumber: number;
  description: string;
  reasons: string[];
  hasAmbiguousNumber: boolean;
  hasAmbiguousVolume: boolean;
  hasAmbiguousPrice: boolean;
}

export interface ImportPlan {
  headerRowNumber: number;
  usesSecondHeaderRow: boolean;
  codeColumn: number | null;
  numberFormat: NumberFormatConfig;
  rows: ClassifiedRow[];
  items: ClassifiedRow[];
  counts: Record<ImportRowKind, number>;
  total: number;
  ambiguous: ClassifiedRow[];
  ambiguousNumberCount: number;
  ambiguousVolumeCount: number;
  ambiguousMoneyCount: number;
  unreadableSubtotalCount: number;
  problems: ImportProblem[];
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
const STRUCTURAL_DESCRIPTION_PATTERN =
  /^(?:(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\.?\s+|[A-Z]\.\s+|[A-Z]\.\d+(?:\.\d+)*\s+)\S/;

function labelOf(code: string, description: string): string {
  if (code && description) return `${code} ${description}`.replace(/\s+/g, " ").trim();
  return code || description;
}

function isNumericRow(volume: number | null, unitPrice: number | null): boolean {
  return volume !== null && unitPrice !== null;
}

function hasStructuralHeadingCode(code: string, description: string): boolean {
  if (
    ROMAN_PATTERN.test(code) ||
    LETTER_PATTERN.test(code) ||
    LETTER_DOT_PATTERN.test(code) ||
    LETTER_NUMBER_PATTERN.test(code)
  ) {
    return true;
  }
  return !code && STRUCTURAL_DESCRIPTION_PATTERN.test(description);
}

function hasNonDashUnit(rawUnit: unknown): boolean {
  if (rawUnit === null || rawUnit === undefined) return false;
  const text = String(rawUnit).trim();
  return text !== "" && !isBareDash(text);
}

/**
 * Apakah baris tampak seperti percobaan baris item (memiliki data volume/harga,
 * satuan item, atau nilai pada kolom Jumlah Harga yang dipetakan) yang bukan
 * judul struktural bergaris datar ("-")?
 */
function isAttemptedItemRow(
  code: string,
  description: string,
  rawVolume: unknown,
  rawPrice: unknown,
  rawUnit: unknown,
  volumeResult: ParsedNumberResult,
  priceResult: ParsedNumberResult,
  rawAmount: unknown = null,
  amountResult?: ParsedNumberResult,
): boolean {
  const structural = hasStructuralHeadingCode(code, description);
  const hasUnit = hasNonDashUnit(rawUnit);
  const volumeEmptyOrDash = volumeResult.status === "empty" || isBareDash(rawVolume);
  const priceEmptyOrDash = priceResult.status === "empty" || isBareDash(rawPrice);

  // Judul struktural yang menaruh "-" pada kolom volume/harga kosong tidak
  // dianggap item bermasalah.
  const isStructuralDashHeading =
    structural &&
    !hasUnit &&
    volumeEmptyOrDash &&
    priceEmptyOrDash &&
    (isBareDash(rawVolume) || isBareDash(rawPrice));

  if (isStructuralDashHeading) return false;

  if (volumeResult.status !== "empty" || priceResult.status !== "empty") {
    return true;
  }

  const hasAmountSignal =
    amountResult !== undefined &&
    amountResult.status !== "empty" &&
    !isBareDash(rawAmount);

  return !structural && (hasUnit || hasAmountSignal);
}

function describeNumberProblem(
  fieldLabel: string,
  result: ParsedNumberResult,
  mode: NumberFormatMode,
  role: NumericFieldRole,
): string {
  if (result.status === "empty") return `${fieldLabel} kosong`;
  if (result.status === "negative") {
    return `${fieldLabel} tidak boleh negatif ("${result.raw}")`;
  }
  if (result.status === "ambiguous") {
    const selectorName =
      role === "volume"
        ? "Format angka teks — Volume"
        : "Format angka teks — Harga & Jumlah";
    return `${fieldLabel} "${result.raw}" ambigu (pemisah ribuan/desimal tidak jelas — pilih ${selectorName} atau ubah menjadi sel angka di Excel)`;
  }

  const looksNumericOnly =
    /^(?:rp\.?|idr)?\s*[0-9.,\s-]+(?:\s+idr)?$/i.test(result.raw) && /\d/.test(result.raw);
  if (mode !== "auto" && looksNumericOnly) {
    const modeLabel =
      mode === "id-ID" ? "Indonesia (1.234,56)" : "Internasional (1,234.56)";
    return `${fieldLabel} "${result.raw}" tidak sesuai format ${modeLabel}`;
  }

  return `${fieldLabel} "${result.raw}" bukan angka yang valid`;
}

/**
 * Baca nilai moneter pada baris subtotal/total menggunakan format moneter.
 * Bila kolom Jumlah Harga dipetakan dan berisi teks ambigu/error/negatif,
 * hasilnya dipertahankan apa adanya agar tidak diam-diam diabaikan atau
 * tertimpa angka dari kolom lain (mis. kolom No).
 */
function inspectSubtotalValue(
  row: unknown[],
  mapping: ColumnMapping,
  codeColumn: number | null,
  amountResult: ParsedNumberResult,
  moneyFormat: NumberFormatMode,
): ParsedNumberResult {
  if (mapping.amount !== null && amountResult.status !== "empty") {
    return amountResult;
  }

  const skipColumns = new Set<number>();
  if (codeColumn !== null) skipColumns.add(codeColumn);
  if (mapping.description !== null) skipColumns.add(mapping.description);
  if (mapping.unit !== null) skipColumns.add(mapping.unit);

  for (let column = row.length - 1; column >= 0; column -= 1) {
    if (skipColumns.has(column)) continue;
    const cell = row[column];
    if (isBareDash(cell)) continue;
    const result = inspectSpreadsheetNumber(cell, moneyFormat);
    if (result.status !== "empty") {
      return result;
    }
  }

  return { status: "empty", value: null, raw: "" };
}

/** Nilai sel pada kolom tertentu; `null` bila kolom tidak dipetakan. */
function cellAt(row: unknown[], index: number | null): unknown {
  if (index === null) return null;
  return row[index] ?? null;
}

/**
 * Label cadangan dari kolom teks tak terpetakan di sebelah kiri kolom uraian
 * (mis. baris subtotal/total ter-merge A:E yang teksnya berada di kolom A saat
 * `codeColumn` tidak terdeteksi). Kolom di sebelah kanan uraian (mis. kolom
 * catatan) tidak dipindai agar teks tak terkait tidak memicu klasifikasi total.
 */
export function fallbackMergedLabel(
  row: unknown[],
  mapping: ColumnMapping,
  codeColumn: number | null,
): string {
  const mapped = new Set<number>();
  if (codeColumn !== null) mapped.add(codeColumn);
  for (const column of Object.values(mapping)) {
    if (column !== null) mapped.add(column);
  }

  const limit =
    mapping.description !== null
      ? Math.min(mapping.description, row.length)
      : row.length;

  for (let column = 0; column < limit; column += 1) {
    if (mapped.has(column)) continue;
    const text = String(row[column] ?? "").trim();
    if (text) return text;
  }

  return "";
}

/**
 * Ada baris item (valid maupun bermasalah/ambigu) di depan?
 *
 * Dipakai membedakan **total seksi** (dokumen masih berlanjut) dari **rekap
 * akhir** (tidak ada item lagi setelah baris total).
 */
function hasItemAhead(
  matrix: unknown[][],
  mapping: ColumnMapping,
  fromIndex: number,
  codeColumn: number | null,
  numberFormats: NumberFormatConfig,
  lookahead = 100,
): boolean {
  const limit = Math.min(matrix.length, fromIndex + 1 + lookahead);

  for (let index = fromIndex + 1; index < limit; index += 1) {
    const row = matrix[index] ?? [];
    const code = codeColumn === null ? "" : String(row[codeColumn] ?? "").trim();
    const description = String(cellAt(row, mapping.description) ?? "").trim();
    const rawVolume = cellAt(row, mapping.volume);
    const rawPrice = cellAt(row, mapping.unitPrice);
    const rawUnit = cellAt(row, mapping.unit);
    const volumeResult = inspectSpreadsheetNumber(rawVolume, numberFormats.volume);
    const priceResult = inspectSpreadsheetNumber(rawPrice, numberFormats.money);
    const baseLabel = `${code} ${description}`.replace(/\s+/g, " ").trim();
    const label =
      baseLabel ||
      (volumeResult.status !== "ok" && priceResult.status !== "ok"
        ? fallbackMergedLabel(row, mapping, codeColumn)
        : "");
    if (
      TOTAL_PATTERN.test(label) ||
      SUBTOTAL_PATTERN.test(label) ||
      ADMIN_PATTERN.test(label)
    ) {
      continue;
    }

    if (volumeResult.status === "ok" && priceResult.status === "ok") return true;
    if (
      isAttemptedItemRow(
        code,
        description,
        rawVolume,
        rawPrice,
        rawUnit,
        volumeResult,
        priceResult,
      )
    ) {
      return true;
    }
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
  /** Format angka teks: satu mode untuk semua kolom, atau terpisah untuk volume dan moneter. */
  numberFormat?: NumberFormatMode | Partial<NumberFormatConfig>;
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
  const numberFormat = resolveNumberFormatConfig(options.numberFormat);
  const { usesSecondRow } = resolveHeader(matrix, headerRowIndex);
  const codeColumn =
    options.codeColumn !== undefined
      ? options.codeColumn
      : detectCodeColumn(matrix, Math.max(headerRowIndex, 0), mapping);

  const rows: ClassifiedRow[] = [];
  const problems: ImportProblem[] = [];
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
    const volumeResult = inspectSpreadsheetNumber(rawVolume, numberFormat.volume);
    const priceResult = inspectSpreadsheetNumber(rawPrice, numberFormat.money);
    const amountResult = inspectSpreadsheetNumber(rawAmount, numberFormat.money);
    const volume = volumeResult.status === "ok" ? volumeResult.value : null;
    const unitPrice = priceResult.status === "ok" ? priceResult.value : null;
    const fileAmount = amountResult.status === "ok" ? amountResult.value : null;

    const mappedCells = [code, description, rawVolume, rawPrice, rawUnit, rawAmount];
    const isEmpty = mappedCells.every(
      (cell) => cell === null || cell === undefined || String(cell).trim() === "",
    );

    if (isEmpty) {
      skipped.push({ rowNumber, reason: "Baris kosong" });
      continue;
    }

    const baseLabel = `${code} ${description}`.replace(/\s+/g, " ").trim();
    const label =
      baseLabel ||
      (volume === null && unitPrice === null
        ? fallbackMergedLabel(row, mapping, codeColumn)
        : "");
    const override = overrides[rowNumber];
    const attemptedItem = isAttemptedItemRow(
      code,
      description,
      rawVolume,
      rawPrice,
      rawUnit,
      volumeResult,
      priceResult,
      rawAmount,
      amountResult,
    );

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
    } else if (attemptedItem) {
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
      if (!hasItemAhead(matrix, mapping, index, codeColumn, numberFormat)) {
        recapFrom = rowNumber + 1;
      }
    }

    const unitInfo = normalizeSpreadsheetUnit(rawUnit);
    const reasons: string[] = [];

    if (kind === "item" && (volume === null || unitPrice === null)) {
      kind = "problem";
    }

    if (kind === "problem") {
      if (volume === null) {
        reasons.push(
          describeNumberProblem("Volume", volumeResult, numberFormat.volume, "volume"),
        );
      }
      if (unitPrice === null) {
        reasons.push(
          describeNumberProblem("Harga satuan", priceResult, numberFormat.money, "money"),
        );
      }
      if (
        volumeResult.status === "empty" &&
        priceResult.status === "empty" &&
        amountResult.status !== "empty" &&
        !isBareDash(rawAmount)
      ) {
        reasons.push(
          amountResult.status === "ok"
            ? `Jumlah harga ("${amountResult.raw}") diisi tanpa volume dan harga satuan`
            : describeNumberProblem("Jumlah harga", amountResult, numberFormat.money, "money"),
        );
      }
      if (!description) {
        reasons.push("Uraian pekerjaan kosong");
      }
    }

    if (kind === "item" && !description) {
      kind = "problem";
      reasons.push("Uraian pekerjaan kosong");
    }

    if (kind === "problem") {
      const hasAmbiguousVolume = volumeResult.status === "ambiguous";
      const hasAmbiguousPrice = priceResult.status === "ambiguous";
      problems.push({
        rowNumber,
        description: label,
        reasons,
        hasAmbiguousNumber: hasAmbiguousVolume || hasAmbiguousPrice,
        hasAmbiguousVolume,
        hasAmbiguousPrice,
      });
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
      const subtotalResult = inspectSubtotalValue(
        row,
        mapping,
        codeColumn,
        amountResult,
        numberFormat.money,
      );
      const fileValue = subtotalResult.status === "ok" ? subtotalResult.value : null;

      // Cakupan pembanding mengikuti jenis barisnya:
      //  - subtotal lokal  → item dalam blok sejak subtotal sebelumnya;
      //  - total seksi     → seluruh item dalam seksi (sejak GROUP terakhir);
      //  - total dokumen   → seluruh item biaya sejauh ini.
      let scope: SubtotalCheck["scope"];
      let computedValue: number;

      if (kind === "total") {
        if (fileValue === null) {
          const isFinalTotal = recapFrom !== null || sectionSum === 0;
          scope = isFinalTotal ? "document" : "section";
          computedValue = isFinalTotal ? documentSum : sectionSum;
        } else {
          const useSection =
            Math.abs(fileValue - sectionSum) <= Math.abs(fileValue - documentSum);
          scope = useSection ? "section" : "document";
          computedValue = useSection ? sectionSum : documentSum;
        }
      } else {
        scope = "block";
        computedValue = sinceSubtotal;
      }

      subtotalChecks.push({
        rowNumber,
        label,
        fileValue,
        fileStatus: subtotalResult.status,
        fileRaw: subtotalResult.raw,
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
  const ambiguousVolumeCount = problems.filter((p) => p.hasAmbiguousVolume).length;
  const ambiguousSubtotalCount = subtotalChecks.filter(
    (check) => check.fileStatus === "ambiguous",
  ).length;
  const ambiguousMoneyCount =
    problems.filter((p) => p.hasAmbiguousPrice).length + ambiguousSubtotalCount;
  const unreadableSubtotalCount = subtotalChecks.filter(isUnreadableSubtotalCheck).length;

  return {
    headerRowNumber: headerRowIndex + 1,
    usesSecondHeaderRow: usesSecondRow,
    codeColumn,
    numberFormat,
    rows,
    items,
    counts,
    total: items.reduce((sum, row) => sum + (row.amount ?? 0), 0),
    ambiguous: rows.filter((row) => row.ambiguous),
    ambiguousNumberCount:
      problems.filter((problem) => problem.hasAmbiguousNumber).length +
      ambiguousSubtotalCount,
    ambiguousVolumeCount,
    ambiguousMoneyCount,
    unreadableSubtotalCount,
    problems,
    notes,
    subtotalChecks,
    skipped,
    truncated,
    structure: buildStructureTree(items),
  };
}

export interface ImportGuardState {
  canReview: boolean;
  canImport: boolean;
  requiresPartialConfirmation: boolean;
  validItemCount: number;
  problemRowCount: number;
}

/**
 * Status keamanan sebelum mengeksekusi import:
 * - Langkah tinjauan selalu dapat dibuka bila pemetaan lengkap, termasuk saat
 *   0 item valid agar pengguna dapat memeriksa seluruh error.
 * - Bila item valid dan baris bermasalah muncul bersamaan, konfirmasi eksplisit
 *   pengguna wajib sebelum mengimpor item yang valid saja.
 * - Bila 0 item valid, impor akhir tetap nonaktif.
 */
export function evaluateImportGuard(
  plan: ImportPlan | null,
  confirmedPartialImport: boolean,
): ImportGuardState {
  if (!plan) {
    return {
      canReview: false,
      canImport: false,
      requiresPartialConfirmation: false,
      validItemCount: 0,
      problemRowCount: 0,
    };
  }

  const validItemCount = plan.items.length;
  const problemRowCount = plan.problems.length;
  const requiresPartialConfirmation = validItemCount > 0 && problemRowCount > 0;
  const canImport =
    validItemCount > 0 && (!requiresPartialConfirmation || confirmedPartialImport);

  return {
    canReview: true,
    canImport,
    requiresPartialConfirmation,
    validItemCount,
    problemRowCount,
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
    decode_range: (range: string) => {
      s: { r: number; c: number };
      e: { r: number; c: number };
    };
    decode_cell: (address: string) => { r: number; c: number };
  };
}

const EXCEL_ERROR_CODES: Record<number, string> = {
  0x00: "#NULL!",
  0x07: "#DIV/0!",
  0x0f: "#VALUE!",
  0x17: "#REF!",
  0x1d: "#NAME?",
  0x24: "#NUM!",
  0x2a: "#N/A",
};

function formatExcelErrorCell(cell: { w?: unknown; v?: unknown }): string {
  if (typeof cell.w === "string" && cell.w.trim() !== "") return cell.w.trim();
  if (typeof cell.v === "number" && cell.v in EXCEL_ERROR_CODES) {
    return EXCEL_ERROR_CODES[cell.v];
  }
  return "#ERROR!";
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
    const worksheet = workbook.Sheets[name] as Record<string, unknown> | undefined;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const limited = matrix.slice(0, MAX_SHEET_ROWS);

    // `sheet_to_json(..., { raw: true })` mengubah sel error rumus (`t: "e"`,
    // mis. #DIV/0!, #REF!, #VALUE!) menjadi `null`. Pulihkan teks errornya agar
    // baris bermasalah tetap terdeteksi sebagai invalid, bukan kosong.
    const ref = worksheet && typeof worksheet["!ref"] === "string" ? worksheet["!ref"] : null;
    if (worksheet && ref) {
      const range = XLSX.utils.decode_range(ref);
      for (const [address, rawCell] of Object.entries(worksheet)) {
        if (address.startsWith("!")) continue;
        const cell = rawCell as { t?: unknown; v?: unknown; w?: unknown } | null;
        if (!cell || cell.t !== "e") continue;
        const pos = XLSX.utils.decode_cell(address);
        const rowIndex = pos.r - range.s.r;
        const colIndex = pos.c - range.s.c;
        if (rowIndex < 0 || rowIndex >= limited.length || colIndex < 0) continue;
        const targetRow = limited[rowIndex];
        if (!targetRow) continue;
        targetRow[colIndex] = formatExcelErrorCell(cell);
      }
    }

    sheets[name] = limited;

    if (
      !hasData &&
      limited.some((row) =>
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
