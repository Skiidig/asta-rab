import type { GroupSummary, GroupSummaryRow } from "./rab-hierarchy";

/**
 * Perbandingan dua rekap GROUP utama.
 *
 * Aturan pencocokan (hanya level GROUP, tidak menebak pasangan item):
 * - Identitas kelompok yang tersimpan hanya **label** (tidak ada id GROUP di
 *   `rab_items`), jadi pencocokan memakai label.
 * - Label yang **unik di kedua dokumen** dipasangkan.
 * - Label yang berulang di salah satu dokumen dianggap **belum dapat
 *   dipasangkan**; setiap kemunculan ditampilkan terpisah dan tidak digabung.
 * - Label yang hanya ada di satu dokumen tetap tampil sebagai baris sendiri.
 * - "Tanpa kelompok" mengikuti baris yang sudah dihasilkan `summarizeGroups`.
 *
 * Semua nilai memakai presisi penuh; pembulatan hanya dilakukan di tampilan.
 * Selisih = pembanding − acuan.
 */

export type ComparisonDirection = "up" | "down" | "same";

export type ComparisonRowStatus =
  | "matched"
  | "baseline_only"
  | "comparison_only"
  | "unpaired";

export interface ComparisonRow {
  key: string;
  label: string;
  /** `null` bila kelompok tidak ada di dokumen acuan. */
  baseline: number | null;
  /** `null` bila kelompok tidak ada di dokumen pembanding. */
  comparison: number | null;
  difference: number;
  /** `null` = tidak dapat dihitung (acuan nol tanpa pasangan / tidak dipasangkan). */
  percent: number | null;
  status: ComparisonRowStatus;
  /** Jumlah item pada sisi acuan/pembanding (null bila kelompok tidak ada). */
  baselineItems: number | null;
  comparisonItems: number | null;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  baselineItems: number;
  comparisonItems: number;
  itemDelta: number;
  baselineTotal: number;
  comparisonTotal: number;
  difference: number;
  percent: number | null;
  direction: ComparisonDirection;
}

const CENT_TOLERANCE = 0.005;

function directionOf(difference: number): ComparisonDirection {
  if (Math.abs(difference) < CENT_TOLERANCE) return "same";
  return difference > 0 ? "up" : "down";
}

function percentOf(baseline: number, comparison: number): number | null {
  if (baseline === 0) return comparison === 0 ? 0 : null;
  return ((comparison - baseline) / baseline) * 100;
}

function byLabel(rows: GroupSummaryRow[]): Map<string, GroupSummaryRow[]> {
  const map = new Map<string, GroupSummaryRow[]>();
  for (const row of rows) {
    const list = map.get(row.label);
    if (list) list.push(row);
    else map.set(row.label, [row]);
  }
  return map;
}

/**
 * Bandingkan dua `GroupSummary` (dari `summarizeGroups`) dan hasilkan baris
 * per kelompok + ringkasan total.
 *
 * Jumlah `difference` seluruh baris selalu sama dengan selisih grand total,
 * termasuk kelompok yang belum dapat dipasangkan.
 */
export function compareGroupSummaries(
  baseline: GroupSummary,
  comparison: GroupSummary,
): ComparisonResult {
  const baselineByLabel = byLabel(baseline.rows);
  const comparisonByLabel = byLabel(comparison.rows);

  const rows: ComparisonRow[] = [];
  const handled = new Set<string>();

  for (const row of baseline.rows) {
    const baseGroup = baselineByLabel.get(row.label) ?? [];
    const compGroup = comparisonByLabel.get(row.label) ?? [];
    const ambiguous = baseGroup.length > 1 || compGroup.length > 1;

    if (ambiguous) {
      // Setiap kemunculan ditampilkan sendiri; tidak ada yang dipasangkan.
      rows.push({
        key: `b:${row.key}`,
        label: row.label,
        baseline: row.amount,
        comparison: null,
        difference: -row.amount,
        percent: null,
        status: "unpaired",
        baselineItems: row.itemCount,
        comparisonItems: null,
      });
      handled.add(row.label);
      continue;
    }

    if (compGroup.length === 0) {
      rows.push({
        key: `b:${row.key}`,
        label: row.label,
        baseline: row.amount,
        comparison: null,
        difference: -row.amount,
        percent: percentOf(row.amount, 0),
        status: "baseline_only",
        baselineItems: row.itemCount,
        comparisonItems: null,
      });
      handled.add(row.label);
      continue;
    }

    // Unik di kedua sisi → dipasangkan (hanya sekali per label).
    if (handled.has(row.label)) continue;
    handled.add(row.label);

    const counterpart = compGroup[0];
    rows.push({
      key: `m:${row.label}`,
      label: row.label,
      baseline: row.amount,
      comparison: counterpart.amount,
      difference: counterpart.amount - row.amount,
      percent: percentOf(row.amount, counterpart.amount),
      status: "matched",
      baselineItems: row.itemCount,
      comparisonItems: counterpart.itemCount,
    });
  }

  for (const row of comparison.rows) {
    const baseGroup = baselineByLabel.get(row.label) ?? [];
    const compGroup = comparisonByLabel.get(row.label) ?? [];
    const matched = baseGroup.length === 1 && compGroup.length === 1;

    // Pasangan unik sudah ditampilkan dari sisi acuan.
    if (matched) continue;

    // Hanya ada di pembanding, atau label ambigu (kemunculan pembanding tetap
    // ditampilkan terpisah agar jumlah selisih tetap rekonsiliasi).
    rows.push({
      key: `c:${row.key}`,
      label: row.label,
      baseline: null,
      comparison: row.amount,
      difference: row.amount,
      percent: null,
      status: baseGroup.length === 0 ? "comparison_only" : "unpaired",
      baselineItems: null,
      comparisonItems: row.itemCount,
    });
  }

  const difference = comparison.total - baseline.total;

  return {
    rows,
    baselineItems: baseline.itemCount,
    comparisonItems: comparison.itemCount,
    itemDelta: comparison.itemCount - baseline.itemCount,
    baselineTotal: baseline.total,
    comparisonTotal: comparison.total,
    difference,
    percent: percentOf(baseline.total, comparison.total),
    direction: directionOf(difference),
  };
}
