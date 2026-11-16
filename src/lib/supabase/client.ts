import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

export function readSupabaseEnv(): SupabaseEnv {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim(),
    publishableKey: (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ""
    ).trim(),
  };
}

/**
 * Lazily create the browser Supabase client.
 *
 * Only the public URL and publishable key are used — never a service role
 * key. Creation is deferred so a missing configuration produces a readable
 * error at query time instead of crashing the whole render.
 *
 * The session is persisted in localStorage so a signed-in user stays signed in
 * across refreshes; `detectSessionInUrl` lets the email-confirmation and
 * password-recovery links restore a session from the URL hash.
 */
export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const { url, publishableKey } = readSupabaseEnv();
  const missing: string[] = [];

  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Konfigurasi Supabase belum lengkap: ${missing.join(", ")}. ` +
        "Isi variabel tersebut di .env.local lalu restart server pengembangan.",
    );
  }

  cachedClient = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "rab-mini:auth",
    },
  });

  return cachedClient;
}
