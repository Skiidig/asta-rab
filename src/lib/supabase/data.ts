import { calculateRabTotal, sanitizeNumber } from "@/lib/rab-calc";
import { fetchAllPages, type PageResponse } from "./paginate";
import { normalizeProjectStatus } from "@/lib/status";
import type {
  Project,
  ProjectStatus,
  RabDocument,
  RabUnit,
  RabWorkItem,
} from "@/types";

import { getSupabaseClient } from "./client";

/* -------------------------------------------------------------------------- */
/*  Raw row types                                                             */
/* -------------------------------------------------------------------------- */

export interface ProjectRow {
  id: string;
  name: string;
  client: string | null;
  location: string | null;
  date: string | null;
  status: string;
  created_at: string;
}

export interface RabDocumentRow {
  id: string;
  project_id: string;
  title: string;
  date: string | null;
  created_at: string;
}

export interface RabItemRow {
  id: string;
  rab_id: string;
  description: string;
  volume: number | string;
  unit: string;
  unit_price: number | string;
  created_at: string;
  /** Kolom struktur (migrasi 0005); NULL untuk dokumen lama. */
  group_name: string | null;
  subgroup_name: string | null;
  item_group_name: string | null;
  sort_order: number | null;
}

/* -------------------------------------------------------------------------- */
/*  Domain mapping                                                            */
/* -------------------------------------------------------------------------- */

function asText(value: string | null | undefined) {
  return value ?? "";
}

function asNonNegativeNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function asUnit(value: string): RabUnit {
  // Satuan disimpan sebagai teks bebas: satuan kustom dari Excel ("m'", "Point")
  // harus utuh saat dibaca kembali, bukan dipaksa menjadi "unit".
  return asText(value).trim() || "unit";
}

/** ISO date accepted by a Postgres `date` column, or `null`. */
export function normalizeDate(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return Number.isFinite(new Date(`${trimmed}T00:00:00Z`).getTime())
    ? trimmed
    : null;
}

