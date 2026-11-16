import { useMemo } from "react";

import { formatIDRMoney, formatPercent } from "@/lib/format";
import { summarizeGroups } from "@/lib/rab-hierarchy";
import { cn } from "@/lib/utils";
import type { RabWorkItem } from "@/types";

/**
 * Rekap anggaran per GROUP utama.
 *
 * Satu-satunya ringkasan dokumen di halaman editor: tabel per kelompok dengan
 * baris Total, sehingga tidak ada kartu ringkasan ganda. Angka dihitung dari
 * item (lewat `summarizeGroups` → `buildDisplayRows`), bukan dari subtotal
 * tersimpan, jadi tidak ada penghitungan dua kali dan langsung mengikuti edit.
 */
export function RabSummary({
  items,
  total,
  className,
}: {
  items: RabWorkItem[];
  /** Grand total dari `calculateRabTotal` (sumber yang sama dengan tabel). */
  total: number;
  className?: string;
}) {
  const summary = useMemo(() => summarizeGroups(items), [items]);
  const grandTotal = total || 0;

  const percentageOf = (amount: number) =>
    grandTotal > 0 ? (amount / grandTotal) * 100 : 0;

  return (
    <section
      aria-labelledby="rab-recap-heading"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-background/40 px-4 py-3">
        <h3
          id="rab-recap-heading"
          className="text-[13px] font-semibold tracking-tight text-foreground"
        >
          Rekap Anggaran per Kelompok
        </h3>
        <p className="text-xs text-muted-foreground">
          {summary.rows.length} kelompok · {summary.itemCount} item pekerjaan
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] border-collapse text-sm">
          <caption className="sr-only">
            Nilai anggaran tiap kelompok pekerjaan dan persentasenya terhadap
            grand total
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Kelompok Pekerjaan
              </th>
              <th scope="col" className="w-20 px-4 py-2 text-right font-medium">
                Item
              </th>
              <th scope="col" className="w-44 px-4 py-2 text-right font-medium">
                Nilai Anggaran
              </th>
              <th scope="col" className="w-24 px-4 py-2 text-right font-medium">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-3 text-[13px] text-muted-foreground"
                >
                  Belum ada pekerjaan pada dokumen ini.
                </td>
              </tr>
            ) : (
              summary.rows.map((row) => (
                <tr key={row.key} className="border-b border-border/70 last:border-0">
                  <td className="max-w-[320px] px-4 py-2 text-[13px] break-words text-foreground">
                    {row.label}
                  </td>
                  <td className="px-4 py-2 text-right text-[13px] text-muted-foreground tabular-nums">
                    {row.itemCount}
                  </td>
                  <td className="px-4 py-2 text-right text-[13px] whitespace-nowrap text-foreground tabular-nums">
                    {formatIDRMoney(row.amount)}
                  </td>
                  <td className="px-4 py-2 text-right text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatPercent(percentageOf(row.amount))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-primary-soft/60">
              <td className="px-4 py-3 text-sm font-semibold text-foreground">
                Total
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-foreground tabular-nums">
                {summary.itemCount}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold whitespace-nowrap text-primary tabular-nums">
                {formatIDRMoney(grandTotal)}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold whitespace-nowrap text-foreground tabular-nums">
                {formatPercent(grandTotal > 0 ? 100 : 0)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
