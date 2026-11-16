import type { Metadata } from "next";

import { AhspView } from "@/components/ahsp/ahsp-view";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export const metadata: Metadata = {
  title: "AHSP",
};

export default function AhspPage() {
  return <AhspView />;
}
