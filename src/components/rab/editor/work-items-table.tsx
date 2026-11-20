"use client";

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  BookOpen,
  Calculator,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { NumberInput } from "@/components/rab/editor/number-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatIDRMoney } from "@/lib/format";
import { calculateItemAmount, RAB_UNITS } from "@/lib/rab-calc";
import { formatVolumeForDisplay } from "@/lib/volume-format";
import {
  buildDisplayRows,
  type DisplayRow,
  type HeadingRow,
  type HierarchyContext,
  type ItemRow,
} from "@/lib/rab-hierarchy";
import { filterDisplayRows } from "@/lib/rab-search";
import {
  buildCollapseView,
  collectGroupMeta,
  toggleCollapseState,
  type CollapseState,
  type GroupMeta,
} from "@/lib/rab-collapse";
import { cn } from "@/lib/utils";
import type { RabUnit, RabWorkItem } from "@/types";

const unitOptions = RAB_UNITS.map((unit) => ({ value: unit, label: unit }));

/**
 * Unit picker.
 *
 * The popup is mounted only while open. Leaving it mounted lets its exit
 * animation linger in browsers that don't run animation frames (background
 * tabs), which leaves a stale list floating over the table.
 */
function UnitSelect({
  value,
  index,
  onChange,
}: {
  value: RabUnit;
  index: number;
  onChange: (unit: RabUnit) => void;
}) {
  const [open, setOpen] = useState(false);

  // Satuan kustom hasil import (mis. "Point", "m'") harus tetap tampil dan
  // terpilih; jangan sampai hilang hanya karena tidak ada di daftar umum.
  const options = RAB_UNITS.includes(value)
    ? unitOptions
    : [{ value, label: value }, ...unitOptions];

  return (
    <Select
      items={options}
      value={value}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(next) => onChange((next as RabUnit) ?? "unit")}
    >
      <SelectTrigger
        aria-label={`Satuan baris ${index}`}
        className="h-9 border-transparent bg-transparent px-2 text-[13px] shadow-none hover:border-border"
      >
        <SelectValue />
      </SelectTrigger>
      {open ? (
        <SelectContent>
          {options.map((unit) => (
            <SelectItem key={unit.value} value={unit.value}>
              {unit.label}
            </SelectItem>
          ))}
        </SelectContent>
      ) : null}
    </Select>
  );
}

/**
 * Satu baris item yang bisa diedit.
 *
 * Di-memo agar mengetik pada satu baris tidak me-render ulang ratusan baris
 * lain (Villa: 490 item). Callback dari induk harus stabil.
 *
 * Pembandingnya menilai `row.item`, bukan objek `row`: `buildDisplayRows`
 * membuat pembungkus baris baru setiap kali dijalankan, sehingga perbandingan
 * dangkal selalu berbeda dan memo tidak pernah bekerja. Item yang tidak diubah
 * mempertahankan identitasnya di store, jadi hanya baris yang diedit yang
 * di-render ulang.
 */
