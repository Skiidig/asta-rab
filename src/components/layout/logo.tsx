import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={cn("flex items-center rounded-md outline-none", className)}
      aria-label="Astaworks — ke Overview"
    >
      <BrandMark variant="wordmark" width={168} priority />
    </Link>
  );
}
