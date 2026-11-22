"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toErrorMessage } from "@/lib/errors";
import { useAuth } from "@/components/providers/auth-provider";
import {
  getLegacyMigrationSummary,
  markLegacyMigrationComplete,
  readLegacySnapshot,
  type LegacyMigrationSummary,
} from "@/lib/legacy-migration";
import { migrateLegacySnapshot } from "@/lib/supabase/migrate";
import {
  DuplicateDocumentError,
  executeDuplicate,
  type DuplicateOperations,
} from "@/lib/duplicate-rab";
import { SaveQueue } from "@/lib/save-queue";
import type { DocumentSaveState } from "@/lib/save-status";
import {
  countDocumentItems,
  createDocumentRecord,
  createProjectRecord,
  createWorkItemRecord,
  deleteDocumentRecord,
  deleteProjectRecord,
  deleteWorkItemRecord,
  EMPTY_WORKSPACE,
  fetchWorkItemRecord,
  fetchWorkspace,
  insertWorkItemsRecord,
  recomputeWorkspace,
  updateDocumentRecord,
  updateProjectRecord,
  updateWorkItemRecord,
  type WorkItemPreset,
  type WorkspaceData,
} from "@/lib/supabase/data";
import type {
  Project,
  ProjectStatus,
  RabDocument,
  RabDocumentDetail,
  RabUnit,
  RabWorkItem,
} from "@/types";

export interface ProjectInput {
  name: string;
  client: string;
  location: string;
  startDate: string;
  status: ProjectStatus;
}

export interface DocumentInput {
  projectId: string;
  title: string;
  date: string;
}

export type DocumentPatchInput = Partial<DocumentInput>;

/** Ukuran batch insert item saat import (batas praktis sekali kirim). */
const IMPORT_CHUNK_SIZE = 200;

/** Operasi I/O untuk duplikasi; dipisah agar orkestrasinya bisa diuji. */
const DUPLICATE_OPERATIONS: DuplicateOperations = {
  createDocument: (input) => createDocumentRecord(input),
  insertItems: (documentId, items, baseTime) =>
    insertWorkItemsRecord(documentId, items, baseTime),
  deleteDocument: (documentId) => deleteDocumentRecord(documentId),
};

/** Baris hasil import Excel yang akan disimpan sebagai item RAB. */
export interface ImportItemInput {
  description: string;
  volume: number;
  unit: RabUnit;
  unitPrice: number;
  /** Konteks struktur dari Excel (opsional). */
  groupName?: string;
  subgroupName?: string;
  itemGroupName?: string;
  sortOrder?: number;
}

export interface ImportDocumentInput {
  projectId: string;
  title: string;
  date: string;
  items: ImportItemInput[];
}

export type LoadStatus = "loading" | "ready" | "error";

export interface MigrationOutcome extends LegacyMigrationSummary {
  /** `false` when the local marker could not be written. */
  markerSaved: boolean;
}

interface DataContextValue {
  status: LoadStatus;
  error: string | null;
  projects: Project[];
  documents: RabDocument[];
  /** Pending legacy localStorage migration, if any. */
  migration: LegacyMigrationSummary | null;
  refresh: () => Promise<void>;
  dismissMigration: () => void;
  runMigration: () => Promise<MigrationOutcome>;
  getProject: (id: string) => Project | undefined;
  getDocument: (id: string) => RabDocument | undefined;
  getDocumentsForProject: (projectId: string) => RabDocument[];
  getDocumentDetail: (id: string) => RabDocumentDetail | undefined;
  createProject: (input: ProjectInput) => Promise<Project>;
  updateProject: (id: string, input: ProjectInput) => Promise<Project>;
  deleteProject: (id: string) => Promise<{ deletedDocuments: number }>;
  createDocument: (input: DocumentInput) => Promise<RabDocument>;
  updateDocument: (
    id: string,
    input: DocumentPatchInput,
  ) => Promise<RabDocument>;
  deleteDocument: (id: string) => Promise<void>;
  duplicateDocument: (id: string, title?: string) => Promise<RabDocument>;
  /** Menambah baris item; `preset` mengisi nilai awal (mis. dari katalog). */
  addWorkItem: (
    documentId: string,
    preset?: WorkItemPreset,
  ) => Promise<RabWorkItem>;
  /** Optimistically updates the row and saves it after a short debounce. */
  updateWorkItem: (
    documentId: string,
    itemId: string,
    patch: Partial<RabWorkItem>,
  ) => void;
  removeWorkItem: (documentId: string, itemId: string) => Promise<void>;
  /**
   * Buat dokumen RAB baru dari hasil import Excel beserta itemnya.
   * Dokumen lama tidak pernah ditimpa.
   */
  importDocument: (input: ImportDocumentInput) => Promise<RabDocument>;
  /** Status penyimpanan per dokumen (dari antrean tulis sebenarnya). */
  getDocumentSaveState: (documentId: string) => DocumentSaveState;
  /** Kirim ulang perubahan yang gagal untuk dokumen tersebut. */
  retryDocumentSave: (documentId: string) => Promise<void>;
  /** Kirim perubahan tertunda untuk satu dokumen dan tunggu hasilnya. */
  flushDocumentWrites: (documentId: string) => Promise<void>;
  getComparisonSnapshot: (
    baselineId: string,
    comparisonId: string,
  ) => Promise<readonly [RabDocumentDetail | undefined, RabDocumentDetail | undefined]>;
}

