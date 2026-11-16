import { calculateItemAmount, calculateRabTotal } from "./rab-calc";
import { formatDate } from "./format";
import {
  companyContactLine,
  companyProfile,
  type CompanyProfile,
} from "./profile";
import { buildDisplayRows } from "./rab-hierarchy";
import type { RabDocumentDetail, RabWorkItem } from "../types";

/**
 * Ekspor RAB ke Excel (.xlsx).
 *
 * Struktur baris memakai `buildDisplayRows()` — sumber yang sama dengan editor
 * dan PDF — sehingga heading kelompok, urutan item, dan cakupan subtotal selalu
 * konsisten. Nilai volume, harga, jumlah, subtotal, dan grand total ditulis
 * sebagai angka (bukan rumus) agar hasil saat dibuka persis sama dengan total
 * aplikasi dan tidak ada risiko subtotal bertingkat terhitung dua kali.
 */

const SHEET_NAME = "RAB";

const COLOR = {
  navy: "FF21375C",
  navySoft: "FFDEE7F3",
  light: "FFF1F5F9",
  lighter: "FFF7FAFC",
  border: "FFCBD5E1",
  text: "FF1E293B",
  muted: "FF64748B",
  white: "FFFFFFFF",
};

const BORDER_THIN = {
  top: { style: "thin", color: { rgb: COLOR.border } },
  bottom: { style: "thin", color: { rgb: COLOR.border } },
  left: { style: "thin", color: { rgb: COLOR.border } },
  right: { style: "thin", color: { rgb: COLOR.border } },
} as const;

const MONEY_FORMAT = "#,##0.##";
// Presisi volume mengikuti nilai tersimpan (hingga 6 desimal); trailing zero
// disembunyikan Excel, jadi 0,9375 tetap terbaca 0,9375.
const VOLUME_FORMAT = "#,##0.######";

const COLUMNS = [
  { wch: 6 },
  { wch: 52 },
  { wch: 12 },
  { wch: 13 },
  { wch: 18 },
  { wch: 20 },
];

/** `RAB_Renovasi_Rumah_2026.xlsx` */
export function rabExcelFileName(detail: RabDocumentDetail): string {
  const source = detail.projectName || detail.title || "RAB";
  const slug = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  const yearSource = detail.date || detail.createdAt || "";
  const year = yearSource.slice(0, 4);
  const yearPart = /^\d{4}$/.test(year)
    ? year
    : String(new Date().getFullYear());

  return `RAB_${slug || "Dokumen"}_${yearPart}.xlsx`;
}

export interface RabExcelOptions {
  /** Disiapkan untuk pengujian: mengembalikan buffer, bukan mengunduh. */
  buffer?: boolean;
}

export interface XlsxModule {
  utils: {
    aoa_to_sheet: (rows: unknown[][]) => Record<string, unknown>;
    book_new: () => Record<string, unknown>;
    book_append_sheet: (
      workbook: Record<string, unknown>,
      sheet: Record<string, unknown>,
      name: string,
    ) => void;
  };
  write: (workbook: Record<string, unknown>, options: Record<string, unknown>) => ArrayBuffer;
  writeFile: (workbook: Record<string, unknown>, filename: string) => void;
}

export async function loadXlsx(): Promise<XlsxModule> {
  const loaded = await import("xlsx-js-style");
  const candidate = (loaded as unknown as { default?: XlsxModule }).default;
  if (candidate && typeof candidate.write === "function") return candidate;
  return loaded as unknown as XlsxModule;
}

export interface CellStyle {
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  border?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
}

export function styleCell(
  sheet: Record<string, unknown>,
  address: string,
  style: CellStyle,
  extra: Record<string, unknown> = {},
) {
  const current = (sheet[address] as Record<string, unknown> | undefined) ?? {
    t: "s",
    v: "",
  };
  sheet[address] = { ...current, s: style, ...extra };
}

/** Kedalaman indentasi uraian item mengikuti konteks hierarkinya. */
function itemIndent(item: RabWorkItem): number {
  if (item.itemGroupName) return 3;
  if (item.subgroupName) return 2;
  if (item.groupName) return 1;
  return 0;
}

