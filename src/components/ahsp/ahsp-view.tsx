"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Pencil, Plus, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AhspFormDialog } from "@/components/ahsp/ahsp-form-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataError } from "@/components/shared/data-error";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  filterAhspAnalyses,
  type AhspAnalysisInput,
} from "@/lib/ahsp";
import { toErrorMessage } from "@/lib/errors";
import { formatIDR } from "@/lib/format";
import type { AhspAnalysis, AhspAnalysisDetail } from "@/types";

/**
 * Halaman daftar AHSP: pencarian nama pekerjaan, filter kategori, dan CRUD
 * analisis (komponennya dikelola di halaman detail).
 */
export function AhspView() {
  const router = useRouter();
  const {
    analyses,
    status,
    error,
    refresh,
    createAnalysis,
    updateAnalysis,
    deleteAnalysis,
  } = useAhsp();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AhspAnalysis | null>(null);
  const [deleting, setDeleting] = useState<AhspAnalysisDetail | null>(null);

  const categories = useMemo(() => ahspCategoryOptions(analyses), [analyses]);
  const filtered = useMemo(
    () => filterAhspAnalyses(analyses, { query, category }),
    [analyses, query, category],
  );

  const hasFilters = query.trim().length > 0 || category !== "all";

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(analysis: AhspAnalysis) {
    setEditing(analysis);
    setFormOpen(true);
  }

  async function handleSubmit(input: AhspAnalysisInput) {
    if (editing) {
      await updateAnalysis(editing.id, input);
      toast.success("Analisis AHSP diperbarui", { description: input.name });
      setFormOpen(false);
      setEditing(null);
      return;
    }

    const created = await createAnalysis(input);
    toast.success("Analisis AHSP dibuat", { description: input.name });
    setFormOpen(false);
    router.push(`/ahsp/${created.id}`);
  }

  async function handleDelete() {
    const target = deleting;
    if (!target) return;

    try {
      await deleteAnalysis(target.id);
      toast.success("Analisis AHSP dihapus", { description: target.name });
    } catch (caught) {
      toast.error("Gagal menghapus analisis", {
        description: toErrorMessage(caught),
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AHSP"
        description="Analisis harga satuan pekerjaan dari komponen material, tenaga kerja, dan peralatan."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Analisis Baru
          </Button>
        }
      />

      {status === "error" ? (
        <DataError
          title="Gagal memuat analisis AHSP"
          message={error ?? "Gagal memuat data dari Supabase."}
          onRetry={() => void refresh()}
        />
      ) : status === "loading" ? (
        <ListSkeleton rows={6} label="Memuat analisis AHSP" />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Cari nama pekerjaan…"
                className="w-full sm:max-w-sm"
                aria-label="Cari analisis AHSP"
              />
              <Select
                items={[
                  { value: "all", label: "Semua kategori" },
                  ...categories.map((value) => ({ value, label: value })),
                ]}
                value={category}
                onValueChange={(value) => setCategory((value as string) ?? "all")}
              >
                <SelectTrigger className="w-full sm:w-44" aria-label="Filter kategori">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua kategori</SelectItem>
                  {categories.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[13px] text-muted-foreground" aria-live="polite">
              {filtered.length} dari {analyses.length} analisis
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface shadow-card">
              {hasFilters ? (
                <EmptyState
                  icon={SearchX}
                  title="Tidak ada analisis yang cocok"
                  description="Coba kata kunci lain atau ubah filter kategori."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery("");
                        setCategory("all");
                      }}
                    >
                      Reset filter
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={Calculator}
                  title="Belum ada analisis AHSP"
                  description="Buat analisis pertama untuk menghitung harga satuan pekerjaan dari komponennya."
                  action={
                    <Button onClick={openCreate}>
                      <Plus />
                      Analisis Baru
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
              <Table>
                <TableHeader className="bg-background/60">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Pekerjaan</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Satuan</TableHead>
                    <TableHead className="text-right">Harga Satuan</TableHead>
                    <TableHead className="w-32 text-right">
                      <span className="sr-only">Aksi</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((analysis) => (
                    <TableRow key={analysis.id}>
                      <TableCell className="max-w-[320px]">
                        <ButtonLink
                          href={`/ahsp/${analysis.id}`}
                          variant="link"
                          className="block h-auto max-w-full truncate p-0 text-left font-medium"
                        >
                          {analysis.name}
                        </ButtonLink>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {analysis.components.length} komponen
                          {analysis.description ? ` · ${analysis.description}` : ""}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
                          {analysis.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {analysis.unit}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                        {formatIDR(analysisTotal(analysis))}
                      </TableCell>
                      <TableCell className="pr-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEdit(analysis)}
                            aria-label={`Edit ${analysis.name}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleting(analysis)}
                            aria-label={`Hapus ${analysis.name}`}
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
          )}
        </>
      )}

      <AhspFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        analysis={editing ?? undefined}
        categories={categories}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Hapus analisis AHSP ini?"
        description={
          <>
            <span className="font-medium text-foreground">{deleting?.name}</span>{" "}
            beserta seluruh komponennya akan dihapus. Item RAB yang sudah dibuat
            tidak terpengaruh karena harganya sudah tersalin saat dipilih.
          </>
        }
        confirmLabel="Hapus analisis"
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
