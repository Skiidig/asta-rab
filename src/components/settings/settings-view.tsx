"use client";

import { useState } from "react";
import { Building2, Check, Monitor, Moon, Save, Sun, UserRound } from "lucide-react";
import { toast } from "sonner";

import { BrandMark } from "@/components/layout/brand-mark";
import { useAuth } from "@/components/providers/auth-provider";
import { useTheme, type ThemeMode } from "@/components/providers/theme-provider";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { toErrorMessage } from "@/lib/errors";
import { getInitials } from "@/lib/format";
import {
  companyContactLine,
  hasCompanyIdentity,
  type CompanyProfile,
} from "@/lib/profile";
import { cn } from "@/lib/utils";

const sections = [
  { id: "profile", label: "Profil Pengguna", icon: UserRound },
  { id: "company", label: "Identitas Perusahaan", icon: Building2 },
  { id: "theme", label: "Tema Tampilan", icon: Sun },
];

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  Icon: typeof Sun;
}> = [
  {
    value: "light",
    label: "Terang",
    description: "Light Cream dengan aksen Royal Blue.",
    Icon: Sun,
  },
  {
    value: "dark",
    label: "Gelap",
    description: "Latar navy gelap untuk ruangan minim cahaya.",
    Icon: Moon,
  },
  {
    value: "system",
    label: "Ikuti sistem",
    description: "Mengikuti preferensi perangkat saat ini.",
    Icon: Monitor,
  },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+()\-.\s]{6,32}$/;

type SaveStatus =
  | { type: "success" | "error"; message: string }
  | null;

function normalizeCompany(company: CompanyProfile): CompanyProfile {
  return {
    ...company,
    name: company.name.trim(),
    address: company.address.trim(),
    phone: company.phone.trim(),
    email: company.email.trim(),
  };
}

