import type { Metadata } from "next";

import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = {
  title: "Pengaturan",
};

/**
 * Halaman ini berada di bawah `AuthGate` (settings/layout.tsx), sehingga
 * render-nya sengaja ditahan sampai status sesi diketahui. Opt-out ini berlaku
 * hanya untuk segmen Settings; segmen lain tetap divalidasi.
 */
export const instant = false;

export default function SettingsPage() {
  return <SettingsView />;
}
