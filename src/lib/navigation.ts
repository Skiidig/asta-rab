import {
  BookOpen,
  Calculator,
  FileText,
  LayoutDashboard,
  FolderKanban,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const mainNav: NavItem[] = [
  { label: "Ringkasan", href: "/dashboard", icon: LayoutDashboard },
  { label: "Proyek", href: "/projects", icon: FolderKanban },
  { label: "Dokumen RAB", href: "/rab", icon: FileText },
  { label: "Katalog Harga", href: "/catalog", icon: BookOpen },
  { label: "AHSP", href: "/ahsp", icon: Calculator },
];

/**
 * Route → page title map used by the header when a page doesn't supply its
 * own title. Kept in one place so breadcrumbs and titles stay in sync.
 */
export const routeTitles: Record<string, string> = {
  "/dashboard": "Ringkasan",
  "/projects": "Proyek",
  "/rab": "Dokumen RAB",
  "/catalog": "Katalog Harga",
  "/ahsp": "AHSP",
  "/settings": "Pengaturan",
};
