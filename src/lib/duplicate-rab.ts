import { calculateRabTotal } from "./rab-calc";
import { sortWorkItems } from "./rab-hierarchy";
import type { RabDocument, RabUnit, RabWorkItem } from "@/types";

/**
 * Aturan duplikasi dokumen RAB.
 *
 * Murni (tanpa React/Supabase) supaya isi salinan dan jalur kegagalannya mudah
 * diuji: hanya nilai yang tersimpan pada item yang disalin — tanpa id, waktu
 * pembuatan, atau metadata sistem. Urutan mengikuti `sort_order`.
 */

export const DUPLICATE_TITLE_SEPARATOR = " — ";
export const DUPLICATE_TITLE_SUFFIX = "Salinan";

/** `[judul asli] — Salinan` (judul kosong tetap mendapat nama wajar). */
export function duplicateTitle(originalTitle: string): string {
  const base = originalTitle.trim() || "Dokumen RAB";
  if (base.endsWith(`${DUPLICATE_TITLE_SEPARATOR}${DUPLICATE_TITLE_SUFFIX}`)) {
    return base;
  }
  return `${base}${DUPLICATE_TITLE_SEPARATOR}${DUPLICATE_TITLE_SUFFIX}`;
}

export interface DuplicateItem {
  description: string;
  volume: number;
  unit: RabUnit;
  unitPrice: number;
  groupName?: string;
  subgroupName?: string;
  itemGroupName?: string;
  sortOrder?: number;
}

/**
 * Payload item untuk dokumen salinan.
 *
 * Semua nilai bisnis disalin apa adanya (uraian, satuan kustom, harga, presisi
 * volume, hierarki, `sort_order`); id dan `createdAt` sengaja tidak ikut karena
 * baris baru mendapatkannya dari database.
 */
export function buildDuplicateItems(items: RabWorkItem[]): DuplicateItem[] {
  return sortWorkItems(items).map((item) => ({
    description: item.description,
    volume: item.volume,
    unit: item.unit,
    unitPrice: item.unitPrice,
    ...(item.groupName ? { groupName: item.groupName } : {}),
    ...(item.subgroupName ? { subgroupName: item.subgroupName } : {}),
    ...(item.itemGroupName ? { itemGroupName: item.itemGroupName } : {}),
    ...(typeof item.sortOrder === "number" ? { sortOrder: item.sortOrder } : {}),
  }));
}

/** Total salinan dihitung dari item yang benar-benar akan disalin. */
export function duplicateTotal(items: RabWorkItem[]): number {
  return calculateRabTotal(items);
}

/* -------------------------------------------------------------------------- */
/*  Orkestrasi (dapat diuji dengan operasi tiruan)                            */
/* -------------------------------------------------------------------------- */

export interface DuplicateDocumentInput {
  projectId: string;
  title: string;
  date: string;
}

export interface DuplicateOperations {
  createDocument(input: DuplicateDocumentInput): Promise<RabDocument>;
  insertItems(
    documentId: string,
    items: DuplicateItem[],
    baseTime: number,
  ): Promise<RabWorkItem[]>;
  deleteDocument(documentId: string): Promise<void>;
}

export interface DuplicateResult {
  document: RabDocument;
  items: RabWorkItem[];
}

export class DuplicateDocumentError extends Error {
  readonly copyId: string;
  readonly copyNumber: string;
  readonly cleanupFailed: boolean;
  readonly itemsInserted: number;
  readonly causeMessage: string;

  constructor(params: {
    copyId: string;
    copyNumber: string;
    cleanupFailed: boolean;
    itemsInserted: number;
    causeMessage: string;
  }) {
    const base = `Gagal menduplikasi dokumen: ${params.causeMessage}.`;
    const cleanup = params.cleanupFailed
      ? ` Salinan ${params.copyNumber} (id ${params.copyId}, ${params.itemsInserted} item) TIDAK berhasil dibersihkan dan mungkin masih tersimpan sebagian — hapus salinan itu secara manual sebelum mencoba lagi. Dokumen asal tidak berubah.`
      : ` Salinan yang sempat dibuat (${params.copyNumber}) sudah dibersihkan; dokumen asal tidak berubah.`;

    super(`${base}${cleanup}`);
    this.name = "DuplicateDocumentError";
    this.copyId = params.copyId;
    this.copyNumber = params.copyNumber;
    this.cleanupFailed = params.cleanupFailed;
    this.itemsInserted = params.itemsInserted;
    this.causeMessage = params.causeMessage;
  }

  /** Pesan siap tampil; TIDAK pernah mengklaim bersih bila pembersihan gagal. */
  get userMessage(): string {
    return this.message;
  }
}

/**
 * Buat salinan dokumen dan salin item per batch.
 *
 * Bila penyalinan item gagal di tengah jalan, salinan dihapus. Bila
 * penghapusan itu juga gagal, error yang dilempar tetap menyebut identitas
 * salinan agar pengguna bisa menanganinya — dokumen asal tidak pernah diubah.
 */
export async function executeDuplicate(
  source: Pick<RabDocument, "title" | "projectId" | "date">,
  title: string,
  items: RabWorkItem[],
  operations: DuplicateOperations,
  chunkSize = 200,
): Promise<DuplicateResult> {
  const copy = await operations.createDocument({
    projectId: source.projectId,
    title: title.trim() || duplicateTitle(source.title),
    date: source.date,
  });

  const payload = buildDuplicateItems(items);
  const inserted: RabWorkItem[] = [];
  const baseTime = Date.now();

  try {
    for (let index = 0; index < payload.length; index += chunkSize) {
      const chunk = payload.slice(index, index + chunkSize);
      const rows = await operations.insertItems(copy.id, chunk, baseTime + index);
      inserted.push(...rows);
    }

    return { document: copy, items: inserted };
  } catch (caught) {
    const causeMessage = caught instanceof Error ? caught.message : String(caught);
    let cleanupFailed = false;

    try {
      await operations.deleteDocument(copy.id);
    } catch {
      cleanupFailed = true;
    }

    throw new DuplicateDocumentError({
      copyId: copy.id,
      copyNumber: copy.number,
      cleanupFailed,
      itemsInserted: inserted.length,
      causeMessage,
    });
  }
}
