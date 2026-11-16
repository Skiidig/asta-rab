import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-action text-action-foreground",
        secondary: "border-transparent bg-foreground/[0.06] text-foreground",
        outline: "border-border text-muted-foreground",
        green: "border-success-border bg-success-soft text-success",
        blue: "border-info-border bg-info-soft text-info",
        amber: "border-warning-border bg-warning-soft text-warning",
        gray: "border-border bg-background text-muted-foreground",
        red: "border-danger-border bg-danger-soft text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * A small status/count pill. The dot is opt-in via `withDot` because count
 * badges (e.g. "3 dokumen") read better without one.
 */
function Badge({
  className,
  variant,
  withDot = false,
  children,
  ...props
}: BadgeProps & { withDot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {withDot ? (
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-current opacity-70"
        />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
