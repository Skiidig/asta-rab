import {
  normalizeResourceCategory,
  normalizeAhspCategory,
  type AhspAnalysisInput,
  type AhspComponentInput,
} from "@/lib/ahsp";
import { RAB_UNITS, sanitizeNumber } from "@/lib/rab-calc";
import type {
  AhspAnalysis,
  AhspAnalysisDetail,
  AhspComponent,
  RabUnit,
} from "@/types";

import { getSupabaseClient } from "./client";

/**
 * Akses data AHSP (`public.ahsp_analyses` + `public.ahsp_components`).
 *
 * Semua query tunduk pada RLS: analisis hanya milik pengguna yang masuk, dan
 * komponen mengikuti kepemilikan analisisnya.
 */

export interface AhspAnalysisRow {
  id: string;
  user_id: string;
  name: string;
  category: string;
  unit: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AhspComponentRow {
  id: string;
  analysis_id: string;
  catalog_item_id: string | null;
  resource_name: string;
  resource_category: string;
  unit: string;
  coefficient: number | string;
  unit_price: number | string;
  created_at: string;
  updated_at: string;
}

function asText(value: string | null | undefined) {
  return value ?? "";
}

function asNonNegativeNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function asUnit(value: string): RabUnit {
  return RAB_UNITS.includes(value as RabUnit) ? (value as RabUnit) : "unit";
}

export function mapAhspAnalysisRow(row: AhspAnalysisRow): AhspAnalysis {
  return {
    id: row.id,
    name: asText(row.name).trim() || "Tanpa nama",
    category: normalizeAhspCategory(row.category),
    unit: asUnit(row.unit),
    description: asText(row.description),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export function mapAhspComponentRow(row: AhspComponentRow): AhspComponent {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    catalogItemId: row.catalog_item_id ?? null,
    resourceName: asText(row.resource_name).trim(),
    resourceCategory: normalizeResourceCategory(row.resource_category),
    unit: asUnit(row.unit),
    coefficient: asNonNegativeNumber(row.coefficient),
    unitPrice: asNonNegativeNumber(row.unit_price),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

interface SupabaseErrorLike {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}

function describeError(error: SupabaseErrorLike | null) {
  if (!error) return "";
  return [error.message, error.details, error.hint]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" — ");
}

function ahspError(action: string, error: SupabaseErrorLike | null) {
  if (error?.code === "PGRST205") {
    return new Error(
      "Tabel AHSP belum ada di database. Jalankan " +
        "supabase/migrations/0004_ahsp.sql di Supabase SQL Editor, " +
        "lalu muat ulang halaman ini.",
    );
  }

  if (error?.code === "23503") {
    return new Error(
      "Item katalog yang dipilih sudah tidak tersedia. Pilih item lain atau isi komponen secara manual.",
    );
  }

  const detail = describeError(error);
  return new Error(`Gagal ${action}.${detail ? ` ${detail}` : ""}`);
}

function analysisColumns(input: AhspAnalysisInput) {
  return {
    name: input.name.trim(),
    category: normalizeAhspCategory(input.category),
    unit: input.unit,
    description: input.description.trim() || null,
  };
}

function componentColumns(input: AhspComponentInput) {
  return {
    catalog_item_id: input.catalogItemId,
    resource_name: input.resourceName.trim(),
    resource_category: input.resourceCategory,
    unit: input.unit,
    coefficient: sanitizeNumber(input.coefficient),
    unit_price: sanitizeNumber(input.unitPrice),
  };
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

/** Semua analisis milik pengguna beserta komponennya. */
export async function fetchAhspAnalyses(): Promise<AhspAnalysisDetail[]> {
  const supabase = getSupabaseClient();

  const [analysisResult, componentResult] = await Promise.all([
    supabase.from("ahsp_analyses").select("*").order("name", { ascending: true }),
    supabase
      .from("ahsp_components")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (analysisResult.error) throw ahspError("memuat analisis AHSP", analysisResult.error);
  if (componentResult.error) throw ahspError("memuat komponen AHSP", componentResult.error);

  const componentsByAnalysis = new Map<string, AhspComponent[]>();
  for (const row of (componentResult.data ?? []) as AhspComponentRow[]) {
    const component = mapAhspComponentRow(row);
    const list = componentsByAnalysis.get(component.analysisId) ?? [];
    list.push(component);
    componentsByAnalysis.set(component.analysisId, list);
  }

  return ((analysisResult.data ?? []) as AhspAnalysisRow[]).map((row) => {
    const analysis = mapAhspAnalysisRow(row);
    return {
      ...analysis,
      components: componentsByAnalysis.get(analysis.id) ?? [],
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Analysis writes                                                           */
/* -------------------------------------------------------------------------- */

export async function createAhspAnalysisRecord(
  input: AhspAnalysisInput,
): Promise<AhspAnalysis> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ahsp_analyses")
    .insert(analysisColumns(input))
    .select("*")
    .single();

  if (error) throw ahspError("menyimpan analisis AHSP", error);
  if (!data) throw new Error("Analisis tersimpan tetapi tidak dapat dibaca kembali.");

  return mapAhspAnalysisRow(data as AhspAnalysisRow);
}

export async function updateAhspAnalysisRecord(
  id: string,
  input: AhspAnalysisInput,
): Promise<AhspAnalysis> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ahsp_analyses")
    .update(analysisColumns(input))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw ahspError("memperbarui analisis AHSP", error);
  if (!data) throw new Error("Analisis AHSP tidak ditemukan.");

  return mapAhspAnalysisRow(data as AhspAnalysisRow);
}

export async function deleteAhspAnalysisRecord(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("ahsp_analyses").delete().eq("id", id);
  if (error) throw ahspError("menghapus analisis AHSP", error);
}

/* -------------------------------------------------------------------------- */
/*  Component writes                                                          */
/* -------------------------------------------------------------------------- */

export async function createAhspComponentRecord(
  analysisId: string,
  input: AhspComponentInput,
): Promise<AhspComponent> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ahsp_components")
    .insert({ analysis_id: analysisId, ...componentColumns(input) })
    .select("*")
    .single();

  if (error) throw ahspError("menyimpan komponen AHSP", error);
  if (!data) throw new Error("Komponen tersimpan tetapi tidak dapat dibaca kembali.");

  return mapAhspComponentRow(data as AhspComponentRow);
}

export async function updateAhspComponentRecord(
  id: string,
  input: AhspComponentInput,
): Promise<AhspComponent> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ahsp_components")
    .update(componentColumns(input))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw ahspError("memperbarui komponen AHSP", error);
  if (!data) throw new Error("Komponen AHSP tidak ditemukan.");

  return mapAhspComponentRow(data as AhspComponentRow);
}

export async function deleteAhspComponentRecord(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("ahsp_components").delete().eq("id", id);
  if (error) throw ahspError("menghapus komponen AHSP", error);
}
