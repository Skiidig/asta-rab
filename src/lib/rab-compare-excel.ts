import type { ComparisonResult, ComparisonRow } from "@/lib/rab-compare";
import {
  applySheetSetup,
  loadXlsx,
  styleCell,
  type CellStyle,
} from "@/lib/rab-excel";

/**
 * Ekspor Excel untuk dialog perbandingan dua dokumen RAB.
 *
 * Sumber data adalah `ComparisonResult` dari `compareGroupSummaries()` — helper
 * yang sama dengan dialog. Tidak ada aturan pencocokan atau perhitungan kedua:
 * seluruh nominal, persentase, dan penanda status diambil dari hasil tersebut.
 */

export interface ComparisonExcelSide {
  title: string;
  number: string;
}

export interface ComparisonExcelInput {
  projectName: string;
  baseline: ComparisonExcelSide;
  comparison: ComparisonExcelSide;
  /** Snapshot hasil perbandingan saat tombol ditekan. */
  result: ComparisonResult;
  exportedAt?: Date;
  /** Zona waktu laporan; default WITA (Asia/Makassar). */
  timeZone?: string;
}

const SHEET_NAME = "Perbandingan";
const HEADER_ROW = 10;
const FIRST_TABLE_ROW = HEADER_ROW + 1;
const TITLE_ROW = 1;

const MONEY_FORMAT = '"Rp" #,##0.00';
const PERCENT_FORMAT = "0.00%";
const COUNT_FORMAT = "#,##0";

const BORDER_THIN = { style: "thin", color: { rgb: "D5DCE6" } };
const HEADER_FILL = { patternType: "solid", fgColor: { rgb: "E8EEF7" } };
const TOTAL_FILL = { patternType: "solid", fgColor: { rgb: "DCE7F5" } };

