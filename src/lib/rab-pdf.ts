/**
 * Pembuat dokumen PDF RAB (A4, siap cetak).
 *
 * Modul ini sengaja tidak memakai React dan tidak menyentuh Supabase: ia hanya
 * menerima data yang sudah dimuat aplikasi (dan sudah difilter RLS) lalu
 * menyusunnya menjadi PDF. Perhitungan memakai fungsi yang sama dengan UI
 * (`calculateItemAmount`, `calculateRabTotal`) agar angka PDF tidak pernah
 * berbeda dari aplikasi.
 *
 * jsPDF dan jspdf-autotable dimuat secara dinamis agar keduanya tidak masuk ke
 * bundel utama.
 */

import {
  companyContactLine,
  companyProfile,
  type CompanyProfile,
} from "./profile";
import { calculateItemAmount, calculateRabTotal } from "./rab-calc";
import { buildDisplayRows } from "./rab-hierarchy";
import { formatVolumeForDisplay } from "./volume-format";
import { formatDate } from "./format";
import type { CellDef } from "jspdf-autotable";
import type { RabDocumentDetail, RabWorkItem } from "../types";

/* -------------------------------------------------------------------------- */
/*  Ukuran & format                                                           */
/* -------------------------------------------------------------------------- */

const PAGE_WIDTH = 595.28; // A4 portrait, satuan poin
const PAGE_HEIGHT = 841.89;
const MARGIN = { top: 40, right: 40, bottom: 56, left: 40 };
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN.left - MARGIN.right;
/** Ruang untuk header berjalan pada halaman kedua dan seterusnya. */
const CONTINUATION_TOP = 76;

const INK = { r: 23, g: 23, b: 23 };
const MUTED = { r: 100, g: 116, b: 139 };
const LINE = { r: 203, g: 213, b: 225 };
const ACCENT = { r: 30, g: 64, b: 120 };
const STRIPE = { r: 248, g: 250, b: 252 };

// Uang ditampilkan tanpa sen bila nilainya bulat, dan dengan maksimal dua
// desimal bila memang ada pecahan (volume × harga dapat menghasilkan pecahan).
// Ini menjaga jumlah seluruh baris tetap sama dengan total yang tercetak.
const rupiahNumber = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const rupiahPrecise = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/**
 * Volume PDF memakai formatter yang sama dengan editor
 * (`src/lib/volume-format.ts`) supaya angka PDF dan layar tidak berbeda.
 * Nama diekspor dipertahankan untuk kebutuhan pengujian lama.
 */
export function formatPdfVolume(
  volume: number,
  unitPrice: number,
  amount: number,
): string {
  return formatVolumeForDisplay(volume, unitPrice, amount);
}

/**
 * Rupiah untuk tabel: bilangan bulat tanpa desimal, pecahan selalu dua desimal
 * (`6.973.312,50`), sehingga nilai sen tidak tampil sebagai satu desimal.
 */
function formatRupiah(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? rupiahNumber.format(rounded)
    : rupiahPrecise.format(rounded);
}

/**
 * Batas panjang teks di dokumen.
 *
 * `rowPageBreak: "avoid"` mencegah baris terpotong, sehingga satu baris yang
 * lebih tinggi dari halaman akan meluber keluar batas cetak. Uraian yang sangat
 * panjang karena itu dipotong; data aslinya tetap utuh di database.
 */
const MAX_DESCRIPTION = 900;
const MAX_HEADER_TEXT = 160;
const MAX_CLIENT = 120;

