"use client";

import { useState } from "react";

import { formatNumberInput, parseNumberInput } from "@/lib/rab-calc";
import {
  formatNumberForEditing,
  formatQuantityForEditing,
} from "@/lib/volume-format";
import { cn } from "@/lib/utils";

/**
 * Numeric text input for RAB quantities and prices.
 *
 * Keeps the user's raw text while editing (so "2," and "1.500" behave
 * naturally) and reports a plain number to the parent. Empty input reports
 * `null`. Negative values are rejected outright.
 *
 * Ada dua mode tampilan:
 * - tidak fokus: memakai `formatDisplay` (default 2 desimal; volume memakai
 *   formatter yang konsisten dengan jumlah harga);
 * - fokus: memakai `formatEditing` (nilai penuh tanpa artefak floating point),
 *   supaya pengguna tidak mengedit angka yang sudah dibulatkan.
 *
 * Fokus lalu blur tanpa perubahan tidak memanggil `onChange`, sehingga tidak
 * ada penyimpanan maupun perubahan total.
 */
export function NumberInput({
  value,
  onChange,
  ariaLabel,
  allowDecimal = true,
  className,
  id,
  placeholder = "0",
  formatDisplay,
  formatEditing,
  dotAsDecimal = false,
}: {
  value: number;
  onChange: (value: number | null) => void;
  ariaLabel: string;
  allowDecimal?: boolean;
  className?: string;
  id?: string;
  placeholder?: string;
  /** Format angka saat tidak fokus. Default: 2 desimal. */
  formatDisplay?: (value: number) => string;
  /** Format angka saat fokus. Default: nilai asli tanpa pembulatan. */
  formatEditing?: (value: number) => string;
  /** Untuk volume/koefisien: titik selalu dianggap desimal. */
  dotAsDecimal?: boolean;
}) {
  // `null` means "not editing" — display the formatted value.
  const [draft, setDraft] = useState<string | null>(null);

  const formatValue = formatDisplay ?? formatNumberInput;
  const formatEdit =
    formatEditing ??
    (dotAsDecimal ? formatQuantityForEditing : formatNumberForEditing);

  const display = draft ?? (value === 0 ? "" : formatValue(value));

  function handleFocus() {
    if (draft !== null) return;
    setDraft(value === 0 ? "" : formatEdit(value));
  }

  function handleChange(raw: string) {
    // Keep digits and separators only, so pasting "Rp 1.000" still works
    // instead of being rejected silently.
    const cleaned = raw.replace(/[^\d.,]/g, "");
    if (!allowDecimal && cleaned.includes(",")) return;

    setDraft(cleaned);

    const parsed = parseNumberInput(cleaned, { dotAsDecimal });
    // Nilai yang sama tidak perlu memicu penyimpanan (mis. mengetik ulang
    // angka yang identik dengan nilai tersimpan).
    if (parsed !== null && parsed === value) return;
    onChange(parsed);
  }

  function handleBlur() {
    // Tanpa perubahan, tidak ada `onChange` — hanya kembali ke mode tampilan.
    setDraft(null);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      autoComplete="off"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={display}
      onFocus={handleFocus}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      className={cn(
        "h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-right text-[13px] text-foreground tabular-nums outline-none transition-colors",
        "hover:border-border focus-visible:border-primary focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-primary/20",
        "placeholder:text-muted-foreground/60",
        className,
      )}
    />
  );
}
