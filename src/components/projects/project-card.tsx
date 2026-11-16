import Link from "next/link";
import { ArrowUpRight, CalendarDays, FileText, MapPin } from "lucide-react";

import { ProjectStatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatIDR } from "@/lib/format";
import type { Project } from "@/types";

/**
 * Card representation of a project, used in the Projects grid and on mobile.
 */
export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="group flex flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised">
      <div className="flex items-center justify-end gap-3">
        <ProjectStatusBadge status={project.status} />
      </div>

      <h3 className="mt-3 line-clamp-2 text-[15px] leading-snug font-semibold tracking-tight text-foreground">
        <Link href={`/projects/${project.id}`} className="hover:text-primary">
          {project.name}
        </Link>
      </h3>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {project.client || "Tanpa klien"}
      </p>

      <dl className="mt-4 space-y-1.5 text-[13px]">
        <div className="flex items-start gap-2 text-muted-foreground">
          <MapPin className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} />
          <dd className="line-clamp-1">{project.location || "—"}</dd>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" strokeWidth={1.8} />
          <dd>
            Mulai{" "}
            {project.startDate ? formatDate(project.startDate) : "belum diisi"}
          </dd>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <FileText className="size-3.5 shrink-0" strokeWidth={1.8} />
          <dd>{project.documentCount} dokumen RAB</dd>
        </div>
      </dl>

      <div className="mt-4 flex items-end justify-between border-t border-border pt-3.5">
        <div>
          <p className="text-[11px] text-muted-foreground">Total RAB</p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {formatIDR(project.totalRab)}
          </p>
        </div>
        <Link
          href={`/projects/${project.id}`}
          aria-label={`Lihat proyek ${project.name}`}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
        >
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
    </article>
  );
}
