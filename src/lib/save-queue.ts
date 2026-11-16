/**
 * Orkestrasi antrean penyimpanan (tanpa React/Supabase).
 *
 * Semua I/O diberikan sebagai operasi yang dapat ditiru pada pengujian:
 * menulis item, menulis dokumen, membuat item (dengan ID dari klien),
 * mengambil item berdasarkan ID, dan menghapus item.
 *
 * Jaminan penting:
 * - ID item dibuat sekali per operasi tambah dan dipakai ulang saat retry;
 *   item dengan isi identik tetap dua pekerjaan berbeda.
 * - Retry tambah selalu memeriksa ID tersebut di server lebih dulu, sehingga
 *   respons yang hilang setelah insert tidak menghasilkan duplikat.
 * - Patch dokumen selalu dikirim dalam bentuk terbaru (bukan snapshot lama).
 * - Keberhasilan permintaan lama tidak menandai revisi yang lebih baru sebagai
 *   tersimpan.
 */

import type { RabDocument, RabUnit, RabWorkItem } from "@/types";
import { deriveDocumentSaveState, type DocumentSaveState } from "./save-status";

export interface SaveQueueDocumentPatch {
  projectId?: string;
  title?: string;
  date?: string;
}

export interface SaveQueueItemPreset {
  id?: string;
  description?: string;
  volume?: number;
  unit?: RabUnit;
  unitPrice?: number;
  groupName?: string | null;
  subgroupName?: string | null;
  itemGroupName?: string | null;
  sortOrder?: number | null;
}

export interface SavedItemLookup {
  item: RabWorkItem;
  documentId: string;
}

export interface SaveQueueOperations {
  writeItem(itemId: string, patch: Partial<RabWorkItem>): Promise<void>;
  writeDocument(
    documentId: string,
    patch: SaveQueueDocumentPatch,
  ): Promise<RabDocument>;
  createItem(
    documentId: string,
    preset: SaveQueueItemPreset,
  ): Promise<RabWorkItem>;
  fetchItem(itemId: string): Promise<SavedItemLookup | null>;
  deleteItem(itemId: string): Promise<void>;
}

export interface SaveQueueHandlers {
  onChanged?: (documentId: string) => void;
  /** Item ditemukan lagi di server saat retry (insert sebelumnya berhasil). */
  onItemRecovered?: (documentId: string, item: RabWorkItem) => void;
  onItemDeleted?: (documentId: string, itemId: string) => void;
  onDocumentUpdated?: (document: RabDocument) => void;
}

interface ItemWrite {
  documentId: string;
  patch: Partial<RabWorkItem>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  revision: number;
  sentRevision: number | null;
  error: string | null;
  promise: Promise<void> | null;
}

interface DocumentWrite {
  documentId: string;
  patch: SaveQueueDocumentPatch;
  inFlight: boolean;
  revision: number;
  sentRevision: number | null;
  error: string | null;
  promise: Promise<void> | null;
  result: RabDocument | null;
}

type FailedOperation =
  | {
      kind: "add";
      documentId: string;
      clientId: string;
      preset: SaveQueueItemPreset;
      message: string;
    }
  | {
      kind: "delete";
      documentId: string;
      itemId: string;
      message: string;
    };

export interface SaveQueueOptions {
  /** Debounce edit item (ms). */
  debounceMs?: number;
}

const MAX_FLUSH_ROUNDS = 6;

function messageOf(caught: unknown): string {
  if (caught instanceof Error && caught.message.trim()) return caught.message;
  if (typeof caught === "string" && caught.trim()) return caught;
  return "Terjadi kesalahan saat menyimpan.";
}

/** UUID v4 dari klien; dipakai sekali per operasi tambah. */
export function createClientId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("Browser ini tidak mendukung pembuatan ID item.");
}

export class SaveQueue {
  private readonly ops: SaveQueueOperations;
  private handlers: SaveQueueHandlers;
  private readonly debounceMs: number;

  private readonly itemWrites = new Map<string, ItemWrite>();
  private readonly documentWrites = new Map<string, DocumentWrite>();
  private readonly failedOps = new Map<string, FailedOperation>();
  private readonly activeOps = new Map<string, number>();
  private readonly retrying = new Set<string>();

