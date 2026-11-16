"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { useData } from "@/components/providers/data-provider";
import { EmptyState } from "@/components/shared/empty-state";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toErrorMessage } from "@/lib/errors";
import { formatIDRPrecise, todayLocalISO } from "@/lib/format";
import {
  EMPTY_MAPPING,
  IMPORT_FIELDS,
  classifyImportMatrix,
  columnLetter,
  detectHeaderRow,
  detectWorkbookMetadata,
  mapColumns,
  parseWorkbookFile,
  resolveHeader,
  type ColumnMapping,
  type ImportFieldKey,
  type ImportOverrides,
  type ImportPlan,
  type ImportRowKind,
  type ParsedWorkbook,
} from "@/lib/excel-import";

type Step = 1 | 2 | 3;

const MAX_IMPORT_ROWS = 1000;

/** Pilihan koreksi klasifikasi untuk baris ambigu. */
const KIND_OPTIONS = [
  { value: "auto", label: "Otomatis" },
  { value: "group", label: "Group" },
  { value: "subgroup", label: "Subgroup" },
  { value: "item_group", label: "Item group" },
  { value: "item", label: "Item" },
  { value: "note", label: "Catatan (skip)" },
];

/** Label cakupan pembanding subtotal. */
const SCOPE_LABEL: Record<"block" | "section" | "document", string> = {
  block: "blok",
  section: "seksi",
  document: "dokumen",
};

/**
 * Wizard import Excel: pilih berkas & proyek → pilih sheet, baris header, dan
 * pemetaan kolom → periksa ringkasan validasi → impor sebagai dokumen RAB baru.
 *
 * Komponen ini hanya di-mount saat dialog dibuka, sehingga state selalu bersih.
 */
