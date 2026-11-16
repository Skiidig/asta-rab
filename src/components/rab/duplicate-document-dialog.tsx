"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { duplicateTitle } from "@/lib/duplicate-rab";
import { toErrorMessage } from "@/lib/errors";
import type { RabDocument } from "@/types";

/**
 * Dialog duplikasi dokumen RAB.
 *
 * Judul awal `[judul asli] — Salinan` dan bisa diubah. Selama proses berjalan
 * tombol dinonaktifkan dan handler menolak submit ulang, sehingga klik berulang
 * tidak menghasilkan dua salinan.
 */
export function DuplicateDocumentDialog({
  document,
  onOpenChange,
  onDuplicated,
}: {
  document: RabDocument;
  onOpenChange: (open: boolean) => void;
  onDuplicated: (copy: RabDocument) => void;
}) {
  const { duplicateDocument } = useData();
  const [title, setTitle] = useState(() => duplicateTitle(document.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (busy) return;

    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("Judul salinan tidak boleh kosong.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const copy = await duplicateDocument(document.id, nextTitle);
      onOpenChange(false);
      onDuplicated(copy);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Duplikasi dokumen RAB</DialogTitle>
          <DialogDescription>
            Salinan berisi seluruh {document.itemCount} item pekerjaan dari
            dokumen asal. Dokumen asal tidak diubah.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 pt-4 pb-5">
          <div className="grid gap-1.5">
            <Label htmlFor="duplicate-title">Judul salinan</Label>
            <Input
              id="duplicate-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              disabled={busy}
              maxLength={160}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Batal
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={busy || title.trim().length === 0}
          >
            <Copy />
            {busy ? "Menduplikasi…" : "Duplikasi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