  constructor(
    ops: SaveQueueOperations,
    handlers: SaveQueueHandlers = {},
    options: SaveQueueOptions = {},
  ) {
    this.ops = ops;
    this.handlers = handlers;
    this.debounceMs = options.debounceMs ?? 500;
  }

  setHandlers(handlers: SaveQueueHandlers): void {
    this.handlers = handlers;
  }

  private changed(documentId: string): void {
    this.handlers.onChanged?.(documentId);
  }

  private beginOperation(documentId: string): void {
    this.activeOps.set(documentId, (this.activeOps.get(documentId) ?? 0) + 1);
    this.changed(documentId);
  }

  private endOperation(documentId: string): void {
    const next = (this.activeOps.get(documentId) ?? 1) - 1;
    if (next <= 0) this.activeOps.delete(documentId);
    else this.activeOps.set(documentId, next);
    this.changed(documentId);
  }

  snapshot(documentId: string): DocumentSaveState {
    const entries = [
      ...[...this.itemWrites.values()].filter(
        (entry) => entry.documentId === documentId,
      ),
      ...[...this.documentWrites.values()].filter(
        (entry) => entry.documentId === documentId,
      ),
    ];

    return deriveDocumentSaveState({
      items: entries.map((entry) => ({
        inFlight: entry.inFlight,
        hasPatch: Object.keys(entry.patch).length > 0,
        error: entry.error,
      })),
      activeOps: this.activeOps.get(documentId) ?? 0,
      failedMessage: this.failedOps.get(documentId)?.message ?? null,
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Item edits                                                            */
  /* ---------------------------------------------------------------------- */

  updateItem(
    documentId: string,
    itemId: string,
    patch: Partial<RabWorkItem>,
  ): void {
    const existing = this.itemWrites.get(itemId);
    if (existing?.timer) clearTimeout(existing.timer);

    const inFlight = existing?.inFlight ?? false;
    const timer = inFlight
      ? null
      : setTimeout(() => {
          void this.flushItem(itemId);
        }, this.debounceMs);

    this.itemWrites.set(itemId, {
      documentId,
      patch: { ...(existing?.patch ?? {}), ...patch },
      timer,
      inFlight,
      revision: (existing?.revision ?? 0) + 1,
      sentRevision: existing?.sentRevision ?? null,
      error: null,
      promise: existing?.promise ?? null,
    });

    this.changed(documentId);
  }

  discardItem(itemId: string): void {
    const entry = this.itemWrites.get(itemId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.itemWrites.delete(itemId);
    this.changed(entry.documentId);
  }

  async flushItem(itemId: string): Promise<void> {
    const entry = this.itemWrites.get(itemId);
    if (!entry || entry.inFlight) {
      await entry?.promise;
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    entry.inFlight = true;
    entry.error = null;
    entry.sentRevision = entry.revision;

    const documentId = entry.documentId;
    const sentPatch = { ...entry.patch };
    this.changed(documentId);

    const request = (async () => {
      try {
        await this.ops.writeItem(itemId, sentPatch);

        // Entri bisa sudah diganti oleh edit baru selama permintaan berjalan.
        const current = this.itemWrites.get(itemId) ?? entry;
        current.inFlight = false;
        current.promise = null;

        if (current.revision === current.sentRevision) {
          this.itemWrites.delete(itemId);
        } else if (!current.timer) {
          // Ada edit yang lebih baru saat permintaan berjalan.
          current.timer = setTimeout(() => {
            void this.flushItem(itemId);
          }, 0);
        }
        this.changed(current.documentId);
      } catch (caught) {
        const current = this.itemWrites.get(itemId) ?? entry;
        current.inFlight = false;
        current.promise = null;
        // Patch terbaru dipertahankan agar dapat dicoba ulang.
        current.error = messageOf(caught);
        this.changed(current.documentId);
      }
    })();

    entry.promise = request;
    await request;
  }

  /** Kirim semua perubahan satu dokumen dan tunggu hingga selesai. */
  async flushDocument(documentId: string): Promise<void> {
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
      const items = [...this.itemWrites.entries()].filter(
        ([, entry]) => entry.documentId === documentId,
      );
      const documentWrite = this.documentWrites.get(documentId);

      if (items.length === 0 && !documentWrite?.error && !documentWrite?.inFlight) {
        return;
      }

      for (const [, entry] of items) {
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
      }

      await Promise.all(
        items.map(([itemId, entry]) => entry.promise ?? this.flushItem(itemId)),
      );

      if (documentWrite?.error) {
        documentWrite.error = null;
        await this.flushDocumentWrite(documentId);
      }

      const remainingItems = [...this.itemWrites.values()].filter(
        (entry) => entry.documentId === documentId,
      );
      const currentDocument = this.documentWrites.get(documentId);

      if (remainingItems.length === 0 && !currentDocument?.error && !currentDocument?.inFlight) {
        return;
      }

      const failure =
        remainingItems.find((entry) => entry.error)?.error ??
        currentDocument?.error ??
        null;
      if (failure) throw new Error(failure);
    }

    throw new Error("Perubahan dokumen belum selesai disimpan.");
  }

  /* ---------------------------------------------------------------------- */
  /*  Document patches                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Simpan patch dokumen. Patch yang menumpuk digabung dan selalu dikirim
   * dalam bentuk terbaru; respons lama tidak menimpa nilai yang lebih baru.
   */
  async updateDocument(
    documentId: string,
    patch: SaveQueueDocumentPatch,
  ): Promise<RabDocument | null> {
    const existing = this.documentWrites.get(documentId);
    const entry: DocumentWrite = existing ?? {
      documentId,
      patch: {},
      inFlight: false,
      revision: 0,
      sentRevision: null,
      error: null,
      promise: null,
      result: null,
    };

    entry.patch = { ...entry.patch, ...patch };
    entry.revision += 1;
    entry.error = null;
    this.documentWrites.set(documentId, entry);
    this.changed(documentId);

    if (entry.inFlight) {
      await entry.promise;
    }

    if (entry.inFlight || entry.revision !== entry.sentRevision) {
      await this.flushDocumentWrite(documentId);
    }

    return this.documentWrites.get(documentId)?.result ?? entry.result;
  }

  getDocumentWriteError(documentId: string): string | null {
    return this.documentWrites.get(documentId)?.error ?? null;
  }

  private async flushDocumentWrite(
    documentId: string,
    force = false,
  ): Promise<void> {
    const entry = this.documentWrites.get(documentId);
    if (!entry) return;

    if (entry.inFlight) {
      await entry.promise;
      if (entry.error) return;
      if (entry.revision !== entry.sentRevision) {
        await this.flushDocumentWrite(documentId);
      }
      return;
    }

    // `force` dipakai retry: revisi boleh sama, tetapi patch harus dikirim lagi.
    if (!force && !entry.error && entry.revision === entry.sentRevision) return;

    const sentRevision = entry.revision;
    const sentPatch = { ...entry.patch };
    entry.inFlight = true;
    entry.error = null;
    entry.sentRevision = sentRevision;
    this.changed(documentId);

    const request = (async () => {
      try {
        const updated = await this.ops.writeDocument(documentId, sentPatch);
        entry.result = updated;
        entry.inFlight = false;
        entry.promise = null;
        this.handlers.onDocumentUpdated?.(updated);

        if (entry.revision === sentRevision) {
          this.documentWrites.delete(documentId);
        } else {
          await this.flushDocumentWrite(documentId);
        }
        this.changed(documentId);
      } catch (caught) {
        entry.inFlight = false;
        entry.promise = null;
        entry.error = messageOf(caught);
        this.changed(documentId);
      }
    })();

    entry.promise = request;
    await request;
  }

  /* ---------------------------------------------------------------------- */
  /*  Add / delete                                                          */
  /* ---------------------------------------------------------------------- */

  async addItem(
    documentId: string,
    preset: SaveQueueItemPreset = {},
  ): Promise<RabWorkItem> {
    const clientId = preset.id ?? createClientId();
    const withId: SaveQueueItemPreset = { ...preset, id: clientId };

    this.beginOperation(documentId);
    try {
      const item = await this.ops.createItem(documentId, withId);
      const failure = this.failedOps.get(documentId);
      if (failure?.kind === "add" && failure.clientId === clientId) {
        this.failedOps.delete(documentId);
      }
      return item;
    } catch (caught) {
      this.failedOps.set(documentId, {
        kind: "add",
        documentId,
        clientId,
        preset: withId,
        message: messageOf(caught),
      });
      throw caught;
    } finally {
      this.endOperation(documentId);
    }
  }

  async deleteItem(documentId: string, itemId: string): Promise<void> {
    this.discardItem(itemId);
    this.beginOperation(documentId);
    try {
      await this.ops.deleteItem(itemId);
      const failure = this.failedOps.get(documentId);
      if (failure?.kind === "delete" && failure.itemId === itemId) {
        this.failedOps.delete(documentId);
      }
    } catch (caught) {
      this.failedOps.set(documentId, {
        kind: "delete",
        documentId,
        itemId,
        message: messageOf(caught),
      });
      throw caught;
    } finally {
      this.endOperation(documentId);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Retry                                                                 */
  /* ---------------------------------------------------------------------- */

  async retry(documentId: string): Promise<void> {
    if (this.retrying.has(documentId)) return;
    this.retrying.add(documentId);

    try {
      for (const [itemId, entry] of [...this.itemWrites.entries()]) {
        if (entry.documentId !== documentId || !entry.error) continue;
        entry.error = null;
        this.changed(documentId);
        await this.flushItem(itemId);
      }

      const documentWrite = this.documentWrites.get(documentId);
      if (documentWrite?.error) {
        documentWrite.error = null;
        this.changed(documentId);
        await this.flushDocumentWrite(documentId, true);
      }

      const failure = this.failedOps.get(documentId);
      if (failure) await this.retryOperation(failure);
    } finally {
      this.retrying.delete(documentId);
      this.changed(documentId);
    }
  }

  private async retryOperation(failure: FailedOperation): Promise<void> {
    const documentId = failure.documentId;
    this.beginOperation(documentId);

    try {
      if (failure.kind === "delete") {
        await this.ops.deleteItem(failure.itemId);
        this.handlers.onItemDeleted?.(documentId, failure.itemId);
        this.failedOps.delete(documentId);
        return;
      }

      // Tambah: cek identitas dulu. Kegagalan pemeriksaan = jangan insert buta.
      const existing = await this.ops.fetchItem(failure.clientId);
      if (existing) {
        if (existing.documentId !== documentId) {
          throw new Error("ID item yang sama sudah dipakai dokumen lain.");
        }
        this.handlers.onItemRecovered?.(documentId, existing.item);
        this.failedOps.delete(documentId);
        return;
      }

      try {
        const item = await this.ops.createItem(documentId, failure.preset);
        this.handlers.onItemRecovered?.(documentId, item);
        this.failedOps.delete(documentId);
      } catch (caught) {
        // Bisa jadi insert sebenarnya berhasil; periksa identitas sekali lagi.
        const again = await this.ops.fetchItem(failure.clientId);
        if (again) {
          if (again.documentId !== documentId) throw caught;
          this.handlers.onItemRecovered?.(documentId, again.item);
          this.failedOps.delete(documentId);
          return;
        }
        const current = this.failedOps.get(documentId);
        if (current) {
          this.failedOps.set(documentId, {
            ...current,
            message: messageOf(caught),
          });
        }
        throw caught;
      }
    } catch (caught) {
      const current = this.failedOps.get(documentId);
      if (current && current.kind === failure.kind) {
        this.failedOps.set(documentId, {
          ...current,
          message: messageOf(caught),
        });
      }
      throw caught;
    } finally {
      this.endOperation(documentId);
    }
  }

  /* ---------------------------------------------------------------------- */
  /*  Cleanup                                                               */
  /* ---------------------------------------------------------------------- */

  clearDocument(documentId: string): void {
    for (const [itemId, entry] of this.itemWrites) {
      if (entry.documentId !== documentId) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.itemWrites.delete(itemId);
    }
    this.documentWrites.delete(documentId);
    this.failedOps.delete(documentId);
    this.activeOps.delete(documentId);
  }

  clearAll(): void {
    for (const entry of this.itemWrites.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.itemWrites.clear();
    this.documentWrites.clear();
    this.failedOps.clear();
    this.activeOps.clear();
  }

  /** Kirim semua patch item yang belum terkirim (best effort, saat halaman ditutup). */
  flushAllBestEffort(): void {
    for (const [itemId, entry] of this.itemWrites) {
      if (entry.timer) clearTimeout(entry.timer);
      if (!entry.inFlight && !entry.error) {
        void this.ops.writeItem(itemId, entry.patch).catch(() => {});
      }
    }
    this.itemWrites.clear();
  }
}
