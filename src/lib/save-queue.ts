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
  error: string | null;
  promise: Promise<void> | null;
}

interface DocumentWrite {
  documentId: string;
  patch: SaveQueueDocumentPatch;
  error: string | null;
  promise: Promise<void> | null;
  result: RabDocument | null;
  retriedOnHide: boolean;
}

type StructuralOperation =
  | {
      kind: "add";
      documentId: string;
      clientId: string;
      preset: SaveQueueItemPreset;
    }
  | {
      kind: "delete";
      documentId: string;
      itemId: string;
    };

type FailedOperation = StructuralOperation & { message: string };

function operationKey(operation: StructuralOperation): string {
  return operation.kind === "add"
    ? `add:${operation.clientId}`
    : `delete:${operation.itemId}`;
}

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
  private readonly failedOps = new Map<string, Map<string, FailedOperation>>();
  private readonly activeOps = new Map<string, Map<string, Promise<unknown>>>();
  private readonly retrying = new Map<string, Promise<void>>();

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

  private trackOperation<T>(operation: StructuralOperation, run: () => Promise<T>): Promise<T> {
    const { documentId } = operation;
    const key = operationKey(operation);
    const active = this.activeOps.get(documentId) ?? new Map<string, Promise<unknown>>();
    // A key identifies both the operation and its return type.
    const existing = active.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const request = Promise.resolve().then(async () => {
      try {
        const result = await run();
        if (this.activeOps.get(documentId) === active) {
          const failures = this.failedOps.get(documentId);
          failures?.delete(key);
          if (failures?.size === 0) this.failedOps.delete(documentId);
        }
        return result;
      } catch (caught) {
        if (this.activeOps.get(documentId) === active) {
          const failures = this.failedOps.get(documentId) ?? new Map();
          failures.set(key, { ...operation, message: messageOf(caught) });
          this.failedOps.set(documentId, failures);
        }
        throw caught;
      }
    }).finally(() => {
      active.delete(key);
      if (active.size === 0 && this.activeOps.get(documentId) === active) {
        this.activeOps.delete(documentId);
      }
      this.changed(documentId);
    });
    active.set(key, request);
    this.activeOps.set(documentId, active);
    this.changed(documentId);
    return request;
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
        inFlight: entry.promise !== null,
        hasPatch: Object.keys(entry.patch).length > 0,
        error: entry.error,
      })),
      activeOps: this.activeOps.get(documentId)?.size ?? 0,
      failedMessage: this.failedOps.get(documentId)?.values().next().value?.message ?? null,
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
    const entry = this.itemWrites.get(itemId) ?? {
      documentId,
      patch: {},
      timer: null,
      error: null,
      promise: null,
    };
    if (entry.timer) clearTimeout(entry.timer);

    entry.patch = { ...entry.patch, ...patch };
    entry.error = null;
    entry.timer = entry.promise
      ? null
      : setTimeout(() => { void this.flushItem(itemId); }, this.debounceMs);
    this.itemWrites.set(itemId, entry);

    this.changed(documentId);
  }

  discardItem(itemId: string): void {
    const entry = this.itemWrites.get(itemId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.itemWrites.delete(itemId);
    this.changed(entry.documentId);
  }

  flushItem(itemId: string): Promise<void> {
    const entry = this.itemWrites.get(itemId);
    if (!entry) return Promise.resolve();
    if (entry.promise) return entry.promise;

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    entry.error = null;
    entry.promise = Promise.resolve().then(async () => {
      while (this.itemWrites.get(itemId) === entry) {
        const sentPatch = entry.patch;
        entry.patch = {};
        try {
          await this.ops.writeItem(itemId, sentPatch);
        } catch (caught) {
          // Simpan patch yang gagal, dengan nilai terbaru tetap diutamakan.
          entry.patch = { ...sentPatch, ...entry.patch };
          entry.error = messageOf(caught);
          break;
        }

        if (this.itemWrites.get(itemId) !== entry) break;
        if (Object.keys(entry.patch).length === 0) {
          this.itemWrites.delete(itemId);
          break;
        }
      }
      entry.promise = null;
      this.changed(entry.documentId);
    });
    this.changed(entry.documentId);
    return entry.promise;
  }

  /** Kirim semua perubahan satu dokumen dan tunggu hingga selesai. */
  async flushDocument(documentId: string): Promise<void> {
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round += 1) {
      const items = [...this.itemWrites.entries()].filter(
        ([, entry]) => entry.documentId === documentId,
      );
      const active = this.activeOps.get(documentId)?.values() ?? [];
      const retry = this.retrying.get(documentId);

      const results = await Promise.allSettled([
        ...items.map(([itemId]) => this.flushItem(itemId)),
        this.flushDocumentWrite(documentId),
        ...active,
        ...(retry ? [retry] : []),
      ]);

      const state = this.snapshot(documentId);
      if (state.phase === "error") throw new Error(state.message);
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
      if (state.phase === "saved") return;
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
      error: null,
      promise: null,
      result: null,
      retriedOnHide: false,
    };

    entry.patch = { ...entry.patch, ...patch };
    entry.error = null;
    entry.retriedOnHide = false;
    this.documentWrites.set(documentId, entry);

    await this.flushDocumentWrite(documentId);

    return this.documentWrites.get(documentId)?.result ?? entry.result;
  }

  getDocumentWriteError(documentId: string): string | null {
    return this.documentWrites.get(documentId)?.error ?? null;
  }

  private flushDocumentWrite(documentId: string): Promise<void> {
    const entry = this.documentWrites.get(documentId);
    if (!entry) return Promise.resolve();
    if (entry.promise) return entry.promise;

    entry.error = null;
    entry.promise = Promise.resolve().then(async () => {
      while (this.documentWrites.get(documentId) === entry) {
        const sentPatch = entry.patch;
        entry.patch = {};
        try {
          const updated = await this.ops.writeDocument(documentId, sentPatch);
          if (this.documentWrites.get(documentId) !== entry) break;
          entry.result = updated;
          this.handlers.onDocumentUpdated?.(updated);
        } catch (caught) {
          entry.patch = { ...sentPatch, ...entry.patch };
          entry.error = messageOf(caught);
          break;
        }

        if (this.documentWrites.get(documentId) !== entry) break;
        if (Object.keys(entry.patch).length === 0) {
          this.documentWrites.delete(documentId);
          break;
        }
      }
      entry.promise = null;
      this.changed(documentId);
    });
    this.changed(documentId);
    return entry.promise;
  }

  /* ---------------------------------------------------------------------- */
  /*  Add / delete                                                          */
  /* ---------------------------------------------------------------------- */

  async addItem(
    documentId: string,
    preset: SaveQueueItemPreset = {},
  ): Promise<RabWorkItem> {
    const clientId = preset.id ?? createClientId();
    const operation = {
      kind: "add" as const,
      documentId,
      clientId,
      preset: { ...preset, id: clientId },
    };
    const failed = this.failedOps.get(documentId)?.get(operationKey(operation));
    if (failed?.kind === "add") {
      return this.trackOperation(failed, () => this.recoverItem(failed));
    }
    return this.trackOperation(operation, () => this.ops.createItem(documentId, operation.preset));
  }

  async deleteItem(documentId: string, itemId: string): Promise<void> {
    return this.trackOperation({ kind: "delete", documentId, itemId }, async () => {
      await this.ops.deleteItem(itemId);
      this.discardItem(itemId);
      this.handlers.onItemDeleted?.(documentId, itemId);
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Retry                                                                 */
  /* ---------------------------------------------------------------------- */

  retry(documentId: string): Promise<void> {
    const existing = this.retrying.get(documentId);
    if (existing) return existing;

    const request = Promise.resolve().then(async () => {
      if (this.retrying.get(documentId) !== request) return;
      const failures = this.failedOps.get(documentId);
      const operations = [...(failures?.entries() ?? [])];
      for (const [itemId, entry] of [...this.itemWrites.entries()]) {
        if (entry.documentId !== documentId || !entry.error) continue;
        await this.flushItem(itemId);
      }

      if (this.retrying.get(documentId) !== request) return;
      if (this.documentWrites.get(documentId)?.error) {
        await this.flushDocumentWrite(documentId);
      }

      for (const [key, failure] of operations) {
        if (this.failedOps.get(documentId)?.get(key) !== failure) continue;
        try {
          if (failure.kind === "delete") {
            await this.deleteItem(documentId, failure.itemId);
          } else {
            await this.trackOperation(failure, () => this.recoverItem(failure));
          }
        } catch {
          // Kegagalan tetap tercatat per operasi. Teruskan operasi lain.
        }
      }

      const state = this.snapshot(documentId);
      if (state.phase === "error") throw new Error(state.message);
    }).finally(() => {
      if (this.retrying.get(documentId) === request) this.retrying.delete(documentId);
      this.changed(documentId);
    });
    this.retrying.set(documentId, request);
    return request;
  }

  private async recoverItem(
    operation: Extract<StructuralOperation, { kind: "add" }>,
  ): Promise<RabWorkItem> {
    const { clientId, documentId, preset } = operation;
    // Kegagalan pemeriksaan ID membatalkan insert ulang.
    const existing = await this.ops.fetchItem(clientId);
    if (existing) {
      if (existing.documentId !== documentId) {
        throw new Error("ID item yang sama sudah dipakai dokumen lain.");
      }
      this.handlers.onItemRecovered?.(documentId, existing.item);
      return existing.item;
    }

    let item: RabWorkItem;
    try {
      item = await this.ops.createItem(documentId, preset);
    } catch (caught) {
      // Respons dapat hilang setelah server menyelesaikan insert.
      const again = await this.ops.fetchItem(clientId);
      if (again?.documentId !== documentId) throw caught;
      item = again.item;
    }
    this.handlers.onItemRecovered?.(documentId, item);
    return item;
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
    this.retrying.delete(documentId);
  }

  clearAll(): void {
    for (const entry of this.itemWrites.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.itemWrites.clear();
    this.documentWrites.clear();
    this.failedOps.clear();
    this.activeOps.clear();
    this.retrying.clear();
  }

  /** Lewati debounce jika halaman disembunyikan, tanpa membuang antrean. */
  flushAllBestEffort(): void {
    for (const [itemId, entry] of this.itemWrites) {
      if (!entry.error) void this.flushItem(itemId);
    }
    for (const [documentId, entry] of this.documentWrites) {
      void this.flushDocumentBestEffort(documentId, entry);
    }
  }

  private async flushDocumentBestEffort(documentId: string, entry: DocumentWrite): Promise<void> {
    if (!entry.error) await this.flushDocumentWrite(documentId);

    // Kedua event lifecycle dapat menunggu promise yang sama. Coba ulang
    // patch metadata yang gagal sekali selama browser masih menjalankan kode.
    if (this.documentWrites.get(documentId) === entry && entry.error && !entry.retriedOnHide) {
      entry.retriedOnHide = true;
      await this.flushDocumentWrite(documentId);
    }
  }
}
