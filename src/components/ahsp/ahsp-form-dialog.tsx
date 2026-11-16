"use client";

import { useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_AHSP_CATEGORY, type AhspAnalysisInput } from "@/lib/ahsp";
import { toErrorMessage } from "@/lib/errors";
import { RAB_UNITS } from "@/lib/rab-calc";
import type { AhspAnalysis, RabUnit } from "@/types";

const unitOptions = RAB_UNITS.map((unit) => ({ value: unit, label: unit }));

/** Dialog informasi dasar analisis AHSP (tanpa komponen). */
export function AhspFormDialog({
  open,
  onOpenChange,
  analysis,
  categories,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bila diisi, dialog mengedit analisis ini. */
  analysis?: AhspAnalysis;
  categories: string[];
  onSubmit: (input: AhspAnalysisInput) => Promise<void>;
}) {
  if (!open) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <AhspForm
          key={analysis?.id ?? "new"}
          analysis={analysis}
          categories={categories}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function AhspForm({
  analysis,
  categories,
  onCancel,
  onSubmit,
}: {
  analysis?: AhspAnalysis;
  categories: string[];
  onCancel: () => void;
  onSubmit: (input: AhspAnalysisInput) => Promise<void>;
}) {
  const [name, setName] = useState(analysis?.name ?? "");
  const [category, setCategory] = useState(analysis?.category ?? DEFAULT_AHSP_CATEGORY);
  const [unit, setUnit] = useState<RabUnit>(analysis?.unit ?? "m2");
  const [description, setDescription] = useState(analysis?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = Boolean(analysis);
  const categoryOptions = categories.includes(category)
    ? categories
    : [...categories, category];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Nama pekerjaan wajib diisi.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSubmit({ name: trimmedName, category, unit, description });
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Analisis AHSP" : "Analisis AHSP Baru"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Perubahan berlaku untuk pemilihan berikutnya; item RAB yang sudah dibuat tidak berubah."
            : "Tentukan pekerjaan yang dianalisis. Komponen material, tenaga kerja, dan peralatan ditambahkan setelah ini."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 px-6 py-5">
        <div className="grid gap-1.5">
          <Label htmlFor="ahsp-name">Nama pekerjaan</Label>
          <Input
            id="ahsp-name"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="Contoh: Pekerjaan Pondasi Batu Kali"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            disabled={saving}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ahsp-category">Kategori pekerjaan</Label>
            <Select
              items={categoryOptions.map((value) => ({ value, label: value }))}
              value={category}
              onValueChange={(value) => setCategory((value as string) ?? "Lainnya")}
              disabled={saving}
            >
              <SelectTrigger id="ahsp-category">
                <SelectValue placeholder="Pilih kategori" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ahsp-unit">Satuan pekerjaan</Label>
            <Select
              items={unitOptions}
              value={unit}
              onValueChange={(value) => setUnit((value as RabUnit) ?? "unit")}
              disabled={saving}
            >
              <SelectTrigger id="ahsp-unit">
                <SelectValue placeholder="Pilih satuan" />
              </SelectTrigger>
              <SelectContent>
                {unitOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ahsp-description">Deskripsi (opsional)</Label>
          <Textarea
            id="ahsp-description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Lingkup pekerjaan, asumsi, atau catatan metode"
            rows={3}
            disabled={saving}
          />
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
          {saving ? "Menyimpan…" : editing ? "Simpan Perubahan" : "Simpan Analisis"}
        </Button>
      </DialogFooter>
    </form>
  );
}