const ItemRowView = memo(function ItemRowView({
  row,
  onChangeItem,
  onRemoveItem,
  onFocusItem,
  onBlurItem,
}: {
  row: ItemRow;
  onChangeItem: (id: string, patch: Partial<RabWorkItem>) => void;
  onRemoveItem: (id: string) => void;
  /** Dipakai agar baris yang sedang diedit tetap tampil saat pencarian aktif. */
  onFocusItem: (id: string) => void;
  onBlurItem: (id: string) => void;
}) {
  const { item, number } = row;
  const amount = calculateItemAmount(item);
  const missingDescription = item.description.trim().length === 0;

  return (
    <tr className="group border-b border-border transition-colors hover:bg-background/50 focus-within:bg-background/50">
      <td className="px-3 py-1.5 text-[13px] text-muted-foreground tabular-nums">
        {number}
      </td>

      <td className="px-3 py-1.5">
        <input
          type="text"
          value={item.description}
          onChange={(event) =>
            onChangeItem(item.id, { description: event.target.value })
          }
          onFocus={() => onFocusItem(item.id)}
          onBlur={() => onBlurItem(item.id)}
          placeholder="Contoh: Pekerjaan pondasi batu kali"
          aria-label={`Uraian pekerjaan baris ${number}`}
          aria-invalid={missingDescription || undefined}
          className={cn(
            "h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-[13px] text-foreground outline-none transition-colors",
            "hover:border-border focus-visible:border-primary focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-primary/20",
            "placeholder:text-muted-foreground/60",
            missingDescription &&
              "border-warning-border bg-warning-soft focus-visible:border-warning focus-visible:ring-warning/30",
          )}
        />
      </td>

      <td className="px-3 py-1.5">
        <NumberInput
          value={item.volume}
          onChange={(value) => onChangeItem(item.id, { volume: value ?? 0 })}
          ariaLabel={`Volume baris ${number}`}
          dotAsDecimal
          formatDisplay={(volume) =>
            formatVolumeForDisplay(volume, item.unitPrice, amount)
          }
        />
      </td>

      <td className="px-3 py-1.5">
        <UnitSelect
          value={item.unit}
          index={number}
          onChange={(unit) => onChangeItem(item.id, { unit })}
        />
      </td>

      <td className="px-3 py-1.5">
        <NumberInput
          value={item.unitPrice}
          onChange={(value) => onChangeItem(item.id, { unitPrice: value ?? 0 })}
          ariaLabel={`Harga satuan baris ${number}`}
        />
      </td>

      <td className="px-3 py-1.5 text-right text-[13px] font-medium whitespace-nowrap text-foreground tabular-nums">
        {formatIDRMoney(amount)}
      </td>

      <td className="px-3 py-1.5 text-right">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onRemoveItem(item.id)}
          aria-label={`Hapus baris ${number}: ${item.description || "tanpa uraian"}`}
          className="text-muted-foreground hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 className="size-4" />
        </Button>
      </td>
    </tr>
  );
},
  (prev, next) =>
    prev.row.item === next.row.item &&
    prev.row.number === next.row.number &&
    prev.onChangeItem === next.onChangeItem &&
    prev.onRemoveItem === next.onRemoveItem &&
    prev.onFocusItem === next.onFocusItem &&
    prev.onBlurItem === next.onBlurItem,
);

const HEADING_STYLES: Record<0 | 1 | 2, string> = {
  0: "bg-background/70 font-semibold tracking-wide text-foreground uppercase",
  1: "bg-background/40 font-semibold text-foreground",
  2: "bg-background/20 font-medium text-foreground",
};

const HEADING_INDENT: Record<0 | 1 | 2, string> = {
  0: "pl-3",
  1: "pl-7",
  2: "pl-11",
};