/**
 * Rentang sel F yang hanya berisi baris item (dipadatkan bila berurutan).
 *
 * Dipakai agar subtotal/total hanya menjumlahkan item pada cakupannya — tidak
 * pernah menjumlahkan baris subtotal lain, sehingga tidak ada penghitungan dua
 * kali.
 */
function itemRanges(rows: number[]): string {
  if (rows.length === 0) return "";
  const parts: string[] = [];
  let start = rows[0];
  let previous = rows[0];

  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index] === previous + 1) {
      previous = rows[index];
      continue;
    }
    parts.push(start === previous ? `F${start}` : `F${start}:F${previous}`);
    start = rows[index];
    previous = rows[index];
  }
  parts.push(start === previous ? `F${start}` : `F${start}:F${previous}`);

  return parts.join(",");
}

type TableRow =
  | { kind: "heading"; level: 0 | 1 | 2; label: string }
  | { kind: "item"; number: number; item: RabWorkItem }
  | { kind: "subtotal"; level: 0 | 1 | 2; label: string; amount: number }
  | { kind: "grand_total"; label: string; amount: number };

export interface RabExcelHeaderLayout {
  /** Baris kop sampai header tabel (belum termasuk data). */
  rows: unknown[][];
  titleRow: number;
  nameRow: number | null;
  contactRow: number | null;
  projectRow: number;
  clientRow: number;
  locationRow: number;
  /** Baris header tabel (1-based). */
  headerRow: number;
  /** Baris pertama data setelah header tabel. */
  firstTableRow: number;
}

/**
 * Susun kop Excel dari identitas yang benar-benar diisi pengguna.
 *
 * Baris nama/kontak yang kosong tidak ditulis sama sekali sehingga tidak ada
 * baris kosong atau pemisah `·` menggantung. Posisi header tabel dihitung dari
 * jumlah baris aktual agar style, merge, freeze pane, dan formula tetap tepat.
 */
export function buildRabExcelHeader(
  detail: RabDocumentDetail,
  profile: CompanyProfile,
): RabExcelHeaderLayout {
  const name = profile.name.trim();
  const contact = companyContactLine(profile);
  const rows: unknown[][] = [["RENCANA ANGGARAN BIAYA"]];

  const nameRow = name ? rows.push([name]) : null;
  const contactRow = contact ? rows.push([contact]) : null;
  rows.push([]);
  const projectRow = rows.push([
    "Proyek",
    detail.projectName,
    "",
    "No. Dokumen",
    detail.number,
  ]);
  const clientRow = rows.push([
    "Klien",
    detail.client || "—",
    "",
    "Tanggal",
    formatDate(detail.date || detail.createdAt),
  ]);
  const locationRow = rows.push(["Lokasi", detail.location || "—"]);
  rows.push([]);
  rows.push([
    "No",
    "Uraian Pekerjaan",
    "Volume",
    "Satuan",
    "Harga Satuan",
    "Jumlah Harga",
  ]);

  return {
    rows,
    titleRow: 1,
    nameRow,
    contactRow,
    projectRow,
    clientRow,
    locationRow,
    headerRow: rows.length,
    firstTableRow: rows.length + 1,
  };
}

/**
 * Susun workbook RAB.
 *
 * Baris tabel: heading GROUP/SUBGROUP/ITEM GROUP, item bernomor, subtotal tiap
 * section, lalu GRAND TOTAL. Semua angka ditulis sebagai nilai numerik.
 */
