"use client";

import { useState } from "react";
import {
  ArrowRight,
  CircleCheckBig,
  FileText,
  FolderKanban,
  Plus,
  Wallet,
} from "lucide-react";

import { RecentDocumentsCard } from "@/components/dashboard/recent-documents-card";
import { TodayLabel } from "@/components/dashboard/today-label";
import { MigrationBanner } from "@/components/dashboard/migration-banner";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { ProjectFormDialog } from "@/components/projects/project-form-dialog";
import { ProjectTable } from "@/components/projects/project-table";
import { DataError } from "@/components/shared/data-error";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIDR } from "@/lib/format";

export function DashboardView() {
  const { projects, documents, status, error, refresh } = useData();
  const { displayName } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  const recentProjects = projects.slice(0, 5);
  const recentDocuments = documents.slice(0, 3);

  const totalEstimatedBudget = documents.reduce(
    (sum, document) => sum + document.total,
    0,
  );
  const activeProjectCount = projects.filter(
    (project) => project.status === "active",
  ).length;
  const completedProjectCount = projects.filter(
    (project) => project.status === "completed",
  ).length;
  const projectsWithoutDocuments = projects.filter(
    (project) => project.documentCount === 0,
  ).length;

  const attentionMessage =
    projects.length === 0
      ? "Buat proyek pertama Anda untuk mulai menyusun RAB."
      : projectsWithoutDocuments > 0
        ? `${projectsWithoutDocuments} proyek belum memiliki dokumen RAB.`
        : null;

  const firstName = displayName.split(" ")[0] || "Pengguna";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<TodayLabel />}
        title={`Selamat datang kembali, ${firstName}`}
        description="Berikut ringkasan proyek dan dokumen RAB Anda hari ini."
        actions={
          <>
            <ButtonLink href="/rab" variant="secondary">
              <FileText />
              Lihat RAB
            </ButtonLink>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Buat Proyek
            </Button>
          </>
        }
      />

      <MigrationBanner />

      {status === "error" ? (
        <DataError
          message={error ?? "Gagal memuat data dari Supabase."}
          onRetry={() => void refresh()}
        />
      ) : status === "loading" ? (
        <DashboardLoading />
      ) : (
        <>
          {/* KPI row */}
          <section
            aria-label="Ringkasan"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard
              label="Total Proyek"
              value={String(projects.length)}
              icon={FolderKanban}
              hint={`${activeProjectCount} proyek aktif`}
            />
            <StatCard
              label="Dokumen RAB"
              value={String(documents.length)}
              icon={FileText}
              hint="Seluruh dokumen RAB Anda"
            />
            <StatCard
              label="Total Estimasi Anggaran"
              value={formatIDR(totalEstimatedBudget)}
              icon={Wallet}
              hint="Akumulasi seluruh dokumen RAB"
              accent
            />
            <StatCard
              label="Proyek Selesai"
              value={String(completedProjectCount)}
              icon={CircleCheckBig}
              hint="Proyek berstatus selesai"
            />
          </section>

          {/* Recent projects + documents */}
          <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="pb-4">
                <div>
                  <CardTitle>Proyek Terbaru</CardTitle>
                  <p className="mt-0.5 text-[14px] text-muted-foreground">
                    Proyek yang sedang Anda kerjakan.
                  </p>
                </div>
                <ButtonLink
                  href="/projects"
                  variant="ghost"
                  size="sm"
                  className="-mr-2"
                >
                  Semua proyek
                  <ArrowRight />
                </ButtonLink>
              </CardHeader>
              <ProjectTable
                projects={recentProjects}
                className="rounded-none border-x-0 border-b-0 shadow-none"
              />
            </Card>

            <div className="flex min-w-0 flex-col gap-6">
              <RecentDocumentsCard documents={recentDocuments} />

              {attentionMessage ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle>Perlu Perhatian</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="px-2 py-2 text-[14px] leading-relaxed text-muted-foreground">
                      {attentionMessage}
                    </p>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </section>
        </>
      )}

      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat dashboard">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
