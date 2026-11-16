"use client";

import { AuthGate } from "@/components/auth/auth-gate";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Kerangka halaman yang hanya boleh dilihat pengguna yang sudah masuk.
 * Membungkus `AppShell` supaya seluruh navigasi tetap sama persis dengan
 * sebelumnya — yang ditambahkan hanya gerbang sesi di luarnya.
 */
export function ProtectedShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <AppShell title={title}>{children}</AppShell>
    </AuthGate>
  );
}
