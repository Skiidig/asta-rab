"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Calculator, ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";

import { useSetHeaderOverride } from "@/components/layout/header-override";
import { useData } from "@/components/providers/data-provider";
import { AhspPickerDialog } from "@/components/rab/ahsp-picker-dialog";
import { CatalogPickerDialog } from "@/components/rab/catalog-picker-dialog";
import { DuplicateDocumentDialog } from "@/components/rab/duplicate-document-dialog";
import { CompareDocumentsDialog } from "@/components/rab/compare-documents-dialog";
import { DocumentHeader } from "@/components/rab/editor/document-header";
import { RabNotFound } from "@/components/rab/editor/rab-not-found";
import { RabSummary } from "@/components/rab/editor/rab-summary";
import { WorkItemsTable } from "@/components/rab/editor/work-items-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataError } from "@/components/shared/data-error";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { catalogItemToWorkItemPreset } from "@/lib/catalog";
import { ahspAnalysisToWorkItemPreset } from "@/lib/ahsp";
import { toErrorMessage } from "@/lib/errors";
import { calculateRabTotal, countFilledItems } from "@/lib/rab-calc";
import {
  buildAddItemPlacement,
  buildGroupPlacementOptions,
  type HierarchyContext,
} from "@/lib/rab-hierarchy";
import type { WorkItemPreset } from "@/lib/supabase/data";
import type { AhspAnalysisDetail, CatalogItem, RabWorkItem } from "@/types";
/**
 * RAB editor container.
 *
 * Reads the document from the shared data store and writes every change back
 * through it, so edits survive navigation and refresh. Item amounts and the
 * document total are derived from raw numbers on render.
 */
