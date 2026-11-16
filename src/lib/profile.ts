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
 * Nilai tersimpan di metadata selalu menang; default ini hanya fallback.
 */
export const companyProfile: CompanyProfile = {
  name: "Mitra Konstruksi Nusantara",
  address: "Jl. Tebet Raya No. 42, Tebet, Jakarta Selatan 12810",
  phone: "+62 21 8370 4512",
  email: "admin@mitrakonstruksi.co.id",
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

/** Nama tampilan: metadata `full_name`, lalu email, lalu "Pengguna". */
export function resolveDisplayName(
  metadata: Record<string, unknown> | undefined | null,
  email: string | undefined | null,
): string {
  const fullName = metadata?.full_name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  return email?.trim() || "Pengguna";
}
