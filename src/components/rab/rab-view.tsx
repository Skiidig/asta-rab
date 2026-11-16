"use client";

import { useMemo, useState } from "react";
import { FilePlus2, FileSearch, FileUp, Plus, SearchX } from "lucide-react";

import { useData } from "@/components/providers/data-provider";
import { ImportExcelDialog } from "@/components/rab/import-excel-dialog";
import { RabDocumentDialog } from "@/components/rab/rab-document-dialog";
import { RabTable } from "@/components/rab/rab-table";
import { DataError } from "@/components/shared/data-error";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/format";

export function RabView() {
  const { documents, status, error, refresh } = useData();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents.filter((document) => {
      if (needle.length === 0) return true;
      return [document.title, document.projectName, document.number]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [documents, query]);

  const filteredTotal = filtered.reduce((sum, document) => sum + document.total, 0);
  const hasFilters = query.trim().length > 0;

  function resetFilters() {
    setQuery("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dokumen RAB"
        description="Semua dokumen Rencana Anggaran Biaya yang tersimpan di workspace Anda."
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <FileUp />
              Import Excel
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Buat RAB
            </Button>
          </>
        }
      />

      {status === "error" ? (
        <DataError
          title="Gagal memuat dokumen RAB"
          message={error ?? "Gagal memuat data dari Supabase."}
          onRetry={() => void refresh()}
        />
      ) : status === "loading" ? (
        <ListSkeleton rows={6} label="Memuat daftar dokumen RAB" />
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card sm:grid-cols-4 sm:divide-x">
            <SummaryItem label="Total dokumen" value={String(documents.length)} />
            <SummaryItem
              label="Sudah ada item"
              value={String(documents.filter((d) => d.itemCount > 0).length)}
            />
            <SummaryItem
              label="Belum ada item"
              value={String(documents.filter((d) => d.itemCount === 0).length)}
            />
            <SummaryItem
              label="Total estimasi"
              value={formatIDR(documents.reduce((sum, d) => sum + d.total, 0))}
              className="col-span-2 border-t border-border sm:col-span-1 sm:border-t-0"
            />
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Cari dokumen atau proyek…"
                className="w-full sm:max-w-sm"
                aria-label="Cari dokumen RAB"
              />
            </div>
            <p className="text-[13px] text-muted-foreground" aria-live="polite">
              {filtered.length} dokumen · {formatIDR(filteredTotal)}
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface shadow-card">
              {hasFilters ? (
                <EmptyState
                  icon={SearchX}
                  title="Tidak ada dokumen yang cocok"
                  description="Coba kata kunci lain atau hapus pencarian."
                  action={
                    <Button variant="secondary" onClick={resetFilters}>
                      Reset filter
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={FileSearch}
                  title="Belum ada dokumen RAB"
                  description="Dokumen RAB yang Anda buat akan muncul di sini."
                  action={
                    <Button onClick={() => setCreateOpen(true)}>
                      <FilePlus2 />
                      Buat dokumen RAB
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <RabTable documents={filtered} />
          )}
        </>
      )}

      <RabDocumentDialog open={createOpen} onOpenChange={setCreateOpen} />

      {importOpen ? (
        <ImportExcelDialog open={importOpen} onOpenChange={setImportOpen} />
      ) : null}
    </div>
  );
}

function SummaryItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="px-5 py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-[15px] font-semibold text-foreground tabular-nums">
          {value}
        </p>
      </div>
    </div>
  );
}
