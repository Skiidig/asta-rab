/**
 * Status penyimpanan per dokumen.
 *
 * Diturunkan dari kondisi antrean nyata (bukan dari perubahan state editor):
 * - `pending`: ada perubahan menunggu debounce (belum dikirim).
 * - `saving`: ada permintaan tulis yang sedang berjalan.
 * - `error`: ada penulisan gagal; pesan disimpan untuk ditampilkan.
 * - `saved`: tidak ada perubahan tertunda maupun yang berjalan.
 */

export type DocumentSavePhase = "saved" | "pending" | "saving" | "error";

export interface DocumentSaveState {
  phase: DocumentSavePhase;
  message?: string;
}

export interface ItemSaveSnapshot {
  /** Permintaan tulis sedang berjalan. */
  inFlight: boolean;
  /** Masih menyimpan patch yang belum terkirim. */
  hasPatch: boolean;
  /** Pesan kesalahan terakhir untuk item ini. */
  error: string | null;
}

/**
 * Prioritas: error > saving > pending > saved.
 *
 * `activeOps` menghitung operasi segera (judul/tambah/hapus) yang sedang
 * berjalan; `failedMessage` berasal dari operasi segera yang gagal.
 */
export function deriveDocumentSaveState(input: {
  items: ItemSaveSnapshot[];
  activeOps: number;
  failedMessage?: string | null;
}): DocumentSaveState {
  const itemError = input.items.find((item) => item.error);
  if (input.failedMessage) {
    return { phase: "error", message: input.failedMessage };
  }
  if (itemError?.error) {
    return { phase: "error", message: itemError.error };
  }
  if (input.activeOps > 0 || input.items.some((item) => item.inFlight)) {
    return { phase: "saving" };
  }
  if (input.items.some((item) => item.hasPatch)) {
    return { phase: "pending" };
  }
  return { phase: "saved" };
}
