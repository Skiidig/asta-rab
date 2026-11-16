import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Trend = {
  value: string;
  direction: "up" | "down" | "flat";
  /** Whether the trend is a positive signal (controls color). */
  positive?: boolean;
};

/**
 * Compact KPI card used across the dashboard. Values are passed as
 * pre-formatted strings so the component stays presentation-only.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  accent = false,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  trend?: Trend;
  accent?: boolean;
  className?: string;
}) {
  const TrendIcon =
    trend?.direction === "up"
      ? ArrowUpRight
      : trend?.direction === "down"
        ? ArrowDownRight
        : Minus;

  return (
    <div
      className={cn(
        "group relative rounded-xl border border-border bg-surface p-5 shadow-card transition-colors hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            accent
              ? "bg-action text-action-foreground"
              : "bg-background text-muted-foreground ring-1 ring-border",
          )}
        >
          <Icon className="size-4" strokeWidth={1.9} />
        </span>
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded text-xs font-medium",
              trend.positive === false ? "text-danger" : "text-success",
            )}
          >
            <TrendIcon className="size-3.5" strokeWidth={2.2} />
            {trend.value}
          </span>
        ) : null}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}
