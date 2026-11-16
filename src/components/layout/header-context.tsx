"use client";

import { createContext, useContext } from "react";

/**
 * Lets a page override header chrome (title + last breadcrumb label).
 *
 * The provider lives in a route layout, above `AppShell`, so both the header
 * and the page's content sit inside it. A page can then push its own label
 * upwards — something a provider rendered inside `<main>` could never do,
 * because React context only flows down.
 */
export interface HeaderOverride {
  /** Replaces the header's page title. */
  title?: string;
  /** Replaces the label of the final breadcrumb segment. */
  crumbLabel?: string;
}

interface HeaderContextValue extends HeaderOverride {
  setOverride: (override: HeaderOverride) => void;
}

export const HeaderContext = createContext<HeaderContextValue>({
  setOverride: () => {},
});

export function useHeaderOverride() {
  return useContext(HeaderContext);
}
