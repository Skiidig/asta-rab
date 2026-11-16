"use client";

import { useMemo, useState } from "react";
import { BookOpen, SearchX } from "lucide-react";

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
import { useCatalog } from "@/hooks/use-catalog";
import { catalogCategoryOptions, filterCatalogItems } from "@/lib/catalog";
import { formatIDR } from "@/lib/format";
import type { CatalogItem } from "@/types";

/**
 * Dialog pemilih item katalog untuk editor RAB.
 *
 * Item yang dipilih dikembalikan lewat `onPick`; pemanggil yang menyalin nama,
 * satuan, dan harga ke baris RAB (snapshot) — dialog ini tidak menulis data.
 */
export function CatalogPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: CatalogItem) => void;
}) {
  const { items, status, error, refresh } = useCatalog();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => catalogCategoryOptions(items), [items]);
  const filtered = useMemo(
    () => filterCatalogItems(items, { query, category }),
    [items, query, category],
  );

  if (!open) return null;

  const hasFilters = query.trim().length > 0 || category !== "all";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pilih dari Katalog</DialogTitle>
          <DialogDescription>
            Nama, satuan, dan harga item akan disalin ke RAB ini. Volume tetap
            Anda isi sendiri, dan harga masih bisa diubah setelah ditambahkan.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 px-6 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Cari item…"
              className="w-full sm:flex-1"
              aria-label="Cari item katalog"
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
        </div>

        <div className="max-h-[46vh] overflow-y-auto px-3 py-3">
          {status === "loading" ? (
            <div className="space-y-2 px-3" aria-busy="true" aria-label="Memuat katalog">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : status === "error" ? (
            <DataError
              title="Gagal memuat katalog"
              message={error ?? "Gagal memuat katalog dari Supabase."}
              onRetry={() => void refresh()}
              className="border-0 shadow-none"
            />
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-border">
              {hasFilters ? (
                <EmptyState
                  icon={SearchX}
                  title="Tidak ada item yang cocok"
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
                  icon={BookOpen}
                  title="Katalog masih kosong"
                  description="Tambahkan material atau pekerjaan ke katalog agar bisa dipilih di sini."
                  compact
                  action={
                    <ButtonLink href="/catalog" variant="secondary" size="sm">
                      Buka Katalog Harga
                    </ButtonLink>
                  }
                />
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    className="flex w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-background focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {item.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {item.category} · per {item.unit}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">
                      {formatIDR(item.unitPrice)}
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