export function RabEditor({ documentId }: { documentId: string }) {
  const {
    status,
    error,
    refresh,
    getDocumentDetail,
    updateDocument,
    addWorkItem,
    updateWorkItem,
    removeWorkItem,
  } = useData();
  const [pendingDelete, setPendingDelete] = useState<RabWorkItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ahspPickerOpen, setAhspPickerOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const addingRef = useRef(false);
  const router = useRouter();
  // Perubahan judul terakhir; ditunggu sebelum dialog duplikasi dibuka agar
  // judul salinan berasal dari judul sumber yang sudah tersimpan.
  const titleWriteRef = useRef<Promise<unknown> | null>(null);

  const document = getDocumentDetail(documentId);

  // Reflect the (possibly edited) title in the app header and breadcrumb.
  useSetHeaderOverride({
    title: document?.title,
    crumbLabel: document?.number,
  });

  const items = useMemo(() => document?.items ?? [], [document]);

  // Satu pilihan per kemunculan GROUP; label berulang mendapat id/anchor
  // berbeda agar penempatan tidak digabung berdasarkan nama.
  const ahspPlacementGroups = useMemo(
    () => buildGroupPlacementOptions(items),
    [items],
  );

  // Ref agar callback stabil (memo baris tabel) tetap membaca item terbaru.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleChangeItem = useCallback(
    (id: string, patch: Partial<RabWorkItem>) => {
      updateWorkItem(documentId, id, patch);
    },
    [updateWorkItem, documentId],
  );

  const handleRemoveItem = useCallback((id: string) => {
    const target = itemsRef.current.find((entry) => entry.id === id);
    if (target) setPendingDelete(target);
  }, []);

  const addWhileIdle = useCallback(
    async (buildPreset: () => WorkItemPreset) => {
      // Tahan klik berikutnya tanpa menunggu render ulang.
      if (addingRef.current) return false;
      addingRef.current = true;
      try {
        await addWorkItem(documentId, buildPreset());
        return true;
      } finally {
        addingRef.current = false;
      }
    },
    [addWorkItem, documentId],
  );

  /**
   * Tambah item. Bila dipanggil dari tombol "+" pada heading, item mewarisi
   * GROUP/SUBGROUP/ITEM GROUP heading tersebut dan disisipkan di dalamnya;
   * tanpa konteks, item mengikuti kelompok item terakhir dokumen.
   */
  const handleAddItem = useCallback(
    async (context?: HierarchyContext) => {
      try {
        await addWhileIdle(() => buildAddItemPlacement(itemsRef.current, context));
      } catch (caught) {
        toast.error("Gagal menambah pekerjaan", {
          description: toErrorMessage(caught),
        });
      }
    },
    [addWhileIdle],
  );

  if (!document) {
    // The document may simply not be loaded yet; avoid flashing a "not found"
    // state while the workspace is still being fetched.
    if (status === "loading") return <EditorLoading />;

    if (status === "error") {
      return (
        <DataError
          message={error ?? "Gagal memuat dokumen RAB dari Supabase."}
          onRetry={() => void refresh()}
        />
      );
    }

    return <RabNotFound id={documentId} />;
  }

  const total = calculateRabTotal(items);
  const filledCount = countFilledItems(items);

  async function removeItem(item: RabWorkItem) {
    try {
      await removeWorkItem(documentId, item.id);
      toast.success("Pekerjaan dihapus", {
        description: item.description || "Baris tanpa uraian",
      });
    } catch (caught) {
      toast.error("Gagal menghapus pekerjaan", {
        description: toErrorMessage(caught),
      });
    }
  }

  /**
   * Tambahkan item RAB dari katalog.
   *
   * Nama, satuan, dan harga disalin ke baris RAB (snapshot); volume dimulai dari
   * 1 dan bisa langsung diubah pengguna.
   */
  async function handlePickFromCatalog(item: CatalogItem) {
    try {
      // Item dari katalog ikut konteks kelompok terakhir agar tidak jatuh di
      // luar hierarki dokumen.
      const added = await addWhileIdle(() => ({
        ...catalogItemToWorkItemPreset(item),
        ...buildAddItemPlacement(items),
      }));
      if (!added) return;
      setPickerOpen(false);
      toast.success("Item ditambahkan dari katalog", {
        description: `${item.name} · ${item.unit}`,
      });
    } catch (caught) {
      toast.error("Gagal menambah item dari katalog", {
        description: toErrorMessage(caught),
      });
    }
  }

  /**
   * Tambahkan item RAB dari analisis AHSP.
   *
   * Harga satuan = total analisis saat ini, disalin (snapshot) ke baris RAB.
   * Perubahan analisis di kemudian hari tidak mengubah item ini.
   */
  async function handlePickFromAhsp(
    analysis: AhspAnalysisDetail,
    context?: HierarchyContext,
  ) {
    try {
      const added = await addWhileIdle(() => ({
        ...ahspAnalysisToWorkItemPreset(analysis),
        ...buildAddItemPlacement(items, context),
      }));
      if (!added) return;
      setAhspPickerOpen(false);
      toast.success("Pekerjaan ditambahkan dari AHSP", {
        description: `${analysis.name} · per ${analysis.unit}`,
      });
    } catch (caught) {
      toast.error("Gagal menambah pekerjaan dari AHSP", {
        description: toErrorMessage(caught),
      });
    }
  }

  return (
    <div className="space-y-6">
      <DocumentHeader
        document={document}
        title={document.title}
        onTitleChange={(title) => {
          titleWriteRef.current = updateDocument(documentId, { title });
        }}
        onDuplicate={() => {
          void (async () => {
            await titleWriteRef.current?.catch(() => {});
            setDuplicateOpen(true);
          })();
        }}
        onCompare={() => setCompareOpen(true)}
      />

      <section aria-labelledby="work-items-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="work-items-heading"
              className="text-[15px] font-semibold tracking-tight text-foreground"
            >
              Rincian Pekerjaan
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Isi volume dan harga satuan — jumlah harga dan total dihitung otomatis.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {filledCount} dari {items.length} pekerjaan terisi uraian
          </p>
        </div>

        {items.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface shadow-card">
            <EmptyState
              icon={ClipboardList}
              title="Belum ada pekerjaan"
              description="Tambahkan pekerjaan pertama untuk mulai menyusun RAB."
              action={
                <Button onClick={() => void handleAddItem()}>
                  <Plus />
                  Tambah Pekerjaan
                </Button>
              }
              secondaryAction={
                <>
                  <Button variant="secondary" onClick={() => setPickerOpen(true)}>
                    <BookOpen />
                    Pilih dari Katalog
                  </Button>
                  <Button variant="secondary" onClick={() => setAhspPickerOpen(true)}>
                    <Calculator />
                    Pilih dari AHSP
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          <WorkItemsTable
            items={items}
            total={total}
            onChangeItem={handleChangeItem}
            onRemoveItem={handleRemoveItem}
            onAddItem={(context) => void handleAddItem(context)}
            onAddFromCatalog={() => setPickerOpen(true)}
            onAddFromAhsp={() => setAhspPickerOpen(true)}
          />
        )}
      </section>

      <RabSummary items={items} total={total} />

      {/* Di-mount hanya saat terbuka agar katalog baru diambil ketika dipakai. */}
      {pickerOpen ? (
        <CatalogPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={(item) => void handlePickFromCatalog(item)}
        />
      ) : null}

      {ahspPickerOpen ? (
        <AhspPickerDialog
          open={ahspPickerOpen}
          onOpenChange={setAhspPickerOpen}
          groups={ahspPlacementGroups}
          onPick={(analysis, context) =>
            void handlePickFromAhsp(analysis, context)
          }
        />
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Perubahan judul, volume, satuan, dan harga tersimpan otomatis ke database
        Supabase. Total dihitung ulang setiap kali data berubah.
      </p>

      {compareOpen ? (
        <CompareDocumentsDialog
          document={document}
          onOpenChange={setCompareOpen}
        />
      ) : null}

      {duplicateOpen ? (
        <DuplicateDocumentDialog
          document={document}
          onOpenChange={setDuplicateOpen}
          onDuplicated={(copy) => {
            toast.success("Dokumen diduplikasi", { description: copy.title });
            router.push(`/rab/${copy.id}`);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Hapus pekerjaan ini?"
        description={
          <>
            <span className="font-medium text-foreground">
              {pendingDelete?.description || "Baris tanpa uraian"}
            </span>{" "}
            akan dihapus dari RAB. Tindakan ini tidak dapat dibatalkan.
          </>
        }
        confirmLabel="Hapus pekerjaan"
        onConfirm={() => {
          if (pendingDelete) void removeItem(pendingDelete);
        }}
      />
    </div>
  );
}

function EditorLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat dokumen RAB">
      <Skeleton className="h-8 w-44" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
