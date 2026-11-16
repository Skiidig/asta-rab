"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
} from "lucide-react";

import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import type { DocumentSavePhase } from "@/lib/save-status";
import { cn } from "@/lib/utils";

const SAVE_META: Record<
  Exclude<DocumentSavePhase, "error">,
  { Icon: typeof Clock; text: string; className: string; spin?: boolean }
> = {
  pending: {
    Icon: Clock,
    text: "Menunggu penyimpanan…",
    className: "text-warning",
  },
  saving: {
    Icon: Loader2,
    text: "Menyimpan…",
    className: "text-muted-foreground",
    spin: true,
  },
  saved: {
    Icon: CheckCircle2,
    text: "Semua perubahan tersimpan",
    className: "text-success",
  },
};

/**
 * Indikator status penyimpanan per dokumen.
 *
 * Status berasal dari antrean tulis nyata (debounce/permintaan/kegagalan),
 * bukan dari perubahan state editor. Teks + ikon dipakai agar tidak
 * mengandalkan warna saja.
 */
export function SaveStatusIndicator({ documentId }: { documentId: string }) {
  const { getDocumentSaveState, retryDocumentSave } = useData();
  const state = getDocumentSaveState(documentId);
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryDocumentSave(documentId);
    } catch {
      // Status di bawah tetap menampilkan kegagalan terbaru.
    } finally {
      setRetrying(false);
    }
  }

  if (state.phase === "error") {
    return (
      <div
        aria-live="polite"
        className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-danger"
      >
        <AlertTriangle className="size-3.5 shrink-0" />
        <span className="font-medium">Gagal menyimpan</span>
        {state.message ? (
          <span
            className="max-w-[42ch] truncate text-danger/90"
            title={state.message}
          >
            · {state.message}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={() => void handleRetry()}
          disabled={retrying}
        >
          <RotateCcw className={cn("size-3", retrying && "animate-spin")} />
          {retrying ? "Mencoba…" : "Coba lagi"}
        </Button>
      </div>
    );
  }

  const meta = SAVE_META[state.phase];

  return (
    <p
      aria-live="polite"
      className={cn("mt-1 flex items-center gap-1.5 text-[12px]", meta.className)}
    >
      <meta.Icon className={cn("size-3.5 shrink-0", meta.spin && "animate-spin")} />
      {meta.text}
    </p>
  );
}
