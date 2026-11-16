import type { DisplayRow } from "./rab-hierarchy";

/**
 * Pelipatan GROUP utama pada tabel Rincian Pekerjaan.
 *
 * Kunci lipatan adalah `heading.key` dari `buildDisplayRows()` — unik per
 * kemunculan, sehingga dua kelompok berlabel sama tetap dapat dilipat
 * terpisah. Melipat hanya menyaring baris tampilan: urutan, ID, nilai, dan
 * antrean penyimpanan tidak berubah.
 */

export interface GroupMeta {
  key: string;
  label: string;
  itemCount: number;
  total: number;
}

/**
 * Ringkasan per GROUP utama: jumlah item (seluruh turunan) dan total kelompok
 * (dari baris subtotal level GROUP pada dokumen penuh).
 */
export function collectGroupMeta(rows: DisplayRow[]): Map<string, GroupMeta> {
  const meta = new Map<string, GroupMeta>();
  let current: GroupMeta | null = null;

  for (const row of rows) {
    if (row.kind === "heading") {
      if (row.depth === 0) {
        current = {
          key: row.key,
          label: row.label,
          itemCount: 0,
          total: 0,
        };
        meta.set(row.key, current);
      }
      continue;
    }

    if (row.kind === "item") {
      if (current && row.item.groupName) current.itemCount += 1;
      continue;
    }

    if (row.kind === "subtotal" && row.depth === 0 && current) {
      current.total = row.amount;
    }
  }

  return meta;
}

/**
 * Sembunyikan isi GROUP yang dilipat: subkelompok, item group, item, dan
 * subtotal turunannya. Baris heading GROUP sendiri tetap tampil beserta
 * ringkasannya. Item tanpa GROUP (di luar kelompok) tidak terpengaruh.
 */
export function applyCollapsedGroups(
  rows: DisplayRow[],
  collapsed: ReadonlySet<string>,
): DisplayRow[] {
  if (collapsed.size === 0) return rows;

  const visible: DisplayRow[] = [];
  let hiding = false;

  for (const row of rows) {
    if (row.kind === "heading" && row.depth === 0) {
      hiding = collapsed.has(row.key);
      visible.push(row);
      continue;
    }

    if (hiding) {
      // Subtotal GROUP menutup cakupan; baris setelahnya (mis. item tanpa
      // kelompok) kembali terlihat.
      if (row.kind === "subtotal" && row.depth === 0) hiding = false;
      continue;
    }

    visible.push(row);
  }

  return visible;
}

/** Semua kunci GROUP (untuk "Lipat semua"). */
export function allGroupKeys(meta: Map<string, GroupMeta>): string[] {
  return [...meta.keys()];
}

/** Jumlah item per GROUP pada dokumen penuh (untuk validasi/ringkasan). */
export function totalGroupedItems(meta: Map<string, GroupMeta>): number {
  let total = 0;
  for (const group of meta.values()) total += group.itemCount;
  return total;
}

/* -------------------------------------------------------------------------- */
/*  Identitas lipatan yang stabil antar-perubahan struktur                    */
/* -------------------------------------------------------------------------- */

export interface GroupIdentity {
  /** Kunci heading pada buildDisplayRows() saat ini (tidak stabil). */
  key: string;
  /**
   * Identitas untuk state lipatan: label GROUP + nomor kemunculan label yang
   * sama. Tidak memakai `heading-N`, sehingga pergeseran nomor heading akibat
   * penambahan/penghapusan item tidak memindahkan lipatan ke kelompok lain.
   */
  id: string;
  label: string;
}

/** Identitas setiap GROUP dalam urutan dokumen. */
export function groupIdentities(rows: DisplayRow[]): GroupIdentity[] {
  const seen = new Map<string, number>();
  const identities: GroupIdentity[] = [];

  for (const row of rows) {
    if (row.kind !== "heading" || row.depth !== 0) continue;

    const occurrence = seen.get(row.label) ?? 0;
    seen.set(row.label, occurrence + 1);

    identities.push({
      key: row.key,
      id: `${row.label}\u0001${occurrence}`,
      label: row.label,
    });
  }

  return identities;
}

/** Tanda tangan struktur GROUP; berubah bila daftar/urutan identitas berubah. */
export function groupStructureSignature(identities: GroupIdentity[]): string {
  return identities.map((entry) => entry.id).join("\u0002");
}

export interface CollapseState {
  signature: string;
  collapsed: ReadonlySet<string>;
}

const EMPTY_COLLAPSED: ReadonlySet<string> = new Set<string>();

/**
 * Terapkan state lipatan hanya bila struktur GROUP masih sama.
 *
 * Bila struktur berubah (GROUP ditambah/dihapus/diubah urutannya, atau label
 * berulang bergeser), seluruh kelompok kembali terbuka — tidak ada pemetaan
 * ulang berdasarkan label yang bisa salah menerapkan lipatan ke kelompok lain.
 */
export function resolveCollapsedIds(
  state: CollapseState,
  signature: string,
): ReadonlySet<string> {
  if (signature === "") return EMPTY_COLLAPSED;
  return state.signature === signature ? state.collapsed : EMPTY_COLLAPSED;
}

/* -------------------------------------------------------------------------- */
/*  Model tampilan lipatan (dipakai komponen dan pengujian integrasi)         */
/* -------------------------------------------------------------------------- */

export interface CollapseView {
  identities: GroupIdentity[];
  signature: string;
  /** Identitas GROUP yang sedang terlipat (state efektif). */
  collapsedIds: ReadonlySet<string>;
  /** Kunci heading yang sedang terlipat — SATU-SATUNYA kondisi efektif. */
  collapsedKeys: ReadonlySet<string>;
  /** Baris yang benar-benar dirender. */
  rows: DisplayRow[];
}

/**
 * Hitung model render dari state lipatan.
 *
 * Identitas → kunci heading dipetakan sekali di sini, lalu kondisi yang sama
 * dipakai untuk ikon/aria-expanded maupun penyaringan isi. Saat mencari,
 * lipatan diabaikan (semua hasil tampil) dan state tetap disimpan.
 */
export function buildCollapseView(input: {
  rows: DisplayRow[];
  searchRows: DisplayRow[];
  isSearching: boolean;
  state: CollapseState;
}): CollapseView {
  const identities = groupIdentities(input.rows);
  const signature = groupStructureSignature(identities);
  const collapsedIds = resolveCollapsedIds(input.state, signature);

  const collapsedKeys = new Set<string>();
  for (const identity of identities) {
    if (collapsedIds.has(identity.id)) collapsedKeys.add(identity.key);
  }

  return {
    identities,
    signature,
    collapsedIds,
    collapsedKeys,
    rows: input.isSearching
      ? input.searchRows
      : applyCollapsedGroups(input.rows, collapsedKeys),
  };
}

/** State lipatan setelah satu GROUP di-toggle (identitas, bukan label saja). */
export function toggleCollapseState(
  state: CollapseState,
  signature: string,
  identityId: string,
): CollapseState {
  const base = new Set(resolveCollapsedIds(state, signature));
  if (base.has(identityId)) base.delete(identityId);
  else base.add(identityId);
  return { signature, collapsed: base };
}