export async function buildRabWorkbook(
  detail: RabDocumentDetail,
  profile: CompanyProfile = companyProfile,
): Promise<Record<string, unknown>> {
  const XLSX = await loadXlsx();

  const header = buildRabExcelHeader(detail, profile);
  const headerRow = header.headerRow;
  const firstTableRow = header.firstTableRow;

  const total = calculateRabTotal(detail.items);
  const displayRows = buildDisplayRows(detail.items);

  const table: TableRow[] = [];
  for (const row of displayRows) {
    if (row.kind === "heading") {
      table.push({ kind: "heading", level: row.depth, label: row.label });
    } else if (row.kind === "subtotal") {
      table.push({
        kind: "subtotal",
        level: row.depth,
        label: row.label,
        amount: row.amount,
      });
    } else {
      table.push({
        kind: "item",
        number: row.number,
        item: row.item,
      });
    }
  }
  table.push({ kind: "grand_total", label: "GRAND TOTAL", amount: total });

  // Baris item per cakupan (untuk formula SUM yang tidak menghitung subtotal).
  const subtotalItemRows = new Map<number, number[]>();
  const allItemRows: number[] = [];
  const scopes: { level: number; items: number[] }[] = [];

  table.forEach((row, index) => {
    const excelRow = firstTableRow + index;

    if (row.kind === "heading") {
      while (scopes.length > 0 && scopes[scopes.length - 1].level >= row.level) {
        scopes.pop();
      }
      scopes.push({ level: row.level, items: [] });
      return;
    }

    if (row.kind === "item") {
      allItemRows.push(excelRow);
      for (const scope of scopes) scope.items.push(excelRow);
      return;
    }

    if (row.kind === "subtotal") {
      while (scopes.length > 0 && scopes[scopes.length - 1].level > row.level) {
        scopes.pop();
      }
      const scope = scopes.pop();
      subtotalItemRows.set(index, scope?.items ?? []);
    }
  });

  const grandTotalRows = itemRanges(allItemRows);

  const headerRows = header.rows;

  const rows: unknown[][] = [...headerRows];

  for (const row of table) {
    if (row.kind === "heading") {
      rows.push([row.label, "", "", "", "", ""]);
    } else if (row.kind === "subtotal") {
      rows.push([row.label, "", "", "", "", row.amount]);
    } else if (row.kind === "grand_total") {
      rows.push([row.label, "", "", "", "", row.amount]);
    } else {
      rows.push([
        row.number,
        row.item.description || "Tanpa uraian",
        row.item.volume,
        row.item.unit,
        row.item.unitPrice,
        calculateItemAmount(row.item),
      ]);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);

  const bodyFont: CellStyle["font"] = { sz: 10, color: { rgb: COLOR.text } };
  const bodyBorder = BORDER_THIN;
  const leftWrap: CellStyle["alignment"] = {
    horizontal: "left",
    vertical: "center",
    wrapText: true,
  };
  const right: CellStyle["alignment"] = {
    horizontal: "right",
    vertical: "center",
  };
  const center: CellStyle["alignment"] = {
    horizontal: "center",
    vertical: "center",
  };

  /* --- Kop & identitas -------------------------------------------------- */
  styleCell(sheet, "A1", {
    font: { bold: true, sz: 15, color: { rgb: COLOR.navy } },
    alignment: { horizontal: "center", vertical: "center" },
  });
  if (header.nameRow) {
    styleCell(sheet, `A${header.nameRow}`, {
      font: { bold: true, sz: 11, color: { rgb: COLOR.text } },
    });
  }
  if (header.contactRow) {
    styleCell(sheet, `A${header.contactRow}`, {
      font: { sz: 9, color: { rgb: COLOR.muted } },
    });
  }

  for (const address of [
    `A${header.projectRow}`,
    `D${header.projectRow}`,
    `A${header.clientRow}`,
    `D${header.clientRow}`,
    `A${header.locationRow}`,
  ]) {
    styleCell(sheet, address, {
      font: { bold: true, sz: 10, color: { rgb: COLOR.muted } },
    });
  }
  for (const address of [
    `B${header.projectRow}`,
    `B${header.clientRow}`,
    `B${header.locationRow}`,
    `E${header.projectRow}`,
    `E${header.clientRow}`,
  ]) {
    styleCell(sheet, address, { font: { sz: 10, color: { rgb: COLOR.text } } });
  }

  /* --- Header tabel ------------------------------------------------------ */
  for (const column of ["A", "B", "C", "D", "E", "F"]) {
    styleCell(sheet, `${column}${headerRow}`, {
      font: { bold: true, sz: 10, color: { rgb: COLOR.white } },
      fill: { patternType: "solid", fgColor: { rgb: COLOR.navy } },
      border: bodyBorder,
      alignment: {
        horizontal: "center",
        vertical: "center",
        wrapText: true,
      },
    });
  }

  /* --- Baris tabel ------------------------------------------------------- */
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const mergeFullRow = (row: number) => {
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 5 } });
  };

  mergeFullRow(header.titleRow);
  if (header.nameRow) mergeFullRow(header.nameRow);
  if (header.contactRow) mergeFullRow(header.contactRow);
  for (const row of [header.projectRow, header.clientRow]) {
    merges.push({ s: { r: row - 1, c: 1 }, e: { r: row - 1, c: 2 } });
    merges.push({ s: { r: row - 1, c: 4 }, e: { r: row - 1, c: 5 } });
  }
  merges.push({
    s: { r: header.locationRow - 1, c: 1 },
    e: { r: header.locationRow - 1, c: 5 },
  });

  const rowHeights: { hpt?: number }[] = Array.from(
    { length: headerRow },
    () => ({}),
  );
  rowHeights[0] = { hpt: 24 };
  rowHeights[headerRow - 1] = { hpt: 26 };

  table.forEach((row, index) => {
    const excelRow = firstTableRow + index;
    const rowIndex = excelRow - 1;

    if (row.kind === "heading") {
      const fill =
        row.level === 0 ? COLOR.navy : row.level === 1 ? COLOR.navySoft : COLOR.light;
      const fontColor = row.level === 0 ? COLOR.white : COLOR.text;
      const style: CellStyle = {
        font: { bold: true, sz: row.level === 0 ? 11 : 10, color: { rgb: fontColor } },
        fill: { patternType: "solid", fgColor: { rgb: fill } },
        border: bodyBorder,
        alignment: {
          horizontal: "left",
          vertical: "center",
          indent: row.level,
        },
      };
      for (const column of ["A", "B", "C", "D", "E", "F"]) {
        styleCell(sheet, `${column}${excelRow}`, style);
      }
      merges.push({
        s: { r: rowIndex, c: 0 },
        e: { r: rowIndex, c: 5 },
      });
      rowHeights[rowIndex] = { hpt: row.level === 0 ? 24 : 21 };
      return;
    }

    if (row.kind === "subtotal") {
      const fill =
        row.level === 0 ? COLOR.navySoft : row.level === 1 ? COLOR.light : COLOR.lighter;
      const style: CellStyle = {
        font: {
          bold: row.level <= 1,
          sz: row.level === 0 ? 10 : 9.5,
          color: { rgb: row.level === 2 ? COLOR.muted : COLOR.text },
        },
        fill: { patternType: "solid", fgColor: { rgb: fill } },
        border: bodyBorder,
      };
      for (const column of ["A", "B", "C", "D", "E"]) {
        styleCell(sheet, `${column}${excelRow}`, {
          ...style,
          alignment: right,
        });
      }
      styleCell(
        sheet,
        `F${excelRow}`,
        { ...style, alignment: right },
        (() => {
          const ranges = itemRanges(subtotalItemRows.get(index) ?? []);
          return ranges
            ? { t: "n", f: `SUM(${ranges})`, v: row.amount, z: MONEY_FORMAT }
            : { t: "n", v: row.amount, z: MONEY_FORMAT };
        })(),
      );
      merges.push({
        s: { r: rowIndex, c: 0 },
        e: { r: rowIndex, c: 4 },
      });
      rowHeights[rowIndex] = { hpt: 17 };
      return;
    }

    if (row.kind === "grand_total") {
      const style: CellStyle = {
        font: { bold: true, sz: 11, color: { rgb: COLOR.white } },
        fill: { patternType: "solid", fgColor: { rgb: COLOR.navy } },
        border: bodyBorder,
        alignment: right,
      };
      for (const column of ["A", "B", "C", "D", "E"]) {
        styleCell(sheet, `${column}${excelRow}`, style);
      }
      styleCell(
        sheet,
        `F${excelRow}`,
        style,
        grandTotalRows
          ? { t: "n", f: `SUM(${grandTotalRows})`, v: row.amount, z: MONEY_FORMAT }
          : { t: "n", v: row.amount, z: MONEY_FORMAT },
      );
      merges.push({
        s: { r: rowIndex, c: 0 },
        e: { r: rowIndex, c: 4 },
      });
      rowHeights[rowIndex] = { hpt: 24 };
      return;
    }

    const item = row.item;
    const amount = calculateItemAmount(item);

    const base: CellStyle = {
      border: bodyBorder,
      font: bodyFont,
    };

    styleCell(sheet, `A${excelRow}`, { ...base, alignment: center });
    styleCell(sheet, `B${excelRow}`, {
      ...base,
      alignment: { ...leftWrap, indent: Math.min(itemIndent(item), 3) },
    });
    styleCell(
      sheet,
      `C${excelRow}`,
      { ...base, alignment: right },
      { t: "n", v: item.volume, z: VOLUME_FORMAT },
    );
    styleCell(sheet, `D${excelRow}`, { ...base, alignment: center });
    styleCell(
      sheet,
      `E${excelRow}`,
      { ...base, alignment: right },
      { t: "n", v: item.unitPrice, z: MONEY_FORMAT },
    );
    styleCell(
      sheet,
      `F${excelRow}`,
      {
        ...base,
        font: { ...bodyFont, bold: true },
        alignment: right,
      },
      { t: "n", f: `C${excelRow}*E${excelRow}`, v: amount, z: MONEY_FORMAT },
    );

    const lines = Math.ceil((item.description?.length ?? 0) / 52) || 1;
    rowHeights[rowIndex] = { hpt: Math.max(18, Math.min(lines, 20) * 13) };
  });

  sheet["!cols"] = COLUMNS;
  sheet["!merges"] = merges;
  sheet["!rows"] = rowHeights;
  // Margin cetak; orientasi/freeze pane tidak didukung penulis xlsx-js-style.
  sheet["!margins"] = {
    left: 0.4,
    right: 0.4,
    top: 0.6,
    bottom: 0.6,
    header: 0.3,
    footer: 0.3,
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);

  return workbook;
}

