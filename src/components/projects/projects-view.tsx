"use client";

import { useMemo, useState } from "react";
import { FolderSearch, LayoutGrid, Plus, Rows3, SearchX } from "lucide-react";

import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectTable } from "@/components/projects/project-table";
import { useData } from "@/components/providers/data-provider";
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
import { PROJECT_STATUSES, projectStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/types";

type StatusFilter = ProjectStatus | "all";
type ViewMode = "table" | "grid";

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Semua status" },
  ...PROJECT_STATUSES.map((value) => ({
    value,
    label: projectStatusMeta[value].label,
  })),
];

export function ProjectsView() {
  const { projects, status, error, refresh } = useData();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<ViewMode>("table");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus = filter === "all" || project.status === filter;
      const matchesQuery =
        needle.length === 0 ||
        [project.name, project.client, project.location]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      return matchesStatus && matchesQuery;
    });
  }, [projects, query, filter]);

  const hasFilters = query.trim().length > 0 || filter !== "all";

  function resetFilters() {
    setQuery("");
    setFilter("all");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proyek"
        description="Kelola seluruh proyek konstruksi Anda beserta dokumen RAB-nya."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Buat Proyek
          </Button>
        }
      />

      {status === "error" ? (
        <DataError
          title="Gagal memuat proyek"
          message={error ?? "Gagal memuat data dari Supabase."}
          onRetry={() => void refresh()}
        />
      ) : status === "loading" ? (
        <ListSkeleton rows={6} label="Memuat daftar proyek" />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Cari nama proyek, klien, atau lokasi…"
                className="w-full sm:max-w-sm"
                aria-label="Cari proyek"
              />
              <Select
                items={statusOptions}
                value={filter}
                onValueChange={(value) =>
                  setFilter((value as StatusFilter) ?? "all")
                }
              >
                <SelectTrigger className="w-full sm:w-44" aria-label="Filter status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-muted-foreground" aria-live="polite">
                {filtered.length} dari {projects.length} proyek
              </p>
              <div
                role="group"
                aria-label="Tampilan"
                className="flex items-center rounded-lg border border-border bg-surface p-0.5 shadow-xs"
              >
                <ViewToggle
                  active={view === "table"}
                  onClick={() => setView("table")}
                  label="Tampilan tabel"
                >
                  <Rows3 className="size-4" />
                </ViewToggle>
                <ViewToggle
                  active={view === "grid"}
                  onClick={() => setView("grid")}
                  label="Tampilan kartu"
                >
                  <LayoutGrid className="size-4" />
                </ViewToggle>
              </div>
            </div>
          </div>

          {/* Results */}
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface shadow-card">
              {hasFilters ? (
                <EmptyState
                  icon={SearchX}
                  title="Tidak ada proyek yang cocok"
                  description="Coba kata kunci lain atau ubah filter status."
                  action={
                    <Button variant="secondary" onClick={resetFilters}>
                      Reset filter
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={FolderSearch}
                  title="Belum ada proyek"
                  description="Mulai dengan membuat proyek pertama Anda untuk menyusun RAB."
                  action={
                    <Button onClick={() => setCreateOpen(true)}>
                      <Plus />
                      Buat Proyek
                    </Button>
                  }
                />
              )}
            </div>
          ) : view === "table" ? (
            <ProjectTable projects={filtered} className="hidden md:block" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}

          {/* On mobile, cards read better than a horizontally scrolling table. */}
          {view === "table" && filtered.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 md:hidden">
              {filtered.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : null}
        </>
      )}

      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-7 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-foreground/[0.06] text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
