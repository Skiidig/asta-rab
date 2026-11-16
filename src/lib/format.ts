/**
 * Formatting helpers for Indonesian Rupiah and dates.
 *
 * The app is Indonesia-first, so formatting is fixed to the `id-ID` locale
 * and the Asia/Jakarta timezone. When a real backend arrives, these helpers
 * are the single place to adjust.
 */

const idrCurrency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const idrCompact = new Intl.NumberFormat("id-ID", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const shortDate = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

const relativeTime = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });

/** `Rp 1.250.000.000` */
export function formatIDR(value: number) {
  return idrCurrency.format(value).replace(/\u00A0/g, " ");
}

const idrCurrencyPrecise = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * `Rp 3.694.397.805,92` — selalu dua desimal.
 *
 * Dipakai saat nilai pecahan harus terlihat apa adanya (mis. total preview
 * import), karena `formatIDR` membulatkan ke rupiah penuh.
 */
export function formatIDRPrecise(value: number) {
  return idrCurrencyPrecise.format(value).replace(/\u00A0/g, " ");
}

/**
 * Rupiah adaptif: dua desimal hanya bila nilainya memang pecahan.
 *
 * `Rp 3.694.397.805,92` untuk total berdesimal, `Rp 150.000` untuk nilai bulat.
 * Dipakai di editor agar presisi nilai asli tidak hilang.
 */
export function formatIDRMoney(value: number) {
  const formatted = formatIDRPrecise(value);
  return formatted.endsWith(",00") ? formatted.slice(0, -3) : formatted;
}

/** `Rp 1,3 M` — compact form for chart labels and tight spaces. */
export function formatIDRCompact(value: number) {
  return `Rp ${idrCompact.format(value)}`;
}

const percentFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `43,75%` — dua desimal, dibulatkan hanya untuk tampilan. */
export function formatPercent(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${percentFormatter.format(safe)}%`;
}

/** `14 Nov 2026` */
export function formatDate(value: string | Date) {
  return shortDate.format(typeof value === "string" ? new Date(value) : value);
}

/**
 * `2026-11-14` — today's date in the browser's local time zone.
 *
 * `Date#toISOString()` would return the UTC date, which is a day behind between
 * 00:00 and the UTC offset (WIB is UTC+7, WITA UTC+8), so form defaults must not
 * use it.
 */
export function todayLocalISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Human-friendly "last updated" label, e.g. `2 jam lalu` / `kemarin`.
 * Falls back to an absolute date for anything older than a month.
 *
 * Pass a fixed `now` when calling from a render that must stay deterministic.
 */
export function formatRelativeTime(value: string | Date, now = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (Math.abs(diffMinutes) < 1) return "baru saja";
  if (Math.abs(diffMinutes) < 60) return relativeTime.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeTime.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) <= 30) return relativeTime.format(diffDays, "day");

  return formatDate(date);
}

/** `Mitra Konstruksi Nusantara` → `MK` */
export function getInitials(name: string) {  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
