import type { RabWorkItem } from "@/types";
import { calculateItemAmount } from "@/lib/rab-calc";

/**
 * Model tampilan tabel RAB bergaya Excel.
 *
 * Satu dokumen dirender sebagai satu daftar baris: heading GROUP/SUBGROUP/
 * ITEM GROUP, baris ITEM, dan baris SUBTOTAL. Semua perhitungan diturunkan dari
 * item (tidak ada subtotal yang disimpan), sehingga tidak ada double counting.
 *
 * Fungsi di sini murni (tanpa React) agar mudah diuji.
 */

export type HierarchyLevel = "group" | "subgroup" | "item_group";

export interface HierarchyContext {
  groupName?: string | null;
  subgroupName?: string | null;
  itemGroupName?: string | null;
  /**
   * Identitas kemunculan GROUP untuk penempatan (mis. saat label GROUP
   * berulang). Tidak disimpan ke database; hanya dipakai helper penempatan.
   */
  anchorItemId?: string | null;
}

export interface HeadingRow {
  kind: "heading";
  key: string;
  level: HierarchyLevel;
  label: string;
  /** 0 = GROUP, 1 = SUBGROUP, 2 = ITEM GROUP. */
  depth: 0 | 1 | 2;
  /** Konteks untuk tombol "tambah item" pada heading ini. */
  context: HierarchyContext;
}

export interface ItemRow {
  kind: "item";
  key: string;
  item: RabWorkItem;
  /** Nomor urut pekerjaan (hanya item, mulai 1). */
  number: number;
}

export interface SubtotalRow {
  kind: "subtotal";
  key: string;
  level: HierarchyLevel;
  depth: 0 | 1 | 2;
  label: string;
  amount: number;
}

export type DisplayRow = HeadingRow | ItemRow | SubtotalRow;

const LEVELS: HierarchyLevel[] = ["group", "subgroup", "item_group"];

/** Apakah dokumen punya hierarki tersimpan? */
export function hasHierarchy(
  items: Pick<RabWorkItem, "groupName" | "subgroupName" | "itemGroupName">[],
): boolean {
  return items.some((item) =>
    Boolean(item.groupName || item.subgroupName || item.itemGroupName),
  );
}

/**
 * Urutkan item sesuai `sort_order`; item tanpa `sort_order` (dokumen lama atau
 * item manual) diletakkan paling akhir dengan urutan aslinya (sort stabil).
 */
export function sortWorkItems(items: RabWorkItem[]): RabWorkItem[] {
  return [...items].sort((a, b) => {
    const aSort = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const bSort = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    return aSort - bSort;
  });
}

/**
 * Susun baris tabel: heading + item + subtotal.
 *
 * Dokumen tanpa hierarki dirender datar (tanpa heading/subtotal palsu), sesuai
 * perilaku dokumen lama.
 */
