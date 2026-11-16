"use client";

import { useMemo } from "react";

import { useNow } from "@/hooks/use-now";

/**
 * Renders today's date in Indonesian format, e.g.
 * "Sabtu, 14 November 2026". Shows a neutral placeholder until mounted.
 */
export function TodayLabel() {
  const now = useNow();

  const label = useMemo(() => {
    if (!now) return null;
    return new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Makassar",
    }).format(now);
  }, [now]);

  if (!label) {
    return (
      <span
        aria-hidden
        className="inline-block h-3 w-40 animate-pulse rounded bg-foreground/[0.06]"
      />
    );
  }

  return <>{label}</>;
}
