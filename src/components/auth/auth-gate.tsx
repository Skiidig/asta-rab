"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/components/providers/auth-provider";

/**
 * Gerbang halaman: menahan render sampai sesi diketahui, lalu mengalihkan
 * pengguna yang belum masuk ke `/login`.
 *
 * Ini hanya lapisan UX. Batas keamanan yang sebenarnya adalah RLS di Supabase:
 * tanpa sesi valid, query data tetap ditolak server apa pun yang dilakukan
 * browser.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "authenticated") return <>{children}</>;

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background px-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {status === "loading"
          ? "Memeriksa sesi…"
          : "Mengalihkan ke halaman masuk…"}
      </span>
    </div>
  );
}
