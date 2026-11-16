import type { ProjectStatus } from "@/types";

/** Project statuses supported by the `projects.status` text column. */
export const PROJECT_STATUSES: ProjectStatus[] = [
  "active",
  "planning",
  "completed",
  "on-hold",
];

export const projectStatusMeta: Record<
  ProjectStatus,
  { label: string; tone: "green" | "blue" | "gray" | "amber" }
> = {
  active: { label: "Aktif", tone: "green" },
  planning: { label: "Perencanaan", tone: "blue" },
  completed: { label: "Selesai", tone: "gray" },
  "on-hold": { label: "Ditunda", tone: "amber" },
};

/** Coerce an unknown database value into a supported project status. */
export function normalizeProjectStatus(value: unknown): ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : "planning";
}
