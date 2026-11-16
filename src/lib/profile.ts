/**
 * Identitas workspace.
 *
 * Profil pengguna (nama tampilan) dan identitas perusahaan dipisahkan:
 * - Profil pengguna disimpan pada `auth.users.user_metadata.full_name`.
 * - Identitas perusahaan disimpan pada `user_metadata.company`.
 *
 * Keduanya memakai mekanisme Supabase Auth yang sudah ada, sehingga tidak
 * memerlukan tabel baru dan tetap terisolasi per akun (setiap pengguna hanya
 * dapat memperbarui metadata miliknya sendiri).
 */

export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
}

/**
 * Nilai awal ketika pengguna belum pernah menyimpan identitas perusahaan.
 *
 * Semua kolom identitas sengaja kosong: aplikasi tidak boleh mengarang nama,
 * alamat, telepon, atau email perusahaan. Contoh pengisian hanya muncul sebagai
 * placeholder di halaman Pengaturan dan tidak pernah menjadi nilai formulir.
 * Nilai tersimpan di metadata selalu menang; default ini hanya fallback.
 */
export const companyProfile: CompanyProfile = {
  name: "",
  address: "",
  phone: "",
  email: "",
  currency: "IDR",
};

export function resolveCompanyProfile(
  metadata: Record<string, unknown> | undefined | null,
): CompanyProfile {
  const stored = metadata?.company as Partial<CompanyProfile> | undefined;
  if (!stored || typeof stored !== "object") return { ...companyProfile };

  return {
    name: textOr(stored.name, companyProfile.name),
    address: textOr(stored.address, companyProfile.address),
    phone: textOr(stored.phone, companyProfile.phone),
    email: textOr(stored.email, companyProfile.email),
    currency: textOr(stored.currency, companyProfile.currency),
  };
}

function textOr(value: unknown, fallback: string): string {
  // String tersimpan dipakai apa adanya, termasuk string kosong: pengguna yang
  // sengaja mengosongkan alamat/telepon tidak boleh diisi ulang dengan contoh.
  return typeof value === "string" ? value : fallback;
}

/** `true` bila setidaknya satu kolom identitas perusahaan terisi. */
export function hasCompanyIdentity(profile: CompanyProfile): boolean {
  return Boolean(
    profile.name.trim() ||
      profile.address.trim() ||
      profile.phone.trim() ||
      profile.email.trim(),
  );
}

/**
 * Baris kontak kop: hanya nilai yang terisi, tanpa pemisah menggantung.
 * Dipakai PDF, Excel, dan pratinjau agar ketiganya konsisten.
 */
export function companyContactLine(
  profile: Pick<CompanyProfile, "phone" | "email">,
): string {
  return [profile.phone, profile.email]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("  ·  ");
}

/** Nama tampilan: metadata `full_name`, lalu email, lalu "Pengguna". */
export function resolveDisplayName(
  metadata: Record<string, unknown> | undefined | null,
  email: string | undefined | null,
): string {
  const fullName = metadata?.full_name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  return email?.trim() || "Pengguna";
}