function clampText(value: string, limit: number) {
  const text = value.trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

/* -------------------------------------------------------------------------- */
/*  Data tabel (dipisah agar bisa diuji tanpa PDF)                            */
/* -------------------------------------------------------------------------- */

export interface RabPdfRow {
  kind: "heading" | "item" | "subtotal" | "grand_total";
  /** 0 = GROUP, 1 = SUBGROUP, 2 = ITEM GROUP (heading & subtotal). */
  level?: 0 | 1 | 2;
  /** Nomor urut pekerjaan — hanya untuk baris item. */
  index?: number;
  /** Label heading/subtotal, atau uraian pekerjaan untuk item. */
  text: string;
  volume?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  /** Indentasi uraian item (0 = rata kiri). */
  indent: number;
}

export interface RabPdfData {
  rows: RabPdfRow[];
  itemCount: number;
  total: number;
  /** Subtotal per GROUP, dipakai ringkasan & pengujian. */
  groupTotals: { label: string; amount: number }[];
}

/** Kedalaman indentasi uraian item mengikuti konteks hierarkinya. */
function itemIndent(item: RabWorkItem): number {
  if (item.itemGroupName) return 3;
  if (item.subgroupName) return 2;
  if (item.groupName) return 1;
  return 0;
}

/**
 * Susun baris PDF dari item dokumen.
 *
 * Memakai `buildDisplayRows` — sumber yang sama dengan editor — sehingga
 * heading, urutan, dan subtotal PDF tidak mungkin berbeda dari aplikasi.
 * Subtotal tidak dihitung ulang di sini dan tidak pernah menjadi item biaya.
 */
export function buildRabPdfData(detail: RabDocumentDetail): RabPdfData {
  const displayRows = buildDisplayRows(detail.items);
  const rows: RabPdfRow[] = [];
  const groupTotals: { label: string; amount: number }[] = [];

  for (const row of displayRows) {
    if (row.kind === "heading") {
      rows.push({
        kind: "heading",
        level: row.depth,
        text: clampText(row.label, MAX_HEADER_TEXT),
        indent: row.depth,
      });
      continue;
    }

    if (row.kind === "subtotal") {
      rows.push({
        kind: "subtotal",
        level: row.depth,
        text: clampText(row.label, MAX_HEADER_TEXT),
        amount: row.amount,
        indent: row.depth,
      });
      if (row.depth === 0) {
        groupTotals.push({
          label: row.label.replace(/^Total\s+/, ""),
          amount: row.amount,
        });
      }
      continue;
    }

    rows.push({
      kind: "item",
      index: row.number,
      text: clampText(row.item.description, MAX_DESCRIPTION) || "Tanpa uraian",
      volume: row.item.volume,
      unit: row.item.unit,
      unitPrice: row.item.unitPrice,
      amount: calculateItemAmount(row.item),
      indent: itemIndent(row.item),
    });
  }

  const total = calculateRabTotal(detail.items);
  rows.push({
    kind: "grand_total",
    text: "GRAND TOTAL",
    amount: total,
    indent: 0,
  });

  return {
    rows,
    itemCount: displayRows.filter((row) => row.kind === "item").length,
    total,
    groupTotals,
  };
}

/** `RAB_Renovasi_Rumah_2026.pdf` */
export function rabPdfFileName(detail: RabDocumentDetail): string {
  const source = detail.projectName || detail.title || "RAB";
  const slug = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  const year = (detail.date || detail.createdAt || "").slice(0, 4);
  const yearPart = /^\d{4}$/.test(year)
    ? year
    : String(new Date().getFullYear());

  return `RAB_${slug || "Dokumen"}_${yearPart}.pdf`;
}

/* -------------------------------------------------------------------------- */
/*  Tipe internal                                                             */
/* -------------------------------------------------------------------------- */

type PdfDocument = import("jspdf").jsPDF;
type JsPdfModule = typeof import("jspdf");
type AutoTableModule = typeof import("jspdf-autotable");

interface PdfLibraries {
  jsPDF: JsPdfModule["jsPDF"];
  autoTable: AutoTableModule["autoTable"];
}

async function loadPdfLibraries(): Promise<PdfLibraries> {
  const [jspdf, autotable] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  return {
    jsPDF: jspdf.jsPDF ?? jspdf.default,
    autoTable: autotable.autoTable,
  };
}

export interface RabPdfOptions {
  /** Nama/email pengguna yang membuat dokumen, untuk blok tanda tangan. */
  preparedBy?: string;
  /** Identitas perusahaan pada kop dan footer; default profil workspace. */
  company?: CompanyProfile;
  /** Nonaktifkan kompresi stream (dipakai pengujian untuk membaca teks). */
  compress?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Penggambar bagian dokumen                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Kop identitas perusahaan. Mengembalikan Y dasar baris terakhir yang digambar
 * (atau Y awal bila identitas kosong) agar tinggi kop mengikuti isinya.
 *
 * Tidak ada nilai contoh atau email akun yang ditambahkan di sini: hanya nilai
 * yang benar-benar tersimpan pada profil perusahaan pengguna.
 */
function drawCompanyIdentity(doc: PdfDocument, profile: CompanyProfile): number {
  const name = profile.name.trim();
  const contact = companyContactLine(profile);
  let y = MARGIN.top + 2;

  if (!name && !contact) return y;

  if (name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(name, MARGIN.left, y);
    y += 14;
  }

  if (contact) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(contact, MARGIN.left, y);
    y += 11;
  }

  return y;
}

/** Kop dokumen pada halaman pertama. Mengembalikan Y awal tabel. */
function drawDocumentHeader(
  doc: PdfDocument,
  detail: RabDocumentDetail,
  profile: CompanyProfile,
) {
  const identityBottom = drawCompanyIdentity(doc, profile);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(detail.number, PAGE_WIDTH - MARGIN.right, MARGIN.top + 2, {
    align: "right",
  });

  // Kop lengkap tetap memakai jarak lama; kop kosong/sebagian tidak
  // menyisakan ruang kosong berlebih di atas judul.
  let y = Math.max(MARGIN.top + 28, identityBottom + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("RENCANA ANGGARAN BIAYA", PAGE_WIDTH / 2, y, {
    align: "center",
    charSpace: 0.4,
  });

  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  const titleLines = doc.splitTextToSize(
    clampText(detail.title, MAX_HEADER_TEXT),
    CONTENT_WIDTH - 60,
  );
  doc.text(titleLines.slice(0, 3), PAGE_WIDTH / 2, y, { align: "center" });
  y += Math.min(titleLines.length, 3) * 13;

  y += 6;
  doc.setDrawColor(LINE.r, LINE.g, LINE.b);
  doc.setLineWidth(0.8);
  doc.line(MARGIN.left, y, PAGE_WIDTH - MARGIN.right, y);

  y += 16;

  const columnGap = 20;
  const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
  const leftX = MARGIN.left;
  // Teks rata kanan harus berakhir di tepi kanan isi halaman, bukan di awal
  // kolom — jika tidak, nilai panjang dari kolom kiri akan menabraknya.
  const rightX = PAGE_WIDTH - MARGIN.right;

  const cells: {
    label: string;
    value: string;
    x: number;
    align: "left" | "right";
  }[] = [
    {
      label: "PROYEK",
      value: clampText(detail.projectName || "—", MAX_HEADER_TEXT),
      x: leftX,
      align: "left",
    },
    { label: "NOMOR DOKUMEN", value: detail.number, x: rightX, align: "right" },
    {
      label: "KLIEN",
      value: clampText(detail.client || "—", MAX_CLIENT),
      x: leftX,
      align: "left",
    },
    {
      label: "TANGGAL",
      value: formatDate(detail.date || detail.createdAt),
      x: rightX,
      align: "right",
    },
    {
      label: "LOKASI",
      value: clampText(detail.location || "—", MAX_HEADER_TEXT),
      x: leftX,
      align: "left",
    },
    {
      label: "JUMLAH ITEM",
      value: `${detail.items.length} pekerjaan`,
      x: rightX,
      align: "right",
    },
  ];

  for (let index = 0; index < cells.length; index += 2) {
    const row = cells.slice(index, index + 2);
    let rowHeight = 0;

    for (const cell of row) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      doc.text(cell.label, cell.x, y, { align: cell.align });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(INK.r, INK.g, INK.b);
      const lines = doc.splitTextToSize(cell.value, columnWidth);
      doc.text(lines, cell.x, y + 11, { align: cell.align });

      rowHeight = Math.max(rowHeight, lines.length * 12);
    }

    y += 11 + rowHeight + 9;
  }

  return y + 4;
}

/** Header kecil pada halaman lanjutan. */
function drawRunningHeader(doc: PdfDocument, detail: RabDocumentDetail) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text("RENCANA ANGGARAN BIAYA", MARGIN.left, MARGIN.top - 10);

  doc.setFont("helvetica", "normal");
  const project = doc.splitTextToSize(
    detail.projectName || detail.title,
    CONTENT_WIDTH - 180,
  )[0];
  doc.text(project, PAGE_WIDTH - MARGIN.right, MARGIN.top - 10, {
    align: "right",
  });

  doc.setDrawColor(LINE.r, LINE.g, LINE.b);
  doc.setLineWidth(0.5);
  doc.line(MARGIN.left, MARGIN.top - 4, PAGE_WIDTH - MARGIN.right, MARGIN.top - 4);
}

