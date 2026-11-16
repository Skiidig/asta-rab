import { ProtectedShell } from "@/components/layout/protected-shell";
import { routeTitles } from "@/lib/navigation";

// Ditahan AuthGate sampai sesi diketahui; opt-out validasi khusus segmen ini.
export const instant = false;

export default function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedShell title={routeTitles["/catalog"]}>{children}</ProtectedShell>
  );
}
