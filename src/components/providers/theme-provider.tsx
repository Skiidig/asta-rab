"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "rab-theme";

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage bisa diblokir; jatuh ke mode sistem.
  }
  return "system";
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Preferensi tema per perangkat.
 *
 * Skrip kecil di root layout sudah menetapkan `data-theme` sebelum paint agar
 * tidak ada kilatan tema salah. Provider menyinkronkan pilihan pengguna,
 * perubahan preferensi sistem, dan tab lain setelah hidrasi.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const modeRef = useRef<ThemeMode>("system");

  const applyMode = useCallback((next: ThemeMode) => {
    const resolved = resolveMode(next);
    modeRef.current = next;
    setMode(next);
    setResolvedTheme(resolved);

    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.themeMode = next;
    root.style.colorScheme = resolved;
  }, []);

  useEffect(() => {
    // Baca preferensi setelah mount; skrip head sudah menerapkan tema sebelum
    // paint, jadi tidak ada kilatan tema.
    queueMicrotask(() => applyMode(readStoredMode()));

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (modeRef.current === "system") applyMode("system");
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) applyMode(readStoredMode());
    };

    media.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      media.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [applyMode]);

  const setThemeMode = useCallback(
    (next: ThemeMode) => {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Tetap terapkan untuk sesi ini meski penyimpanan diblokir.
      }
      applyMode(next);
    },
    [applyMode],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedTheme, setThemeMode }),
    [mode, resolvedTheme, setThemeMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }
  return context;
}
