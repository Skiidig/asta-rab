"use client";

import { useCallback, useEffect, useState } from "react";

import type { CatalogItemInput } from "@/lib/catalog";
import { toErrorMessage } from "@/lib/errors";
import {
  createCatalogItemRecord,
  deleteCatalogItemRecord,
  fetchCatalogItems,
  updateCatalogItemRecord,
} from "@/lib/supabase/catalog";
import type { CatalogItem } from "@/types";

export type CatalogStatus = "loading" | "ready" | "error";

function sortByName(items: CatalogItem[]) {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, "id", { sensitivity: "base" }),
  );
}

/**
 * State katalog harga untuk satu layar.
 *
 * Dimuat saat komponen dipasang (halaman katalog atau dialog pemilih), dan
 * setiap mutasi menulis ke Supabase lebih dulu baru memperbarui state. RLS
 * memastikan hanya katalog milik pengguna yang masuk.
 */
export function useCatalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchCatalogItems();
      setItems(data);
      setStatus("ready");
      setError(null);
    } catch (caught) {
      setStatus("error");
      setError(toErrorMessage(caught, "Gagal memuat katalog harga."));
    }
  }, []);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    await load();
  }, [load]);

  useEffect(() => {
    // Dijadwalkan di luar body effect agar tidak memicu cascading render
    // (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const createItem = useCallback(async (input: CatalogItemInput) => {
    const created = await createCatalogItemRecord(input);
    setItems((current) => sortByName([...current, created]));
    return created;
  }, []);

  const updateItem = useCallback(async (id: string, input: CatalogItemInput) => {
    const updated = await updateCatalogItemRecord(id, input);
    setItems((current) =>
      sortByName(current.map((item) => (item.id === id ? updated : item))),
    );
    return updated;
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    await deleteCatalogItemRecord(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return { items, status, error, refresh, createItem, updateItem, deleteItem };
}