function HeadingRowView({
  row,
  meta,
  collapsed,
  canToggle,
  onToggle,
  onAdd,
}: {
  row: HeadingRow;
  /** Ringkasan hanya untuk heading GROUP (depth 0). */
  meta?: GroupMeta;
  collapsed?: boolean;
  /** Lipat dinonaktifkan selama pencarian. */
  canToggle: boolean;
  onToggle?: (key: string) => void;
  onAdd: (context: HierarchyContext) => void;
}) {
  const isGroup = row.depth === 0;

  return (
    <tr className={cn("border-b border-border/70", HEADING_STYLES[row.depth])}>
      <td colSpan={6} className={cn("px-3 py-2 text-[13px]", HEADING_INDENT[row.depth])}>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-words">{row.label}</span>
          {isGroup && meta ? (
            <span className="text-[11px] font-normal whitespace-nowrap text-muted-foreground">
              {meta.itemCount} item · {formatIDRMoney(meta.total)}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-1.5 py-1 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-0.5">
          {isGroup && onToggle ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onToggle(row.key)}
              disabled={!canToggle}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Buka" : "Lipat"} kelompok ${row.label}`}
              title={
                canToggle
                  ? `${collapsed ? "Buka" : "Lipat"} kelompok ${row.label}`
                  : "Tidak tersedia selama pencarian"
              }
              className="text-muted-foreground hover:bg-primary-soft hover:text-primary"
            >
              {collapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onAdd(row.context)}
            aria-label={`Tambah item di ${row.label}`}
            title={`Tambah item di ${row.label}`}
            className="text-muted-foreground hover:bg-primary-soft hover:text-primary"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

const SUBTOTAL_STYLES: Record<0 | 1 | 2, string> = {
  0: "bg-primary-soft/50 font-semibold text-foreground",
  1: "bg-background/40 font-medium text-foreground",
  2: "text-muted-foreground",
};

const SUBTOTAL_INDENT: Record<0 | 1 | 2, string> = {
  0: "pr-3",
  1: "pr-3",
  2: "pr-3",
};

/**
 * Wilayah tabel digulir terbatas sehingga kepala kolom dan grand total tetap
 * menempel saat berpindah di antara ratusan baris. `border-collapse` membuat
 * garis ikut tergulir, jadi garisnya diganti inset shadow pada sel.
 */
const STICKY_HEAD_CELL =
  "sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--color-border)]";
const STICKY_FOOT_CELL =
  "sticky bottom-0 z-10 bg-primary-soft shadow-[inset_0_2px_0_var(--color-border)]";

/**
 * Tabel RAB bergaya Excel: satu tabel panjang berisi heading GROUP/SUBGROUP/
 * ITEM GROUP, baris item yang bisa diedit, dan subtotal per cakupan.
 *
 * Subtotal dihitung dari item pada render (`buildDisplayRows`), bukan disimpan,
 * sehingga edit volume/harga langsung memperbarui subtotal dan grand total.
 */
export function WorkItemsTable({
  items,
  total,
  onChangeItem,
  onRemoveItem,
  onAddItem,
  onAddFromCatalog,
  onAddFromAhsp,
}: {
  items: RabWorkItem[];
  total: number;
  onChangeItem: (id: string, patch: Partial<RabWorkItem>) => void;
  onRemoveItem: (id: string) => void;
  /** `context` diisi saat tombol "+" pada heading diklik. */
  onAddItem: (context?: HierarchyContext) => void;
  /** Bila diisi, tampilkan tombol untuk menambah item dari Katalog Harga. */
  onAddFromCatalog?: () => void;
  /** Bila diisi, tampilkan tombol untuk menambah item dari AHSP. */
  onAddFromAhsp?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [collapseState, setCollapseState] = useState<CollapseState>({
    signature: "",
    collapsed: new Set<string>(),
  });
  const tableRef = useRef<HTMLDivElement | null>(null);

  /**
   * Selesaikan edit yang sedang berjalan sebelum melipat, agar draft input
   * tidak hilang saat barisnya di-unmount. Nilai sudah dikirim per ketikan;
   * blur hanya memfinalkan tampilan.
   */
  const commitActiveInput = useCallback(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.tagName === "INPUT" &&
      tableRef.current?.contains(active)
    ) {
      active.blur();
    }
  }, []);

  const displayRows = useMemo(() => buildDisplayRows(items), [items]);
  const filtered = useMemo(
    () => filterDisplayRows(displayRows, query, { forceItemId: focusedItemId }),
    [displayRows, query, focusedItemId],
  );
  const groupMeta = useMemo(() => collectGroupMeta(displayRows), [displayRows]);
  const isSearching = query.trim().length > 0;
  const collapseView = useMemo(
    () =>
      buildCollapseView({
        rows: displayRows,
        searchRows: filtered.rows,
        isSearching,
        state: collapseState,
      }),
    [displayRows, filtered.rows, isSearching, collapseState],
  );
  const groupIds = collapseView.identities;
  const structureSignature = collapseView.signature;
  const identityByKey = useMemo(
    () => new Map(groupIds.map((entry) => [entry.key, entry.id])),
    [groupIds],
  );
  // Satu kondisi efektif: dipakai ikon/aria-expanded DAN penyaringan isi.
  const collapsedKeys = collapseView.collapsedKeys;
  const rows = collapseView.rows;

  const clearSearch = useCallback(() => setQuery(""), []);
  const handleFocusItem = useCallback((id: string) => setFocusedItemId(id), []);
  const handleBlurItem = useCallback((id: string) => {
    // Baris yang uraiannya diubah hingga tidak cocok tetap tampil selama
    // kolom masih fokus; hasil pencarian diperbarui setelah blur.
    setFocusedItemId((current) => (current === id ? null : current));
  }, []);

  const toggleGroup = useCallback(
    (headingKey: string) => {
      const id = identityByKey.get(headingKey);
      if (!id) return;

      commitActiveInput();
      setCollapseState((current) =>
        toggleCollapseState(current, structureSignature, id),
      );
    },
    [commitActiveInput, identityByKey, structureSignature],
  );

  const collapseAllGroups = useCallback(() => {
    commitActiveInput();
    setCollapseState({
      signature: structureSignature,
      collapsed: new Set(groupIds.map((entry) => entry.id)),
    });
  }, [commitActiveInput, groupIds, structureSignature]);

  const expandAllGroups = useCallback(() => {
    commitActiveInput();
    setCollapseState({ signature: structureSignature, collapsed: new Set() });
  }, [commitActiveInput, structureSignature]);

  const handleAddFromHeading = useCallback(
    (context: HierarchyContext) => onAddItem(context),
    [onAddItem],
  );

  /**
   * Navigasi gaya spreadsheet: panah atas/bawah memindahkan fokus ke kolom
   * yang sama pada baris item berikutnya. Baris heading/subtotal tanpa input di
   * kolom itu dilewati, dan pemicu Select dibiarkan agar menu satuan tetap
   * memakai panahnya sendiri.
   */
  const handleTableKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;

      const row = target.closest("tr");
      const cell = target.closest("td");
      if (!row || !cell) return;

      const body = row.parentElement;
      if (!(body instanceof HTMLTableSectionElement)) return;

      const rows = Array.from(body.rows);
      const startIndex = rows.indexOf(row);
      const cellIndex = Array.from(row.cells).indexOf(cell);
      if (startIndex < 0 || cellIndex < 0) return;

      const step = event.key === "ArrowDown" ? 1 : -1;
      for (
        let index = startIndex + step;
        index >= 0 && index < rows.length;
        index += step
      ) {
        const nextInput = rows[index].cells[cellIndex]?.querySelector("input");
        if (nextInput) {
          event.preventDefault();
          nextInput.focus();
          return;
        }
      }
    },
    [],
  );

  return (
    <div
      ref={tableRef}
      onKeyDown={handleTableKeyDown}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-card"
    >
      <div className="border-b border-border bg-background/40 px-3 py-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5">
          <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari pekerjaan…"
              aria-label="Cari pekerjaan"
              className="h-9 w-full rounded-md border border-border bg-surface pr-9 pl-8 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            />
            {query.length > 0 ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Hapus pencarian"
                title="Hapus pencarian"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {isSearching
                ? `${filtered.matchCount} dari ${filtered.totalItems} pekerjaan`
                : `${filtered.totalItems} pekerjaan`}
            </p>

            {groupMeta.size > 0 ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={collapseAllGroups}
                  disabled={isSearching}
                  title={
                    isSearching
                      ? "Tidak tersedia selama pencarian"
                      : "Lipat seluruh kelompok"
                  }
                >
                  Lipat semua
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={expandAllGroups}
                  disabled={isSearching}
                  title={
                    isSearching
                      ? "Tidak tersedia selama pencarian"
                      : "Buka seluruh kelompok"
                  }
                >
                  Buka semua
                </Button>
              </div>
            ) : null}
          </div>

          {isSearching ? (
            <p className="w-full text-[11px] text-muted-foreground">
              Subtotal dan rekap mencakup seluruh pekerjaan, bukan hanya hasil
              pencarian. Kontrol lipat dinonaktifkan selama pencarian.
            </p>
          ) : null}
        </div>
      </div>

      <div className="relative max-h-[70dvh] overflow-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <caption className="sr-only">
            Daftar pekerjaan RAB beserta kelompok dan subtotal
          </caption>
          <thead>
            <tr className="border-b border-border bg-background/60">
              <th scope="col" className={cn("w-12 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground", STICKY_HEAD_CELL)}>
                No.
              </th>
              <th scope="col" className={cn("px-3 py-2.5 text-left text-xs font-medium text-muted-foreground", STICKY_HEAD_CELL)}>
                Uraian Pekerjaan
              </th>
              <th scope="col" className={cn("w-28 px-3 py-2.5 text-right text-xs font-medium text-muted-foreground", STICKY_HEAD_CELL)}>
                Volume
              </th>
              <th scope="col" className={cn("w-28 px-3 py-2.5 text-left text-xs font-medium text-muted-foreground", STICKY_HEAD_CELL)}>
                Satuan
              </th>
              <th scope="col" className={cn("w-40 px-3 py-2.5 text-right text-xs font-medium text-muted-foreground", STICKY_HEAD_CELL)}>
                Harga Satuan
              </th>
              <th scope="col" className={cn("w-40 px-3 py-2.5 text-right text-xs font-medium text-muted-foreground", STICKY_HEAD_CELL)}>
                Jumlah Harga
              </th>
              <th scope="col" className={cn("w-14 px-3 py-2.5 text-right text-xs font-medium text-muted-foreground", STICKY_HEAD_CELL)}>
                <span className="sr-only">Aksi</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-[13px] text-muted-foreground"
                >
                  Tidak ada pekerjaan yang cocok dengan pencarian.
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="ml-1 font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Hapus pencarian
                  </button>
                </td>
              </tr>
            ) : (
              rows.map((row: DisplayRow) => {
              if (row.kind === "heading") {
                return (
                  <HeadingRowView
                    key={row.key}
                    row={row}
                    meta={row.depth === 0 ? groupMeta.get(row.key) : undefined}
                    collapsed={collapsedKeys.has(row.key)}
                    canToggle={!isSearching}
                    onToggle={row.depth === 0 ? toggleGroup : undefined}
                    onAdd={handleAddFromHeading}
                  />
                );
              }

              if (row.kind === "subtotal") {
                return (
                  <tr
                    key={row.key}
                    className={cn("border-b border-border/70", SUBTOTAL_STYLES[row.depth])}
                  >
                    <td
                      colSpan={5}
                      className={cn(
                        "px-3 py-1.5 text-right text-[13px]",
                        SUBTOTAL_INDENT[row.depth],
                      )}
                    >
                      {row.label}
                    </td>
                    <td className="px-3 py-1.5 text-right text-[13px] font-medium whitespace-nowrap tabular-nums">
                      {formatIDRMoney(row.amount)}
                    </td>
                    <td />
                  </tr>
                );
              }

              return (
                <ItemRowView
                  key={row.key}
                  row={row}
                  onChangeItem={onChangeItem}
                  onRemoveItem={onRemoveItem}
                  onFocusItem={handleFocusItem}
                  onBlurItem={handleBlurItem}
                />
              );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-primary-soft/60">
              <td colSpan={5} className={cn("px-3 py-3 text-right text-sm font-semibold text-foreground", STICKY_FOOT_CELL)}>
                Grand Total
              </td>
              <td className={cn("px-3 py-3 text-right text-sm font-semibold tracking-tight whitespace-nowrap text-primary tabular-nums", STICKY_FOOT_CELL)}>
                {formatIDRMoney(total)}
              </td>
              <td className={STICKY_FOOT_CELL} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onAddItem()}>
            <Plus />
            Tambah Pekerjaan
          </Button>
          {onAddFromCatalog ? (
            <Button variant="outline" size="sm" onClick={onAddFromCatalog}>
              <BookOpen />
              Pilih dari Katalog
            </Button>
          ) : null}
          {onAddFromAhsp ? (
            <Button variant="outline" size="sm" onClick={onAddFromAhsp}>
              <Calculator />
              Pilih dari AHSP
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {items.length} baris pekerjaan
        </p>
      </div>
    </div>
  );
}
