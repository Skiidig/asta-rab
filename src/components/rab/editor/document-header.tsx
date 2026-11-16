"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  Building2,
  CalendarDays,
  Copy,
  MapPin,
  UserRound,
} from "lucide-react";

import { ExportExcelButton } from "@/components/rab/export-excel-button";
import { ExportRabButton } from "@/components/rab/export-rab-button";
import { SaveStatusIndicator } from "@/components/rab/editor/save-status";
import { Button, ButtonLink } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { RabDocumentDetail } from "@/types";

/**
 * Editor document header: back link, editable title, and project context.
 *
 * The title is edited inline. Changes are committed on blur or Enter; an
 * empty title reverts to the previous value rather than saving blank text.
 */
export function DocumentHeader({
  document,
  title,
  onTitleChange,
  onDuplicate,
  onCompare,
}: {
  document: RabDocumentDetail;
  title: string;
  onTitleChange: (title: string) => void;
  /** Membuka dialog duplikasi dokumen. */
  onDuplicate?: () => void;
  /** Membuka dialog perbandingan dengan dokumen lain di proyek yang sama. */
  onCompare?: () => void;
}) {
  const [draft, setDraft] = useState(title);
  const [editing, setEditing] = useState(false);

  function commit() {
    const next = draft.trim();
    onTitleChange(next.length > 0 ? next : title);
    setDraft(next.length > 0 ? next : title);
    setEditing(false);
  }

  return (
    <div className="space-y-4">
      <ButtonLink href="/rab" variant="ghost" size="sm" className="-ml-2 w-fit">
        <ArrowLeft />
        Kembali ke Dokumen RAB
      </ButtonLink>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] tracking-wide text-muted-foreground">
                {document.number}
              </span>
            </div>

            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                  }
                  if (event.key === "Escape") {
                    setDraft(title);
                    setEditing(false);
                  }
                }}
                aria-label="Judul dokumen RAB"
                className="mt-2 w-full rounded-lg border border-primary bg-surface px-2 py-1 text-xl font-semibold tracking-tight text-foreground outline-none ring-2 ring-primary/20 sm:text-[22px]"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(title);
                  setEditing(true);
                }}
                title="Klik untuk mengubah judul"
                className="mt-2 block max-w-full rounded-md text-left text-xl font-semibold tracking-tight text-foreground transition-colors hover:text-primary sm:text-[22px]"
              >
                {title}
                <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
                  ubah judul
                </span>
              </button>
            )}

            <p className="mt-1 text-[13px] text-muted-foreground">
              {document.projectName}
            </p>
            <SaveStatusIndicator documentId={document.id} />
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {onCompare ? (
              <Button variant="outline" size="sm" onClick={onCompare}>
                <ArrowLeftRight />
                Bandingkan
              </Button>
            ) : null}
            {onDuplicate ? (
              <Button variant="outline" size="sm" onClick={onDuplicate}>
                <Copy />
                Duplikasi
              </Button>
            ) : null}
            <ExportRabButton documentId={document.id} />
            <ExportExcelButton documentId={document.id} />
          </div>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-border pt-4 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
          <DetailItem icon={Building2} label="Proyek" value={document.projectName} />
          <DetailItem icon={UserRound} label="Klien" value={document.client} />
          <DetailItem icon={MapPin} label="Lokasi" value={document.location} />
          <DetailItem
            icon={CalendarDays}
            label={document.date ? "Tanggal dokumen" : "Tanggal dibuat"}
            value={formatDate(document.date || document.createdAt)}
          />
        </dl>
      </div>
    </div>
  );
}

function DetailItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
      <div className="min-w-0">
        <dt className="text-[11px] text-muted-foreground">{label}</dt>
        <dd className="truncate font-medium text-foreground" title={value}>
          {value}
        </dd>
      </div>
    </div>
  );
}