export function ImportExcelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { projects, importDocument } = useData();

  const [step, setStep] = useState<Step>(1);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [overrides, setOverrides] = useState<ImportOverrides>({});
  const [metadata, setMetadata] = useState<
    ReturnType<typeof detectWorkbookMetadata> | null
  >(null);
  const [importing, setImporting] = useState(false);

  const matrix = useMemo(
    () => parsed?.sheets[sheetName] ?? [],
    [parsed, sheetName],
  );

  const headerInfo = useMemo(
    () => resolveHeader(matrix, Math.max(headerRow - 1, 0)),
    [matrix, headerRow],
  );

  const mappingComplete =
    mapping.description !== null && mapping.volume !== null && mapping.unitPrice !== null;

  const plan = useMemo<ImportPlan | null>(() => {
    if (!mappingComplete) return null;
    return classifyImportMatrix(matrix, mapping, headerRow - 1, {
      maxRows: MAX_IMPORT_ROWS,
      overrides,
    });
  }, [matrix, mapping, headerRow, overrides, mappingComplete]);

  const columnCount = useMemo(() => {
    const scan = matrix.slice(0, Math.max(headerRow, 1) + 5);
    return scan.reduce(
      (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
      0,
    );
  }, [matrix, headerRow]);

  const columnOptions = useMemo(() => {
    const header = headerInfo.labels;
    return Array.from({ length: columnCount }, (_, index) => {
      const label = String(header[index] ?? "").trim();
      return {
        value: String(index),
        label: `${columnLetter(index)}${label ? ` — ${label.slice(0, 24)}` : " — (kosong)"}`,
      };
    });
  }, [headerInfo, columnCount]);

  const previewRows = useMemo(() => {
    const rows: { rowNumber: number; values: unknown[] }[] = [];
    const start = headerRow - 1 + (headerInfo.usesSecondRow ? 2 : 1);
    for (let index = start; index < matrix.length && rows.length < 5; index += 1) {
      const row = matrix[index] ?? [];
      if (row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "")) {
        continue;
      }
      rows.push({ rowNumber: index + 1, values: row });
    }
    return rows;
  }, [matrix, headerRow, headerInfo]);

  if (!open) return null;

  const hasProject = projects.length > 0;

  async function handleFileChange(selected: File | null) {
    setFile(selected);
    setFileError(null);
    setParsed(null);
    setOverrides({});
    setMetadata(null);
    setStep(1);

    if (!selected) return;

    setParsing(true);

    try {
      const result = await parseWorkbookFile(selected);
      const firstSheet = result.sheetNames[0];
      const firstMatrix = result.sheets[firstSheet] ?? [];
      const headerIndex = detectHeaderRow(firstMatrix);

      setParsed(result);
      setSheetName(firstSheet);
      setHeaderRow(headerIndex + 1);
      setMapping(mapColumns(resolveHeader(firstMatrix, headerIndex).labels));
      setMetadata(detectWorkbookMetadata(firstMatrix, headerIndex));

      if (!title.trim()) {
        setTitle(selected.name.replace(/\.[^.]+$/, "").slice(0, 100));
      }
    } catch (caught) {
      setFileError(toErrorMessage(caught));
    } finally {
      setParsing(false);
    }
  }

  function applySheet(name: string) {
    const nextMatrix = parsed?.sheets[name] ?? [];
    const headerIndex = detectHeaderRow(nextMatrix);

    setSheetName(name);
    setHeaderRow(headerIndex + 1);
    setMapping(mapColumns(resolveHeader(nextMatrix, headerIndex).labels));
    setMetadata(detectWorkbookMetadata(nextMatrix, headerIndex));
    setOverrides({});
  }

  function applyHeaderRow(value: number) {
    const safe = Math.max(
      1,
      Math.min(Number.isFinite(value) ? Math.floor(value) : 1, Math.max(matrix.length, 1)),
    );

    setHeaderRow(safe);
    setMapping(mapColumns(resolveHeader(matrix, safe - 1).labels));
    setOverrides({});
  }

  function setFieldMapping(field: ImportFieldKey, value: string) {
    setMapping((current) => ({
      ...current,
      [field]: value === "" ? null : Number(value),
    }));
    setOverrides({});
  }

  /** Koreksi manual klasifikasi satu baris (dari daftar baris ambigu). */
  function setRowKind(rowNumber: number, kind: string) {
    setOverrides((current) => {
      const next = { ...current };
      if (kind === "auto") {
        delete next[rowNumber];
      } else {
        next[rowNumber] = kind as ImportRowKind | "skip";
      }
      return next;
    });
  }

  function handleReview() {
    if (!plan || plan.items.length === 0) return;
    setStep(3);
  }

  async function handleImport() {
    if (!plan || plan.items.length === 0) return;

    setImporting(true);

    try {
      const document = await importDocument({
        projectId,
        title: title.trim() || "RAB Import",
        date: todayLocalISO(),
        items: plan.items.map((row) => ({
          description: row.description,
          volume: row.volume ?? 0,
          unit: row.unit,
          unitPrice: row.unitPrice ?? 0,
          groupName: row.groupName ?? undefined,
          subgroupName: row.subgroupName ?? undefined,
          itemGroupName: row.itemGroupName ?? undefined,
          sortOrder: row.sortOrder,
        })),
      });

      toast.success("Import Excel selesai", {
        description: `${plan.items.length} item masuk ke "${document.title}".`,
      });
      onOpenChange(false);
      router.push(`/rab/${document.id}`);
    } catch (caught) {
      toast.error("Import gagal", { description: toErrorMessage(caught) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Excel</DialogTitle>
          <DialogDescription>
            Impor daftar pekerjaan dari berkas Excel menjadi dokumen RAB baru.
            Dokumen yang sudah ada tidak akan diubah.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-4 pb-5">
          <p className="mb-4 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Langkah {step} dari 3
          </p>

          {!hasProject ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="Belum ada proyek"
              description="Setiap dokumen RAB harus terhubung ke proyek. Buat proyek dulu, lalu impor Excel ke proyek tersebut."
              compact
              action={
                <ButtonLink href="/projects" variant="secondary" size="sm">
                  Ke halaman Projects
                </ButtonLink>
              }
            />
          ) : step === 1 ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="import-project">Proyek tujuan</Label>
                <Select
                  items={projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  }))}
                  value={projectId}
                  onValueChange={(value) => setProjectId((value as string) ?? "")}
                >
                  <SelectTrigger id="import-project">
                    <SelectValue placeholder="Pilih proyek" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Dokumen RAB baru akan dibuat di proyek ini.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="import-file">Berkas Excel</Label>
                <label
                  htmlFor="import-file"
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong bg-background/60 px-3 py-3 text-[13px] transition-colors hover:border-primary"
                >
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <Upload className="size-4 shrink-0" />
                    <span className="truncate">
                      {parsing
                        ? "Membaca berkas…"
                        : file
                          ? file.name
                          : "Pilih berkas .xlsx atau .xls"}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground">
                    Pilih
                  </span>
                  <input
                    id="import-file"
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="sr-only"
                    disabled={parsing}
                    onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Maksimal 5 MB. Format .xlsx atau .xls.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="import-title">Nama dokumen RAB</Label>
                <Input
                  id="import-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Contoh: RAB Renovasi Rumah"
                  disabled={parsing}
                />
              </div>

              {metadata?.project || metadata?.location ? (
                <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                  <p>
                    Terdeteksi di workbook:
                    {metadata?.project ? (
                      <>
                        {" "}proyek{" "}
                        <span className="font-medium text-foreground">
                          &ldquo;{metadata.project}&rdquo;
                        </span>
                      </>
                    ) : null}
                    {metadata?.location ? (
                      <>
                        {" "}· lokasi{" "}
                        <span className="font-medium text-foreground">
                          &ldquo;{metadata.location}&rdquo;
                        </span>
                      </>
                    ) : null}
                  </p>
                  {metadata?.project ? (
                    <button
                      type="button"
                      onClick={() =>
                        setTitle((metadata.project ?? "").slice(0, 100))
                      }
                      className="mt-1 text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Pakai sebagai judul dokumen
                    </button>
                  ) : null}
                  <p className="mt-1 text-[11px]">
                    Nama proyek aplikasi tidak diubah otomatis.
                  </p>
                </div>
              ) : null}

              {fileError ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {fileError}
                </p>
              ) : null}
            </div>
          ) : step === 2 ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="import-sheet">Sheet</Label>
                  <Select
                    items={(parsed?.sheetNames ?? []).map((name) => ({
                      value: name,
                      label: name,
                    }))}
                    value={sheetName}
                    onValueChange={(value) => applySheet((value as string) ?? sheetName)}
                  >
                    <SelectTrigger id="import-sheet">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(parsed?.sheetNames ?? []).map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="import-header">Baris header</Label>
                  <Input
                    id="import-header"
                    type="number"
                    min={1}
                    value={headerRow}
                    onChange={(event) => applyHeaderRow(Number(event.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Baris judul di atas tabel tidak ikut diimpor.
                  </p>
                  {headerInfo.usesSecondRow ? (
                    <p className="text-xs text-muted-foreground">
                      Header dua baris terdeteksi dan digabungkan otomatis.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-border">
                <p className="border-b border-border bg-background/60 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Pemetaan kolom
                </p>
                <div className="grid gap-2 p-3">
                  {IMPORT_FIELDS.map((field) => (
                    <div
                      key={field.key}
                      className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="w-40 shrink-0 text-[13px] font-medium text-foreground">
                        {field.label}
                        {field.required ? (
                          <span className="ml-1 text-danger">*</span>
                        ) : null}
                      </span>
                      <Select
                        items={[
                          { value: "", label: "— Tidak dipakai" },
                          ...columnOptions,
                        ]}
                        value={mapping[field.key] === null ? "" : String(mapping[field.key])}
                        onValueChange={(value) =>
                          setFieldMapping(field.key, (value as string) ?? "")
                        }
                      >
                        <SelectTrigger className="w-full sm:flex-1" aria-label={field.label}>
                          <SelectValue placeholder="Pilih kolom" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">— Tidak dipakai</SelectItem>
                          {columnOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border">
                <p className="border-b border-border bg-background/60 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Pratinjau 5 baris pertama
                </p>
                <div className="max-h-56 overflow-auto">
                  <table className="w-full min-w-[520px] text-[12px]">
                    <thead className="bg-background/40">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          Baris
                        </th>
                        {IMPORT_FIELDS.filter(
                          (field) => mapping[field.key] !== null,
                        ).map((field) => (
                          <th
                            key={field.key}
                            className="px-2 py-1.5 text-left font-medium text-muted-foreground"
                          >
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-3 text-center text-muted-foreground"
                          >
                            Tidak ada baris data setelah header.
                          </td>
                        </tr>
                      ) : (
                        previewRows.map((row) => (
                          <tr key={row.rowNumber} className="border-t border-border">
                            <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                              {row.rowNumber}
                            </td>
                            {IMPORT_FIELDS.filter(
                              (field) => mapping[field.key] !== null,
                            ).map((field) => (
                              <td
                                key={field.key}
                                className="max-w-[180px] truncate px-2 py-1.5 text-foreground"
                              >
                                {String(row.values[mapping[field.key] as number] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {!mappingComplete ? (
                <p className="flex items-start gap-2 text-[13px] text-warning">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  Kolom Uraian, Volume, dan Harga Satuan wajib dipetakan.
                </p>
              ) : null}
            </div>
          ) : plan ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryStat label="Item valid" value={plan.items.length} tone="positive" />
                <SummaryStat
                  label="Kelompok (G/S/IG)"
                  value={`${plan.counts.group}/${plan.counts.subgroup}/${plan.counts.item_group}`}
                />
                <SummaryStat
                  label="Perlu perhatian"
                  value={plan.problems.length + plan.ambiguous.length}
                  tone={
                    plan.problems.length + plan.ambiguous.length > 0 ? "negative" : undefined
                  }
                />
                <SummaryStat label="Dilewati" value={plan.skipped.length} />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2.5">
                <span className="text-[13px] text-muted-foreground">Total nilai item</span>
                <span className="text-[15px] font-semibold text-foreground tabular-nums">
                  {formatIDRPrecise(plan.total)}
                </span>
              </div>

              {plan.truncated ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-[13px] text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Hanya {MAX_IMPORT_ROWS} item pertama yang diproses. Pecah berkas
                  menjadi beberapa bagian bila perlu.
                </p>
              ) : null}

              {plan.structure.length > 0 ? (
                <div className="rounded-lg border border-border">
                  <p className="border-b border-border bg-background/60 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Struktur terbaca
                  </p>
                  <ul className="max-h-48 overflow-y-auto px-3 py-2 text-[13px]">
                    {plan.structure.slice(0, 40).map((node, index) => (
                      <li
                        key={`${node.level}-${node.label}-${index}`}
                        className="flex items-center justify-between gap-3 py-0.5"
                        style={{ paddingLeft: (node.level - 1) * 14 }}
                      >
                        <span className="truncate text-foreground">{node.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {node.itemCount} item · {formatIDRPrecise(node.subtotal)}
                        </span>
                      </li>
                    ))}
                    {plan.structure.length > 40 ? (
                      <li className="py-0.5 text-muted-foreground">
                        +{plan.structure.length - 40} bagian lainnya
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {plan.ambiguous.length > 0 ? (
                <div className="rounded-lg border border-warning-border bg-warning-soft">
                  <p className="border-b border-warning-border px-3 py-2 text-[11px] font-medium tracking-wide text-warning uppercase">
                    Baris ambigu — periksa klasifikasinya
                  </p>
                  <ul className="max-h-48 divide-y divide-amber-200/60 overflow-y-auto">
                    {plan.ambiguous.slice(0, 10).map((row) => (
                      <li
                        key={row.rowNumber}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 text-[13px] text-warning">
                          <span className="font-medium">Baris {row.rowNumber}:</span>{" "}
                          {[row.code, row.description].filter(Boolean).join(" ")}
                        </span>
                        <Select
                          items={KIND_OPTIONS}
                          value={overrides[row.rowNumber] ?? "auto"}
                          onValueChange={(value) =>
                            setRowKind(row.rowNumber, (value as string) ?? "auto")
                          }
                        >
                          <SelectTrigger
                            className="w-36"
                            aria-label={`Klasifikasi baris ${row.rowNumber}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {KIND_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </li>
                    ))}
                    {plan.ambiguous.length > 10 ? (
                      <li className="px-3 py-2 text-[13px] text-muted-foreground">
                        +{plan.ambiguous.length - 10} baris lainnya — rapikan di Excel
                        bila perlu, atau biarkan sebagai judul tanpa item.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {plan.subtotalChecks.some(
                (check) => check.difference !== null && Math.abs(check.difference) > 0.5,
              ) ? (
                <div className="rounded-lg border border-warning-border bg-warning-soft">
                  <p className="border-b border-warning-border px-3 py-2 text-[11px] font-medium tracking-wide text-warning uppercase">
                    Subtotal di file berbeda dari hitungan
                  </p>
                  <ul className="max-h-32 overflow-y-auto px-3 py-2 text-[13px] text-warning">
                    {plan.subtotalChecks
                      .filter(
                        (check) =>
                          check.difference !== null && Math.abs(check.difference) > 0.5,
                      )
                      .slice(0, 10)
                      .map((check) => (
                        <li key={check.rowNumber} className="py-0.5">
                          <span className="font-medium">Baris {check.rowNumber}:</span>{" "}
                          {check.label} — file {formatIDRPrecise(check.fileValue ?? 0)}, hitungan{" "}
                          {formatIDRPrecise(check.computedValue)} ({SCOPE_LABEL[check.scope]})
                        </li>
                      ))}
                  </ul>
                  <p className="border-t border-warning-border px-3 py-2 text-xs text-warning">
                    Subtotal dan total tidak diimpor sebagai item; nilai dokumen dihitung
                    dari item.
                  </p>
                </div>
              ) : null}

              {plan.problems.length > 0 ? (
                <div className="rounded-lg border border-danger-border bg-danger-soft">
                  <p className="border-b border-danger-border px-3 py-2 text-[11px] font-medium tracking-wide text-danger uppercase">
                    Baris bermasalah (tidak diimpor)
                  </p>
                  <ul className="max-h-40 overflow-y-auto px-3 py-2 text-[13px] text-danger">
                    {plan.problems.slice(0, 20).map((problem) => (
                      <li key={problem.rowNumber} className="py-0.5">
                        <span className="font-medium">Baris {problem.rowNumber}:</span>{" "}
                        {problem.reasons.join("; ")}
                      </li>
                    ))}
                    {plan.problems.length > 20 ? (
                      <li className="py-0.5 text-muted-foreground">
                        +{plan.problems.length - 20} baris lainnya
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {plan.notes.length > 0 ? (
                <div className="rounded-lg border border-border bg-background/40">
                  <p className="border-b border-border px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Catatan
                  </p>
                  <ul className="max-h-32 overflow-y-auto px-3 py-2 text-[13px] text-muted-foreground">
                    {plan.notes.slice(0, 10).map((note, index) => (
                      <li key={`${note.rowNumber}-${index}`} className="py-0.5">
                        {note.rowNumber > 0 ? `Baris ${note.rowNumber}: ` : ""}
                        {note.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {plan.items.length > 0 ? (
                <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {plan.items.length} item siap diimpor ke dokumen baru
                  {title.trim() ? ` "${title.trim()}"` : ""}. Total dihitung dari item.
                </p>
              ) : (
                <p className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Tidak ada item valid. Periksa pemetaan kolom atau isi berkas.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Batal
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!parsed || parsing || !projectId}
              >
                Lanjut
              </Button>
            </>
          ) : step === 2 ? (
            <>
              <Button variant="secondary" onClick={() => setStep(1)}>
                Kembali
              </Button>
              <Button
                onClick={handleReview}
                disabled={!mappingComplete || !plan || plan.items.length === 0}
              >
                Periksa Data
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setStep(2)} disabled={importing}>
                Kembali
              </Button>
              <Button
                onClick={() => void handleImport()}
                disabled={importing || (plan?.items.length ?? 0) === 0}
              >
                {importing ? "Mengimpor…" : `Impor ${plan?.items.length ?? 0} Item`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "positive"
            ? "text-success"
            : tone === "negative"
              ? "text-danger"
              : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
