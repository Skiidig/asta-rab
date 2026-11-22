"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Loader2,
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
import { cn } from "@/lib/utils";
import {
  DEFAULT_NUMBER_FORMAT_CONFIG,
  EMPTY_MAPPING,
  IMPORT_FIELDS,
  classifyImportMatrix,
  columnLetter,
  detectHeaderRow,
  detectWorkbookMetadata,
  evaluateImportGuard,
  hasSubtotalWarning,
  inspectSpreadsheetNumber,
  isUnreadableSubtotalCheck,
  mapColumns,
  numberFormatForField,
  parseWorkbookFile,
  resolveHeader,
  type ColumnMapping,
  type ImportFieldKey,
  type ImportOverrides,
  type ImportPlan,
  type ImportRowKind,
  type NumberFormatConfig,
  type NumberFormatMode,
  type NumericFieldRole,
  type ParsedWorkbook,
  type SubtotalCheck,
} from "@/lib/excel-import";

type Step = 1 | 2 | 3;

const MAX_IMPORT_ROWS = 1000;

const VOLUME_FORMAT_OPTIONS: { value: NumberFormatMode; label: string }[] = [
  { value: "auto", label: "Otomatis (ketat)" },
  { value: "id-ID", label: "Indonesia (koma desimal, mis. 1,500 = 1,5)" },
  { value: "en-US", label: "Internasional (titik desimal, mis. 1.500 = 1,5)" },
];

const MONEY_FORMAT_OPTIONS: { value: NumberFormatMode; label: string }[] = [
  { value: "auto", label: "Otomatis (ketat)" },
  { value: "id-ID", label: "Indonesia (titik ribuan, mis. 150.000)" },
  { value: "en-US", label: "Internasional (koma ribuan, mis. 150,000)" },
];

const PREVIEW_NUMBER_FORMATTER = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 6,
});

