/**
 * Pagination helper untuk query Supabase/PostgREST.
 *
 * PostgREST membatasi jumlah baris per respons (Supabase default 1000). Satu
 * `select("*")` karena itu bisa memotong data diam-diam. Helper ini membaca
 * halaman demi halaman dengan `.range()`, dan urutan halaman harus
 * deterministik (kolom urut + pembeda unik seperti `id`) supaya tidak ada baris
 * yang terlewat atau terduplikasi.
 *
 * Kegagalan pada halaman mana pun dilempar sebagai error — pemanggil tidak
 * pernah menerima data parsial sebagai "berhasil".
 */

export interface PageError {
  message?: string;
  details?: string;
  hint?: string;
}

export interface PageResponse<T> {
  data: T[] | null;
  error: PageError | null;
}

export interface FetchAllPagesOptions {
  /** Jumlah baris per permintaan; di bawah batas respons server. */
  pageSize?: number;
  /** Pengaman agar loop tidak berjalan tanpa akhir. */
  maxPages?: number;
}

/** 500 baris: aman di bawah batas default PostgREST (1000). */
export const DEFAULT_PAGE_SIZE = 500;

function describe(error: PageError): string {
  return [error.message, error.details, error.hint]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" — ");
}

export async function fetchAllPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  options: FetchAllPagesOptions = {},
): Promise<T[]> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE));
  const maxPages = options.maxPages ?? 10_000;

  const rows: T[] = [];
  let from = 0;
  let page = 0;

  for (;;) {
    if (page >= maxPages) {
      throw new Error(
        `Gagal memuat ${label}: melebihi batas ${maxPages} halaman.`,
      );
    }

    const { data, error } = await fetchPage(from, from + pageSize - 1);

    if (error) {
      const detail = describe(error);
      throw new Error(
        `Gagal memuat ${label} (halaman ${page + 1}).${detail ? ` ${detail}` : ""}`,
      );
    }

    const batch = data ?? [];
    rows.push(...batch);

    // Halaman terakhir selalu lebih pendek (termasuk 0 baris). Jika tepat
    // sepanjang pageSize, satu halaman lagi diminta untuk memastikan tidak ada
    // sisa data.
    if (batch.length < pageSize) break;

    from += pageSize;
    page += 1;
  }

  return rows;
}
