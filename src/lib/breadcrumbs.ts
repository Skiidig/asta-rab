/**
 * Pembentukan jejak breadcrumb (murni, tanpa React) agar mudah diuji.
 *
 * Aturan:
 *  - Akar trail adalah "Workspace" (menuju /dashboard).
 *  - Krum berikutnya adalah halaman (judul dari `titles`, fallback dari path).
 *  - Bila dua krum berurutan menunjuk URL yang sama — mis. `/dashboard`:
 *    "Workspace" dan "Overview" sama-sama /dashboard — keduanya digabung
 *    menjadi satu krum dengan label yang lebih spesifik.
 *  - Setiap krum punya `id` stabil dan unik untuk dipakai sebagai React key,
 *    bukan `href` (yang bisa berulang secara sah) dan bukan indeks.
 */

export interface Crumb {
  id: string;
  label: string;
  href: string;
}

export interface BreadcrumbOptions {
  /** Peta route → judul halaman (mis. `routeTitles`). */
  titles: Record<string, string>;
  /** Label pengganti untuk krum terakhir (dari header override). */
  crumbLabel?: string;
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildBreadcrumbs(
  pathname: string,
  { titles, crumbLabel }: BreadcrumbOptions,
): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [];

  const rootHref = `/${segments[0]}`;
  const rootLabel = titles[rootHref] ?? titleCase(segments[0]);

  const candidates: Crumb[] = [
    { id: "workspace", label: "Workspace", href: "/dashboard" },
    { id: "section", label: rootLabel, href: rootHref },
    ...segments.slice(1).map((segment, index) => ({
      id: `segment-${index + 1}`,
      label:
        index === segments.length - 2 && crumbLabel
          ? crumbLabel
          : titleCase(decodeURIComponent(segment)),
      href: `/${segments.slice(0, index + 2).join("/")}`,
    })),
  ];

  // Gabungkan krum berurutan dengan href yang sama; label paling spesifik
  // (halaman) menang, dan `id` krum pertama dipertahankan agar stabil.
  const crumbs: Crumb[] = [];
  for (const candidate of candidates) {
    const previous = crumbs[crumbs.length - 1];
    if (previous && previous.href === candidate.href) {
      crumbs[crumbs.length - 1] = { ...candidate, id: previous.id };
      continue;
    }
    crumbs.push(candidate);
  }

  return crumbs;
}
