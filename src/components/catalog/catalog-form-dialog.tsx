"use client";

import { useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_CATALOG_CATEGORY, type CatalogItemInput } from "@/lib/catalog";
import { toErrorMessage } from "@/lib/errors";
import { RAB_UNITS } from "@/lib/rab-calc";
import type { CatalogItem, RabUnit } from "@/types";

const unitOptions = RAB_UNITS.map((unit) => ({ value: unit, label: unit }));

/**
 * Dialog tambah/edit item katalog. Hanya di-mount saat terbuka sehingga setiap
 * pembukaan dimulai dari state baru.
 */
export function CatalogFormDialog({
  open,
  onOpenChange,
  item,
  categories,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bila diisi, dialog mengedit item ini. */
  item?: CatalogItem;
  /** Kategori yang tersedia (bawaan + yang sudah dipakai). */
  categories: string[];
  /** Melempar error bila penyimpanan gagal; error ditampilkan di dalam form. */
  onSubmit: (input: CatalogItemInput) => Promise<void>;
}) {
  if (!open) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <CatalogForm
          key={item?.id ?? "new"}
          item={item}
          categories={categories}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function CatalogForm({
  item,
  categories,
  onCancel,
  onSubmit,
}: {
  item?: CatalogItem;
  categories: string[];
  onCancel: () => void;
  onSubmit: (input: CatalogItemInput) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(
    item?.category ?? DEFAULT_CATALOG_CATEGORY,
  );
  const [unit, setUnit] = useState<RabUnit>(item?.unit ?? "m2");
  const [unitPrice, setUnitPrice] = useState(item?.unitPrice ?? 0);
  const [description, setDescription] = useState(item?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editing = Boolean(item);
  const categoryOptions = categories.includes(category)
    ? categories
    : [...categories, category];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Nama item wajib diisi.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSubmit({
        name: trimmedName,
        category,
        unit,
        unitPrice,
        description,
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
        <DialogTitle>{editing ? "Edit Item Katalog" : "Item Katalog Baru"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Perubahan hanya berlaku untuk pemilihan berikutnya; item RAB yang sudah dibuat tidak berubah."
            : "Simpan material atau pekerjaan beserta satuan dan harga satuannya agar mudah dipakai ulang di RAB."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 px-6 py-5">
        <div className="grid gap-1.5">
          <Label htmlFor="catalog-name">Nama item</Label>
          <Input
            id="catalog-name"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            placeholder="Contoh: Semen Portland 50 kg"
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            disabled={saving}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="catalog-category">Kategori</Label>
            <Select
              items={categoryOptions.map((value) => ({ value, label: value }))}
              value={category}
              onValueChange={(value) => setCategory((value as string) ?? "Lainnya")}
              disabled={saving}
            >
              <SelectTrigger id="catalog-category">
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
            <Label htmlFor="catalog-unit">Satuan</Label>
            <Select
              items={unitOptions}
              value={unit}
              onValueChange={(value) => setUnit((value as RabUnit) ?? "unit")}
              disabled={saving}
            >
              <SelectTrigger id="catalog-unit">
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
          <Label htmlFor="catalog-price">Harga satuan (Rp)</Label>
          <NumberInput
            id="catalog-price"
            value={unitPrice}
            onChange={(value) => setUnitPrice(value ?? 0)}
            ariaLabel="Harga satuan katalog"
            placeholder="0"
            className="rounded-lg border-border bg-surface px-3 hover:border-border-strong"
          />
          <p className="text-xs text-muted-foreground">
            Harga ini disalin ke RAB saat item dipilih, lalu bisa diubah manual di editor.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="catalog-description">Catatan (opsional)</Label>
          <Textarea
            id="catalog-description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Spesifikasi singkat, merek, atau keterangan lain"
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
          {saving ? "Menyimpan…" : editing ? "Simpan Perubahan" : "Simpan Item"}
        </Button>
      </DialogFooter>
    </form>
  );
}
