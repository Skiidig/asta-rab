import { RAB_UNITS, sanitizeNumber } from "@/lib/rab-calc";
import { normalizeProjectStatus } from "@/lib/status";
import type { ProjectStatus, RabUnit } from "@/types";

/**
 * Read-only access to the snapshot written by the previous localStorage
 * version of RAB Mini.
 *
 * Nothing here ever deletes or rewrites `rab-mini:data:v1`. The migration flow
 * only reads it; a separate marker records that a migration has run so the
 * confirmation does not reappear on every visit.
 */

export const LEGACY_STORAGE_KEY = "rab-mini:data:v1";
export const MIGRATION_MARKER_KEY = "rab-mini:supabase-migration:v1";

export interface LegacyProject {
  id: string;
  name: string;
  client: string;
  location: string;
  startDate: string;
  status: ProjectStatus;
}

export interface LegacyDocument {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
}

export interface LegacyWorkItem {
  id: string;
  description: string;
  volume: number;
  unit: RabUnit;
  unitPrice: number;
}

export interface LegacySnapshot {
  projects: LegacyProject[];
  documents: LegacyDocument[];
  workItems: Record<string, LegacyWorkItem[]>;
}

export interface LegacyMigrationSummary {
  projectCount: number;
  documentCount: number;
  itemCount: number;
}

export interface MigrationMarkerInput extends LegacyMigrationSummary {
  projectCount: number;
  documentCount: number;
  itemCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asUnit(value: unknown): RabUnit {
  return RAB_UNITS.includes(value as RabUnit) ? (value as RabUnit) : "unit";
}

function asTimestamp(value: unknown, fallback: string) {
  const text = asString(value).trim();
  if (!text) return fallback;
  return Number.isFinite(new Date(text).getTime()) ? text : fallback;
}

function readStorage(key: string) {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be blocked (private mode, disabled cookies).
    return null;
  }
}

/** Parse and normalise the legacy snapshot; returns `null` when absent. */
export function readLegacySnapshot(): LegacySnapshot | null {
  const raw = readStorage(LEGACY_STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;

  const fallbackTimestamp = new Date().toISOString();
  const projects: LegacyProject[] = [];
  const projectIds = new Set<string>();

  if (Array.isArray(parsed.projects)) {
    for (const entry of parsed.projects) {
      if (!isRecord(entry)) continue;

      const id = asString(entry.id).trim();
      const name = asString(entry.name).trim();
      if (!id || !name || projectIds.has(id)) continue;
      projectIds.add(id);

      projects.push({
        id,
        name,
        client: asString(entry.client),
        location: asString(entry.location),
        startDate: asString(entry.startDate),
        status: normalizeProjectStatus(entry.status),
      });
    }
  }

  const documents: LegacyDocument[] = [];
  const documentIds = new Set<string>();

  if (Array.isArray(parsed.documents)) {
    for (const entry of parsed.documents) {
      if (!isRecord(entry)) continue;

      const id = asString(entry.id).trim();
      const projectId = asString(entry.projectId).trim();
      if (!id || documentIds.has(id) || !projectIds.has(projectId)) continue;
      documentIds.add(id);

      documents.push({
        id,
        projectId,
        title: asString(entry.title, "Dokumen RAB"),
        createdAt: asTimestamp(entry.createdAt, fallbackTimestamp),
      });
    }
  }

  const workItems: Record<string, LegacyWorkItem[]> = {};

  if (isRecord(parsed.workItems)) {
    for (const [documentId, entries] of Object.entries(parsed.workItems)) {
      if (!documentIds.has(documentId) || !Array.isArray(entries)) continue;

      const seen = new Set<string>();
      workItems[documentId] = entries.flatMap((entry, index) => {
        if (!isRecord(entry)) return [];

        const id =
          asString(entry.id).trim() || `legacy-item-${documentId}-${index + 1}`;
        if (seen.has(id)) return [];
        seen.add(id);

        return [
          {
            id,
            description: asString(entry.description),
            volume: sanitizeNumber(Number(entry.volume)),
            unit: asUnit(entry.unit),
            unitPrice: sanitizeNumber(Number(entry.unitPrice)),
          },
        ];
      });
    }
  }

  return { projects, documents, workItems };
}

export function countLegacySnapshot(snapshot: LegacySnapshot): LegacyMigrationSummary {
  return {
    projectCount: snapshot.projects.length,
    documentCount: snapshot.documents.length,
    itemCount: Object.values(snapshot.workItems).reduce(
      (total, items) => total + items.length,
      0,
    ),
  };
}

/** Summary for the dashboard banner, or `null` when there is nothing to do. */
export function getLegacyMigrationSummary(): LegacyMigrationSummary | null {
  if (readStorage(MIGRATION_MARKER_KEY) !== null) return null;

  const snapshot = readLegacySnapshot();
  if (!snapshot) return null;

  const summary = countLegacySnapshot(snapshot);
  if (summary.projectCount === 0 && summary.documentCount === 0) return null;

  return summary;
}

/**
 * Record a completed migration. The legacy snapshot itself is intentionally
 * left untouched so the user can still recover it manually.
 */
export function markLegacyMigrationComplete(
  summary: LegacyMigrationSummary,
): boolean {
  if (typeof window === "undefined") return false;

  try {
    window.localStorage.setItem(
      MIGRATION_MARKER_KEY,
      JSON.stringify({
        version: 1,
        migratedAt: new Date().toISOString(),
        ...summary,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
