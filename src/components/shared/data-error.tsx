"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Full-block query error. Shown instead of an empty state so a failed
 * Supabase request is never mistaken for "there is no data yet".
 */
export function DataError({
  title = "Gagal memuat data",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-danger-border bg-danger-soft px-6 py-12 text-center shadow-card",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-xl border border-danger-border bg-surface text-danger shadow-card">
        <AlertTriangle className="size-5" strokeWidth={1.8} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-md text-[13px] leading-relaxed break-words text-muted-foreground">
        {message}
      </p>
      <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
        Periksa koneksi internet, status project Supabase, dan nilai
        NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY di
        .env.local.
      </p>
      <Button variant="secondary" className="mt-5" onClick={onRetry}>
        <RefreshCw />
        Coba lagi
      </Button>
    </div>
  );
}