export function buildDisplayRows(items: RabWorkItem[]): DisplayRow[] {
  const ordered = sortWorkItems(items);
  const rows: DisplayRow[] = [];
  let itemNumber = 0;

  if (!hasHierarchy(ordered)) {
    for (const item of ordered) {
      itemNumber += 1;
      rows.push({ kind: "item", key: item.id, item, number: itemNumber });
    }
    return rows;
  }

  interface OpenNode {
    level: 0 | 1 | 2;
    label: string;
    key: string;
    amount: number;
  }

  const stack: OpenNode[] = [];
  let headingSeq = 0;

  const closeTo = (target: number) => {
    while (stack.length > target) {
      const node = stack.pop();
      if (!node) break;
      rows.push({
        kind: "subtotal",
        key: `subtotal-${node.key}`,
        level: LEVELS[node.level],
        depth: node.level,
        label:
          node.level === 0 ? `Total ${node.label}` : `Subtotal ${node.label}`,
        amount: node.amount,
      });
    }
  };

  for (const item of ordered) {
    const labels = [
      item.groupName ?? null,
      item.subgroupName ?? null,
      item.itemGroupName ?? null,
    ];

    // Tutup heading yang tidak lagi cocok dengan jalur item ini.
    let common = 0;
    while (
      common < stack.length &&
      common < 3 &&
      labels[common] === stack[common].label
    ) {
      common += 1;
    }
    closeTo(common);

    // Buka heading baru sesuai kedalaman jalur item (induk wajib ada).
    for (let level = common; level < 3; level += 1) {
      const label = labels[level];
      if (!label) break;

      const key = `heading-${headingSeq}`;
      headingSeq += 1;
      stack.push({ level: level as 0 | 1 | 2, label, key, amount: 0 });

      rows.push({
        kind: "heading",
        key,
        level: LEVELS[level],
        label,
        depth: level as 0 | 1 | 2,
        context: {
          groupName: stack[0]?.label ?? null,
          subgroupName: stack[1]?.label ?? null,
          itemGroupName: stack[2]?.label ?? null,
        },
      });
    }

    itemNumber += 1;
    const amount = calculateItemAmount(item);
    for (const node of stack) node.amount += amount;
    rows.push({ kind: "item", key: item.id, item, number: itemNumber });
  }

  closeTo(0);
  return rows;
}

export interface NewItemPlacement {
  groupName?: string | null;
  subgroupName?: string | null;
  itemGroupName?: string | null;
  sortOrder?: number | null;
}

function matchesContext(item: RabWorkItem, context: HierarchyContext): boolean {
  if (context.groupName && (item.groupName ?? null) !== context.groupName) return false;
  if (context.subgroupName && (item.subgroupName ?? null) !== context.subgroupName) {
    return false;
  }
  if (context.itemGroupName && (item.itemGroupName ?? null) !== context.itemGroupName) {
    return false;
  }
  return true;
}

/**
 * Satu pilihan penempatan untuk setiap kemunculan GROUP, termasuk label yang
 * berulang. `id` adalah id item pertama pada kemunculan tersebut; id item
 * dipakai sebagai anchor karena GROUP sendiri tidak punya id di database.
 */
export interface GroupPlacementOption {
  id: string;
  label: string;
  context: HierarchyContext;
}

export function buildGroupPlacementOptions(
  items: RabWorkItem[],
): GroupPlacementOption[] {
  const ordered = sortWorkItems(items);
  const runs: Array<{ groupName: string; anchorId: string }> = [];

  let index = 0;
  while (index < ordered.length) {
    const groupName = ordered[index].groupName?.trim();
    if (!groupName) {
      index += 1;
      continue;
    }

    const start = index;
    while (
      index < ordered.length &&
      (ordered[index].groupName?.trim() ?? "") === groupName
    ) {
      index += 1;
    }

    runs.push({ groupName, anchorId: ordered[start].id });
  }

  const totals = new Map<string, number>();
  for (const run of runs) {
    totals.set(run.groupName, (totals.get(run.groupName) ?? 0) + 1);
  }

  const occurrences = new Map<string, number>();
  return runs.map((run) => {
    const occurrence = (occurrences.get(run.groupName) ?? 0) + 1;
    occurrences.set(run.groupName, occurrence);
    const repeated = (totals.get(run.groupName) ?? 0) > 1;

    return {
      id: run.anchorId,
      label: repeated
        ? `${run.groupName} (kemunculan ${occurrence})`
        : run.groupName,
      context: { groupName: run.groupName, anchorItemId: run.anchorId },
    };
  });
}

