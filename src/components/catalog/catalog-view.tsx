"use client";

import { useMemo, useState } from "react";
import { BookOpen, Pencil, Plus, SearchX, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { CatalogFormDialog } from "@/components/catalog/catalog-form-dialog";
import { useCatalog } from "@/hooks/use-catalog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataError } from "@/components/shared/data-error";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
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
import {
  catalogCategoryOptions,
  filterCatalogItems,
  type CatalogItemInput,
} from "@/lib/catalog";
import { toErrorMessage } from "@/lib/errors";
import { formatIDR } from "@/lib/format";
import type { CatalogItem } from "@/types";

/**
 * Halaman Katalog Harga: daftar material/pekerjaan beserta satuan dan harga
 * satuan, dengan pencarian, filter kategori, dan CRUD.
 */
export function CatalogView() {
  const { items, status, error, refresh, createItem, updateItem, deleteItem } =
    useCatalog();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);

  const categories = useMemo(() => catalogCategoryOptions(items), [items]);

  const filtered = useMemo(
    () => filterCatalogItems(items, { query, category }),
    [items, query, category],
  );

  const hasFilters = query.trim().length > 0 || category !== "all";

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(item: CatalogItem) {
    setEditing(item);
    setFormOpen(true);
  }

  function resetFilters() {
    setQuery("");
    setCategory("all");
  }

  async function handleSubmit(input: CatalogItemInput) {
    if (editing) {
      await updateItem(editing.id, input);
      toast.success("Item katalog diperbarui", { description: input.name });
    } else {
      await createItem(input);
      toast.success("Item katalog ditambahkan", { description: input.name });
    }

    setFormOpen(false);
    setEditing(null);
  }

  async function handleDelete() {
    const target = deleting;
    if (!target) return;

    try {
      await deleteItem(target.id);
      toast.success("Item katalog dihapus", { description: target.name });
    } catch (caught) {
      toast.error("Gagal menghapus item katalog", {
        description: toErrorMessage(caught),
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Katalog Harga"
        description="Simpan material dan pekerjaan beserta satuan dan harga satuannya, lalu pakai langsung di RAB."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Tambah Item
          </Button>
        }
      />

      {status === "error" ? (
        <DataError
          title="Gagal memuat katalog harga"
          message={error ?? "Gagal memuat data dari Supabase."}
          onRetry={() => void refresh()}
        />
      ) : status === "loading" ? (
        <ListSkeleton rows={6} label="Memuat katalog harga" />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Cari nama material atau pekerjaan…"
                className="w-full sm:max-w-sm"
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
              {filtered.length} dari {items.length} item
            </p>
          </div>

          {/* Results */}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface shadow-card">
              {hasFilters ? (
                <EmptyState
                  icon={SearchX}
                  title="Tidak ada item yang cocok"
                  description="Coba kata kunci lain atau ubah filter kategori."
                  action={
                    <Button variant="secondary" onClick={resetFilters}>
                      Reset filter
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={BookOpen}
                  title="Katalog masih kosong"
                  description="Tambahkan material atau pekerjaan pertama agar bisa dipilih langsung saat menyusun RAB."
                  action={
                    <Button onClick={openCreate}>
                      <Plus />
                      Tambah Item
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
                    <TableHead>Nama</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Satuan</TableHead>
                    <TableHead className="text-right">Harga Satuan</TableHead>
                    <TableHead className="w-24 text-right">
                      <span className="sr-only">Aksi</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-[320px]">
                        <span className="block truncate font-medium text-foreground">
                          {item.name}
                        </span>
                        {item.description ? (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
                          {item.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.unit}
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                        {formatIDR(item.unitPrice)}
                      </TableCell>
                      <TableCell className="pr-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEdit(item)}
                            aria-label={`Edit ${item.name}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleting(item)}
                            aria-label={`Hapus ${item.name}`}
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

      <CatalogFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        item={editing ?? undefined}
        categories={categories}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Hapus item katalog ini?"
        description={
          <>
            <span className="font-medium text-foreground">{deleting?.name}</span>{" "}
            akan dihapus dari katalog. Item yang sudah dipakai di RAB tetap utuh
            karena harganya sudah tersalin ke dokumen.
          </>
        }
        confirmLabel="Hapus item"
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
