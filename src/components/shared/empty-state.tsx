import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Friendly zero-state used when a list has no results or no data yet.
 * Pass `action` for a call-to-action and `secondaryAction` for a lighter
 * alternative (e.g. "Reset filter").
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-6 py-10" : "px-6 py-16",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground shadow-card">
        <Icon className="size-5" strokeWidth={1.7} />
      </span>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
