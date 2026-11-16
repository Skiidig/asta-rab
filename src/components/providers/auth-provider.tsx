"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { authErrorMessage } from "@/lib/auth/messages";
import {
  resolveCompanyProfile,
  resolveDisplayName,
  type CompanyProfile,
} from "@/lib/profile";
import { getSupabaseClient } from "@/lib/supabase/client";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface SignUpResult {
  /**
   * `true` ketika project Supabase mewajibkan konfirmasi email, sehingga
   * pendaftaran berhasil tetapi belum ada sesi yang bisa dipakai.
   */
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  /** Nama tampilan dari metadata, fallback email akun. */
  displayName: string;
  /** Identitas perusahaan/workspace dari metadata pengguna. */
  companyProfile: CompanyProfile;
  /** Simpan nama tampilan + identitas perusahaan dalam satu pembaruan. */
  saveProfileSettings: (input: {
    displayName: string;
    company: CompanyProfile;
  }) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Sesi Supabase Auth untuk seluruh aplikasi.
 *
 * Sesi disimpan di localStorage oleh `@supabase/supabase-js` (lihat
 * `src/lib/supabase/client.ts`), sehingga tetap aktif setelah refresh. Status
 * awal `"loading"` sampai sesi selesai dipulihkan; gerbang halaman
 * (`AuthGate`) menahan render sampai status pasti agar data pengguna lain
 * tidak sempat tampil.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const supabase = getSupabaseClient();

      const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setStatus(nextSession ? "authenticated" : "unauthenticated");
      });

      unsubscribe = () => data.subscription.unsubscribe();

      // Cadangan bila event INITIAL_SESSION tidak terkirim: baca sesi tersimpan
      // sekali setelah mount.
      void supabase.auth
        .getSession()
        .then(({ data: restored }) => {
          if (!active || !restored.session) return;
          setSession((current) => current ?? restored.session);
          setStatus((current) =>
            current === "loading" ? "authenticated" : current,
          );
        })
        .catch(() => {
          if (active) {
            setStatus((current) =>
              current === "loading" ? "unauthenticated" : current,
            );
          }
        });
    } catch {
      // Konfigurasi Supabase belum lengkap: tetap tampilkan halaman masuk agar
      // pesan konfigurasi muncul saat pengguna mencoba masuk.
      queueMicrotask(() => {
        if (active) setStatus("unauthenticated");
      });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) throw new Error(authErrorMessage(error));
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) throw new Error(authErrorMessage(error));

    return { needsEmailConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(authErrorMessage(error));
  }, []);

  const metadata = (session?.user?.user_metadata ?? undefined) as
    | Record<string, unknown>
    | undefined;
  const displayName = resolveDisplayName(metadata, session?.user?.email);
  const companyProfile = resolveCompanyProfile(metadata);

  /**
   * Profil dan identitas perusahaan tidak memakai tabel terpisah: keduanya
   * disimpan di `user_metadata` akun yang sedang masuk. Dengan begitu RLS
   * Supabase Auth yang sudah ada menjaga isolasi antar pengguna, dan tidak ada
   * migrasi baru.
   */
  const saveProfileSettings = useCallback(
    async ({
      displayName: nextDisplayName,
      company,
    }: {
      displayName: string;
      company: CompanyProfile;
    }) => {
      const supabase = getSupabaseClient();
      const currentMetadata = (session?.user?.user_metadata ?? {}) as Record<
        string,
        unknown
      >;

      const { data, error } = await supabase.auth.updateUser({
        data: {
          ...currentMetadata,
          full_name: nextDisplayName.trim(),
          company: {
            ...company,
            name: company.name.trim(),
            address: company.address.trim(),
            phone: company.phone.trim(),
            email: company.email.trim(),
            currency: company.currency || "IDR",
          },
        },
      });

      if (error) throw new Error(authErrorMessage(error));

      if (data.user) {
        setSession((current) =>
          current ? { ...current, user: data.user } : current,
        );
      }
    },
    [session?.user?.user_metadata],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      session,
      displayName,
      companyProfile,
      saveProfileSettings,
      signIn,
      signUp,
      signOut,
    }),
    [
      status,
      session,
      displayName,
      companyProfile,
      saveProfileSettings,
      signIn,
      signUp,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }
  return context;
}
