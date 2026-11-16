import { toErrorMessage } from "@/lib/errors";
import type {
  LegacyMigrationSummary,
  LegacySnapshot,
} from "@/lib/legacy-migration";
import { sanitizeNumber } from "@/lib/rab-calc";

import { getSupabaseClient } from "./client";
import { normalizeDate } from "./data";

interface SupabaseErrorLike {
  message?: string;
  details?: string;
  hint?: string;
}

function describeError(error: SupabaseErrorLike | null) {
  if (!error) return "";
  return [error.message, error.details, error.hint]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" — ");
}

function migrationError(action: string, error: SupabaseErrorLike | null) {
  const detail = describeError(error);
  return new Error(
    `Migrasi gagal saat ${action}.${detail ? ` ${detail}` : ""}`,
  );
}

function createUuid() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Fallback for browsers without randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function timestampOrNow(value: string, fallback: number) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Copy a legacy localStorage snapshot into Supabase.
 *
 * New UUIDs are generated for every record, so non-UUID legacy ids cannot
 * collide with existing rows. Documents and items are linked through those
 * generated ids. On any failure the inserted projects are deleted again; the
 * database's cascade rules remove their documents and items.
 */
export async function migrateLegacySnapshot(
  snapshot: LegacySnapshot,
): Promise<LegacyMigrationSummary> {
  const supabase = getSupabaseClient();
  const now = Date.now();

  const projectIdMap = new Map<string, string>();
  const documentIdMap = new Map<string, string>();

  const projectRows = snapshot.projects.map((project, index) => {
    const id = createUuid();
    projectIdMap.set(project.id, id);

    return {
      id,
      name: project.name,
      client: project.client.trim() || null,
      location: project.location.trim() || null,
      date: normalizeDate(project.startDate),
      status: project.status,
      // Keep the legacy array order in the project list.
      created_at: new Date(now - index * 1000).toISOString(),
    };
  });

  const documentTimestamps = new Map<string, number>();

  const documentRows = snapshot.documents.map((document, index) => {
    const id = createUuid();
    documentIdMap.set(document.id, id);

    const createdAt =
      timestampOrNow(document.createdAt, now) + index;
    documentTimestamps.set(document.id, createdAt);

    return {
      id,
      project_id: projectIdMap.get(document.projectId) ?? "",
      title: document.title.trim() || "Dokumen RAB",
      date: null,
      created_at: new Date(createdAt).toISOString(),
    };
  });

  const itemRows: {
    id: string;
    rab_id: string;
    description: string;
    volume: number;
    unit: string;
    unit_price: number;
    created_at: string;
  }[] = [];

  for (const document of snapshot.documents) {
    const rabId = documentIdMap.get(document.id);
    if (!rabId) continue;

    const base = documentTimestamps.get(document.id) ?? now;
    const items = snapshot.workItems[document.id] ?? [];

    items.forEach((item, index) => {
      itemRows.push({
        id: createUuid(),
        rab_id: rabId,
        description: item.description,
        volume: sanitizeNumber(item.volume),
        unit: item.unit,
        unit_price: sanitizeNumber(item.unitPrice),
        created_at: new Date(base + index + 1).toISOString(),
      });
    });
  }

  const projectIds = projectRows.map((row) => row.id);

  try {
    if (projectRows.length > 0) {
      const { error } = await supabase.from("projects").insert(projectRows);
      if (error) throw migrationError("menyimpan proyek", error);
    }

    if (documentRows.length > 0) {
      const { error } = await supabase
        .from("rab_documents")
        .insert(documentRows);
      if (error) throw migrationError("menyimpan dokumen RAB", error);
    }

    for (const batch of chunks(itemRows, 200)) {
      const { error } = await supabase.from("rab_items").insert(batch);
      if (error) throw migrationError("menyimpan item pekerjaan", error);
    }
  } catch (error) {
    let rollbackNote = "";

    if (projectIds.length > 0) {
      const { error: rollbackError } = await supabase
        .from("projects")
        .delete()
        .in("id", projectIds);

      if (rollbackError) {
        const detail = describeError(rollbackError);
        rollbackNote =
          " Rollback otomatis juga gagal" +
          `${detail ? `: ${detail}` : "."} ` +
          "Hapus proyek hasil migrasi secara manual sebelum mencoba lagi.";
      }
    }

    throw new Error(`${toErrorMessage(error)}${rollbackNote}`);
  }

  return {
    projectCount: projectRows.length,
    documentCount: documentRows.length,
    itemCount: itemRows.length,
  };
}
