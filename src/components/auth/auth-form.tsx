"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, LogIn, MailCheck, UserPlus } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toErrorMessage } from "@/lib/errors";

export type AuthMode = "login" | "register";

const COPY: Record<
  AuthMode,
  { title: string; description: string; submit: string; icon: typeof LogIn }
> = {
  login: {
    title: "Masuk",
    description: "Gunakan email dan password akun Anda untuk membuka workspace.",
    submit: "Masuk",
    icon: LogIn,
  },
  register: {
    title: "Daftar",
    description: "Buat akun baru untuk mulai menyusun RAB proyek Anda.",
    submit: "Buat akun",
    icon: UserPlus,
  },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

/** Formulir masuk dan daftar. Satu komponen agar gayanya identik. */
export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { status, signIn, signUp } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const copy = COPY[mode];

  // Sudah masuk → jangan tampilkan halaman masuk lagi.
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Format email tidak valid.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
      return;
    }
    if (mode === "register" && password !== confirmPassword) {
      setError("Konfirmasi password tidak sama.");
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      if (mode === "login") {
        await signIn(trimmedEmail, password);
        router.replace("/dashboard");
      } else {
        const result = await signUp(trimmedEmail, password);

        if (result.needsEmailConfirmation) {
          setInfo(
            `Pendaftaran berhasil. Kami mengirim tautan konfirmasi ke ${trimmedEmail}. Buka tautan tersebut, lalu masuk.`,
          );
          setPassword("");
          setConfirmPassword("");
        } else {
          router.replace("/dashboard");
        }
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  if (status === "authenticated") {
    return (
      <div
        className="flex min-h-dvh items-center justify-center bg-background px-4"
        aria-busy="true"
      >
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Anda sudah masuk — mengalihkan ke dashboard…
        </span>
      </div>
    );
  }

  const Icon = copy.icon;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center">
          <BrandMark variant="full" width={220} priority />
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-card">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {copy.title}
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {copy.description}
          </p>

          <form onSubmit={handleSubmit} className="mt-5 grid gap-4" noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="auth-email">Email</Label>
              <Input
                id="auth-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError(null);
                }}
                placeholder="nama@perusahaan.co.id"
                aria-invalid={error ? true : undefined}
                disabled={saving}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="auth-password">Password</Label>
              <Input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError(null);
                }}
                placeholder={`Minimal ${MIN_PASSWORD_LENGTH} karakter`}
                aria-invalid={error ? true : undefined}
                disabled={saving}
                required
              />
            </div>

            {mode === "register" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-confirm">Ulangi password</Label>
                <Input
                  id="auth-confirm"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setError(null);
                  }}
                  placeholder="Ketik ulang password"
                  aria-invalid={error ? true : undefined}
                  disabled={saving}
                  required
                />
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-[13px] leading-relaxed text-danger"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
                {error}
              </p>
            ) : null}

            {info ? (
              <p
                role="status"
                className="flex items-start gap-2 rounded-lg border border-success-border bg-success-soft px-3 py-2 text-[13px] leading-relaxed text-success"
              >
                <MailCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
                {info}
              </p>
            ) : null}

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="animate-spin" /> : <Icon />}
              {saving ? "Memproses…" : copy.submit}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[13px] text-muted-foreground">
          {mode === "login" ? (
            <>
              Belum punya akun?{" "}
              <Link
                href="/register"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Daftar
              </Link>
            </>
          ) : (
            <>
              Sudah punya akun?{" "}
              <Link
                href="/login"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Masuk
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
