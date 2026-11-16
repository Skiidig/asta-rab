import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export const metadata: Metadata = {
  title: "Ringkasan",
};

export default function DashboardPage() {
  return <DashboardView />;
}