/**
 * Konteks + `sort_order` untuk item baru.
 *
 * - Dengan `context` (tombol "+" pada heading): item mewarisi GROUP/SUBGROUP/
 *   ITEM GROUP heading tersebut dan disisipkan tepat setelah item terakhir
 *   dalam cakupannya, sehingga tidak melompat ke akhir dokumen.
 * - Dengan `context.anchorItemId` (pemilih kelompok AHSP): cakupan dikunci ke
 *   kemunculan GROUP yang berisi item anchor, sehingga label GROUP berulang
 *   tidak digabung.
 * - Tanpa `context`: item baru mengikuti item terakhir (dipakai tombol tambah
 *   global dan penambahan dari Katalog/AHSP bila tidak ada kelompok).
 *
 * `sort_order` memakai celah di antara baris Excel (baris judul tidak
 * tersimpan), dan bila tidak ada celah dipakai nilai yang sama dengan item
 * terakhir cakupan — item baru dibuat belakangan sehingga tetap tampil setelah
 * item itu dan sebelum kelompok berikutnya.
 */
export function buildAddItemPlacement(
  items: RabWorkItem[],
  context?: HierarchyContext,
): NewItemPlacement {
  const ordered = sortWorkItems(items);

  if (context?.anchorItemId) {
    const anchorIndex = ordered.findIndex(
      (item) => item.id === context.anchorItemId,
    );
    if (anchorIndex < 0) {
      throw new Error(
        "Kelompok tujuan tidak lagi tersedia. Pilih kelompok lain.",
      );
    }

    const anchorGroup = ordered[anchorIndex].groupName?.trim();
    if (!anchorGroup) {
      throw new Error(
        "Kelompok tujuan tidak lagi tersedia. Pilih kelompok lain.",
      );
    }

    let start = anchorIndex;
    while (
      start > 0 &&
      (ordered[start - 1].groupName?.trim() ?? "") === anchorGroup
    ) {
      start -= 1;
    }
    let end = anchorIndex;
    while (
      end + 1 < ordered.length &&
      (ordered[end + 1].groupName?.trim() ?? "") === anchorGroup
    ) {
      end += 1;
    }

    const runSorts = ordered
      .slice(start, end + 1)
      .map((item) => (typeof item.sortOrder === "number" ? item.sortOrder : null))
      .filter((value): value is number => value !== null);
    const globalSorts = ordered
      .map((item) => (typeof item.sortOrder === "number" ? item.sortOrder : null))
      .filter((value): value is number => value !== null);

    if (globalSorts.length === 0) {
      return {
        groupName: anchorGroup,
        subgroupName: null,
        itemGroupName: null,
        sortOrder: null,
      };
    }

    const maxScope =
      runSorts.length > 0 ? Math.max(...runSorts) : Math.max(...globalSorts);
    const nextSort = globalSorts
      .filter((value) => value > maxScope)
      .sort((a, b) => a - b)[0];
    const sortOrder =
      nextSort === undefined || nextSort > maxScope + 1
        ? maxScope + 1
        : maxScope;

    return {
      groupName: anchorGroup,
      subgroupName: null,
      itemGroupName: null,
      sortOrder,
    };
  }

  const inherited = context ?? lastContext(ordered);

  const sorts = ordered
    .map((item) => (typeof item.sortOrder === "number" ? item.sortOrder : null))
    .filter((value): value is number => value !== null);

  if (sorts.length === 0) {
    return {
      groupName: inherited?.groupName ?? null,
      subgroupName: inherited?.subgroupName ?? null,
      itemGroupName: inherited?.itemGroupName ?? null,
      sortOrder: null,
    };
  }

  const scope = inherited ? ordered.filter((item) => matchesContext(item, inherited)) : ordered;
  const scopeSorts = scope
    .map((item) => (typeof item.sortOrder === "number" ? item.sortOrder : null))
    .filter((value): value is number => value !== null);

  const maxScope = scopeSorts.length > 0 ? Math.max(...scopeSorts) : Math.max(...sorts);
  const nextSort = sorts
    .filter((value) => value > maxScope)
    .sort((a, b) => a - b)[0];

  const sortOrder =
    nextSort === undefined || nextSort > maxScope + 1 ? maxScope + 1 : maxScope;

  return {
    groupName: inherited?.groupName ?? null,
    subgroupName: inherited?.subgroupName ?? null,
    itemGroupName: inherited?.itemGroupName ?? null,
    sortOrder,
  };
}