const NUMERIC_PREVIEW_FIELDS = new Set<ImportFieldKey>([
  "volume",
  "unitPrice",
  "amount",
]);

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
  const [numberFormats, setNumberFormats] = useState<NumberFormatConfig>(
    DEFAULT_NUMBER_FORMAT_CONFIG,
  );
  const [overrides, setOverrides] = useState<ImportOverrides>({});
  const [confirmPartialImport, setConfirmPartialImport] = useState(false);
  const [showAllProblems, setShowAllProblems] = useState(false);
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
      numberFormat: numberFormats,
    });
  }, [matrix, mapping, headerRow, overrides, mappingComplete, numberFormats]);

  const guard = useMemo(
    () => evaluateImportGuard(plan, confirmPartialImport),
    [plan, confirmPartialImport],
  );

  const subtotalWarnings = useMemo(
    () => (plan ? plan.subtotalChecks.filter(hasSubtotalWarning) : []),
    [plan],
  );

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
    setNumberFormats(DEFAULT_NUMBER_FORMAT_CONFIG);
    setOverrides({});
    setConfirmPartialImport(false);
    setShowAllProblems(false);
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
    setConfirmPartialImport(false);
    setShowAllProblems(false);
  }

  function applyHeaderRow(value: number) {
    const safe = Math.max(
      1,
      Math.min(Number.isFinite(value) ? Math.floor(value) : 1, Math.max(matrix.length, 1)),
    );

    setHeaderRow(safe);
    setMapping(mapColumns(resolveHeader(matrix, safe - 1).labels));
    setOverrides({});
    setConfirmPartialImport(false);
    setShowAllProblems(false);
  }

  function setFieldMapping(field: ImportFieldKey, value: string) {
    setMapping((current) => ({
      ...current,
      [field]: value === "" ? null : Number(value),
    }));
    setOverrides({});
    setConfirmPartialImport(false);
    setShowAllProblems(false);
  }

  function applyFieldNumberFormat(role: NumericFieldRole, mode: NumberFormatMode) {
    setNumberFormats((current) => ({ ...current, [role]: mode }));
    setConfirmPartialImport(false);
    setShowAllProblems(false);
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
    setConfirmPartialImport(false);
  }

  function handleReview() {
    if (!mappingComplete || !guard.canReview) return;
    setConfirmPartialImport(false);
    setShowAllProblems(false);
    setStep(3);
  }

  async function handleImport() {
    if (!plan || !guard.canImport) return;

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
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden"
        aria-busy={parsing || importing || undefined}
      >
        <DialogHeader className="shrink-0 border-b border-border pb-3">
          <DialogTitle>Import Excel</DialogTitle>
          <DialogDescription>
            Impor daftar pekerjaan dari berkas Excel menjadi dokumen RAB baru.
            Dokumen yang sudah ada tidak akan diubah.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex flex-1 gap-1.5" aria-hidden>
              {[1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    index <= step ? "bg-primary" : "bg-border",
                  )}
                />
              ))}
            </div>
            <p
              className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              aria-current="step"
            >
              Langkah {step} dari 3
            </p>
          </div>

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
                    {parsing ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="size-4 shrink-0" />
                    )}
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

              <div className="grid gap-2.5 rounded-lg border border-border bg-background/40 p-3">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Format angka teks (opsional, terpisah per kolom)
                </p>
                <NumberFormatSelectors
                  idPrefix="import-step2"
                  formats={numberFormats}
                  onChange={applyFieldNumberFormat}
                />
                <p className="text-xs text-muted-foreground">
                  Hanya berlaku untuk sel teks; sel angka Excel selalu dibaca sesuai
                  nilainya. Volume dan Harga/Jumlah dapat memakai konvensi berbeda (mis.
                  Volume &ldquo;1.500&rdquo; = 1,5 dan Harga &ldquo;150.000&rdquo; =
                  150.000). Mode &ldquo;Otomatis (ketat)&rdquo; tidak pernah menebak teks
                  ambigu.
                </p>
              </div>

              <div className="rounded-lg border border-border">
                <p className="border-b border-border bg-background/60 px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Pratinjau 5 baris pertama
                </p>
                <div className="max-h-56 overflow-auto">
                  <table className="w-full min-w-[520px] text-[12px]">
                    <caption className="sr-only">
                      Pratinjau lima baris pertama hasil pemetaan kolom
                    </caption>
                    <thead className="bg-background/40">
                      <tr>
                        <th
                          scope="col"
                          className="px-2 py-1.5 text-left font-medium text-muted-foreground"
                        >
                          Baris
                        </th>
                        {IMPORT_FIELDS.filter(
                          (field) => mapping[field.key] !== null,
                        ).map((field) => (
                          <th
                            key={field.key}
                            scope="col"
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
                                <PreviewCell
                                  field={field.key}
                                  value={row.values[mapping[field.key] as number]}
                                  numberFormat={numberFormatForField(
                                    field.key,
                                    numberFormats,
                                  )}
                                />
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
              ) : plan && plan.problems.length > 0 ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-[13px] text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Terdeteksi {plan.items.length} item valid dan {plan.problems.length}{" "}
                  baris bermasalah. Lanjut ke &ldquo;Periksa Data&rdquo; untuk melihat
                  rincian validasi.
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
                  value={
                    plan.problems.length +
                    plan.ambiguous.length +
                    plan.unreadableSubtotalCount
                  }
                  tone={
                    plan.problems.length +
                      plan.ambiguous.length +
                      plan.unreadableSubtotalCount >
                    0
                      ? "negative"
                      : undefined
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

              {plan.ambiguousNumberCount > 0 ||
              numberFormats.volume !== "auto" ||
              numberFormats.money !== "auto" ? (
                <div className="grid gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-3 py-2.5">
                  <p className="text-[11px] font-medium tracking-wide text-warning uppercase">
                    Format angka teks (Volume vs Harga &amp; Jumlah)
                  </p>
                  <NumberFormatSelectors
                    idPrefix="import-review"
                    formats={numberFormats}
                    onChange={applyFieldNumberFormat}
                    tone="warning"
                  />
                  <p className="text-xs text-warning">
                    {plan.ambiguousNumberCount > 0
                      ? `Terdeteksi angka teks ambigu (${plan.ambiguousVolumeCount} kolom Volume, ${plan.ambiguousMoneyCount} kolom Harga/Jumlah/Subtotal). Pilih format yang sesuai per kolom secara eksplisit, atau ubah sel tersebut menjadi angka di Excel. Sel angka Excel tidak terpengaruh.`
                      : "Format angka teks diterapkan terpisah hanya pada sel teks; sel angka Excel tetap dibaca sesuai nilainya."}
                  </p>
                </div>
              ) : null}

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
                  <ul className="max-h-48 divide-y divide-warning-border/60 overflow-y-auto">
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

              {subtotalWarnings.length > 0 ? (
                <div className="rounded-lg border border-warning-border bg-warning-soft">
                  <p className="border-b border-warning-border px-3 py-2 text-[11px] font-medium tracking-wide text-warning uppercase">
                    Peringatan subtotal / total di file ({subtotalWarnings.length})
                  </p>
                  <ul className="max-h-40 overflow-y-auto px-3 py-2 text-[13px] text-warning">
                    {subtotalWarnings.slice(0, 15).map((check) => (
                      <SubtotalWarningItem key={check.rowNumber} check={check} />
                    ))}
                    {subtotalWarnings.length > 15 ? (
                      <li className="py-0.5 text-muted-foreground">
                        +{subtotalWarnings.length - 15} baris subtotal/total lainnya
                      </li>
                    ) : null}
                  </ul>
                  <p className="border-t border-warning-border px-3 py-2 text-xs text-warning">
                    Subtotal dan total tidak diimpor sebagai item; nilai dokumen dihitung
                    dari item. Nilai moneter yang ambigu atau tidak terbaca tetap
                    ditampilkan di sini agar dapat diverifikasi.
                  </p>
                </div>
              ) : null}

              {plan.problems.length > 0 ? (
                <div className="rounded-lg border border-danger-border bg-danger-soft">
                  <div className="flex items-center justify-between gap-2 border-b border-danger-border px-3 py-2">
                    <p className="text-[11px] font-medium tracking-wide text-danger uppercase">
                      Baris bermasalah — tidak diimpor ({plan.problems.length} baris)
                    </p>
                    {plan.problems.length > 20 ? (
                      <button
                        type="button"
                        onClick={() => setShowAllProblems((current) => !current)}
                        className="text-xs font-medium text-danger underline-offset-2 hover:underline"
                      >
                        {showAllProblems
                          ? "Ringkas (20 baris)"
                          : `Tampilkan semua (${plan.problems.length})`}
                      </button>
                    ) : null}
                  </div>
                  <ul className="max-h-56 overflow-y-auto px-3 py-2 text-[13px] text-danger">
                    {(showAllProblems ? plan.problems : plan.problems.slice(0, 20)).map(
                      (problem) => (
                        <li key={problem.rowNumber} className="py-0.5">
                          <span className="font-medium">Baris {problem.rowNumber}</span>
                          {problem.description ? (
                            <span className="text-danger/90">
                              {" "}
                              ({problem.description.slice(0, 60)})
                            </span>
                          ) : null}
                          : {problem.reasons.join("; ")}
                        </li>
                      ),
                    )}
                    {!showAllProblems && plan.problems.length > 20 ? (
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

              {guard.requiresPartialConfirmation ? (
                <div className="grid gap-2 rounded-lg border border-warning-border bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
                  <p className="flex items-start gap-2 font-medium">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    Impor parsial: {guard.problemRowCount} baris bermasalah akan
                    dilewati dan tidak masuk ke RAB. Hanya {guard.validItemCount} item
                    valid yang akan diimpor.
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={confirmPartialImport}
                      onChange={(event) => setConfirmPartialImport(event.target.checked)}
                      className="mt-0.5 size-4 rounded border-border accent-primary"
                    />
                    <span>
                      Saya sudah memeriksa daftar baris bermasalah dan ingin tetap
                      mengimpor {guard.validItemCount} item valid saja (
                      {guard.problemRowCount} baris bermasalah dilewati).
                    </span>
                  </label>
                </div>
              ) : plan.items.length > 0 ? (
                <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  {plan.items.length} item siap diimpor ke dokumen baru
                  {title.trim() ? ` "${title.trim()}"` : ""}. Total dihitung dari item.
                </p>
              ) : (
                <p className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Tidak ada item valid untuk diimpor. Periksa baris bermasalah di atas,
                  format angka teks, atau pemetaan kolom.
                </p>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
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
                disabled={!mappingComplete || !guard.canReview}
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
                disabled={importing || !guard.canImport}
              >
                {importing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Mengimpor…
                  </>
                ) : (
                  `Impor ${plan?.items.length ?? 0} Item`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberFormatSelectors({
  idPrefix,
  formats,
  onChange,
  tone,
}: {
  idPrefix: string;
  formats: NumberFormatConfig;
  onChange: (role: NumericFieldRole, mode: NumberFormatMode) => void;
  tone?: "warning";
}) {
  const labelClass = tone === "warning" ? "text-[12px] text-warning" : "text-[12px]";
  const triggerClass = tone === "warning" ? "w-full bg-surface" : "w-full";

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}-volume-format`} className={labelClass}>
          Volume
        </Label>
        <Select
          items={VOLUME_FORMAT_OPTIONS}
          value={formats.volume}
          onValueChange={(value) =>
            onChange("volume", (value as NumberFormatMode) ?? "auto")
          }
        >
          <SelectTrigger id={`${idPrefix}-volume-format`} className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOLUME_FORMAT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1">
        <Label htmlFor={`${idPrefix}-money-format`} className={labelClass}>
          Harga &amp; Jumlah
        </Label>
        <Select
          items={MONEY_FORMAT_OPTIONS}
          value={formats.money}
          onValueChange={(value) =>
            onChange("money", (value as NumberFormatMode) ?? "auto")
          }
        >
          <SelectTrigger id={`${idPrefix}-money-format`} className={triggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONEY_FORMAT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function SubtotalWarningItem({ check }: { check: SubtotalCheck }) {
  if (isUnreadableSubtotalCheck(check)) {
    const detail =
      check.fileStatus === "ambiguous"
        ? `nilai file "${check.fileRaw}" ambigu — pilih Format angka Harga & Jumlah`
        : check.fileStatus === "negative"
          ? `nilai file negatif ("${check.fileRaw}")`
          : `nilai file "${check.fileRaw}" tidak valid`;

    return (
      <li className="py-0.5">
        <span className="font-medium">Baris {check.rowNumber}:</span> {check.label} —{" "}
        {detail}; hitungan {formatIDRPrecise(check.computedValue)} (
        {SCOPE_LABEL[check.scope]})
      </li>
    );
  }

  return (
    <li className="py-0.5">
      <span className="font-medium">Baris {check.rowNumber}:</span> {check.label} — file{" "}
      {formatIDRPrecise(check.fileValue ?? 0)}, hitungan{" "}
      {formatIDRPrecise(check.computedValue)} ({SCOPE_LABEL[check.scope]})
    </li>
  );
}

function PreviewCell({
  field,
  value,
  numberFormat,
}: {
  field: ImportFieldKey;
  value: unknown;
  numberFormat: NumberFormatMode;
}) {
  if (!NUMERIC_PREVIEW_FIELDS.has(field)) {
    return <>{String(value ?? "")}</>;
  }

  const inspected = inspectSpreadsheetNumber(value, numberFormat);
  if (inspected.status === "empty") return null;

  if (inspected.status === "ambiguous") {
    return (
      <span className="text-danger" title="Format angka teks ambigu">
        {inspected.raw} (ambigu)
      </span>
    );
  }

  if (inspected.status === "negative") {
    return (
      <span className="text-danger" title="Nilai negatif tidak diizinkan">
        {inspected.raw} (negatif)
      </span>
    );
  }

  if (inspected.status === "invalid") {
    return (
      <span className="text-danger" title="Bukan angka yang valid">
        {inspected.raw}
      </span>
    );
  }

  if (
    typeof value === "string" &&
    inspected.value !== null &&
    /[.,]/.test(inspected.raw)
  ) {
    return (
      <span className="tabular-nums">
        {inspected.raw}{" "}
        <span className="text-muted-foreground">
          (= {PREVIEW_NUMBER_FORMATTER.format(inspected.value)})
        </span>
      </span>
    );
  }

  return (
    <span className="tabular-nums">
      {inspected.value !== null
        ? PREVIEW_NUMBER_FORMATTER.format(inspected.value)
        : inspected.raw}
    </span>
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