export function SettingsView() {
  const { user, displayName, companyProfile, saveProfileSettings } = useAuth();
  const { mode: themeMode, setThemeMode } = useTheme();

  const [name, setName] = useState(displayName);
  const [company, setCompany] = useState<CompanyProfile>(companyProfile);
  const [baseline, setBaseline] = useState({
    name: displayName,
    company: companyProfile,
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);

  const trimmedName = name.trim();
  const normalizedCompany = normalizeCompany(company);

  const dirty =
    trimmedName !== baseline.name.trim() ||
    JSON.stringify(normalizedCompany) !==
      JSON.stringify(normalizeCompany(baseline.company));

  const nameError =
    trimmedName.length < 2 ? "Nama tampilan minimal 2 karakter." : null;
  const companyEmailError =
    normalizedCompany.email && !EMAIL_PATTERN.test(normalizedCompany.email)
      ? "Format email perusahaan tidak valid."
      : null;
  const companyPhoneError =
    normalizedCompany.phone && !PHONE_PATTERN.test(normalizedCompany.phone)
      ? "Nomor telepon tidak valid."
      : null;

  const valid = !nameError && !companyEmailError && !companyPhoneError;
  const canSave = dirty && valid && !saving;
  const companyContact = companyContactLine(normalizedCompany);
  const companyFilled = hasCompanyIdentity(normalizedCompany);

  function setCompanyField<K extends keyof CompanyProfile>(
    field: K,
    value: CompanyProfile[K],
  ) {
    setCompany((current) => ({ ...current, [field]: value }));
    setStatus(null);
  }

  function resetForm() {
    setName(baseline.name);
    setCompany(baseline.company);
    setStatus(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setStatus(null);

    try {
      await saveProfileSettings({
        displayName: trimmedName,
        company: normalizedCompany,
      });

      const saved = {
        name: trimmedName,
        company: normalizedCompany,
      };
      setBaseline(saved);
      setName(saved.name);
      setCompany(saved.company);
      setStatus({ type: "success", message: "Pengaturan tersimpan." });
      toast.success("Pengaturan tersimpan");
    } catch (caught) {
      // Isian tetap dipertahankan agar pengguna tidak kehilangan input.
      setStatus({ type: "error", message: toErrorMessage(caught) });
      toast.error("Gagal menyimpan pengaturan", {
        description: toErrorMessage(caught),
      });
    } finally {
      setSaving(false);
    }
  }

  const avatarName = trimmedName || user?.email || "Pengguna";
  const accountEmail = user?.email ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengaturan"
        description="Kelola profil pengguna dan identitas perusahaan yang tampil pada dokumen."
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="Bagian pengaturan"
          className="min-w-0 lg:sticky lg:top-24 lg:self-start"
        >
          <ul className="flex flex-wrap gap-1 pb-1 lg:flex-col lg:pb-0">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <li key={section.id} className="shrink-0">
                  <a
                    href={`#${section.id}`}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                  >
                    <Icon className="size-4" strokeWidth={1.8} />
                    {section.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <form onSubmit={handleSubmit} className="min-w-0 space-y-6" noValidate>
          <Card id="profile" className="scroll-mt-24">
            <CardHeader className="pb-4">
              <div className="min-w-0">
                <CardTitle>Profil Pengguna</CardTitle>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Nama ini tampil pada menu akun. Email mengikuti akun yang masuk.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div className="flex items-center gap-4">
                <span
                  aria-hidden
                  className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-base font-semibold text-primary ring-1 ring-primary/10"
                >
                  {getInitials(avatarName)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {trimmedName || "Nama tampilan"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {accountEmail || "Email akun tidak tersedia"}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="profile-name">Nama tampilan</Label>
                  <Input
                    id="profile-name"
                    name="displayName"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setStatus(null);
                    }}
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "profile-name-error" : undefined}
                  />
                  {nameError ? (
                    <p id="profile-name-error" className="text-xs text-danger">
                      {nameError}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="profile-email">Email akun</Label>
                  <Input
                    id="profile-email"
                    value={accountEmail}
                    readOnly
                    disabled
                    aria-describedby="profile-email-note"
                  />
                  <p
                    id="profile-email-note"
                    className="text-xs text-muted-foreground"
                  >
                    Email berasal dari autentikasi dan tidak dapat diubah di sini.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card id="company" className="scroll-mt-24">
            <CardHeader className="pb-4">
              <div className="min-w-0">
                <CardTitle>Identitas Perusahaan</CardTitle>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Dipakai pada kop PDF dan Excel saat dokumen diekspor.
                  Kosongkan kolom yang tidak ingin ditampilkan.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pt-0">
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <p className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  Pratinjau kop dokumen
                </p>
                <div className="mt-3 min-w-0 space-y-0.5">
                  {companyFilled ? (
                    <>
                      {normalizedCompany.name ? (
                        <p className="text-sm font-semibold break-words text-foreground">
                          {normalizedCompany.name}
                        </p>
                      ) : null}
                      {normalizedCompany.address ? (
                        <p className="text-xs leading-relaxed break-words whitespace-pre-line text-muted-foreground">
                          {normalizedCompany.address}
                        </p>
                      ) : null}
                      {companyContact ? (
                        <p className="text-xs break-words text-muted-foreground">
                          {companyContact}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Belum ada identitas perusahaan. Kop dokumen hanya memuat
                      judul dan informasi proyek.
                    </p>
                  )}
                </div>
                <div className="mt-3 border-t border-border pt-2">
                  <p className="text-[10px] font-medium tracking-wide text-muted-foreground">
                    RENCANA ANGGARAN BIAYA
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                    Branding aplikasi
                  </span>
                  <BrandMark variant="wordmark" width={96} />
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="company-name">Nama perusahaan/usaha</Label>
                  <Input
                    id="company-name"
                    name="companyName"
                    autoComplete="organization"
                    placeholder="Contoh: Mitra Konstruksi Nusantara"
                    value={company.name}
                    onChange={(event) =>
                      setCompanyField("name", event.target.value)
                    }
                    aria-describedby="company-name-note"
                  />
                  <p
                    id="company-name-note"
                    className="text-xs text-muted-foreground"
                  >
                    Opsional. Kosongkan bila dokumen tidak perlu memuat nama
                    perusahaan.
                  </p>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="company-address">Alamat</Label>
                  <Textarea
                    id="company-address"
                    name="address"
                    autoComplete="street-address"
                    placeholder="Contoh: Jl. Tebet Raya No. 42, Tebet, Jakarta Selatan 12810"
                    value={company.address}
                    onChange={(event) =>
                      setCompanyField("address", event.target.value)
                    }
                    rows={3}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-phone">Nomor telepon</Label>
                  <Input
                    id="company-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="Contoh: +62 21 8370 4512"
                    value={company.phone}
                    onChange={(event) =>
                      setCompanyField("phone", event.target.value)
                    }
                    aria-invalid={Boolean(companyPhoneError)}
                    aria-describedby={
                      companyPhoneError ? "company-phone-error" : undefined
                    }
                  />
                  {companyPhoneError ? (
                    <p id="company-phone-error" className="text-xs text-danger">
                      {companyPhoneError}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-email">Email perusahaan</Label>
                  <Input
                    id="company-email"
                    name="email"
                    type="email"
                    autoComplete="off"
                    placeholder="Contoh: admin@mitrakonstruksi.co.id"
                    value={company.email}
                    onChange={(event) =>
                      setCompanyField("email", event.target.value)
                    }
                    aria-invalid={Boolean(companyEmailError)}
                    aria-describedby={
                      companyEmailError ? "company-email-error" : undefined
                    }
                  />
                  {companyEmailError ? (
                    <p id="company-email-error" className="text-xs text-danger">
                      {companyEmailError}
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card id="theme" className="scroll-mt-24">
            <CardHeader className="pb-4">
              <div className="min-w-0">
                <CardTitle>Tema Tampilan</CardTitle>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Preferensi disimpan di perangkat ini dan langsung diterapkan.
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div
                role="radiogroup"
                aria-label="Tema tampilan"
                className="grid gap-2 sm:grid-cols-3"
              >
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.Icon;
                  const active = themeMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setThemeMode(option.value)}
                      className={cn(
                        "flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        active
                          ? "border-primary bg-primary-soft text-foreground"
                          : "border-border bg-surface text-foreground hover:border-border-strong",
                      )}
                    >
                      <span className="flex items-center gap-2 text-[13px] font-medium">
                        <Icon
                          className={cn(
                            "size-4",
                            active ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        {option.label}
                        {active ? (
                          <Check className="ml-auto size-3.5 text-primary" />
                        ) : null}
                      </span>
                      <span className="text-[11px] leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p
              aria-live="polite"
              className={
                status?.type === "error"
                  ? "text-xs break-words text-danger"
                  : "text-xs text-muted-foreground"
              }
            >
              {status?.message ??
                "Perubahan hanya tersimpan setelah Anda menekan Simpan."}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={resetForm}
                disabled={!dirty || saving}
              >
                Batal
              </Button>
              <Button type="submit" disabled={!canSave}>
                {status?.type === "success" && !dirty ? (
                  <Check />
                ) : (
                  <Save />
                )}
                {saving ? "Menyimpan…" : "Simpan Perubahan"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