/** Konteks item terakhir dokumen (untuk penambahan di akhir). */
export function lastContext(items: RabWorkItem[]): HierarchyContext | undefined {
  const ordered = sortWorkItems(items);
  const last = ordered[ordered.length - 1];
  if (!last) return undefined;
  if (!last.groupName && !last.subgroupName && !last.itemGroupName) return undefined;

  return {
    groupName: last.groupName ?? null,
    subgroupName: last.subgroupName ?? null,
    itemGroupName: last.itemGroupName ?? null,
  };
}

/** Subtotal tiap cakupan (untuk laporan/uji); kunci = jalur label. */
export function collectScopeTotals(items: RabWorkItem[]): {
  group: Map<string, number>;
  subgroup: Map<string, number>;
  itemGroup: Map<string, number>;
} {
  const group = new Map<string, number>();
  const subgroup = new Map<string, number>();
  const itemGroup = new Map<string, number>();

  for (const item of items) {
    const amount = calculateItemAmount(item);
    if (item.groupName) group.set(item.groupName, (group.get(item.groupName) ?? 0) + amount);
    if (item.subgroupName) {
      subgroup.set(item.subgroupName, (subgroup.get(item.subgroupName) ?? 0) + amount);
    }
    if (item.itemGroupName) {
      itemGroup.set(item.itemGroupName, (itemGroup.get(item.itemGroupName) ?? 0) + amount);
    }
  }

  return { group, subgroup, itemGroup };
}

export interface GroupSummaryRow {
  /** Kunci stabil untuk React (per heading GROUP, termasuk yang berlabel sama). */
  key: string;
  label: string;
  itemCount: number;
  amount: number;
}

export interface GroupSummary {
  rows: GroupSummaryRow[];
  itemCount: number;
  total: number;
}

/**
 * Rekap per GROUP utama.
 *
 * Memakai `buildDisplayRows()` — sumber yang sama dengan editor, PDF, dan
 * Excel — sehingga pengelompokan serta nilainya tidak mungkin berbeda dari
 * tabel. Heading dan subtotal tidak pernah dihitung sebagai item; item tanpa
 * GROUP masuk ke baris "Tanpa kelompok" (dokumen lama menjadi satu baris).
 */
export function summarizeGroups(
  items: RabWorkItem[],
  ungroupedLabel = "Tanpa kelompok",
): GroupSummary {
  const rows: GroupSummaryRow[] = [];
  let currentGroup: GroupSummaryRow | null = null;
  let ungrouped: GroupSummaryRow | null = null;
  let itemCount = 0;
  let total = 0;

  const ungroupedBucket = (): GroupSummaryRow => {
    if (!ungrouped) {
      ungrouped = {
        key: "ungrouped",
        label: ungroupedLabel,
        itemCount: 0,
        amount: 0,
      };
    }
    return ungrouped;
  };

  for (const row of buildDisplayRows(items)) {
    if (row.kind === "heading") {
      if (row.depth === 0) {
        currentGroup = {
          key: `group-${rows.length}`,
          label: row.label,
          itemCount: 0,
          amount: 0,
        };
        rows.push(currentGroup);
      }
      continue;
    }

    if (row.kind !== "item") continue;

    const amount = calculateItemAmount(row.item);
    itemCount += 1;
    total += amount;

    if (row.item.groupName && currentGroup) {
      currentGroup.itemCount += 1;
      currentGroup.amount += amount;
    } else {
      const bucket = ungroupedBucket();
      bucket.itemCount += 1;
      bucket.amount += amount;
    }
  }

  if (ungrouped) rows.push(ungrouped);

  return { rows, itemCount, total };
}
