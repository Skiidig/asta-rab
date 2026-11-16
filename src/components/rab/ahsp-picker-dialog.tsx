"use client";

import { useMemo, useState } from "react";
import { Calculator, SearchX } from "lucide-react";

import { DataError } from "@/components/shared/data-error";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchInput } from "@/components/shared/search-input";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAhsp } from "@/hooks/use-ahsp";
import {
  ahspCategoryOptions,
  analysisTotal,
  filterAhspAnalyses,
} from "@/lib/ahsp";
import { formatIDR } from "@/lib/format";
import type { HierarchyContext } from "@/lib/rab-hierarchy";
import type { AhspAnalysisDetail } from "@/types";

interface PlacementOption {
  id: string;
  label: string;
  context: HierarchyContext;
}

/**
 * Dialog pemilih pekerjaan dari AHSP untuk editor RAB.
 *
 * Harga satuan yang ditampilkan adalah total analisis saat ini. Setelah dipilih,
 * nilainya disalin ke item RAB (snapshot) sehingga perubahan analisis di
 * kemudian hari tidak mengubah RAB tersebut. Kelompok tujuan dipilih eksplisit
 * agar item tidak jatuh ke kelompok terakhir secara tak terduga.
 */
export function AhspPickerDialog({
  open,
  onOpenChange,
  onPick,
  groups = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (analysis: AhspAnalysisDetail, context?: HierarchyContext) => void;
  groups?: PlacementOption[];
}) {
  const { analyses, status, error, refresh } = useAhsp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [placement, setPlacement] = useState(() => groups[0]?.id ?? "");
  const [placementError, setPlacementError] = useState<string | null>(null);
  const selectedPlacement =
    groups.find((group) => group.id === placement) ?? null;

  const categories = useMemo(() => ahspCategoryOptions(analyses), [analyses]);
  const filtered = useMemo(
    () => filterAhspAnalyses(analyses, { query, category }),
    [analyses, query, category],
  );

  if (!open) return null;

  const hasFilters = query.trim().length > 0 || category !== "all";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pilih dari AHSP</DialogTitle>
          <DialogDescription>
            Nama pekerjaan, satuan, dan harga satuan hasil analisis akan disalin
            ke RAB ini. Volume tetap Anda isi sendiri.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 px-6 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Cari pekerjaan…"
              className="w-full sm:flex-1"
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
              <SelectTrigger className="w-full sm:w-40" aria-label="Filter kategori">
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

          {groups.length > 0 ? (
            <div className="grid gap-1.5">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Kelompok tujuan
              </p>
              <Select
                items={groups.map((group) => ({
                  value: group.id,
                  label: group.label,
                }))}
                value={selectedPlacement ? selectedPlacement.id : ""}
                onValueChange={(value) => {
                  setPlacement((value as string) ?? "");
                  setPlacementError(null);
                }}
              >
                <SelectTrigger aria-label="Kelompok tujuan penambahan AHSP">
                  <SelectValue placeholder="Pilih kelompok" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {placementError ? (
                <p className="text-xs text-danger" role="alert">
                  {placementError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="max-h-[46vh] overflow-y-auto px-3 py-3">
          {status === "loading" ? (
            <div className="space-y-2 px-3" aria-busy="true" aria-label="Memuat AHSP">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : status === "error" ? (
            <DataError
              title="Gagal memuat AHSP"
              message={error ?? "Gagal memuat analisis AHSP dari Supabase."}
              onRetry={() => void refresh()}
              className="border-0 shadow-none"
            />
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-border">
              {hasFilters ? (
                <EmptyState
                  icon={SearchX}
                  title="Tidak ada pekerjaan yang cocok"
                  description="Coba kata kunci lain atau ubah filter kategori."
                  compact
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
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
                  description="Buat analisis harga satuan pekerjaan agar bisa dipakai langsung di RAB."
                  compact
                  action={
                    <ButtonLink href="/ahsp" variant="secondary" size="sm">
                      Buka AHSP
                    </ButtonLink>
                  }
                />
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((analysis) => (
                <li key={analysis.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (groups.length > 0 && !selectedPlacement) {
                        setPlacementError(
                          "Pilih kelompok tujuan sebelum menambahkan AHSP.",
                        );
                        return;
                      }
                      onPick(analysis, selectedPlacement?.context);
                    }}
                    className="flex w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {analysis.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {analysis.category} · per {analysis.unit} ·{" "}
                        {analysis.components.length} komponen
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                      {formatIDR(analysisTotal(analysis))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
