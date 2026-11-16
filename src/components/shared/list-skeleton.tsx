import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Neutral placeholder for a list while the first query is running. */
export function ListSkeleton({
  rows = 5,
  label = "Memuat data",
  className,
}: {
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface shadow-card",
        className,
      )}
    >
      <div className="border-b border-border bg-background/60 px-5 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="size-8 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5" style={{ width: `${60 - index * 4}%` }} />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-3.5 w-28 sm:block" />
            <Skeleton className="hidden h-3.5 w-20 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
