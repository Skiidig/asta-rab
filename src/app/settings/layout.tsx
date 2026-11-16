import { ProtectedShell } from "@/components/layout/protected-shell";
import { routeTitles } from "@/lib/navigation";

/**
 * Segmen ini sengaja menunggu sesi: `AuthGate` menahan render sampai status
 * autentikasi diketahui agar data pengguna tidak sempat tampil. Validasi
 * instant navigation tidak dapat membuktikan shell stabil untuk segmen yang
 * memang diblokir autentikasi, jadi segmen ini diopt-out secara eksplisit —
 * bukan dengan mematikan validasi global atau melepas guard.
 */
export const instant = false;

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <ProtectedShell title={routeTitles["/settings"]}>{children}</ProtectedShell>
  );
}
