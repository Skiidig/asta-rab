"use client";

import { useState } from "react";
import { FolderKanban } from "lucide-react";
import { toast } from "sonner";

import { useData } from "@/components/providers/data-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { Button, ButtonLink } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toErrorMessage } from "@/lib/errors";
import type { RabDocument } from "@/types";

/**
 * Create or edit a RAB document's metadata. Controlled and mounted only while
 * open. New documents start with an empty work-items list.
 */
export function RabDocumentDialog({
  open,
  onOpenChange,
  document,
  initialProjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present, the dialog edits this document instead of creating one. */
  document?: RabDocument;
  /** Preselects a project when creating from a project page. */
  initialProjectId?: string;
}) {
  const { projects, status, error } = useData();

  if (!open) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        {status !== "ready" ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {status === "error"
                  ? "Daftar proyek tidak tersedia"
                  : "Memuat daftar proyek…"}
              </DialogTitle>
              <DialogDescription>
                {status === "error"
                  ? (error ?? "Gagal memuat proyek dari Supabase.")
                  : "Tunggu sebentar, data proyek sedang diambil dari database."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Tutup
              </Button>
            </DialogFooter>
          </>
        ) : projects.length === 0 ? (
          <>
            <DialogHeader>
              <DialogTitle>Belum ada proyek</DialogTitle>
              <DialogDescription>
                Setiap dokumen RAB harus terhubung ke satu proyek. Buat proyek
                terlebih dahulu, lalu tambahkan dokumen RAB.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 py-5">
              <EmptyState
                icon={FolderKanban}
                title="Buat proyek dulu"
                description="Dokumen RAB tidak dapat berdiri sendiri tanpa proyek induk."
                compact
              />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Tutup
              </Button>
              <ButtonLink href="/projects" onClick={() => onOpenChange(false)}>
                Ke halaman Projects
              </ButtonLink>
            </DialogFooter>
          </>
        ) : (
          <DocumentForm
            key={document?.id ?? "new"}
            document={document}
            initialProjectId={initialProjectId}
            onCancel={() => onOpenChange(false)}
            onSaved={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DocumentForm({
  document,
  initialProjectId,
  onCancel,
  onSaved,
}: {
  document?: RabDocument;
  initialProjectId?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { projects, createDocument, updateDocument } = useData();

  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));

  const defaultProjectId =
    document?.projectId ??
    (initialProjectId &&
    projects.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : projects[0]?.id) ??
    "";

  const [projectId, setProjectId] = useState(defaultProjectId);
  const [title, setTitle] = useState(document?.title ?? "");
  const [date, setDate] = useState(document?.date ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = Boolean(document);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!projectId) {
      setError("Pilih proyek untuk dokumen RAB ini.");
      return;
    }
    if (!trimmedTitle) {
      setError("Judul dokumen wajib diisi.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editing && document) {
        await updateDocument(document.id, {
          projectId,
          title: trimmedTitle,
          date,
        });
        toast.success("Dokumen RAB diperbarui", { description: trimmedTitle });
      } else {
        const created = await createDocument({
          projectId,
          title: trimmedTitle,
          date,
        });
        toast.success("Dokumen RAB dibuat", {
          description: `${created.number} · ${created.title}`,
        });
      }

      onSaved();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit Dokumen RAB" : "Dokumen RAB Baru"}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? "Perbarui informasi dokumen. Rincian pekerjaan diubah dari halaman editor."
            : "Pilih proyek induk dan beri judul dokumen. Dokumen baru dimulai tanpa item pekerjaan."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 px-6 py-5">
        <div className="grid gap-1.5">
          <Label htmlFor="document-project">Proyek</Label>
          <Select
            items={projectOptions}
            value={projectId}
            onValueChange={(value) => {
              setProjectId((value as string) ?? "");
              setError(null);
            }}
            disabled={saving}
          >
            <SelectTrigger id="document-project">
              <SelectValue placeholder="Pilih proyek" />
            </SelectTrigger>
            <SelectContent>
              {projectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="document-title">Judul dokumen</Label>
          <Input
            id="document-title"
            name="title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            placeholder="Contoh: RAB Renovasi Lantai 2"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            disabled={saving}
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="document-date">Tanggal dokumen</Label>
          <Input
            id="document-date"
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Opsional. Dipakai sebagai tanggal dokumen di header editor.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Batal
        </Button>
        <Button type="submit" disabled={saving}>
          {saving
            ? "Menyimpan…"
            : editing
              ? "Simpan Perubahan"
              : "Buat Dokumen"}
        </Button>
      </DialogFooter>
    </form>
  );
}
