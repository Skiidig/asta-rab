import type {
  DisplayRow,
  HeadingRow,
  ItemRow,
  SubtotalRow,
} from "./rab-hierarchy";

/**
 * Penyaringan tabel Rincian Pekerjaan.
 *
 * Aturan:
 * - Mencocokkan uraian (case-insensitive, spasi tepi diabaikan) dan nomor item.
 * - Kata kunci yang hanya berisi angka mencocokkan **nomor item secara tepat**
 *   (bukan sebagian), selain tetap mencari di uraian.
 * - Heading (GROUP/SUBGROUP/ITEM GROUP) hanya ditampilkan bila menjadi konteks
 *   item hasil pencarian; heading tanpa hasil disembunyikan.
 * - Subtotal tidak pernah dihitung ulang: baris subtotal yang ditampilkan
 *   memakai nilai cakupan penuh dokumen dari `buildDisplayRows`.
 * - Nomor item tidak diberi ulang; memakai nomor dokumen asli.
 *
 * `forceItemId` dipakai saat pengguna sedang mengedit uraian item: baris itu
 * tetap terlihat sampai edit selesai meskipun uraiannya tidak lagi cocok.
 */

export interface DisplaySearchResult {
  rows: DisplayRow[];
  /** Jumlah item yang terlihat (termasuk item yang dipaksa tampil saat edit). */
  matchCount: number;
  /** Jumlah seluruh item dokumen, bukan hasil pencarian. */
  totalItems: number;
}

interface SearchOptions {
  forceItemId?: string | null;
}

interface Node {
  heading: HeadingRow | null;
  entries: (ItemRow | Node)[];
  subtotal: SubtotalRow | null;
}

function isNode(entry: ItemRow | Node): entry is Node {
  return "entries" in entry;
}

function buildTree(rows: DisplayRow[]): Node {
  const root: Node = { heading: null, entries: [], subtotal: null };
  const stack: Node[] = [root];

  for (const row of rows) {
    const current = stack[stack.length - 1];

    if (row.kind === "heading") {
      const node: Node = { heading: row, entries: [], subtotal: null };
      current.entries.push(node);
      stack.push(node);
      continue;
    }

    if (row.kind === "item") {
      current.entries.push(row);
      continue;
    }

    current.subtotal = row;
    if (stack.length > 1) stack.pop();
  }

  return root;
}

function filterNode(
  node: Node,
  matches: (row: ItemRow) => boolean,
): { rows: DisplayRow[]; matched: number } {
  const children: DisplayRow[] = [];
  let matched = 0;

  for (const entry of node.entries) {
    if (isNode(entry)) {
      const result = filterNode(entry, matches);
      if (result.matched > 0) {
        children.push(...result.rows);
        matched += result.matched;
      }
      continue;
    }

    if (matches(entry)) {
      children.push(entry);
      matched += 1;
    }
  }

  if (!node.heading) return { rows: children, matched };
  if (matched === 0) return { rows: [], matched: 0 };

  const rows: DisplayRow[] = [node.heading, ...children];
  // Nilai subtotal tetap dari cakupan penuh (bukan hasil pencarian).
  if (node.subtotal) rows.push(node.subtotal);

  return { rows, matched };
}

export function filterDisplayRows(
  rows: DisplayRow[],
  query: string,
  options: SearchOptions = {},
): DisplaySearchResult {
  const totalItems = rows.filter((row) => row.kind === "item").length;
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return { rows, matchCount: totalItems, totalItems };
  }

  const numeric = /^\d+$/.test(normalized) ? Number(normalized) : null;
  const forceItemId = options.forceItemId ?? null;

  const matches = (row: ItemRow): boolean => {
    if (forceItemId && row.item.id === forceItemId) return true;
    if (numeric !== null && row.number === numeric) return true;
    return row.item.description.toLowerCase().includes(normalized);
  };

  const result = filterNode(buildTree(rows), matches);

  return {
    rows: result.rows,
    matchCount: result.matched,
    totalItems,
  };
}
