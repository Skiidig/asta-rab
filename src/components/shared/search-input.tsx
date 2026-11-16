"use client";

import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Controlled search field with a clear button. Kept controlled so pages can
 * filter instantly on the client without extra URL round-trips.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Cari…",
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-surface pr-9 pl-9 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow,border-color]",
          "placeholder:text-muted-foreground/80 hover:border-border-strong",
          "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Hapus pencarian"
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
