import type { Metadata } from "next";

import { CatalogView } from "@/components/catalog/catalog-view";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export const metadata: Metadata = {
  title: "Katalog Harga",
};

export default function CatalogPage() {
  return <CatalogView />;
}