export function comparisonExportTimestamp(
  date: Date = new Date(),
  timeZone = "Asia/Makassar",
): string {
  const formatted = new Intl.DateTimeFormat("id-ID", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  let zoneLabel = timeZone;
  try {
    zoneLabel =
      new Intl.DateTimeFormat("id-ID", {
        timeZone,
        timeZoneName: "short",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    zoneLabel = timeZone;
  }

  return `${formatted} ${zoneLabel} (${timeZone})`;
}

function markerOf(row: ComparisonRow): string {
  if (row.status === "baseline_only") return "Hanya di acuan";
  if (row.status === "comparison_only") return "Hanya di pembanding";
  if (row.status === "unpaired") return "Belum dapat dipasangkan";
  return "";
}

function labelOf(row: ComparisonRow): string {
  const marker = markerOf(row);
  return marker ? `${row.label} (${marker})` : row.label;
}

/** Rasio untuk format persen Excel (18,81% → 0,1881). */
function percentRatio(percent: number | null): number | null {
  return percent === null ? null : percent / 100;
}

function moneyOrBlank(value: number | null): number | string {
  return value === null ? "—" : value;
}

/** Nama berkas: `Perbandingan_<proyek>_<tanggal>.xlsx`. */
export function comparisonExcelFileName(
  input: ComparisonExcelInput,
  date: Date = new Date(),
): string {
  const source = input.projectName || input.baseline.title || "RAB";
  const slug = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  const stamp = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);

  return `Perbandingan_${slug || "RAB"}_${stamp}.xlsx`;
}

/** Susun workbook "Perbandingan" (satu sheet). */
export async function buildComparisonWorkbook(
  input: ComparisonExcelInput,
): Promise<Record<string, unknown>> {
  const XLSX = await loadXlsx();
  const { result } = input;
  const timestamp = comparisonExportTimestamp(
    input.exportedAt ?? new Date(),
    input.timeZone ?? "Asia/Makassar",
  );

  const rows: unknown[][] = [
    ["Perbandingan Dokumen RAB", "", "", "", ""],
    ["Proyek", input.projectName, "", "", ""],
    [
      "Dokumen acuan",
      `${input.baseline.title} · ${input.baseline.number}`,
      "",
      "",
      "",
    ],
    [
      "Dokumen pembanding",
      `${input.comparison.title} · ${input.comparison.number}`,
      "",
      "",
      "",
    ],
    ["Waktu ekspor", timestamp, "", "", ""],
    [
      "Catatan",
      "Laporan pada waktu ekspor — nilai mengikuti data tersimpan saat tombol Export ditekan.",
      "",
      "",
      "",
    ],
    ["Jumlah item", "", "", "", ""],
    ["Total anggaran", "", "", "", ""],
    ["", "", "", "", ""],
    ["Kelompok", "Nilai Acuan", "Nilai Pembanding", "Selisih", "Selisih %"],
  ];

  for (const row of result.rows) {
    rows.push([
      labelOf(row),
      moneyOrBlank(row.baseline),
      moneyOrBlank(row.comparison),
      row.difference,
      percentRatio(row.percent) ?? "—",
    ]);
  }

  rows.push([
    "Total",
    result.baselineTotal,
    result.comparisonTotal,
    result.difference,
    percentRatio(result.percent) ?? "—",
  ]);

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const totalRow = FIRST_TABLE_ROW + result.rows.length;

  const titleStyle: CellStyle = {
    font: { bold: true, sz: 16, color: { rgb: "1F2A37" } },
    alignment: { vertical: "center" },
  };
  styleCell(sheet, "A1", titleStyle);

  const labelStyle: CellStyle = {
    font: { bold: true, color: { rgb: "374151" } },
    alignment: { vertical: "center" },
  };
  for (const address of ["A2", "A3", "A4", "A5", "A6", "A7", "A8"]) {
    styleCell(sheet, address, labelStyle);
  }

  // Label metadata sejajar atas agar tidak mengambang saat nilai membungkus.
  for (const address of ["A3", "A4", "A5"]) {
    styleCell(sheet, address, {
      ...labelStyle,
      alignment: { vertical: "top" },
    });
  }

  // Nilai metadata memakai rentang B:E dengan wrap text.
  const metaValueStyle: CellStyle = {
    alignment: { wrapText: true, vertical: "top" },
  };
  for (const address of ["B3", "B4", "B5"]) {
    styleCell(sheet, address, metaValueStyle);
  }
  // Pastikan sel selain top-left pada rentang merge benar-benar kosong.
  for (const address of ["C3", "D3", "E3", "C4", "D4", "E4", "C5", "D5", "E5"]) {
    delete sheet[address];
  }

  const noteStyle: CellStyle = {
    font: { italic: true, color: { rgb: "6B7280" }, sz: 10 },
    alignment: { wrapText: true, vertical: "top" },
  };
  styleCell(sheet, "B6", noteStyle);

  const headerStyle: CellStyle = {
    font: { bold: true, color: { rgb: "1F2A37" } },
    fill: HEADER_FILL,
    border: {
      top: BORDER_THIN,
      bottom: BORDER_THIN,
      left: BORDER_THIN,
      right: BORDER_THIN,
    },
    alignment: { vertical: "center", wrapText: true },
  };
  for (const column of ["A", "B", "C", "D", "E"]) {
    styleCell(sheet, `${column}${HEADER_ROW}`, {
      ...headerStyle,
      alignment: {
        ...headerStyle.alignment,
        horizontal: column === "A" ? "left" : "right",
      },
    });
  }
  styleCell(
    sheet,
    `A${HEADER_ROW}`,
    { ...headerStyle, alignment: { ...headerStyle.alignment, horizontal: "left" } },
  );

  // Angka pada blok ringkasan.
  sheet.B7 = { t: "n", v: result.baselineItems, z: COUNT_FORMAT };
  sheet.C7 = { t: "n", v: result.comparisonItems, z: COUNT_FORMAT };
  sheet.B8 = { t: "n", v: result.baselineTotal, z: MONEY_FORMAT };
  sheet.C8 = { t: "n", v: result.comparisonTotal, z: MONEY_FORMAT };
  sheet.D8 = { t: "n", v: result.difference, z: MONEY_FORMAT };
  sheet.E8 =
    percentRatio(result.percent) === null
      ? { t: "s", v: "—" }
      : { t: "n", v: percentRatio(result.percent) as number, z: PERCENT_FORMAT };

  const bodyStyle: CellStyle = {
    alignment: { vertical: "top", wrapText: true },
    border: { bottom: BORDER_THIN },
  };
  const numberStyle: CellStyle = {
    alignment: { vertical: "top", horizontal: "right" },
    border: { bottom: BORDER_THIN },
  };

  result.rows.forEach((row, index) => {
    const excelRow = FIRST_TABLE_ROW + index;

    styleCell(sheet, `A${excelRow}`, bodyStyle);

    if (row.baseline !== null) {
      sheet[`B${excelRow}`] = { t: "n", v: row.baseline, z: MONEY_FORMAT };
    }
    if (row.comparison !== null) {
      sheet[`C${excelRow}`] = { t: "n", v: row.comparison, z: MONEY_FORMAT };
    }
    sheet[`D${excelRow}`] = { t: "n", v: row.difference, z: MONEY_FORMAT };

    const ratio = percentRatio(row.percent);
    if (ratio !== null) {
      sheet[`E${excelRow}`] = { t: "n", v: ratio, z: PERCENT_FORMAT };
    }

    for (const column of ["B", "C", "D", "E"]) {
      styleCell(sheet, `${column}${excelRow}`, numberStyle);
    }
  });

  const totalStyle: CellStyle = {
    font: { bold: true, color: { rgb: "1F2A37" } },
    fill: TOTAL_FILL,
    border: { top: BORDER_THIN, bottom: BORDER_THIN },
    alignment: { vertical: "center" },
  };

  // Baris Total juga harus numerik berformat, bukan General.
  sheet[`B${totalRow}`] = {
    t: "n",
    v: result.baselineTotal,
    z: MONEY_FORMAT,
  };
  sheet[`C${totalRow}`] = {
    t: "n",
    v: result.comparisonTotal,
    z: MONEY_FORMAT,
  };
  sheet[`D${totalRow}`] = {
    t: "n",
    v: result.difference,
    z: MONEY_FORMAT,
  };
  sheet[`E${totalRow}`] =
    percentRatio(result.percent) === null
      ? { t: "s", v: "—" }
      : {
          t: "n",
          v: percentRatio(result.percent) as number,
          z: PERCENT_FORMAT,
        };

  for (const column of ["A", "B", "C", "D", "E"]) {
    styleCell(sheet, `${column}${totalRow}`, {
      ...totalStyle,
      alignment: {
        ...totalStyle.alignment,
        horizontal: column === "A" ? "left" : "right",
      },
    });
  }

  sheet["!cols"] = [
    { wch: 55 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 14 },
  ];

  // Tinggi baris dihitung dari perkiraan jumlah baris teks pada rentang B:E
  // (total ±80 karakter). Autofit tidak dipakai untuk sel gabungan.
  const metaWidth = 80;
  const metaHeight = (text: string) => {
    const lines = Math.max(1, Math.ceil(text.length / metaWidth));
    return Math.max(18, lines * 15 + 3);
  };
  const rowInfo: Array<{ hpt: number }> = [];
  rowInfo[0] = { hpt: 24 };
  rowInfo[2] = {
    hpt: metaHeight(`${input.baseline.title} · ${input.baseline.number}`),
  };
  rowInfo[3] = {
    hpt: metaHeight(`${input.comparison.title} · ${input.comparison.number}`),
  };
  rowInfo[4] = { hpt: metaHeight(timestamp) };
  rowInfo[5] = { hpt: 30 };
  sheet["!rows"] = rowInfo;

  sheet["!merges"] = [
    { s: { r: TITLE_ROW - 1, c: 0 }, e: { r: TITLE_ROW - 1, c: 4 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 4 } },
    { s: { r: 3, c: 1 }, e: { r: 3, c: 4 } },
    { s: { r: 4, c: 1 }, e: { r: 4, c: 4 } },
    { s: { r: 5, c: 1 }, e: { r: 5, c: 4 } },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, SHEET_NAME);
  return workbook;
}

/** Hasilkan buffer xlsx (dipakai pengujian dan unduhan). */
export async function comparisonExcelBuffer(
  input: ComparisonExcelInput,
): Promise<ArrayBuffer> {
  const XLSX = await loadXlsx();
  const workbook = await buildComparisonWorkbook(input);

  const raw = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;

  return applySheetSetup(raw, {
    sheetName: SHEET_NAME,
    headerRow: HEADER_ROW,
    firstTableRow: FIRST_TABLE_ROW,
  });
}

/** Unduh workbook perbandingan. Mengembalikan nama berkas. */
export async function downloadComparisonExcel(
  input: ComparisonExcelInput,
): Promise<string> {
  const fileName = comparisonExcelFileName(input, input.exportedAt ?? new Date());
  const buffer = await comparisonExcelBuffer(input);

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
