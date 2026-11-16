"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Copy,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useData } from "@/components/providers/data-provider";
import { RabDocumentDialog } from "@/components/rab/rab-document-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toErrorMessage } from "@/lib/errors";
import { formatDate, formatIDR } from "@/lib/format";
import { useRabPdfExport } from "@/hooks/use-rab-pdf-export";
import { cn } from "@/lib/utils";
import type { RabDocument } from "@/types";

function DocumentActions({ document }: { document: RabDocument }) {
  const { deleteDocument, duplicateDocument } = useData();
  const { exportPdf, exportingId } = useRabPdfExport();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const exporting = exportingId === document.id;
  const editorHref = `/rab/${document.id}`;

  async function handleDuplicate() {
    try {
      const copy = await duplicateDocument(document.id);
      toast.success("Dokumen diduplikasi", {
        description: `${copy.number} · ${copy.title}`,
      });
    } catch (caught) {
      toast.error("Gagal menduplikasi dokumen", {
        description: toErrorMessage(caught),
      });
    }
  }

  async function handleDelete() {
    try {
      await deleteDocument(document.id);
      toast.success("Dokumen RAB dihapus", { description: document.title });
    } catch (caught) {
      toast.error("Gagal menghapus dokumen", {
        description: toErrorMessage(caught),
      });
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Aksi untuk ${document.title}`}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem render={<Link href={editorHref} />}>
            <Eye />
            Lihat dokumen
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href={editorHref} />}>
            <Pencil />
            Edit RAB
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <FileText />
            Edit informasi
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void handleDuplicate()}>
            <Copy />
            Duplikat
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={exporting}
            onClick={() => void exportPdf(document.id)}
          >
            <Download />
            {exporting ? "Menyiapkan PDF…" : "Ekspor PDF"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 />
            Hapus dokumen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RabDocumentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        document={document}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Hapus dokumen RAB ini?"
        description={
          <>
            <span className="font-medium text-foreground">
              {document.title}
            </span>{" "}
            beserta seluruh item pekerjaannya akan dihapus. Tindakan ini tidak
            dapat dibatalkan.
          </>
        }
        confirmLabel="Hapus dokumen"
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}

/**
 * RAB document list. Totals and item counts are derived from the database
 * rows by the data layer.
 */
export function RabTable({
  documents,
  className,
}: {
  documents: RabDocument[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      <Table className="min-w-[820px]">
        <TableHeader className="bg-background/60">
          <TableRow className="hover:bg-transparent">
            <TableHead>Dokumen</TableHead>
            <TableHead>Proyek</TableHead>
            <TableHead>Dibuat</TableHead>
            <TableHead className="text-right">Item</TableHead>
            <TableHead className="text-right">Total Estimasi</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Aksi</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <TableRow key={document.id}>
              <TableCell className="max-w-[300px]">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                    <FileText className="size-4" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/rab/${document.id}`}
                      className="block truncate font-medium text-foreground hover:text-primary"
                    >
                      {document.title}
                    </Link>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {document.number}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-[220px] truncate text-muted-foreground">
                {document.projectName || "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(document.createdAt)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {document.itemCount}
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                {formatIDR(document.total)}
              </TableCell>
              <TableCell className="pr-3">
                <DocumentActions document={document} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
