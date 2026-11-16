import { ProtectedShell } from "@/components/layout/protected-shell";
import { routeTitles } from "@/lib/navigation";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <ProtectedShell title={routeTitles["/dashboard"]}>{children}</ProtectedShell>
  );
}
