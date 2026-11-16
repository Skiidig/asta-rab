import { Badge, type BadgeProps } from "@/components/ui/badge";
import { projectStatusMeta } from "@/lib/status";
import type { ProjectStatus } from "@/types";

type Tone = NonNullable<BadgeProps["variant"]>;

function StatusBadgeBase({
  label,
  tone,
}: {
  label: string;
  tone: Tone;
}) {
  return (
    <Badge variant={tone} withDot>
      {label}
    </Badge>
  );
}

/** Status pill for projects (Aktif, Perencanaan, Selesai, Ditunda). */
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const meta = projectStatusMeta[status];
  return <StatusBadgeBase label={meta.label} tone={meta.tone} />;
}
