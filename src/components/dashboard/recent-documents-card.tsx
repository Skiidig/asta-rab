import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RabDocument } from "@/types";

/**
 * Ringkasan dokumen RAB terbaru untuk dashboard.
 *
 * Judul panjang dibatasi dua baris dengan elipsis, sementara nama lengkap tetap
 * menjadi accessible name tautan dan terlihat penuh saat dokumen dibuka.
 */
export function RecentDocumentsCard({
  documents,
}: {
  documents: RabDocument[];
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="min-w-0">
          <CardTitle>Dokumen Terbaru</CardTitle>
          <p className="mt-0.5 text-[14px] text-muted-foreground">
            Dokumen RAB yang paling baru dibuat.
          </p>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-2 pt-0">
        {documents.length === 0 ? (
          <p className="px-2 py-6 text-center text-[14px] text-muted-foreground">
            Belum ada dokumen RAB.
          </p>
        ) : (
          documents.map((document) => (
            <Link
              key={document.id}
              href={`/rab/${document.id}`}
              aria-label={`Buka dokumen ${document.title}`}
              className="group flex min-w-0 items-center gap-3 rounded-lg border border-transparent p-2 transition-colors hover:border-border hover:bg-background"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning ring-1 ring-warning-border">
                <Clock3 className="size-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[14px] leading-snug font-medium break-words text-foreground">
                  {document.title}
                </span>
                <span className="mt-0.5 block min-w-0 text-xs text-muted-foreground">
                  <span className="line-clamp-2 break-words">
                    {document.projectName}
                  </span>
                  <span className="mt-0.5 block">{document.itemCount} item</span>
                </span>
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary"
              />
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
