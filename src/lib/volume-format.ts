/**
 * Formatter angka untuk input editor RAB.
 *
 * Dua mode yang dibedakan dengan sengaja:
 * - **tampilan** (tidak sedang diedit): presisi dipilih agar `volume × harga`
 *   sama dengan jumlah harga yang terlihat — aturan yang sama dengan PDF.
 * - **edit** (sedang fokus): nilai penuh dari data tersimpan, dibersihkan dari
 *   artefak floating point (mis. 2,7916000000000007 → 2,7916).
 *
 * Tidak ada nilai yang dibulatkan untuk disimpan; fungsi di sini hanya teks.
 */

const displayFormatters = Array.from({ length: 7 }, (_, digits) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }),
);

/** Pembulatan tampilan ringkas (maks. 6 desimal). Bukan untuk mode edit. */
export function cleanNumber(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

/** Perluas notasi eksponen menjadi desimal tanpa kehilangan presisi. */
function decimalString(value: number): string {
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(20).replace(/\.?0+$/, "");
}

/**
 * Representasi nilai asli untuk mode edit.
 *
 * Memakai representasi desimal terpendek yang bila di-parse kembali
 * menghasilkan angka yang sama persis (round-trip), tanpa pembulatan. Presisi
 * data yang sah — mis. `169,42320105820107` — tidak boleh dibuang; pembatasan
 * enam desimal hanya dipakai untuk tampilan ringkas, bukan di sini.
 */
export function formatNumberForEditing(value: number): string {
  if (!Number.isFinite(value)) return "0";

  const raw = decimalString(value);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [integer, fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const formatted = fraction ? `${grouped},${fraction}` : grouped;

  return negative ? `-${formatted}` : formatted;
}

/**
 * Mode edit untuk besaran (volume/koefisien): desimal tanpa pemisah ribuan.
 *
 * `formatNumberForEditing(1000)` menghasilkan "1.000" untuk input uang, tetapi
 * parser besaran membaca titik sebagai desimal. Agar `"1.000"` tidak berubah
 * menjadi 1, mode edit besaran memakai bentuk polos `"1000"` / `"1500.25"`.
 * Tampilan saat tidak fokus tetap memakai format Indonesia.
 */
export function formatQuantityForEditing(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return decimalString(value);
}

/**
 * Tampilan volume agar konsisten dengan jumlah harga.
 *
 * Contoh: 0,9375 × 1.000.000 = 937.500 → tampil `0,9375` (bukan `0,94`);
 * 312,0625 × 21.000 = 6.553.312,50 → tampil `312,0625` (bukan `312,06`).
 */
export function formatVolumeForDisplay(
  volume: number,
  unitPrice: number,
  amount: number,
): string {
  const safe = Number.isFinite(volume) ? volume : 0;
  if (Number.isInteger(safe)) return displayFormatters[0].format(safe);

  if (unitPrice > 0) {
    for (let digits = 1; digits <= 6; digits += 1) {
      const rounded = Number(safe.toFixed(digits));
      // Toleransi setengah sen: nilai yang ditampilkan tetap membulat ke
      // jumlah harga yang sama pada dua desimal.
      if (Math.abs(rounded * unitPrice - amount) <= 0.005) {
        return displayFormatters[digits].format(rounded);
      }
    }
  }

  return displayFormatters[6].format(cleanNumber(safe));
}
