export type ProjectStatus = "active" | "planning" | "completed" | "on-hold";

/**
 * A project as stored in the `projects` table plus values derived from its
 * RAB documents. Database columns are nullable for `client`, `location`, and
 * `date`; those are normalised to empty strings for display.
 */
export interface Project {
  id: string;
  name: string;
  client: string;
  location: string;
  /** ISO 8601 date, e.g. `2026-09-02`, or `""` when not set */
  startDate: string;
  status: ProjectStatus;
  /** ISO 8601 timestamp the project row was created */
  createdAt: string;
  /** Number of RAB documents linked to this project (derived) */
  documentCount: number;
  /** Sum of all linked document totals in IDR (derived) */
  totalRab: number;
}

/**
 * A RAB document row joined with display-only values. The database stores the
 * title, project, optional date, and creation time; the document number,
 * project name, total, and item count are derived at read time.
 */
export interface RabDocument {
  id: string;
  /** Human-friendly document number derived from the id and year */
  number: string;
  title: string;
  projectId: string;
  projectName: string;
  /** ISO 8601 date, or `""` when not set */
  date: string;
  /** Total estimated cost in IDR (derived from items) */
  total: number;
  /** Number of line items in the document (derived) */
  itemCount: number;
  /** ISO 8601 timestamp the document row was created */
  createdAt: string;
}

/**
 * One line item inside a RAB document.
 *
 * Numeric values are always plain numbers — never formatted strings — so
 * calculations stay exact. Formatting happens only at display time.
 */
export interface RabWorkItem {
  id: string;
  /** Work description, e.g. "Pekerjaan pondasi batu kali" */
  description: string;
  /** Quantity, e.g. 24.5 */
  volume: number;
  /** Unit of measure, e.g. "m3", "m2", "ls" */
  unit: RabUnit;
  /** Price per unit in IDR */
  unitPrice: number;
  /**
   * Konteks hierarki dari import Excel (opsional). Dokumen lama dan item
   * manual tidak memiliki nilai ini dan ditampilkan datar.
   */
  groupName?: string;
  subgroupName?: string;
  itemGroupName?: string;
  /** Urutan sumber (nomor baris Excel) untuk dokumen hasil import. */
  sortOrder?: number;
}

/**
 * A RAB document with the project context and line items needed by the
 * editor. Derived from `RabDocument` + `Project` + work items.
 */
export interface RabDocumentDetail extends RabDocument {
  client: string;
  location: string;
  items: RabWorkItem[];
}

/** Satuan umum yang ditampilkan di pemilih satuan (UI). */
export type KnownRabUnit =
  | "m2"
  | "m3"
  | "m"
  | "m1"
  | "kg"
  | "unit"
  | "ls"
  | "titik"
  | "set"
  | "hari"
  | "bh"
  | "zak"
  | "batang"
  | "lembar";

/**
 * Satuan item. Database menyimpan satuan sebagai teks bebas dan workbook Excel
 * sering memakai satuan non-standar (`m'`, `Point`, `Mtr'`), jadi tipe ini
 * menerima teks apa pun sambil tetap memberi saran satuan umum.
 */
export type RabUnit = KnownRabUnit | (string & {});

/**
 * Satu entri katalog harga milik pengguna (material, pekerjaan, upah, alat).
 *
 * Katalog hanya menjadi *sumber pilihan*: saat dipakai di RAB, nama, satuan,
 * dan harganya disalin ke `rab_items`. Tidak ada relasi ke tabel katalog,
 * sehingga mengubah atau menghapus entri katalog tidak memengaruhi dokumen
 * RAB yang sudah dibuat.
 */
export interface CatalogItem {
  id: string;
  /** Nama material/pekerjaan, mis. "Semen Portland 50 kg" */
  name: string;
  /** Kategori bebas, mis. "Material", "Pekerjaan", "Upah", "Alat" */
  category: string;
  unit: RabUnit;
  /** Harga satuan dalam IDR */
  unitPrice: number;
  /** Catatan opsional */
  description: string;
  createdAt: string;
  updatedAt: string;
}

/** Kelompok komponen AHSP. */
export type AhspResourceCategory = "Material" | "Tenaga kerja" | "Peralatan";

/** Satu komponen analisis harga satuan pekerjaan (AHSP). */
export interface AhspComponent {
  id: string;
  analysisId: string;
  /**
   * Referensi informatif ke katalog harga. `null` untuk komponen manual.
   * Nama, satuan, dan harga sudah disalin ke kolom komponen sehingga
   * perubahan/penghapusan katalog tidak memengaruhi analisis ini.
   */
  catalogItemId: string | null;
  /** Nama material/tenaga kerja/peralatan */
  resourceName: string;
  resourceCategory: AhspResourceCategory;
  unit: RabUnit;
  /** Koefisien (hingga 6 desimal) */
  coefficient: number;
  /** Harga dasar satuan dalam IDR (snapshot) */
  unitPrice: number;
  createdAt: string;
  updatedAt: string;
}

/** Analisis harga satuan pekerjaan; totalnya dihitung dari komponen. */
export interface AhspAnalysis {
  id: string;
  name: string;
  /** Kategori pekerjaan, mis. "Pondasi", "Struktur" */
  category: string;
  /** Satuan hasil pekerjaan, mis. "m3" */
  unit: RabUnit;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface AhspAnalysisDetail extends AhspAnalysis {
  components: AhspComponent[];
}