/* -------------------------------------------------------------------------- */
/*  Post-processing XML: freeze pane & pengaturan cetak                        */
/* -------------------------------------------------------------------------- */

/**
 * `xlsx-js-style` tidak menulis pane beku maupun `pageSetup`, jadi XML sheet
 * dipatch setelah workbook ditulis.
 *
 * ZIP ditangani `fflate` yang sudah tersedia sebagai dependency `jspdf` —
 * tidak ada dependency baru yang ditambahkan ke proyek.
 */
function patchSheetXml(
  xml: string,
  headerRow: number,
  firstTableRow: number,
): string {
  let output = xml;

  // fitToPage wajib agar fitToWidth dipakai saat mencetak.
  if (!output.includes("<sheetPr")) {
    output = output.replace(
      /(<worksheet[^>]*>)/,
      '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
    );
  }

  const frozenViews =
    '<sheetViews><sheetView workbookViewId="0">' +
    `<pane xSplit="0" ySplit="${headerRow}" topLeftCell="A${firstTableRow}" ` +
    'activePane="bottomLeft" state="frozen"/>' +
    `<selection pane="bottomLeft" activeCell="A${firstTableRow}" ` +
    `sqref="A${firstTableRow}"/></sheetView></sheetViews>`;

  if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(output)) {
    output = output.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, frozenViews);
  } else {
    output = output.replace("</worksheet>", `${frozenViews}</worksheet>`);
  }

  // Elemen akhir worksheet harus mengikuti urutan schema ECMA-376:
  // mergeCells → printOptions → pageMargins → pageSetup → ignoredErrors.
  // `xlsx-js-style` menulis mergeCells/ignoredErrors, sedangkan printOptions
  // dan pageSetup kita tambahkan; tanpa pengurutan ulang Excel menolak sheet.
  const mergeCells = output.match(/<mergeCells[\s\S]*?<\/mergeCells>/)?.[0] ?? "";
  const ignoredErrors =
    output.match(/<ignoredErrors[\s\S]*?<\/ignoredErrors>/)?.[0] ?? "";
  const pageMargins =
    output.match(/<pageMargins[^>]*\/>/)?.[0] ??
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';

  output = output
    .replace(/<mergeCells[\s\S]*?<\/mergeCells>/g, "")
    .replace(/<ignoredErrors[\s\S]*?<\/ignoredErrors>/g, "")
    .replace(/<printOptions[^>]*\/>/g, "")
    .replace(/<pageSetup[^>]*\/>/g, "")
    .replace(/<pageMargins[^>]*\/>/g, "");

  const trailing = [
    mergeCells,
    '<printOptions horizontalCentered="0"/>',
    pageMargins,
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
    ignoredErrors,
  ]
    .filter(Boolean)
    .join("");

  if (output.includes("</sheetData>")) {
    output = output.replace("</sheetData>", `</sheetData>${trailing}`);
  } else if (output.includes("<sheetData/>")) {
    output = output.replace("<sheetData/>", `<sheetData/>${trailing}`);
  } else {
    output = output.replace("</worksheet>", `${trailing}</worksheet>`);
  }

  return output;
}

