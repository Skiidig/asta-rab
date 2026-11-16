"use client";

import { useSyncExternalStore } from "react";

/**
 * Returns the current date, captured once after mount.
 *
 * The clock is an external, non-React value, so we read it through
 * `useSyncExternalStore`:
 *  - `getServerSnapshot` returns `null`, keeping prerendered HTML stable.
 *  - `getSnapshot` runs on the client and returns the mount time.
 *
 * Components render an absolute date (or placeholder) when `now` is `null`
 * and upgrade to relative labels once hydrated.
 */
const subscribe = () => () => {};

let mountedAt: Date | null = null;

function getSnapshot() {
  mountedAt ??= new Date();
  return mountedAt;
}

function getServerSnapshot() {
  return null;
}

export function useNow() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
