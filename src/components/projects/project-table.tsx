import Link from "next/link";
import { ArrowUpRight, FolderKanban } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { ButtonLink } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatIDR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

/**
 * Tabular project list for desktop. On small screens the table scrolls
 * horizontally; the Projects page uses `ProjectCard` for the card layout.
 */
export function ProjectTable({
  projects,
  className,
  emptyState,
}: {
  projects: Project[];
  className?: string;
  emptyState?: React.ReactNode;
}) {
  if (projects.length === 0) {
    return (
      <div className={className}>
        {emptyState ?? (
          <EmptyState
            icon={FolderKanban}
            title="Belum ada proyek"
            description="Proyek yang Anda buat akan muncul di sini."
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      <Table className="min-w-[760px]">
        <TableHeader className="bg-background/60">
          <TableRow className="hover:bg-transparent">
            <TableHead>Proyek</TableHead>
            <TableHead>Klien</TableHead>
            <TableHead>Lokasi</TableHead>
            <TableHead>Mulai</TableHead>
            <TableHead className="text-right">Total RAB</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Aksi</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow key={project.id}>
              <TableCell className="max-w-[260px]">
                <Link
                  href={`/projects/${project.id}`}
                  className="group block truncate font-medium text-foreground hover:text-primary"
                >
                  {project.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {project.documentCount} dokumen RAB
                </span>
              </TableCell>
              <TableCell className="max-w-[180px] truncate text-muted-foreground">
                {project.client || "—"}
              </TableCell>
              <TableCell className="max-w-[200px] truncate text-muted-foreground">
                {project.location || "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {project.startDate ? formatDate(project.startDate) : "—"}
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                {formatIDR(project.totalRab)}
              </TableCell>
              <TableCell>
                <ProjectStatusBadge status={project.status} />
              </TableCell>
              <TableCell className="pr-3">
                <ButtonLink
                  href={`/projects/${project.id}`}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Lihat detail proyek ${project.name}`}
                >
                  <ArrowUpRight className="size-4" />
                </ButtonLink>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
