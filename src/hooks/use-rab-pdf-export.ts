"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { toErrorMessage } from "@/lib/errors";
import { downloadRabPdf, rabPdfFileName } from "@/lib/rab-pdf";

/**
 * Unduh dokumen RAB sebagai PDF.
 *
 * Data diambil dari workspace yang sudah dimuat lewat RLS, jadi pengguna hanya
 * bisa mengekspor dokumen miliknya — id milik pengguna lain tidak ada di state
 * dan berakhir pada pesan "tidak ditemukan".
 */
export function useRabPdfExport() {
  const { getDocumentDetail } = useData();
  const { user, companyProfile } = useAuth();
  const [exportingId, setExportingId] = useState<string | null>(null);

  const exportPdf = useCallback(
    async (documentId: string) => {
      const detail = getDocumentDetail(documentId);

      if (!detail) {
        toast.error("Dokumen RAB tidak ditemukan", {
          description: "Muat ulang halaman lalu coba lagi.",
        });
        return;
      }

      if (detail.items.length === 0) {
        toast.info("Belum ada item pekerjaan", {
          description:
            "Tambahkan minimal satu item pekerjaan sebelum mengekspor PDF.",
        });
        return;
      }

      setExportingId(documentId);

      try {
        const fileName = rabPdfFileName(detail);
        await downloadRabPdf(detail, {
          preparedBy: user?.email,
          company: companyProfile,
        });
        toast.success("PDF berhasil dibuat", { description: fileName });
      } catch (caught) {
        toast.error("Gagal membuat PDF", {
          description: toErrorMessage(caught),
        });
      } finally {
        setExportingId(null);
      }
    },
    [getDocumentDetail, user, companyProfile],
  );

  return { exportPdf, exportingId };
}