function drawFooter(
  doc: PdfDocument,
  page: number,
  totalPages: number,
  profile: CompanyProfile,
) {
  const y = PAGE_HEIGHT - MARGIN.bottom + 22;

  doc.setDrawColor(LINE.r, LINE.g, LINE.b);
  doc.setLineWidth(0.5);
  doc.line(MARGIN.left, y - 12, PAGE_WIDTH - MARGIN.right, y - 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  // Branding aplikasi selalu tampil; identitas perusahaan hanya ditambahkan
  // bila diisi, tanpa pemisah menggantung.
  const footerText = [profile.name.trim(), "Dibuat dengan RAB Mini"]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(footerText, MARGIN.left, y);
  doc.text(`Halaman ${page} dari ${totalPages}`, PAGE_WIDTH - MARGIN.right, y, {
    align: "right",
  });
}

/** Kotak rekapitulasi total. */
function drawRecap(
  doc: PdfDocument,
  data: RabPdfData,
  startY: number,
): number {
  const boxWidth = 260;
  const boxHeight = 58;
  const x = PAGE_WIDTH - MARGIN.right - boxWidth;
  const y = startY;

  doc.setFillColor(ACCENT.r, ACCENT.g, ACCENT.b);
  doc.rect(x, y, boxWidth, 22, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text("REKAPITULASI", x + 10, y + 14.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`${data.itemCount} item pekerjaan`, x + boxWidth - 10, y + 14.5, {
    align: "right",
  });

  doc.setDrawColor(LINE.r, LINE.g, LINE.b);
  doc.setLineWidth(0.5);
  doc.rect(x, y + 22, boxWidth, boxHeight - 22, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("TOTAL BIAYA RAB", x + 10, y + 38);

  doc.setFontSize(12.5);
  doc.text(`Rp ${formatRupiah(data.total)}`, x + boxWidth - 10, y + 49, {
    align: "right",
  });

  return y + boxHeight;
}

/** Blok tanda tangan tiga kolom. */
function drawSignatureBlock(
  doc: PdfDocument,
  startY: number,
  preparedBy?: string,
) {
  const labels = ["Dibuat oleh", "Diperiksa oleh", "Disetujui oleh"];
  const columnWidth = CONTENT_WIDTH / labels.length;
  const lineY = startY + 62;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(INK.r, INK.g, INK.b);

  labels.forEach((label, index) => {
    const centerX = MARGIN.left + columnWidth * index + columnWidth / 2;
    doc.text(label, centerX, startY + 10, { align: "center" });

    doc.setDrawColor(160, 170, 185);
    doc.setLineWidth(0.5);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.line(centerX - 62, lineY, centerX + 62, lineY);
    doc.setLineDashPattern([], 0);

    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    const caption =
      index === 0 && preparedBy ? preparedBy : "(nama & jabatan)";
    const lines = doc.splitTextToSize(caption, columnWidth - 24);
    doc.text(lines, centerX, lineY + 11, { align: "center" });
    doc.setFontSize(8.5);
    doc.setTextColor(INK.r, INK.g, INK.b);
  });

  return lineY + 30;
}

/* -------------------------------------------------------------------------- */
/*  Gaya baris tabel (heading, item, subtotal)                                */
/* -------------------------------------------------------------------------- */

const COLUMN_WIDTHS = {
  no: 30,
  description: 189.28,
  volume: 54,
  unit: 44,
  price: 94,
  amount: 104,
};

const DESCRIPTION_PADDING = 10;
const INDENT_STEP = 9;
const MAX_INDENT = 3;
const ITEM_FONT_SIZE = 8.6;
const ITEM_LINE_HEIGHT = ITEM_FONT_SIZE * 1.15;
const CELL_PADDING_Y = 9;
/** Perkiraan tinggi header tabel (dipakai perhitungan pagination). */
const HEAD_ROW_HEIGHT = 22;

const HEADING_STYLES: Record<0 | 1 | 2, CellDef["styles"]> = {
  0: {
    fontStyle: "bold",
    fontSize: 9.6,
    fillColor: [ACCENT.r, ACCENT.g, ACCENT.b],
    textColor: [255, 255, 255],
    cellPadding: { top: 5.5, right: 5, bottom: 5.5, left: 5 },
  },
  1: {
    fontStyle: "bold",
    fontSize: 9.2,
    fillColor: [232, 238, 247],
    textColor: [30, 41, 59],
    cellPadding: { top: 4.5, right: 5, bottom: 4.5, left: 12 },
  },
  2: {
    fontStyle: "bold",
    fontSize: 8.8,
    fillColor: [243, 246, 250],
    textColor: [30, 41, 59],
    cellPadding: { top: 4, right: 5, bottom: 4, left: 22 },
  },
};

const SUBTOTAL_STYLES: Record<0 | 1 | 2, CellDef["styles"]> = {
  0: {
    fontStyle: "bold",
    fontSize: 9,
    fillColor: [222, 231, 243],
    textColor: [23, 23, 23],
  },
  1: {
    fontStyle: "bold",
    fontSize: 8.6,
    fillColor: [241, 245, 250],
    textColor: [30, 41, 59],
  },
  2: {
    fontStyle: "normal",
    fontSize: 8.4,
    fillColor: [250, 251, 253],
    textColor: [MUTED.r, MUTED.g, MUTED.b],
  },
};

const GRAND_TOTAL_STYLES: CellDef["styles"] = {
  fontStyle: "bold",
  fontSize: 9.6,
  fillColor: [ACCENT.r, ACCENT.g, ACCENT.b],
  textColor: [255, 255, 255],
};

/** Ubah baris PDF menjadi sel autoTable (heading & subtotal memakai colSpan). */
export function buildPdfBodyRows(rows: RabPdfRow[]): CellDef[][] {
  return rows.map((row) => {
    if (row.kind === "heading") {
      const level = row.level ?? 0;
      return [
        {
          content: row.text,
          colSpan: 6,
          styles: { ...HEADING_STYLES[level], halign: "left" },
        },
      ];
    }

    if (row.kind === "subtotal") {
      const level = row.level ?? 0;
      return [
        {
          content: row.text,
          colSpan: 5,
          styles: { ...SUBTOTAL_STYLES[level], halign: "right" },
        },
        {
          content: formatRupiah(row.amount ?? 0),
          styles: { ...SUBTOTAL_STYLES[level], halign: "right" },
        },
      ];
    }

    if (row.kind === "grand_total") {
      return [
        {
          content: row.text,
          colSpan: 5,
          styles: { ...GRAND_TOTAL_STYLES, halign: "right" },
        },
        {
          content: formatRupiah(row.amount ?? 0),
          styles: { ...GRAND_TOTAL_STYLES, halign: "right" },
        },
      ];
    }

    return [
      { content: String(row.index ?? ""), styles: { halign: "center" } },
      {
        content: row.text,
        styles: {
          cellPadding: {
            top: 4.5,
            right: 5,
            bottom: 4.5,
            left: DESCRIPTION_PADDING + Math.min(row.indent, MAX_INDENT) * INDENT_STEP,
          },
        },
      },
      {
        content: formatPdfVolume(
          row.volume ?? 0,
          row.unitPrice ?? 0,
          row.amount ?? 0,
        ),
        styles: { halign: "right" },
      },
      { content: row.unit ?? "", styles: { halign: "center" } },
      { content: formatRupiah(row.unitPrice ?? 0), styles: { halign: "right" } },
      { content: formatRupiah(row.amount ?? 0), styles: { halign: "right" } },
    ];
  });
}

/** Perkiraan tinggi satu baris tabel (untuk memutus halaman). */
export function estimatePdfRowHeight(doc: PdfDocument, row: RabPdfRow): number {
  if (row.kind === "heading") {
    return row.level === 0 ? 24 : row.level === 1 ? 22 : 20;
  }
  if (row.kind === "subtotal") return 17;
  if (row.kind === "grand_total") return 22;

  const width = Math.max(
    40,
    COLUMN_WIDTHS.description -
      DESCRIPTION_PADDING -
      Math.min(row.indent, MAX_INDENT) * INDENT_STEP,
  );
  const lines = doc.splitTextToSize(row.text || " ", width).length;

  return lines * ITEM_LINE_HEIGHT + CELL_PADDING_Y + 2.5;
}

/**
 * Pecah baris menjadi halaman.
 *
 * Aturan yang dijaga:
 * - Heading tidak ditinggal sendirian di dasar halaman (disediakan ruang untuk
 *   baris berikutnya).
 * - Subtotal selalu menempel pada item terakhir cakupannya: item + subtotal
 *   diperlakukan sebagai satu blok, sehingga subtotal tidak membuka halaman
 *   sendirian dan tidak terpisah dari angkanya.
 * - Satu baris tidak pernah dibelah dua halaman (`rowPageBreak: "avoid"`).
 */
export function paginatePdfRows(
  doc: PdfDocument,
  rows: RabPdfRow[],
  firstStartY: number,
): RabPdfRow[][] {
  const pageBottom = PAGE_HEIGHT - MARGIN.bottom;

  // Blok: satu baris, atau satu item yang langsung diikuti subtotal beruntun.
  const blocks: { rows: RabPdfRow[]; height: number; kind: RabPdfRow["kind"] }[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rowsInBlock = [rows[index]];
    let last = index;

    if (rows[index].kind === "item") {
      while (last + 1 < rows.length && rows[last + 1].kind === "subtotal") {
        last += 1;
        rowsInBlock.push(rows[last]);
      }
    }

    blocks.push({
      rows: rowsInBlock,
      height: rowsInBlock.reduce(
        (total, row) => total + estimatePdfRowHeight(doc, row),
        0,
      ),
      kind: rows[index].kind,
    });
    index = last;
  }

  const chunks: RabPdfRow[][] = [];
  let current: RabPdfRow[] = [];
  let y = firstStartY + HEAD_ROW_HEIGHT;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    let required = block.height;

    // Heading butuh ruang untuk heading lanjutan + blok isi pertama, agar tidak
    // menggantung sendirian di dasar halaman.
    if (block.kind === "heading") {
      let look = index + 1;
      while (look < blocks.length && blocks[look].kind === "heading") {
        required += blocks[look].height;
        look += 1;
      }
      if (look < blocks.length) required += blocks[look].height;
    }

    if (current.length > 0 && y + required > pageBottom) {
      chunks.push(current);
      current = [];
      y = CONTINUATION_TOP + HEAD_ROW_HEIGHT;
    }

    current.push(...block.rows);
    y += block.height;
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

/* -------------------------------------------------------------------------- */
/*  Susun dokumen                                                             */
/* -------------------------------------------------------------------------- */

export async function buildRabPdf(
  detail: RabDocumentDetail,
  options: RabPdfOptions = {},
): Promise<PdfDocument> {
  const { jsPDF, autoTable } = await loadPdfLibraries();
  const data = buildRabPdfData(detail);
  const profile = options.company ?? companyProfile;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: options.compress ?? true,
  }) as PdfDocument;

  doc.setProperties({
    title: `RAB ${detail.projectName}`.trim(),
    subject: detail.title,
    author: profile.name.trim() || "RAB Mini",
    creator: "RAB Mini",
  });

  const tableStartY = drawDocumentHeader(doc, detail, profile);
  const chunks = paginatePdfRows(doc, data.rows, tableStartY);
  let tableEndY = tableStartY;

  chunks.forEach((chunk, index) => {
    if (index > 0) doc.addPage();

    autoTable(doc, {
      startY: index === 0 ? tableStartY : CONTINUATION_TOP,
      margin: {
        left: MARGIN.left,
        right: MARGIN.right,
        top: CONTINUATION_TOP,
        bottom: MARGIN.bottom,
      },
      head: [
        [
          "No.",
          "Uraian Pekerjaan",
          "Volume",
          "Satuan",
          "Harga Satuan (Rp)",
          "Jumlah Harga (Rp)",
        ],
      ],
      body: buildPdfBodyRows(chunk),
      theme: "grid",
      showHead: "everyPage",
      rowPageBreak: "avoid",
      styles: {
        font: "helvetica",
        fontSize: ITEM_FONT_SIZE,
        cellPadding: { top: 4.5, right: 5, bottom: 4.5, left: 5 },
        lineColor: [214, 222, 232],
        lineWidth: 0.4,
        textColor: [30, 41, 59],
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fillColor: [33, 55, 92],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8.4,
        halign: "center",
        lineColor: [33, 55, 92],
      },
      alternateRowStyles: { fillColor: [STRIPE.r, STRIPE.g, STRIPE.b] },
      columnStyles: {
        0: { cellWidth: COLUMN_WIDTHS.no, halign: "center" },
        1: { cellWidth: COLUMN_WIDTHS.description, halign: "left" },
        2: { cellWidth: COLUMN_WIDTHS.volume, halign: "right" },
        3: { cellWidth: COLUMN_WIDTHS.unit, halign: "center" },
        4: { cellWidth: COLUMN_WIDTHS.price, halign: "right" },
        5: { cellWidth: COLUMN_WIDTHS.amount, halign: "right" },
      },
    });

    const state = doc as unknown as { lastAutoTable?: { finalY: number } };
    tableEndY = state.lastAutoTable?.finalY ?? tableStartY;
  });

  let y = tableEndY + 20;

  // Rekapitulasi tidak boleh terpisah dari totalnya.
  if (y + 58 + 16 > PAGE_HEIGHT - MARGIN.bottom) {
    doc.addPage();
    y = CONTINUATION_TOP;
  }
  y = drawRecap(doc, data, y);

  // Blok tanda tangan butuh ~130 pt; pindahkan ke halaman baru bila sempit.
  if (y + 130 > PAGE_HEIGHT - MARGIN.bottom) {
    doc.addPage();
    y = CONTINUATION_TOP;
  }
  drawSignatureBlock(doc, y + 34, options.preparedBy);

  // Header halaman lanjutan + footer nomor halaman.
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    if (page > 1) drawRunningHeader(doc, detail);
    drawFooter(doc, page, totalPages, profile);
  }

  return doc;
}

/** Buat PDF lalu unduh. Mengembalikan nama file yang dipakai. */
export async function downloadRabPdf(
  detail: RabDocumentDetail,
  options: RabPdfOptions = {},
): Promise<string> {
  const fileName = rabPdfFileName(detail);
  const doc = await buildRabPdf(detail, options);
  doc.save(fileName);
  return fileName;
}

/** Dipakai pengujian: ringkas item + total tanpa menyentuh jsPDF. */
export function summarizeItems(items: RabWorkItem[]) {
  return {
    itemCount: items.length,
    total: calculateRabTotal(items),
    amounts: items.map((item) => calculateItemAmount(item)),
  };
}
