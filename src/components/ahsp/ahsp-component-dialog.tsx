"use client";

import { useState } from "react";
import { Info } from "lucide-react";

import { NumberInput } from "@/components/rab/editor/number-input";
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
import {
  AHSP_RESOURCE_CATEGORIES,
  DEFAULT_AHSP_RESOURCE_CATEGORY,
  componentCost,
  normalizeNonNegative,
  type AhspComponentInput,
} from "@/lib/ahsp";
import { toErrorMessage } from "@/lib/errors";
import { formatIDR } from "@/lib/format";
import { RAB_UNITS } from "@/lib/rab-calc";
import type { AhspResourceCategory, RabUnit } from "@/types";

const unitOptions = RAB_UNITS.map((unit) => ({ value: unit, label: unit }));
const resourceOptions = AHSP_RESOURCE_CATEGORIES.map((value) => ({
  value,
  label: value,
}));

/** Nilai awal komponen; `id` diisi saat mengedit komponen yang sudah ada. */
export interface AhspComponentDraft {
  id?: string;
  catalogItemId?: string | null;
  resourceName?: string;
  resourceCategory?: AhspResourceCategory;
  unit?: RabUnit;
  coefficient?: number;
  unitPrice?: number;
}

/**
 * Dialog tambah/edit komponen AHSP.
 *
 * Jumlah biaya dihitung langsung saat mengetik (koefisien × harga dasar) dengan
 * rumus yang sama seperti perhitungan total, sehingga angka yang terlihat di
 * form identik dengan hasil akhirnya.
 */
export function AhspComponentDialog({
  open,
  onOpenChange,
  draft,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft?: AhspComponentDraft;
  onSubmit: (input: AhspComponentInput) => Promise<void>;
}) {
  if (!open) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <AhspComponentForm
          key={draft?.id ?? `draft-${draft?.resourceName ?? "baru"}`}
          draft={draft}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function AhspComponentForm({
  draft,
  onCancel,
  onSubmit,
}: {
  draft?: AhspComponentDraft;
  onCancel: () => void;
  onSubmit: (input: AhspComponentInput) => Promise<void>;
}) {
  const [resourceName, setResourceName] = useState(draft?.resourceName ?? "");
  const [resourceCategory, setResourceCategory] = useState<AhspResourceCategory>(
    draft?.resourceCategory ?? DEFAULT_AHSP_RESOURCE_CATEGORY,
  );
  const [unit, setUnit] = useState<RabUnit>(draft?.unit ?? "m2");
  const [coefficient, setCoefficient] = useState(draft?.coefficient ?? 1);
  const [unitPrice, setUnitPrice] = useState(draft?.unitPrice ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = Boolean(draft?.id);
  const cost = componentCost(coefficient, unitPrice);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = resourceName.trim();
    if (!trimmedName) {
      setError("Nama material/tenaga kerja/peralatan wajib diisi.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSubmit({
        catalogItemId: draft?.catalogItemId ?? null,
        resourceName: trimmedName,
        resourceCategory,
        unit,
        coefficient: normalizeNonNegative(coefficient),
        unitPrice: normalizeNonNegative(unitPrice),
      });
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
          {editing ? "Edit Komponen AHSP" : "Komponen AHSP"}
        </DialogTitle>
        <DialogDescription>
          Isi koefisien dan harga dasar satuan. Jumlah biaya dihitung otomatis
          dan menjadi bagian dari harga satuan pekerjaan.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 px-6 py-5">
        <div className="grid gap-1.5">
          <Label htmlFor="component-name">Nama material / tenaga kerja / peralatan</Label>
          <Input
            id="component-name"
            name="resourceName"
            value={resourceName}
            onChange={(event) => {
              setResourceName(event.target.value);
              setError(null);
            }}
            placeholder="Contoh: Batu kali, Pekerja, Molen"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            disabled={saving}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="component-category">Kelompok</Label>
            <Select
              items={resourceOptions}
              value={resourceCategory}
              onValueChange={(value) =>
                setResourceCategory(
                  (value as AhspResourceCategory) ?? DEFAULT_AHSP_RESOURCE_CATEGORY,
                )
              }
              disabled={saving}
            >
              <SelectTrigger id="component-category">
                <SelectValue placeholder="Pilih kelompok" />
              </SelectTrigger>
              <SelectContent>
                {resourceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="component-unit">Satuan</Label>
            <Select
              items={unitOptions}
              value={unit}
              onValueChange={(value) => setUnit((value as RabUnit) ?? "unit")}
              disabled={saving}
            >
              <SelectTrigger id="component-unit">
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="component-coefficient">Koefisien</Label>
            <NumberInput
              id="component-coefficient"
              value={coefficient}
              onChange={(value) => setCoefficient(value ?? 0)}
              ariaLabel="Koefisien komponen"
              placeholder="0"
              dotAsDecimal
              className="rounded-lg border-border bg-surface px-3 hover:border-border-strong"
            />
            <p className="text-xs text-muted-foreground">
              Mendukung desimal, mis. 0,35
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="component-price">Harga dasar satuan (Rp)</Label>
            <NumberInput
              id="component-price"
              value={unitPrice}
              onChange={(value) => setUnitPrice(value ?? 0)}
              ariaLabel="Harga dasar satuan"
              placeholder="0"
              className="rounded-lg border-border bg-surface px-3 hover:border-border-strong"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2.5">
          <span className="text-[13px] text-muted-foreground">Jumlah biaya</span>
          <span className="text-[15px] font-semibold text-foreground tabular-nums">
            {formatIDR(cost)}
          </span>
        </div>

        {draft?.catalogItemId ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Nama, satuan, dan harga disalin dari katalog. Mengubahnya di sini
            tidak mengubah item katalog, dan perubahan katalog tidak mengubah
            analisis ini.
          </p>
        ) : null}

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
          {saving ? "Menyimpan…" : editing ? "Simpan Komponen" : "Tambah Komponen"}
        </Button>
      </DialogFooter>
    </form>
  );
}