const DataContext = createContext<DataContextValue | null>(null);

function readDocumentDetail(
  workspace: WorkspaceData,
  id: string,
): RabDocumentDetail | undefined {
  const document = workspace.documents.find((entry) => entry.id === id);
  if (!document) return undefined;

  const project = workspace.projects.find((entry) => entry.id === document.projectId);
  return {
    ...document,
    client: project?.client || "—",
    location: project?.location || "—",
    // Store diperbarui secara immutabel. Pertahankan identitas item saat render.
    items: workspace.items[id] ?? [],
  };
}

/**
 * Supabase-backed data layer.
 *
 * Reads the whole workspace once per load, then keeps a local copy in sync
 * after every successful mutation. Nothing is seeded: while loading, or when
 * a query fails, the collections stay empty so demo data is never presented as
 * real data.
 */
export function DataProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, user } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceData>(EMPTY_WORKSPACE);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState<LegacyMigrationSummary | null>(
    null,
  );

  const workspaceRef = useRef(workspace);
  const migrationDismissedRef = useRef(false);
  const [saveStates, setSaveStates] = useState<Record<string, DocumentSaveState>>({});
  const queueRef = useRef<SaveQueue | null>(null);

  const commit = useCallback(
    (updater: (current: WorkspaceData) => WorkspaceData) => {
      const next = recomputeWorkspace(updater(workspaceRef.current));
      workspaceRef.current = next;
      setWorkspace(next);
    },
    [],
  );

  /**
   * Fetch the workspace and store the result.
   *
   * Deliberately performs no synchronous state update before the first `await`:
   * React forbids setting state synchronously from an effect body, and the
   * initial `status` is already `"loading"`. Callers that want an explicit
   * loading phase (a retry click) use `refresh` below.
   */
  const load = useCallback(async () => {
    try {
      const data = await fetchWorkspace();
      workspaceRef.current = data;
      setWorkspace(data);
      setStatus("ready");
      setError(null);

      if (!migrationDismissedRef.current) {
        setMigration(getLegacyMigrationSummary());
      }
    } catch (caught) {
      const message = toErrorMessage(
        caught,
        "Gagal memuat data dari Supabase.",
      );
      workspaceRef.current = EMPTY_WORKSPACE;
      setWorkspace(EMPTY_WORKSPACE);
      setStatus("error");
      setError(message);
    }
  }, []);

  /** Re-fetch from an event handler, showing the loading state first. */
  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    await load();
  }, [load]);

  /**
   * Buang data milik pengguna sebelumnya saat sesi berakhir, supaya workspace
   * orang lain tidak pernah tertinggal di layar (RLS tetap menolak query-nya,
   * tetapi state klien harus ikut bersih).
   */
  const reset = useCallback(() => {
    queueRef.current?.clearAll();
    setSaveStates({});

    workspaceRef.current = EMPTY_WORKSPACE;
    setWorkspace(EMPTY_WORKSPACE);
    setStatus("loading");
    setError(null);
    setMigration(null);
  }, []);

  useEffect(() => {
    if (authStatus === "authenticated") {
      // Scheduled outside the effect body: `load` updates state, and a
      // synchronous state update inside an effect triggers a cascading render
      // (react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        void load();
      });
      return;
    }

    if (authStatus === "unauthenticated") {
      queueMicrotask(() => {
        reset();
      });
    }
  }, [authStatus, user?.id, load, reset]);

  /**
   * Re-read the workspace without switching to the loading state. Used after a
   * failed background item write so the UI reflects what is actually stored.
   */
  const resync = useCallback(async () => {
    try {
      const data = await fetchWorkspace();
      workspaceRef.current = data;
      setWorkspace(data);
      setStatus("ready");
      setError(null);
    } catch {
      // Keep the current data; the next explicit refresh will report errors.
    }
  }, []);

  /**
   * Antrean penyimpanan per dokumen. Dibuat sekali; orkestrasi (debounce,
   * revisi, retry) berada di `SaveQueue` agar dapat diuji dengan I/O tiruan.
   */
  const getQueue = useCallback(() => {
    if (queueRef.current) return queueRef.current;

    const appendWorkItem = (documentId: string, item: RabWorkItem) => {
      commit((state) => {
        const items = state.items[documentId] ?? [];
        if (items.some((entry) => entry.id === item.id)) return state;
        return {
          ...state,
          items: {
            ...state.items,
            [documentId]: [...items, item],
          },
        };
      });
    };

    queueRef.current = new SaveQueue(
      {
        writeItem: (itemId, patch) => updateWorkItemRecord(itemId, patch),
        writeDocument: (documentId, patch) =>
          updateDocumentRecord(documentId, patch),
        createItem: async (documentId, preset) => {
          const item = await createWorkItemRecord(documentId, preset);
          // Terbitkan item sebelum flush dapat mengambil snapshot dokumen.
          appendWorkItem(documentId, item);
          return item;
        },
        fetchItem: (itemId) => fetchWorkItemRecord(itemId),
        deleteItem: (itemId) => deleteWorkItemRecord(itemId),
      },
      {
        onChanged: (documentId) => {
          const queue = queueRef.current;
          if (!queue) return;
          const next = queue.snapshot(documentId);
          setSaveStates((previous) => {
            const current = previous[documentId];
            if (
              current?.phase === next.phase &&
              current?.message === next.message
            ) {
              return previous;
            }
            return { ...previous, [documentId]: next };
          });
        },
        onItemRecovered: appendWorkItem,
        onItemDeleted: (documentId, itemId) => {
          commit((state) => {
            const items = state.items[documentId];
            if (!items?.some((entry) => entry.id === itemId)) return state;
            return {
              ...state,
              items: {
                ...state.items,
                [documentId]: items.filter((entry) => entry.id !== itemId),
              },
            };
          });
        },
        onDocumentUpdated: (updated) => {
          commit((state) => ({
            ...state,
            documents: state.documents.map((document) =>
              document.id === updated.id
                ? {
                    ...document,
                    ...updated,
                    projectName: document.projectName,
                    total: document.total,
                    itemCount: document.itemCount,
                  }
                : document,
            ),
          }));
        },
      },
    );

    return queueRef.current;
  }, [commit]);

  /** Best effort for item and metadata writes while the browser still runs. */
  const flushPendingWrites = useCallback(() => {
    queueRef.current?.flushAllBestEffort();
  }, []);

  const flushAndReadWorkspace = useCallback(
    async (documentIds: string[]) => {
      const queue = getQueue();
      function documentTitle(id: string) {
        return workspaceRef.current.documents.find((entry) => entry.id === id)?.title ?? id;
      }
      function saveError(id: string, message: string) {
        return new Error(
          `Perubahan dokumen "${documentTitle(id)}" belum tersimpan (${message}). Buka dokumen dan pilih Coba lagi jika status penyimpanan gagal.`,
        );
      }

      await Promise.all(documentIds.map(async (id) => {
        try {
          await queue.flushDocument(id);
        } catch (caught) {
          throw saveError(id, toErrorMessage(caught));
        }
      }));

      // Periksa lagi dan ambil snapshot dalam giliran yang sama. Saat menunggu
      // dokumen lain, perubahan baru bisa masuk ke antrean dokumen pertama.
      for (const id of documentIds) {
        const state = queue.snapshot(id);
        if (state.phase === "error") {
          throw saveError(id, state.message ?? "Gagal menyimpan");
        }
        if (state.phase !== "saved") {
          throw new Error(`Tunggu sampai perubahan dokumen "${documentTitle(id)}" tersimpan, lalu coba lagi.`);
        }
      }
      return workspaceRef.current;
    },
    [getQueue],
  );

  const flushDocumentWrites = useCallback(
    async (documentId: string) => {
      await flushAndReadWorkspace([documentId]);
    },
    [flushAndReadWorkspace],
  );

  const getComparisonSnapshot = useCallback(
    async (baselineId: string, comparisonId: string) => {
      const snapshot = await flushAndReadWorkspace([baselineId, comparisonId]);
      return [
        readDocumentDetail(snapshot, baselineId),
        readDocumentDetail(snapshot, comparisonId),
      ] as const;
    },
    [flushAndReadWorkspace],
  );

  useEffect(() => {
    const handlePageHide = () => flushPendingWrites();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingWrites();
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingWrites();
    };
  }, [flushPendingWrites]);

  const getProject = useCallback(
    (id: string) => workspace.projects.find((project) => project.id === id),
    [workspace.projects],
  );

  const getDocument = useCallback(
    (id: string) => workspace.documents.find((document) => document.id === id),
    [workspace.documents],
  );

  const getDocumentsForProject = useCallback(
    (projectId: string) =>
      workspace.documents.filter(
        (document) => document.projectId === projectId,
      ),
    [workspace.documents],
  );

  const getDocumentDetail = useCallback(
    (id: string) => readDocumentDetail(workspace, id),
    [workspace],
  );

  /* ---------------------------------------------------------------------- */
  /*  Project CRUD                                                          */
  /* ---------------------------------------------------------------------- */

  const createProject = useCallback(
    async (input: ProjectInput) => {
      const created = await createProjectRecord(input);
      commit((current) => ({
        ...current,
        projects: [created, ...current.projects],
      }));

      return (
        workspaceRef.current.projects.find(
          (project) => project.id === created.id,
        ) ?? created
      );
    },
    [commit],
  );

  const updateProject = useCallback(
    async (id: string, input: ProjectInput) => {
      const updated = await updateProjectRecord(id, input);
      commit((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === id
            ? {
                ...project,
                ...updated,
                documentCount: project.documentCount,
                totalRab: project.totalRab,
              }
            : project,
        ),
      }));

      return (
        workspaceRef.current.projects.find((project) => project.id === id) ??
        updated
      );
    },
    [commit],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const current = workspaceRef.current;
      if (!current.projects.some((project) => project.id === id)) {
        throw new Error("Proyek tidak ditemukan.");
      }

      const documentIds = new Set(
        current.documents
          .filter((document) => document.projectId === id)
          .map((document) => document.id),
      );

      await deleteProjectRecord(id);

      // Batalkan antrean untuk dokumen yang ikut terhapus.
      for (const documentId of documentIds) {
        queueRef.current?.clearDocument(documentId);
      }
      setSaveStates((previous) => {
        const next = { ...previous };
        for (const documentId of documentIds) delete next[documentId];
        return next;
      });

      commit((state) => {
        const items = { ...state.items };
        for (const documentId of documentIds) delete items[documentId];

        return {
          ...state,
          projects: state.projects.filter((project) => project.id !== id),
          documents: state.documents.filter(
            (document) => document.projectId !== id,
          ),
          items,
        };
      });

      return { deletedDocuments: documentIds.size };
    },
    [commit],
  );

  /* ---------------------------------------------------------------------- */
  /*  RAB document CRUD                                                     */
  /* ---------------------------------------------------------------------- */

  const createDocument = useCallback(
    async (input: DocumentInput) => {
      if (
        !workspaceRef.current.projects.some(
          (project) => project.id === input.projectId,
        )
      ) {
        throw new Error("Proyek yang dipilih tidak ditemukan.");
      }

      const created = await createDocumentRecord(input);
      commit((current) => ({
        ...current,
        documents: [...current.documents, created],
        items: { ...current.items, [created.id]: [] },
      }));

      return (
        workspaceRef.current.documents.find(
          (document) => document.id === created.id,
        ) ?? created
      );
    },
    [commit],
  );

  const updateDocument = useCallback(
    async (id: string, input: DocumentPatchInput) => {
      const current = workspaceRef.current;
      const existing = current.documents.find((document) => document.id === id);
      if (!existing) throw new Error("Dokumen RAB tidak ditemukan.");

      const projectId = input.projectId ?? existing.projectId;
      if (!current.projects.some((project) => project.id === projectId)) {
        throw new Error("Proyek yang dipilih tidak ditemukan.");
      }

      const updated = await getQueue().updateDocument(id, input);
      return (
        workspaceRef.current.documents.find((document) => document.id === id) ??
        updated ??
        existing
      );
    },
    [getQueue],
  );

  const deleteDocument = useCallback(
    async (id: string) => {
      if (
        !workspaceRef.current.documents.some(
          (document) => document.id === id,
        )
      ) {
        throw new Error("Dokumen RAB tidak ditemukan.");
      }

      queueRef.current?.clearDocument(id);
      setSaveStates((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });

      await deleteDocumentRecord(id);
      commit((state) => {
        const items = { ...state.items };
        delete items[id];

        return {
          ...state,
          documents: state.documents.filter((document) => document.id !== id),
          items,
        };
      });
    },
    [commit],
  );

  const duplicateDocument = useCallback(
    async (id: string, title?: string) => {
      if (status !== "ready") {
        throw new Error(
          "Data dokumen belum siap. Tunggu sampai halaman selesai dimuat lalu coba lagi.",
        );
      }

      const workspace = await flushAndReadWorkspace([id]);
      const source = workspace.documents.find((document) => document.id === id);
      if (!source) throw new Error("Dokumen sumber tidak ditemukan.");

      const items = workspace.items[id];
      if (!Array.isArray(items)) {
        throw new Error(
          "Item dokumen sumber belum termuat. Muat ulang halaman lalu coba lagi.",
        );
      }

      const storedCount = await countDocumentItems(id);
      if (storedCount !== items.length) {
        throw new Error(
          `Dokumen sumber memiliki ${storedCount} item, tetapi baru ${items.length} yang termuat. Muat ulang halaman lalu coba lagi.`,
        );
      }

      try {
        const result = await executeDuplicate(
          source,
          title ?? "",
          items,
          DUPLICATE_OPERATIONS,
          IMPORT_CHUNK_SIZE,
        );

        commit((state) => ({
          ...state,
          documents: [...state.documents, result.document],
          items: { ...state.items, [result.document.id]: result.items },
        }));

        return (
          workspaceRef.current.documents.find(
            (document) => document.id === result.document.id,
          ) ?? result.document
        );
      } catch (caught) {
        if (caught instanceof DuplicateDocumentError) {
          // Pembersihan gagal → muat ulang agar salinan sisa terlihat dan bisa
          // ditangani; pesannya menyebut identitas salinan tersebut.
          if (caught.cleanupFailed) void resync();
          throw new Error(caught.userMessage);
        }
        throw caught;
      }
    },
    [commit, flushAndReadWorkspace, resync, status],
  );

  /* ---------------------------------------------------------------------- */
  /*  Work item CRUD                                                        */
  /* ---------------------------------------------------------------------- */

  const addWorkItem = useCallback(
    async (documentId: string, preset?: WorkItemPreset) => {
      if (
        !workspaceRef.current.documents.some(
          (document) => document.id === documentId,
        )
      ) {
        throw new Error("Dokumen RAB tidak ditemukan.");
      }

      // ID item dibuat sekali di antrean dan dipakai ulang saat retry.
      return getQueue().addItem(documentId, preset ?? {});
    },
    [getQueue],
  );

  /**
   * Import Excel: buat dokumen RAB baru lalu isi itemnya.
   *
   * Dokumen lama tidak pernah disentuh. Bila penyimpanan item gagal di tengah
   * jalan, dokumen yang baru dibuat dihapus kembali agar tidak ada data parsial.
   */
  const importDocument = useCallback(
    async (input: ImportDocumentInput) => {
      if (
        !workspaceRef.current.projects.some(
          (project) => project.id === input.projectId,
        )
      ) {
        throw new Error("Proyek yang dipilih tidak ditemukan.");
      }
      if (input.items.length === 0) {
        throw new Error("Tidak ada baris valid untuk diimpor.");
      }

      const created = await createDocumentRecord({
        projectId: input.projectId,
        title: input.title.trim() || "RAB Import",
        date: input.date,
      });

      try {
        const inserted: RabWorkItem[] = [];
        const baseTime = Date.now();

        for (let index = 0; index < input.items.length; index += IMPORT_CHUNK_SIZE) {
          const chunk = input.items.slice(index, index + IMPORT_CHUNK_SIZE);
          const rows = await insertWorkItemsRecord(
            created.id,
            chunk,
            baseTime + index,
          );
          inserted.push(...rows);
        }

        commit((current) => ({
          ...current,
          documents: [...current.documents, created],
          items: { ...current.items, [created.id]: inserted },
        }));

        return (
          workspaceRef.current.documents.find(
            (document) => document.id === created.id,
          ) ?? created
        );
      } catch (caught) {
        // Jangan tinggalkan dokumen setengah jadi.
        await deleteDocumentRecord(created.id).catch(() => {});
        throw caught;
      }
    },
    [commit],
  );

  const updateWorkItem = useCallback(
    (
      documentId: string,
      itemId: string,
      patch: Partial<RabWorkItem>,
    ) => {
      commit((state) => {
        const items = state.items[documentId];
        if (!items?.some((item) => item.id === itemId)) return state;

        return {
          ...state,
          items: {
            ...state.items,
            [documentId]: items.map((item) =>
              item.id === itemId ? { ...item, ...patch } : item,
            ),
          },
        };
      });

      getQueue().updateItem(documentId, itemId, patch);
    },
    [commit, getQueue],
  );

  const removeWorkItem = useCallback(
    (documentId: string, itemId: string) => getQueue().deleteItem(documentId, itemId),
    [getQueue],
  );

  const getDocumentSaveState = useCallback(
    (documentId: string): DocumentSaveState =>
      saveStates[documentId] ?? { phase: "saved" },
    [saveStates],
  );

  /**
   * Kirim ulang perubahan yang gagal untuk satu dokumen melalui antrean.
   *
   * - Edit item: patch terbaru pada antrean dikirim ulang (bukan versi lama).
   * - Patch dokumen: seluruh field terbaru dikirim, bukan snapshot lama.
   * - Tambah: ID dari klien diperiksa dulu ke server; insert hanya dilakukan
   *   bila item dengan ID itu benar-benar belum ada.
   * - Hapus: idempoten.
   */
  const retryDocumentSave = useCallback(
    async (documentId: string) => {
      await getQueue().retry(documentId);
    },
    [getQueue],
  );

  /* ---------------------------------------------------------------------- */
  /*  Legacy localStorage migration                                         */
  /* ---------------------------------------------------------------------- */

  const dismissMigration = useCallback(() => {
    migrationDismissedRef.current = true;
    setMigration(null);
  }, []);

  const runMigration = useCallback(async (): Promise<MigrationOutcome> => {
    const snapshot = readLegacySnapshot();
    if (!snapshot) {
      throw new Error(
        "Data lokal tidak ditemukan atau sudah tidak dapat dibaca.",
      );
    }

    const result = await migrateLegacySnapshot(snapshot);
    const markerSaved = markLegacyMigrationComplete(result);

    migrationDismissedRef.current = true;
    setMigration(null);
    await refresh();

    return { ...result, markerSaved };
  }, [refresh]);

  const value = useMemo<DataContextValue>(
    () => ({
      status,
      error,
      projects: workspace.projects,
      documents: workspace.documents,
      migration,
      refresh,
      dismissMigration,
      runMigration,
      getProject,
      getDocument,
      getDocumentsForProject,
      getDocumentDetail,
      createProject,
      updateProject,
      deleteProject,
      createDocument,
      updateDocument,
      deleteDocument,
      duplicateDocument,
      addWorkItem,
      updateWorkItem,
      removeWorkItem,
      importDocument,
      getDocumentSaveState,
      retryDocumentSave,
      flushDocumentWrites,
      getComparisonSnapshot,
    }),
    [
      status,
      error,
      workspace.projects,
      workspace.documents,
      migration,
      refresh,
      dismissMigration,
      runMigration,
      getProject,
      getDocument,
      getDocumentsForProject,
      getDocumentDetail,
      createProject,
      updateProject,
      deleteProject,
      createDocument,
      updateDocument,
      deleteDocument,
      duplicateDocument,
      addWorkItem,
      updateWorkItem,
      removeWorkItem,
      importDocument,
      getDocumentSaveState,
      retryDocumentSave,
      flushDocumentWrites,
      getComparisonSnapshot,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used inside <DataProvider>.");
  }
  return context;
}
