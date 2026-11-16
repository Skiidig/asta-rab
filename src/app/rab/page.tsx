import type { Metadata } from "next";

import { RabView } from "@/components/rab/rab-view";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export const metadata: Metadata = {
  title: "Dokumen RAB",
};

export default function RabPage() {
  return <RabView />;
}
