"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteAhspAnalysisRecord,
  deleteAhspComponentRecord,
  fetchAhspAnalyses,
  createAhspAnalysisRecord,
  createAhspComponentRecord,
  updateAhspAnalysisRecord,
  updateAhspComponentRecord,
} from "@/lib/supabase/ahsp";
import type { AhspAnalysisInput, AhspComponentInput } from "@/lib/ahsp";
import { toErrorMessage } from "@/lib/errors";
import type { AhspAnalysisDetail, AhspComponent } from "@/types";

export type AhspStatus = "loading" | "ready" | "error";

function sortByName(items: AhspAnalysisDetail[]) {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, "id", { sensitivity: "base" }),
  );
}

/**
 * State AHSP untuk satu layar (daftar, editor, atau dialog pemilih).
 *
 * Analisis dan komponennya dimuat bersama sehingga total harga satuan bisa
 * dihitung tanpa query tambahan. Setiap mutasi menulis ke Supabase lebih dulu,
 * lalu memperbarui state lokal.
 */
export function useAhsp() {
  const [analyses, setAnalyses] = useState<AhspAnalysisDetail[]>([]);
  const [status, setStatus] = useState<AhspStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAhspAnalyses();
      setAnalyses(data);
      setStatus("ready");
      setError(null);
    } catch (caught) {
      setStatus("error");
      setError(toErrorMessage(caught, "Gagal memuat analisis AHSP."));
    }
  }, []);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    await load();
  }, [load]);

  useEffect(() => {
    // Dijadwalkan di luar body effect (aturan react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const createAnalysis = useCallback(async (input: AhspAnalysisInput) => {
    const created = await createAhspAnalysisRecord(input);
    const detail: AhspAnalysisDetail = { ...created, components: [] };
    setAnalyses((current) => sortByName([...current, detail]));
    return detail;
  }, []);

  const updateAnalysis = useCallback(
    async (id: string, input: AhspAnalysisInput) => {
      const updated = await updateAhspAnalysisRecord(id, input);
      setAnalyses((current) =>
        sortByName(
          current.map((analysis) =>
            analysis.id === id
              ? { ...analysis, ...updated, components: analysis.components }
              : analysis,
          ),
        ),
      );
      return updated;
    },
    [],
  );

  const deleteAnalysis = useCallback(async (id: string) => {
    await deleteAhspAnalysisRecord(id);
    setAnalyses((current) => current.filter((analysis) => analysis.id !== id));
  }, []);

  const addComponent = useCallback(
    async (analysisId: string, input: AhspComponentInput) => {
      const created = await createAhspComponentRecord(analysisId, input);
      setAnalyses((current) =>
        current.map((analysis) =>
          analysis.id === analysisId
            ? { ...analysis, components: [...analysis.components, created] }
            : analysis,
        ),
      );
      return created;
    },
    [],
  );

  const updateComponent = useCallback(
    async (analysisId: string, componentId: string, input: AhspComponentInput) => {
      const updated = await updateAhspComponentRecord(componentId, input);
      setAnalyses((current) =>
        current.map((analysis) =>
          analysis.id === analysisId
            ? {
                ...analysis,
                components: analysis.components.map((component) =>
                  component.id === componentId ? updated : component,
                ),
              }
            : analysis,
        ),
      );
      return updated;
    },
    [],
  );

  const removeComponent = useCallback(
    async (analysisId: string, componentId: string) => {
      await deleteAhspComponentRecord(componentId);
      setAnalyses((current) =>
        current.map((analysis) =>
          analysis.id === analysisId
            ? {
                ...analysis,
                components: analysis.components.filter(
                  (component: AhspComponent) => component.id !== componentId,
                ),
              }
            : analysis,
        ),
      );
    },
    [],
  );

  const byId = useMemo(
    () => new Map(analyses.map((analysis) => [analysis.id, analysis])),
    [analyses],
  );

  const getAnalysis = useCallback(
    (id: string) => byId.get(id),
    [byId],
  );

  return {
    analyses,
    status,
    error,
    refresh,
    getAnalysis,
    createAnalysis,
    updateAnalysis,
    deleteAnalysis,
    addComponent,
    updateComponent,
    removeComponent,
  };
}
