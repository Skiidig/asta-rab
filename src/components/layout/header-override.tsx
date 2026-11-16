"use client";

import { useEffect, useMemo, useState } from "react";

import {
  HeaderContext,
  useHeaderOverride,
  type HeaderOverride,
} from "@/components/layout/header-context";

/**
 * Holds the current page's header override. Render it in a route layout,
 * around `AppShell`, so both the header and the page content can reach it.
 */
export function HeaderOverrideProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [override, setOverride] = useState<HeaderOverride>({});

  const value = useMemo(() => ({ ...override, setOverride }), [override]);

  return (
    <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>
  );
}

/**
 * Sets the header title and final breadcrumb label for the current page while
 * it is mounted, and clears them again on unmount.
 */
export function useSetHeaderOverride({ title, crumbLabel }: HeaderOverride) {
  const { setOverride } = useHeaderOverride();

  useEffect(() => {
    setOverride({ title, crumbLabel });
    return () => setOverride({});
  }, [title, crumbLabel, setOverride]);
}
