"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  FolderKanban,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { useSetHeaderOverride } from "@/components/layout/header-override";
import { useData } from "@/components/providers/data-provider";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { RabDocumentDialog } from "@/components/rab/rab-document-dialog";
import { RabTable } from "@/components/rab/rab-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataError } from "@/components/shared/data-error";
import { EmptyState } from "@/components/shared/empty-state";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toErrorMessage } from "@/lib/errors";
import { formatDate, formatIDR } from "@/lib/format";

/**
 * Project detail: project metadata, its RAB documents, and the lifecycle
 * actions (edit, delete with cascade confirmation, create RAB).
 */
export function ProjectDetailView({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { status, error, refresh, getProject, getDocumentsForProject, deleteProject } =
    useData();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createRabOpen, setCreateRabOpen] = useState(false);

  const project = getProject(projectId);
  const documents = getDocumentsForProject(projectId);

  useSetHeaderOverride({ title: project?.name, crumbLabel: project?.name });

  if (!project) {
    if (status === "loading") return <DetailLoading />;

    if (status === "error") {
      return (
        <DataError
          message={error ?? "Gagal memuat data proyek dari Supabase."}
          onRetry={() => void refresh()}
        />
      );
    }

    return (
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <EmptyState
          icon={FolderKanban}
          title="Proyek tidak ditemukan"
          description={`Proyek dengan ID "${projectId}" tidak tersedia. Mungkin sudah dihapus atau tautannya salah.`}
          action={
            <ButtonLink href="/projects" variant="secondary">
              Kembali ke Projects
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const totalRab = documents.reduce((sum, document) => sum + document.total, 0);

  async function handleDelete() {
    try {
      const result = await deleteProject(projectId);

      toast.success("Proyek dihapus", {
        description:
          result.deletedDocuments > 0
            ? `${project?.name} dan ${result.deletedDocuments} dokumen RAB terkait dihapus.`
            : project?.name,
      });
      router.push("/projects");
    } catch (caught) {
      toast.error("Gagal menghapus proyek", {
        description: toErrorMessage(caught),
      });
    }
  }

  return (
    <div className="space-y-6">
      <ButtonLink href="/projects" variant="ghost" size="sm" className="-ml-2 w-fit">
        <ArrowLeft />
        Kembali ke Projects
      </ButtonLink>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusBadge status={project.status} />
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-[22px]">
              {project.name}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{project.client}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil />
              Edit Proyek
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              Hapus
            </Button>
            <Button onClick={() => setCreateRabOpen(true)}>
              <Plus />
              Buat RAB
            </Button>
          </div>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-border pt-4 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <DetailItem icon={UserRound} label="Klien" value={project.client || "—"} />
          <DetailItem icon={MapPin} label="Lokasi" value={project.location || "—"} />
          <DetailItem
            icon={CalendarDays}
            label="Tanggal mulai"
            value={project.startDate ? formatDate(project.startDate) : "—"}
          />
          <DetailItem
            icon={Wallet}
            label="Estimasi anggaran"
            value={formatIDR(totalRab)}
          />
        </dl>
      </section>

      <div className="grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card sm:grid-cols-3 sm:divide-x">
        <SummaryItem label="Dokumen RAB" value={String(documents.length)} />
        <SummaryItem
          label="Total pekerjaan"
          value={String(
            documents.reduce((sum, document) => sum + document.itemCount, 0),
          )}
        />
        <SummaryItem
          label="Total RAB"
          value={formatIDR(totalRab)}
          className="col-span-2 border-t border-border sm:col-span-1 sm:border-t-0"
        />
      </div>

      <section aria-labelledby="project-documents-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="project-documents-heading"
              className="text-[15px] font-semibold tracking-tight text-foreground"
            >
              Dokumen RAB
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Semua dokumen RAB yang terhubung dengan proyek ini.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setCreateRabOpen(true)}>
            <Plus />
            Buat RAB
          </Button>
        </div>

        {documents.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface shadow-card">
            <EmptyState
              icon={FileText}
              title="Belum ada dokumen RAB"
              description="Buat dokumen RAB pertama untuk proyek ini. Dokumen baru dimulai tanpa item pekerjaan."
              action={
                <Button onClick={() => setCreateRabOpen(true)}>
                  <Plus />
                  Buat dokumen RAB
                </Button>
              }
            />
          </div>
        ) : (
          <RabTable documents={documents} />
        )}
      </section>

      <ProjectFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
      />

      <RabDocumentDialog
        open={createRabOpen}
        onOpenChange={setCreateRabOpen}
        initialProjectId={project.id}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Hapus proyek ini?"
        description={
          documents.length > 0 ? (
            <>
              Proyek{" "}
              <span className="font-medium text-foreground">{project.name}</span> memiliki{" "}
              <span className="font-medium text-foreground">
                {documents.length} dokumen RAB
              </span>
              . Semua dokumen tersebut beserta item pekerjaannya akan ikut terhapus.
              Tindakan ini tidak dapat dibatalkan.
            </>
          ) : (
            <>
              Proyek{" "}
              <span className="font-medium text-foreground">{project.name}</span> akan
              dihapus. Tindakan ini tidak dapat dibatalkan.
            </>
          )
        }
        confirmLabel={
          documents.length > 0 ? "Hapus proyek & dokumen" : "Hapus proyek"
        }
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
      <div className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className="truncate font-medium text-foreground" title={value}>
          {value}
        </dd>
      </div>
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

function DetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat proyek">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
