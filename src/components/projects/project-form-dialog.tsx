"use client";

import { useState } from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toErrorMessage } from "@/lib/errors";
import { todayLocalISO } from "@/lib/format";
import { PROJECT_STATUSES, projectStatusMeta } from "@/lib/status";
import type { Project, ProjectStatus } from "@/types";

const statusOptions = PROJECT_STATUSES.map((status) => ({
  value: status,
  label: projectStatusMeta[status].label,
}));

/**
 * Create or edit a project. Controlled by the parent and only mounted while
 * open, so each opening starts with fresh form state.
 */
export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present, the dialog edits this project instead of creating one. */
  project?: Project;
}) {
  if (!open) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <ProjectForm
          key={project?.id ?? "new"}
          project={project}
          onCancel={() => onOpenChange(false)}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  project,
  onCancel,
  onSaved,
}: {
  project?: Project;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { createProject, updateProject } = useData();

  const [name, setName] = useState(project?.name ?? "");
  const [client, setClient] = useState(project?.client ?? "");
  const [location, setLocation] = useState(project?.location ?? "");
  const [startDate, setStartDate] = useState(
    project?.startDate || todayLocalISO(),
  );
  const [status, setStatus] = useState<ProjectStatus>(
    project?.status ?? "planning",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = Boolean(project);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Nama proyek wajib diisi.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const input = { name: trimmedName, client, location, startDate, status };

      if (editing && project) {
        await updateProject(project.id, input);
        toast.success("Proyek diperbarui", { description: trimmedName });
      } else {
        await createProject(input);
        toast.success("Proyek berhasil dibuat", { description: trimmedName });
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
        <DialogTitle>{editing ? "Edit Proyek" : "Proyek Baru"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Perbarui informasi dasar proyek. Perubahan disimpan ke database Supabase."
            : "Isi informasi dasar proyek. Data langsung disimpan ke database Supabase."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 px-6 py-5">
        <div className="grid gap-1.5">
          <Label htmlFor="project-name">Nama proyek</Label>
          <Input
            id="project-name"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="Contoh: Renovasi Rumah Bapak Hendra"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            disabled={saving}
            required
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="project-client">Nama klien</Label>
          <Input
            id="project-client"
            name="client"
            value={client}
            onChange={(event) => setClient(event.target.value)}
            placeholder="Nama klien (opsional)"
            disabled={saving}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="project-location">Lokasi</Label>
          <Input
            id="project-location"
            name="location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Kota / kecamatan (opsional)"
            disabled={saving}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="project-date">Tanggal mulai</Label>
            <Input
              id="project-date"
              name="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="project-status">Status</Label>
            <Select
              items={statusOptions}
              value={status}
              onValueChange={(value) =>
                setStatus((value as ProjectStatus) ?? "planning")
              }
              disabled={saving}
            >
              <SelectTrigger id="project-status">
                <SelectValue placeholder="Pilih status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
              : "Simpan Proyek"}
        </Button>
      </DialogFooter>
    </form>
  );
}
