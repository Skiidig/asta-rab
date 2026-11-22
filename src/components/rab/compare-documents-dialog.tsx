"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  FileSpreadsheet,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatIDRMoney, formatPercent } from "@/lib/format";
import { toErrorMessage } from "@/lib/errors";
import { downloadComparisonExcel } from "@/lib/rab-compare-excel";
import { summarizeGroups } from "@/lib/rab-hierarchy";
import {
  compareGroupSummaries,
  type ComparisonDirection,
  type ComparisonRow,
} from "@/lib/rab-compare";
import { cn } from "@/lib/utils";
import type { RabDocument, RabDocumentDetail } from "@/types";

const DIRECTION_META: Record<
  ComparisonDirection,
  { label: string; className: string; Icon: typeof TrendingUp }
> = {
  up: { label: "Naik", className: "text-warning", Icon: TrendingUp },
  down: { label: "Turun", className: "text-success", Icon: TrendingDown },
  same: { label: "Tetap", className: "text-muted-foreground", Icon: Minus },
};

const STATUS_BADGE: Partial<Record<ComparisonRow["status"], string>> = {
  unpaired: "Belum dapat dipasangkan",
  baseline_only: "Hanya di acuan",
  comparison_only: "Hanya di pembanding",
};

function signedMoney(value: number): string {
  if (value > 0) return `+${formatIDRMoney(value)}`;
  return formatIDRMoney(value);
}

function signedCount(value: number): string {
  if (value > 0) return `+${value} item`;
  if (value < 0) return `${value} item`;
  return "0 item";
}

function percentNote(row: ComparisonRow): string {
  if (row.status === "unpaired") return "Belum dapat dipasangkan.";
  if (row.status === "comparison_only") return "Kelompok tidak ada di dokumen acuan.";
  return "Persentase tidak dapat dihitung dari nilai acuan nol.";
}

/**
 * Dialog perbandingan dua dokumen RAB dalam proyek yang sama.
 *
 * Pratinjau memakai state yang sudah dimuat. Ekspor menunggu antrean kedua
 * dokumen lalu menghitung perbandingan ulang dari snapshot yang tersimpan.
 */
