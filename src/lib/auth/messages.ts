/**
 * Terjemahan pesan error Supabase Auth ke bahasa Indonesia.
 *
 * Supabase mengembalikan pesan berbahasa Inggris; pengguna aplikasi ini
 * berbahasa Indonesia, jadi pesan yang dikenal dipetakan. Pesan yang tidak
 * dikenal diteruskan apa adanya agar tidak ada informasi yang hilang.
 */

interface MappedError {
  match: RegExp;
  message: string;
}

const MAPPED_ERRORS: MappedError[] = [
  {
    match: /invalid login credentials/i,
    message: "Email atau password salah.",
  },
  {
    match: /email not confirmed/i,
    message:
      "Email belum dikonfirmasi. Buka tautan konfirmasi di kotak masuk Anda, lalu coba masuk lagi.",
  },
  {
    match: /user already registered/i,
    message: "Email ini sudah terdaftar. Silakan masuk.",
  },
  {
    match: /password should be at least \d+ characters/i,
    message: "Password terlalu pendek (minimal 6 karakter).",
  },
  {
    match: /unable to validate email address|invalid email/i,
    message: "Format email tidak valid.",
  },
  {
    match: /email rate limit exceeded|over_email_send_rate_limit/i,
    message:
      "Email konfirmasi baru saja dikirim. Tunggu beberapa menit sebelum mencoba lagi.",
  },
  {
    match: /signups not allowed|signup is disabled/i,
    message: "Pendaftaran dinonaktifkan untuk project ini.",
  },
  {
    match: /rate limit|too many requests/i,
    message: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  },
  {
    match: /network|fetch failed|failed to fetch/i,
    message:
      "Tidak dapat menghubungi server. Periksa koneksi internet Anda lalu coba lagi.",
  },
];

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Pesan ramah pengguna untuk error autentikasi. */
export function authErrorMessage(error: unknown): string {
  const raw = extractMessage(error).trim();
  if (!raw) return "Autentikasi gagal. Coba lagi.";

  for (const mapped of MAPPED_ERRORS) {
    if (mapped.match.test(raw)) return mapped.message;
  }

  return raw;
}
