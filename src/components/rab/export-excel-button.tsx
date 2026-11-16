"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { toErrorMessage } from "@/lib/errors";
import { downloadRabExcel, rabExcelFileName } from "@/lib/rab-excel";

/**
 * Tombol "Export Excel" untuk dokumen RAB yang sedang dibuka.
 *
 * Selama berkas disusun tombol dinonaktifkan agar tidak memicu unduhan ganda.
 */
export function ExportExcelButton({
  documentId,
  className,
}: {
  documentId: string;
  className?: string;
}) {
  const { getDocumentDetail } = useData();
  const { companyProfile } = useAuth();
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    const detail = getDocumentDetail(documentId);

    if (!detail) {
      toast.error("Dokumen RAB tidak ditemukan", {
        description: "Muat ulang halaman lalu coba lagi.",
      });
      return;
    }

    setExporting(true);

    try {
      const fileName = rabExcelFileName(detail);
      await downloadRabExcel(detail, companyProfile);
      toast.success("Excel berhasil dibuat", { description: fileName });
    } catch (caught) {
      toast.error("Gagal membuat Excel", {
        description: toErrorMessage(caught),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button
      variant="secondary"
      className={className}
      onClick={() => void handleExport()}
      disabled={exporting}
      aria-busy={exporting}
    >
      {exporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
      {exporting ? "Menyiapkan Excel…" : "Export Excel"}
    </Button>
  );
}