export function CompareDocumentsDialog({
  document,
  onOpenChange,
}: {
  document: RabDocumentDetail;
  onOpenChange: (open: boolean) => void;
}) {
  const { documents, getDocumentDetail, getComparisonSnapshot } = useData();

  const [baselineId, setBaselineId] = useState(document.id);
  const [comparisonId, setComparisonId] = useState(() => {
    const candidate = documents.find(
      (entry) => entry.projectId === document.projectId && entry.id !== document.id,
    );
    return candidate?.id ?? "";
  });
  const [exporting, setExporting] = useState(false);

  const baselineDoc = documents.find((entry) => entry.id === baselineId) ?? null;
  const comparisonDoc =
    documents.find((entry) => entry.id === comparisonId) ?? null;

  const options = useMemo(
    () =>
      documents
        .filter(
          (entry) =>
            entry.projectId === document.projectId && entry.id !== baselineId,
        )
        .map((entry) => ({
          value: entry.id,
          label: `${entry.title} · ${entry.number}`,
        })),
    [documents, document.projectId, baselineId],
  );

  const result = useMemo(() => {
    const baseline = getDocumentDetail(baselineId);
    const comparison = comparisonId ? getDocumentDetail(comparisonId) : undefined;
    if (!baseline || !comparison) return null;

    return compareGroupSummaries(
      summarizeGroups(baseline.items),
      summarizeGroups(comparison.items),
    );
  }, [getDocumentDetail, baselineId, comparisonId]);

  function swapDocuments() {
    if (!comparisonDoc) return;
    const previousBaseline = baselineId;
    setBaselineId(comparisonId);
    setComparisonId(previousBaseline);
  }

  async function handleExport() {
    if (!baselineDoc || !comparisonDoc || !result || exporting) return;

    setExporting(true);

    try {
      let baselineDetail: RabDocumentDetail | undefined;
      let comparisonDetail: RabDocumentDetail | undefined;
      try {
        [baselineDetail, comparisonDetail] = await getComparisonSnapshot(
          baselineDoc.id,
          comparisonDoc.id,
        );
      } catch (caught) {
        toast.error("Perubahan belum tersimpan", {
          description: `Ekspor dibatalkan. ${toErrorMessage(caught)}`,
        });
        return;
      }

      if (!baselineDetail || !comparisonDetail) {
        toast.error("Gagal membuat Excel perbandingan", {
          description:
            "Dokumen tidak dapat dimuat. Muat ulang halaman lalu coba lagi.",
        });
        return;
      }
      if (baselineDetail.projectId !== comparisonDetail.projectId) {
        toast.error("Gagal membuat Excel perbandingan", {
          description: "Pilih kembali dua dokumen dari proyek yang sama.",
        });
        return;
      }

      // Snapshot memakai helper yang sama dengan dialog, dihitung setelah
      // penyimpanan selesai dan mengikuti acuan/pembanding saat ini.
      const snapshot = compareGroupSummaries(
        summarizeGroups(baselineDetail.items),
        summarizeGroups(comparisonDetail.items),
      );

      const fileName = await downloadComparisonExcel({
        projectName:
          baselineDetail.projectName ||
          comparisonDetail.projectName ||
          document.projectName ||
          "",
        baseline: {
          title: baselineDetail.title,
          number: baselineDetail.number,
        },
        comparison: {
          title: comparisonDetail.title,
          number: comparisonDetail.number,
        },
        result: snapshot,
      });

      toast.success("Excel perbandingan berhasil dibuat", {
        description: fileName,
      });
    } catch (caught) {
      toast.error("Gagal membuat Excel perbandingan", {
        description: toErrorMessage(caught),
      });
    } finally {
      setExporting(false);
    }
  }

  const direction = result ? DIRECTION_META[result.direction] : null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[1100px] flex-col overflow-hidden">
        <DialogHeader className="shrink-0 border-b border-border pb-3">
          <DialogTitle>Bandingkan dokumen RAB</DialogTitle>
          <DialogDescription>
            Bandingkan jumlah item, total anggaran, dan nilai per kelompok.
            Perbandingan hanya membaca data; kedua dokumen tidak diubah.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pt-4 pb-5">
          <div className="grid gap-1.5">
            <Label htmlFor="compare-document">Dokumen pembanding</Label>
            {options.length === 0 ? (
              <p className="rounded-lg border border-border bg-background/60 px-3 py-2 text-[13px] text-muted-foreground">
                Belum ada dokumen lain di proyek ini untuk dibandingkan.
              </p>
            ) : (
              <Select
                items={options}
                value={comparisonId}
                onValueChange={(value) => setComparisonId((value as string) ?? "")}
              >
                <SelectTrigger id="compare-document">
                  <SelectValue placeholder="Pilih dokumen pembanding" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <DocumentCard label="Acuan" document={baselineDoc} />
            <Button
              variant="outline"
              size="icon-sm"
              onClick={swapDocuments}
              disabled={!comparisonDoc}
              aria-label="Tukar acuan dan pembanding"
              title="Tukar acuan dan pembanding"
              className="justify-self-center"
            >
              <ArrowLeftRight />
            </Button>
            <DocumentCard label="Pembanding" document={comparisonDoc} />
          </div>

          {!comparisonDoc || !result ? (
            <p className="rounded-lg border border-border bg-background/60 px-3 py-2 text-[13px] text-muted-foreground">
              Pilih dokumen pembanding untuk melihat perbandingan.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat
                  label="Jumlah item"
                  value={`${result.comparisonItems}`}
                  detail={`Acuan ${result.baselineItems} · ${signedCount(result.itemDelta)}`}
                />
                <Stat
                  label="Total anggaran"
                  value={formatIDRMoney(result.comparisonTotal)}
                  detail={`Acuan ${formatIDRMoney(result.baselineTotal)}`}
                />
                <Stat
                  label="Selisih (pembanding − acuan)"
                  value={signedMoney(result.difference)}
                  detail={
                    result.percent === null
                      ? "Persentase tidak dapat dihitung dari nilai acuan nol"
                      : formatPercent(result.percent)
                  }
                  tone={direction ?? undefined}
                />
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Selisih = pembanding − acuan. Kenaikan biaya belum tentu berarti
                hasil buruk; tinjau konteks pekerjaannya.
              </p>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[940px] table-fixed border-collapse text-sm">
                  <caption className="sr-only">
                    Perbandingan nilai per kelompok pekerjaan antara dokumen
                    acuan dan pembanding
                  </caption>
                  <colgroup>
                    <col className="w-[280px]" />
                    <col className="w-[180px]" />
                    <col className="w-[180px]" />
                    <col className="w-[180px]" />
                    <col className="w-[120px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border bg-background/60 text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Kelompok
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Nilai Acuan
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Nilai Pembanding
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Selisih
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Selisih %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-3 text-[13px] text-muted-foreground"
                        >
                          Kedua dokumen belum memiliki kelompok pekerjaan.
                        </td>
                      </tr>
                    ) : (
                      result.rows.map((row) => (
                        <tr
                          key={row.key}
                          className="border-b border-border/70 last:border-0"
                        >
                          <td className="max-w-[280px] px-3 py-2 align-top text-[13px] break-words text-foreground">
                            {row.label}
                            {STATUS_BADGE[row.status] ? (
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {STATUS_BADGE[row.status]}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right text-[13px] whitespace-nowrap tabular-nums">
                            {row.baseline === null ? "—" : formatIDRMoney(row.baseline)}
                          </td>
                          <td className="px-3 py-2 text-right text-[13px] whitespace-nowrap tabular-nums">
                            {row.comparison === null
                              ? "—"
                              : formatIDRMoney(row.comparison)}
                          </td>
                          <td className="px-3 py-2 text-right text-[13px] font-medium whitespace-nowrap tabular-nums">
                            {signedMoney(row.difference)}
                          </td>
                          <td
                            className="px-3 py-2 text-right text-[13px] whitespace-nowrap tabular-nums text-muted-foreground"
                            title={row.percent === null ? percentNote(row) : undefined}
                          >
                            {row.percent === null ? "—" : formatPercent(row.percent)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-primary-soft/60">
                      <td className="px-3 py-3 text-sm font-semibold text-foreground">
                        Total
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap tabular-nums">
                        {formatIDRMoney(result.baselineTotal)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap tabular-nums">
                        {formatIDRMoney(result.comparisonTotal)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap tabular-nums text-primary">
                        {signedMoney(result.difference)}
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold whitespace-nowrap tabular-nums">
                        {result.percent === null
                          ? "—"
                          : formatPercent(result.percent)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                &ldquo;—&rdquo; berarti persentase tidak dapat dihitung (nilai
                acuan nol atau kelompok belum dapat dipasangkan).
              </p>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="secondary"
            onClick={() => void handleExport()}
            disabled={!result || !baselineDoc || !comparisonDoc || exporting}
            aria-busy={exporting}
          >
            {exporting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FileSpreadsheet />
            )}
            {exporting ? "Menyiapkan Excel…" : "Export Excel"}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentCard({
  label,
  document,
}: {
  label: string;
  document: RabDocument | null;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background/40 px-3 py-2">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {document ? (
        <>
          <p
            className="mt-1 line-clamp-2 text-[13px] leading-snug font-medium break-words text-foreground"
            title={document.title}
          >
            {document.title}
          </p>
          <p
            className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
            title={document.number}
          >
            {document.number}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[13px] text-muted-foreground">Belum dipilih</p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: { label: string; className: string; Icon: typeof TrendingUp };
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[15px] font-semibold whitespace-nowrap text-foreground tabular-nums",
          tone?.className,
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        {tone ? <tone.Icon className="size-3" /> : null}
        {tone ? `${tone.label} · ` : null}
        {detail}
      </p>
    </div>
  );
}
