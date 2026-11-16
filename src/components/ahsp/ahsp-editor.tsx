"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AhspComponentDialog, type AhspComponentDraft } from "@/components/ahsp/ahsp-component-dialog";
import { AhspFormDialog } from "@/components/ahsp/ahsp-form-dialog";
import { useSetHeaderOverride } from "@/components/layout/header-override";
import { CatalogPickerDialog } from "@/components/rab/catalog-picker-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataError } from "@/components/shared/data-error";
import { EmptyState } from "@/components/shared/empty-state";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAhsp } from "@/hooks/use-ahsp";
import {
  ahspCategoryOptions,
  analysisTotal,
  componentCost,
  groupComponents,
  resourceCategoryFromCatalogCategory,
  type AhspAnalysisInput,
  type AhspComponentInput,
} from "@/lib/ahsp";
import { toErrorMessage } from "@/lib/errors";
import { formatIDR } from "@/lib/format";
import type { AhspComponent, CatalogItem } from "@/types";

const coefficientFormat = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 6,
});

/**
 * Editor analisis AHSP: informasi pekerjaan, komponen per kelompok, subtotal
 * tiap kelompok, dan total harga satuan.
 */
export function AhspEditor({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const {
    status,
    error,
    refresh,
    getAnalysis,
    updateAnalysis,
    deleteAnalysis,
    addComponent,
    updateComponent,
    removeComponent,
  } = useAhsp();

  const [formOpen, setFormOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [componentDialogOpen, setComponentDialogOpen] = useState(false);
  const [componentDraft, setComponentDraft] = useState<AhspComponentDraft | undefined>();
  const [deletingComponent, setDeletingComponent] = useState<AhspComponent | null>(null);
  const [deleteAnalysisOpen, setDeleteAnalysisOpen] = useState(false);

  const analysis = getAnalysis(analysisId);

  useSetHeaderOverride({
    title: analysis?.name,
    crumbLabel: analysis?.category,
  });

  const categories = useMemo(() => ahspCategoryOptions(), []);
  const groups = useMemo(
    () => groupComponents(analysis?.components ?? []),
    [analysis?.components],
  );

  if (!analysis) {
    if (status === "loading") return <EditorLoading />;

    if (status === "error") {
      return (
        <DataError
          message={error ?? "Gagal memuat analisis AHSP dari Supabase."}
          onRetry={() => void refresh()}
        />
      );
    }

    return (
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <EmptyState
          icon={Calculator}
          title="Analisis AHSP tidak ditemukan"
          description={`Analisis dengan ID "${analysisId}" tidak tersedia. Mungkin sudah dihapus atau tautannya salah.`}
          action={
            <ButtonLink href="/ahsp" variant="secondary">
              Kembali ke AHSP
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const total = analysisTotal(analysis);

  async function handleAnalysisSubmit(input: AhspAnalysisInput) {
    await updateAnalysis(analysisId, input);
    toast.success("Analisis diperbarui", { description: input.name });
    setFormOpen(false);
  }

  async function handleDeleteAnalysis() {
    try {
      await deleteAnalysis(analysisId);
      toast.success("Analisis AHSP dihapus", { description: analysis?.name });
      router.push("/ahsp");
    } catch (caught) {
      toast.error("Gagal menghapus analisis", {
        description: toErrorMessage(caught),
      });
    }
  }

  async function handleComponentSubmit(input: AhspComponentInput) {
    try {
      if (componentDraft?.id) {
        await updateComponent(analysisId, componentDraft.id, input);
        toast.success("Komponen diperbarui", { description: input.resourceName });
      } else {
        await addComponent(analysisId, input);
        toast.success("Komponen ditambahkan", { description: input.resourceName });
      }
      setComponentDialogOpen(false);
      setComponentDraft(undefined);
    } catch (caught) {
      toast.error("Gagal menyimpan komponen", {
        description: toErrorMessage(caught),
      });
    }
  }

  async function handleDeleteComponent() {
    const target = deletingComponent;
    if (!target) return;

    try {
      await removeComponent(analysisId, target.id);
      toast.success("Komponen dihapus", { description: target.resourceName });
    } catch (caught) {
      toast.error("Gagal menghapus komponen", {
        description: toErrorMessage(caught),
      });
    } finally {
      setDeletingComponent(null);
    }
  }

  function handlePickCatalog(item: CatalogItem) {
    setPickerOpen(false);
    setComponentDraft({
      catalogItemId: item.id,
      resourceName: item.name,
      resourceCategory: resourceCategoryFromCatalogCategory(item.category),
      unit: item.unit,
      coefficient: 1,
      unitPrice: item.unitPrice,
    });
    setComponentDialogOpen(true);
  }

  function openManualComponent() {
    setComponentDraft(undefined);
    setComponentDialogOpen(true);
  }

  function openEditComponent(component: AhspComponent) {
    setComponentDraft({
      id: component.id,
      catalogItemId: component.catalogItemId,
      resourceName: component.resourceName,
      resourceCategory: component.resourceCategory,
      unit: component.unit,
      coefficient: component.coefficient,
      unitPrice: component.unitPrice,
    });
    setComponentDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <ButtonLink href="/ahsp" variant="ghost" size="sm" className="-ml-2 w-fit">
        <ArrowLeft />
        Kembali ke AHSP
      </ButtonLink>

      {/* Informasi pekerjaan */}
      <section className="rounded-xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
                {analysis.category}
              </span>
              <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
                per {analysis.unit}
              </span>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-[22px]">
              {analysis.name}
            </h1>
            {analysis.description ? (
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {analysis.description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(true)}>
              <Pencil />
              Edit Info
            </Button>
            <Button variant="destructive" onClick={() => setDeleteAnalysisOpen(true)}>
              <Trash2 />
              Hapus
            </Button>
          </div>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-border pt-4 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-[11px] text-muted-foreground">Harga satuan</dt>
            <dd className="mt-0.5 text-[15px] font-semibold text-foreground tabular-nums">
              {formatIDR(total)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Komponen</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {analysis.components.length} item
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Satuan hasil</dt>
            <dd className="mt-0.5 font-medium text-foreground">{analysis.unit}</dd>
          </div>
        </dl>
      </section>

      {/* Komponen */}
      <section aria-labelledby="ahsp-components-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="ahsp-components-heading"
              className="text-[15px] font-semibold tracking-tight text-foreground"
            >
              Komponen Analisis
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Jumlah biaya = koefisien × harga dasar. Total dihitung otomatis.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={openManualComponent}>
              <Plus />
              Tambah Manual
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
              <Calculator />
              Pilih dari Katalog
            </Button>
          </div>
        </div>

        {analysis.components.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface shadow-card">
            <EmptyState
              icon={Calculator}
              title="Belum ada komponen"
              description="Tambahkan material, tenaga kerja, atau peralatan beserta koefisien dan harga dasarnya."
              action={
                <Button onClick={openManualComponent}>
                  <Plus />
                  Tambah Komponen
                </Button>
              }
              secondaryAction={
                <Button variant="secondary" onClick={() => setPickerOpen(true)}>
                  Pilih dari Katalog
                </Button>
              }
            />
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div
                key={group.category}
                className="overflow-hidden rounded-xl border border-border bg-surface shadow-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/60 px-4 py-2.5">
                  <h3 className="text-[13px] font-semibold text-foreground">
                    {group.category}
                  </h3>
                  <p className="text-[13px] text-muted-foreground">
                    Subtotal{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatIDR(group.subtotal)}
                    </span>
                  </p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Nama</TableHead>
                      <TableHead className="w-20">Satuan</TableHead>
                      <TableHead className="w-28 text-right">Koefisien</TableHead>
                      <TableHead className="w-36 text-right">Harga Dasar</TableHead>
                      <TableHead className="w-36 text-right">Jumlah Biaya</TableHead>
                      <TableHead className="w-24 text-right">
                        <span className="sr-only">Aksi</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.components.map((component) => (
                      <TableRow key={component.id}>
                        <TableCell className="max-w-[280px]">
                          <span className="block truncate font-medium text-foreground">
                            {component.resourceName || "Tanpa nama"}
                          </span>
                          {component.catalogItemId ? (
                            <span className="text-[11px] text-muted-foreground">
                              dari katalog
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {component.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {coefficientFormat.format(component.coefficient)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">
                          {formatIDR(component.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                          {formatIDR(
                            componentCost(component.coefficient, component.unitPrice),
                          )}
                        </TableCell>
                        <TableCell className="pr-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openEditComponent(component)}
                              aria-label={`Edit ${component.resourceName}`}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeletingComponent(component)}
                              aria-label={`Hapus ${component.resourceName}`}
                              className="text-muted-foreground hover:bg-danger-soft hover:text-danger"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}

            {/* Total keseluruhan */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-card">
              <div>
                <p className="text-[13px] text-muted-foreground">
                  Total harga satuan pekerjaan
                </p>
                <p className="text-xs text-muted-foreground">
                  {analysis.components.length} komponen · per {analysis.unit}
                </p>
              </div>
              <p className="text-lg font-semibold tracking-tight text-primary tabular-nums">
                {formatIDR(total)}
              </p>
            </div>
          </div>
        )}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Koefisien dan harga dasar diisi manual oleh Anda — aplikasi tidak
        menyediakan angka standar AHSP. Nilai dari katalog disalin sebagai
        snapshot, jadi perubahan katalog tidak mengubah analisis ini.
      </p>

      <AhspFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        analysis={analysis}
        categories={categories}
        onSubmit={handleAnalysisSubmit}
      />

      <AhspComponentDialog
        open={componentDialogOpen}
        onOpenChange={(open) => {
          setComponentDialogOpen(open);
          if (!open) setComponentDraft(undefined);
        }}
        draft={componentDraft}
        onSubmit={handleComponentSubmit}
      />

      {pickerOpen ? (
        <CatalogPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onPick={handlePickCatalog}
        />
      ) : null}

      <ConfirmDialog
        open={deletingComponent !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingComponent(null);
        }}
        title="Hapus komponen ini?"
        description={
          <>
            <span className="font-medium text-foreground">
              {deletingComponent?.resourceName || "Komponen"}
            </span>{" "}
            akan dihapus dari analisis. Total harga satuan ikut dihitung ulang.
          </>
        }
        confirmLabel="Hapus komponen"
        onConfirm={() => void handleDeleteComponent()}
      />

      <ConfirmDialog
        open={deleteAnalysisOpen}
        onOpenChange={setDeleteAnalysisOpen}
        title="Hapus analisis AHSP ini?"
        description={
          <>
            <span className="font-medium text-foreground">{analysis.name}</span>{" "}
            beserta {analysis.components.length} komponennya akan dihapus. Item
            RAB yang sudah dibuat tidak terpengaruh.
          </>
        }
        confirmLabel="Hapus analisis"
        onConfirm={() => void handleDeleteAnalysis()}
      />
    </div>
  );
}

function EditorLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat analisis AHSP">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