/** Header tabel diulang saat dicetak + paksa hitung ulang saat dibuka. */
function patchWorkbookXml(
  xml: string,
  sheetName: string,
  headerRow: number,
): string {
  let output = xml;

  if (!output.includes("_xlnm.Print_Titles")) {
    const defined =
      '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">' +
      `${sheetName}!$${headerRow}:$${headerRow}</definedName></definedNames>`;

    output = output.includes("<calcPr")
      ? output.replace("<calcPr", `${defined}<calcPr`)
      : output.replace("</workbook>", `${defined}</workbook>`);
  }

  if (/<calcPr[^>]*\/>/.test(output)) {
    output = output.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
  } else if (!output.includes("<calcPr")) {
    output = output.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
  }

  return output;
}

export interface SheetSetupOptions {
  sheetName: string;
  /** Baris header tabel (1-based) yang dibekukan. */
  headerRow: number;
  /** Baris pertama data setelah header. */
  firstTableRow: number;
}

export async function applySheetSetup(
  buffer: ArrayBuffer,
  options: SheetSetupOptions,
): Promise<ArrayBuffer> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(buffer));

  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheetFile = files[sheetPath];
  if (sheetFile) {
    files[sheetPath] = strToU8(
      patchSheetXml(
        strFromU8(sheetFile),
        options.headerRow,
        options.firstTableRow,
      ),
    );
  }

  const workbookPath = "xl/workbook.xml";
  const workbookFile = files[workbookPath];
  if (workbookFile) {
    files[workbookPath] = strToU8(
      patchWorkbookXml(
        strFromU8(workbookFile),
        options.sheetName,
        options.headerRow,
      ),
    );
  }

  const zipped = zipSync(files);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

/** Unduh RAB sebagai .xlsx. Mengembalikan nama berkas yang dipakai. */
export async function downloadRabExcel(
  detail: RabDocumentDetail,
  profile: CompanyProfile = companyProfile,
): Promise<string> {
  const fileName = rabExcelFileName(detail);
  const buffer = await rabExcelBuffer(detail, profile);

  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);

  return fileName;
}

/** Dipakai pengujian: hasilkan buffer xlsx tanpa mengunduh. */
export async function rabExcelBuffer(
  detail: RabDocumentDetail,
  profile: CompanyProfile = companyProfile,
): Promise<ArrayBuffer> {
  const XLSX = await loadXlsx();
  const workbook = await buildRabWorkbook(detail, profile);
  const header = buildRabExcelHeader(detail, profile);

  const raw = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return applySheetSetup(raw, {
    sheetName: SHEET_NAME,
    headerRow: header.headerRow,
    firstTableRow: header.firstTableRow,
  });
}
