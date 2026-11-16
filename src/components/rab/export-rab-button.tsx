"use client";

import { Download, Loader2 } from "lucide-react";

import { useRabPdfExport } from "@/hooks/use-rab-pdf-export";
import { Button } from "@/components/ui/button";

/**
 * Tombol "Export PDF" untuk dokumen RAB yang sedang dibuka.
 *
 * Selama PDF disusun tombol dinonaktifkan dan menampilkan status, sehingga
 * pengguna tidak bisa memicu beberapa unduhan sekaligus.
 */
export function ExportRabButton({
  documentId,
  className,
}: {
  documentId: string;
  className?: string;
}) {
  const { exportPdf, exportingId } = useRabPdfExport();
  const exporting = exportingId === documentId;

  return (
    <Button
      variant="secondary"
      className={className}
      onClick={() => void exportPdf(documentId)}
      disabled={exporting}
      aria-busy={exporting}
    >
      {exporting ? <Loader2 className="animate-spin" /> : <Download />}
      {exporting ? "Menyiapkan PDF…" : "Export PDF"}
    </Button>
  );
}
