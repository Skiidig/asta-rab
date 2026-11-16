"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { routeTitles } from "@/lib/navigation";
import { useHeaderOverride } from "@/components/layout/header-context";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";

/**
 * Jejak breadcrumb dari pathname aktif. Trail dua tingkat (Workspace / Halaman);
 * segmen bersarang memakai label yang bisa ditimpa halaman lewat
 * `HeaderOverrideProvider`.
 *
 * Pembentukan trail ada di `buildBreadcrumbs` (murni, teruji). Krum dengan URL
 * sama digabung, dan React key memakai `id` stabil — bukan `href`.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const { crumbLabel } = useHeaderOverride();
  const crumbs = buildBreadcrumbs(pathname, { titles: routeTitles, crumbLabel });

  if (pathname === "/dashboard") return null;

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-1.5 text-xs">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.id} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
              ) : null}
              {isLast ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