/** Stable, human-friendly number derived from the row id and creation year. */
function documentNumber(createdAt: string, id: string) {
  const parsed = new Date(createdAt);
  const year = Number.isFinite(parsed.getTime())
    ? parsed.getFullYear()
    : new Date().getFullYear();
  return `RAB-${year}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    client: asText(row.client),
    location: asText(row.location),
    startDate: asText(row.date),
    status: normalizeProjectStatus(row.status),
    createdAt: row.created_at,
    documentCount: 0,
    totalRab: 0,
  };
}

export function mapDocumentRow(row: RabDocumentRow): RabDocument {
  return {
    id: row.id,
    number: documentNumber(row.created_at, row.id),
    title: asText(row.title) || "Dokumen RAB",
    projectId: row.project_id,
    projectName: "",
    date: asText(row.date),
    total: 0,
    itemCount: 0,
    createdAt: row.created_at,
  };
}

export function mapWorkItemRow(row: RabItemRow): RabWorkItem {
  const item: RabWorkItem = {
    id: row.id,
    description: asText(row.description),
    volume: asNonNegativeNumber(row.volume),
    unit: asUnit(row.unit),
    unitPrice: asNonNegativeNumber(row.unit_price),
  };

  // Hanya sertakan konteks struktur bila ada, agar dokumen lama tetap persis
  // seperti sebelumnya (tanpa field tambahan yang bernilai null).
  const groupName = asText(row.group_name).trim();
  const subgroupName = asText(row.subgroup_name).trim();
  const itemGroupName = asText(row.item_group_name).trim();

  if (groupName) item.groupName = groupName;
  if (subgroupName) item.subgroupName = subgroupName;
  if (itemGroupName) item.itemGroupName = itemGroupName;
  if (typeof row.sort_order === "number" && Number.isFinite(row.sort_order)) {
    item.sortOrder = row.sort_order;
  }

  return item;
}

/* -------------------------------------------------------------------------- */
/*  Derived workspace                                                         */
/* -------------------------------------------------------------------------- */

export interface WorkspaceData {
  projects: Project[];
  documents: RabDocument[];
  items: Record<string, RabWorkItem[]>;
}

export const EMPTY_WORKSPACE: WorkspaceData = {
  projects: [],
  documents: [],
  items: {},
};

/**
 * Recompute every value derived from other records: item totals, document
 * counts, project names, and per-project document totals. Documents whose
 * project is missing are dropped so the relationship graph stays consistent.
 */
export function recomputeWorkspace(workspace: WorkspaceData): WorkspaceData {
  const projectById = new Map(
    workspace.projects.map((project) => [project.id, project]),
  );

  const documents = workspace.documents
    .filter((document) => projectById.has(document.projectId))
    .map((document) => {
      const items = workspace.items[document.id] ?? [];
      return {
        ...document,
        projectName: projectById.get(document.projectId)?.name ?? "",
        total: calculateRabTotal(items),
        itemCount: items.length,
      };
    })
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );

  const documentIds = new Set(documents.map((document) => document.id));
  const items = Object.fromEntries(
    Object.entries(workspace.items).filter(([documentId]) =>
      documentIds.has(documentId),
    ),
  );

  const documentCount = new Map<string, number>();
  const totalRab = new Map<string, number>();

  for (const document of documents) {
    documentCount.set(
      document.projectId,
      (documentCount.get(document.projectId) ?? 0) + 1,
    );
    totalRab.set(
      document.projectId,
      (totalRab.get(document.projectId) ?? 0) + document.total,
    );
  }

  return {
    projects: workspace.projects.map((project) => ({
      ...project,
      documentCount: documentCount.get(project.id) ?? 0,
      totalRab: totalRab.get(project.id) ?? 0,
    })),
    documents,
    items,
  };
}

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

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

function queryError(label: string, error: SupabaseErrorLike | null) {
  const detail = describeError(error);
  return new Error(
    `Gagal memuat ${label} dari Supabase.${detail ? ` ${detail}` : ""}`,
  );
}

function writeError(action: string, error: SupabaseErrorLike | null) {
  const detail = describeError(error);
  return new Error(`Gagal ${action}.${detail ? ` ${detail}` : ""}`);
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the whole workspace with paginated reads.
 *
 * `rab_items` dapat melewati batas baris per respons PostgREST (mis. beberapa
 * dokumen × 490 item), sehingga setiap tabel dibaca halaman demi halaman.
 * Urutan selalu diakhiri `id` sebagai pembeda unik agar batas halaman tidak
 * membuat baris terlewat atau terduplikasi. Bila satu halaman gagal, seluruh
 * pemuatan dianggap gagal (tidak ada data parsial yang dilaporkan siap).
 */
export async function fetchWorkspace(): Promise<WorkspaceData> {
  const supabase = getSupabaseClient();

  const projectPage = async (from: number, to: number): Promise<PageResponse<ProjectRow>> => {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data as ProjectRow[] | null) ?? null, error };
  };

  const documentPage = async (
    from: number,
    to: number,
  ): Promise<PageResponse<RabDocumentRow>> => {
    const { data, error } = await supabase
      .from("rab_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data as RabDocumentRow[] | null) ?? null, error };
  };

  const itemPage = async (from: number, to: number): Promise<PageResponse<RabItemRow>> => {
    const { data, error } = await supabase
      .from("rab_items")
      .select("*")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    return { data: (data as RabItemRow[] | null) ?? null, error };
  };

  const [projectRows, documentRows, itemRows] = await Promise.all([
    fetchAllPages<ProjectRow>("daftar proyek", projectPage),
    fetchAllPages<RabDocumentRow>("dokumen RAB", documentPage),
    fetchAllPages<RabItemRow>("item pekerjaan", itemPage),
  ]);

  const projects = projectRows.map(mapProjectRow);
  const documents = documentRows.map(mapDocumentRow);

  const items: Record<string, RabWorkItem[]> = {};
  for (const row of itemRows) {
    (items[row.rab_id] ??= []).push(mapWorkItemRow(row));
  }

  return recomputeWorkspace({ projects, documents, items });
}

/* -------------------------------------------------------------------------- */
/*  Project writes                                                            */
/* -------------------------------------------------------------------------- */

export interface ProjectWrite {
  name: string;
  client: string;
  location: string;
  startDate: string;
  status: ProjectStatus;
}

function projectColumns(input: ProjectWrite) {
  return {
    name: input.name.trim(),
    client: input.client.trim() || null,
    location: input.location.trim() || null,
    date: normalizeDate(input.startDate),
    status: normalizeProjectStatus(input.status),
  };
}

export async function createProjectRecord(
  input: ProjectWrite,
): Promise<Project> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .insert(projectColumns(input))
    .select("*")
    .single();

  if (error) throw writeError("menyimpan proyek", error);
  if (!data) throw new Error("Proyek tersimpan tetapi tidak dapat dibaca kembali.");

  return mapProjectRow(data as ProjectRow);
}

export async function updateProjectRecord(
  id: string,
  input: ProjectWrite,
): Promise<Project> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .update(projectColumns(input))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw writeError("memperbarui proyek", error);
  if (!data) throw new Error("Proyek tidak ditemukan.");

  return mapProjectRow(data as ProjectRow);
}

export async function deleteProjectRecord(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw writeError("menghapus proyek", error);
}

/* -------------------------------------------------------------------------- */
/*  Document writes                                                           */
/* -------------------------------------------------------------------------- */

export interface DocumentWrite {
  projectId: string;
  title: string;
  date: string;
}

export interface DocumentPatch {
  projectId?: string;
  title?: string;
  date?: string;
}

export async function createDocumentRecord(
  input: DocumentWrite,
): Promise<RabDocument> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("rab_documents")
    .insert({
      project_id: input.projectId,
      title: input.title.trim() || "Dokumen RAB Baru",
      date: normalizeDate(input.date),
    })
    .select("*")
    .single();

  if (error) throw writeError("menyimpan dokumen RAB", error);
  if (!data) {
    throw new Error("Dokumen RAB tersimpan tetapi tidak dapat dibaca kembali.");
  }

  return mapDocumentRow(data as RabDocumentRow);
}

export async function updateDocumentRecord(
  id: string,
  patch: DocumentPatch,
): Promise<RabDocument> {
  const columns: Record<string, unknown> = {};

  if (patch.projectId !== undefined) columns.project_id = patch.projectId;
  if (patch.title !== undefined) {
    columns.title = patch.title.trim() || "Dokumen RAB";
  }
  if (patch.date !== undefined) columns.date = normalizeDate(patch.date);

  if (Object.keys(columns).length === 0) {
    throw new Error("Tidak ada perubahan dokumen yang dikirim.");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("rab_documents")
    .update(columns)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw writeError("memperbarui dokumen RAB", error);
  if (!data) throw new Error("Dokumen RAB tidak ditemukan.");

  return mapDocumentRow(data as RabDocumentRow);
}

export async function deleteDocumentRecord(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("rab_documents").delete().eq("id", id);
  if (error) throw writeError("menghapus dokumen RAB", error);
}

/* -------------------------------------------------------------------------- */
/*  Work item writes                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Nilai awal opsional untuk baris item baru.
 *
 * Dipakai ketika pengguna memilih item dari Katalog Harga: nama, satuan, dan
 * harga disalin (snapshot) ke baris `rab_items`. Tidak ada referensi ke tabel
 * katalog, sehingga perubahan atau penghapusan katalog tidak menyentuh dokumen
 * RAB yang sudah dibuat.
 */
export interface WorkItemPreset {
  /** ID dari klien (dipakai ulang saat retry agar tidak menggandakan item). */
  id?: string;
  description?: string;
  volume?: number;
  unit?: RabUnit;
  unitPrice?: number;
  /** Konteks hierarki (hasil import atau tombol tambah di dalam kelompok). */
  groupName?: string | null;
  subgroupName?: string | null;
  itemGroupName?: string | null;
  /** Posisi baris pada urutan Excel; `null` untuk dokumen lama. */
  sortOrder?: number | null;
}

export async function createWorkItemRecord(
  rabId: string,
  preset: WorkItemPreset = {},
): Promise<RabWorkItem> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("rab_items")
    .insert({
      ...(preset.id ? { id: preset.id } : {}),
      rab_id: rabId,
      description: preset.description ?? "",
      volume: sanitizeNumber(preset.volume ?? 1),
      unit: preset.unit ?? "m2",
      unit_price: sanitizeNumber(preset.unitPrice ?? 0),
      group_name: preset.groupName?.trim() || null,
      subgroup_name: preset.subgroupName?.trim() || null,
      item_group_name: preset.itemGroupName?.trim() || null,
      sort_order:
        typeof preset.sortOrder === "number" && Number.isFinite(preset.sortOrder)
          ? Math.trunc(preset.sortOrder)
          : null,
    })
    .select("*")
    .single();

  if (error) throw writeError("menambah item pekerjaan", error);
  if (!data) {
    throw new Error("Item tersimpan tetapi tidak dapat dibaca kembali.");
  }

  return mapWorkItemRow(data as RabItemRow);
}

/**
 * Ambil satu item berdasarkan ID (dipakai memastikan hasil operasi tambah
 * saat respons sebelumnya hilang).
 */
export async function fetchWorkItemRecord(
  id: string,
): Promise<{ item: RabWorkItem; documentId: string } | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("rab_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw queryError("item pekerjaan", error);
  if (!data) return null;

  const row = data as RabItemRow;
  return { item: mapWorkItemRow(row), documentId: row.rab_id };
}

export async function updateWorkItemRecord(
  id: string,
  patch: Partial<RabWorkItem>,
): Promise<void> {
  const columns: Record<string, unknown> = {};

  if (patch.description !== undefined) columns.description = patch.description;
  if (patch.volume !== undefined) columns.volume = sanitizeNumber(patch.volume);
  if (patch.unit !== undefined) columns.unit = patch.unit;
  if (patch.unitPrice !== undefined) {
    columns.unit_price = sanitizeNumber(patch.unitPrice);
  }

  if (Object.keys(columns).length === 0) return;

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("rab_items")
    .update(columns)
    .eq("id", id);

  if (error) throw writeError("memperbarui item pekerjaan", error);
}

export async function deleteWorkItemRecord(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("rab_items").delete().eq("id", id);
  if (error) throw writeError("menghapus item pekerjaan", error);
}

/**
 * Jumlah item tersimpan untuk satu dokumen.
 *
 * Dipakai sebelum duplikasi untuk memastikan daftar item di memori tidak
 * terpotong (mis. batas baris PostgREST) — jangan menyalin daftar yang belum
 * lengkap.
 */
export async function countDocumentItems(rabId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("rab_items")
    .select("id", { count: "exact", head: true })
    .eq("rab_id", rabId);

  if (error) throw queryError("jumlah item dokumen", error);
  return count ?? 0;
}

/**
 * Insert a batch of items for a document.
 *
 * Ordering is derived from `created_at`, so timestamps are staggered by one
 * millisecond per row to preserve the source order in the editor.
 */
export async function insertWorkItemsRecord(
  rabId: string,
  items: (Pick<RabWorkItem, "description" | "volume" | "unit" | "unitPrice"> &
    Partial<Pick<RabWorkItem, "groupName" | "subgroupName" | "itemGroupName" | "sortOrder">>)[],
  baseTime = Date.now(),
): Promise<RabWorkItem[]> {
  if (items.length === 0) return [];

  const rows = items.map((item, index) => ({
    rab_id: rabId,
    description: item.description,
    volume: sanitizeNumber(item.volume),
    unit: item.unit,
    unit_price: sanitizeNumber(item.unitPrice),
    created_at: new Date(baseTime + index).toISOString(),
    group_name: item.groupName?.trim() || null,
    subgroup_name: item.subgroupName?.trim() || null,
    item_group_name: item.itemGroupName?.trim() || null,
    sort_order:
      typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder)
        ? Math.trunc(item.sortOrder)
        : null,
  }));

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("rab_items")
    .insert(rows)
    .select("*");

  if (error) throw writeError("menyalin item pekerjaan", error);

  return ((data ?? []) as RabItemRow[]).map(mapWorkItemRow);
}
