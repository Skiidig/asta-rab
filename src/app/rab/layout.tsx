import { HeaderOverrideProvider } from "@/components/layout/header-override";
import { ProtectedShell } from "@/components/layout/protected-shell";
import { routeTitles } from "@/lib/navigation";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export default function RabLayout({ children }: LayoutProps<"/rab">) {
  return (
    <HeaderOverrideProvider>
      <ProtectedShell title={routeTitles["/rab"]}>{children}</ProtectedShell>
    </HeaderOverrideProvider>
  );
}
