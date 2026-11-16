"use client";

import { useState } from "react";
import { DatabaseBackup, HardDriveDownload } from "lucide-react";
import { toast } from "sonner";

import { useData } from "@/components/providers/data-provider";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { toErrorMessage } from "@/lib/errors";

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Offer to copy legacy localStorage records into Supabase.
 *
 * The confirmation is explicit and the original localStorage snapshot is never
 * modified or removed, so declining or a failed migration loses nothing.
 */
export function MigrationBanner() {
  const { migration, dismissMigration, runMigration } = useData();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  if (!migration) return null;

  async function handleMigrate() {
    setRunning(true);

    try {
      const result = await runMigration();

      toast.success("Data lokal berhasil dimigrasikan", {
        description: [
          countLabel(result.projectCount, "proyek", "proyek"),
          countLabel(result.documentCount, "dokumen RAB", "dokumen RAB"),
          countLabel(result.itemCount, "item pekerjaan", "item pekerjaan"),
        ].join(" · "),
      });

      if (!result.markerSaved) {
        toast.warning("Penanda migrasi gagal disimpan", {
          description:
            "Data sudah masuk ke Supabase, tetapi penanda di browser tidak tersimpan. Jangan jalankan migrasi lagi agar data tidak berganda.",
        });
      }
    } catch (caught) {
      toast.error("Migrasi data lokal gagal", {
        description: toErrorMessage(caught),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <section
        aria-label="Migrasi data lokal"
        className="flex flex-col gap-4 rounded-xl border border-warning-border bg-warning-soft p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-warning-border bg-surface text-warning">
            <DatabaseBackup className="size-4" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground">
              Data lokal lama ditemukan
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              {countLabel(migration.projectCount, "proyek", "proyek")},{" "}
              {countLabel(migration.documentCount, "dokumen RAB", "dokumen RAB")},{" "}
              {countLabel(migration.itemCount, "item pekerjaan", "item pekerjaan")}{" "}
              dari versi localStorage dapat disalin ke Supabase. Data asli di
              browser tidak akan dihapus.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:pl-4">
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            disabled={running}
          >
            <HardDriveDownload />
            {running ? "Memigrasikan…" : "Migrasikan data"}
          </Button>
          <Button
            variant="ghost"
            onClick={dismissMigration}
            disabled={running}
          >
            Nanti
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Migrasikan data lokal ke Supabase?"
        description={
          <>
            {migration.projectCount} proyek, {migration.documentCount} dokumen
            RAB, dan {migration.itemCount} item pekerjaan akan{" "}
            <span className="font-medium text-foreground">ditambahkan</span> ke
            database. Data lama di localStorage tetap tersimpan sebagai cadangan.
            {" "}Jika migrasi gagal di tengah proses, data yang sudah masuk akan
            dibatalkan otomatis.
          </>
        }
        confirmLabel="Ya, migrasikan"
        destructive={false}
        onConfirm={handleMigrate}
      />
    </>
  );
}
