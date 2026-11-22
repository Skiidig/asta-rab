#!/usr/bin/env node
/**
 * Deterministic regression tests for the Excel import pipeline.
 *
 * Run:
 *   node --test scripts/test-excel-import.mjs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootRequire = createRequire(import.meta.url);
const ts = rootRequire(path.join(repoRoot, "node_modules/typescript"));
const XLSX = rootRequire(path.join(repoRoot, "node_modules/xlsx-js-style"));

// Transpile TypeScript modules on the fly using the installed `typescript` package
// so the test suite does not depend on Node 22.15+ `registerHooks` or native TS stripping.
const tsModuleCache = new Map();

function resolveLocalTsFile(specifier, fromDir) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = path.join(repoRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = path.resolve(fromDir, specifier);
  }
  if (!base) return null;

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && (candidate.endsWith(".ts") || candidate.endsWith(".tsx"))) {
      return candidate;
    }
  }
  return null;
}

function loadTsModule(filePath) {
  const resolved = path.resolve(filePath);
  if (tsModuleCache.has(resolved)) {
    return tsModuleCache.get(resolved).exports;
  }

  const source = readFileSync(resolved, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: resolved,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const mod = { exports: {} };
  tsModuleCache.set(resolved, mod);

  const dir = path.dirname(resolved);
  const nodeRequire = createRequire(resolved);
  const localRequire = (specifier) => {
    const localTs = resolveLocalTsFile(specifier, dir);
    if (localTs) return loadTsModule(localTs);
    return nodeRequire(specifier);
  };

  const wrapper = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${outputText}\n})`,
    { filename: resolved },
  );
  wrapper(mod.exports, localRequire, mod, resolved, dir);

  return mod.exports;
}

const excelImport = loadTsModule(path.join(repoRoot, "src/lib/excel-import.ts"));
const rabExcel = loadTsModule(path.join(repoRoot, "src/lib/rab-excel.ts"));

const {
  classifyImportMatrix,
  detectHeaderRow,
  evaluateImportGuard,
  fallbackMergedLabel,
  hasSubtotalWarning,
  inspectSpreadsheetNumber,
  isUnreadableSubtotalCheck,
  mapColumns,
  numberFormatForField,
  parseSpreadsheetNumber,
  parseWorkbookFile,
  resolveHeader,
  resolveNumberFormatConfig,
} = excelImport;

const { buildRabWorkbook } = rabExcel;

function makeMockExcelFile(workbook, name = "test.xlsx") {
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const bytes = new Uint8Array(buffer);
  return {
    name,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

test("numeric parsing policy: Excel numeric cells are independent of text locale mode", () => {
  for (const mode of ["auto", "id-ID", "en-US"]) {
    assert.deepEqual(inspectSpreadsheetNumber(1.234, mode), {
      status: "ok",
      value: 1.234,
      raw: "1.234",
    });
    assert.deepEqual(inspectSpreadsheetNumber(1234, mode), {
      status: "ok",
      value: 1234,
      raw: "1234",
    });
    assert.deepEqual(inspectSpreadsheetNumber(0, mode), {
      status: "ok",
      value: 0,
      raw: "0",
    });
    assert.deepEqual(inspectSpreadsheetNumber(-0, mode), {
      status: "ok",
      value: 0,
      raw: "0",
    });
    assert.equal(inspectSpreadsheetNumber(-5, mode).status, "negative");
    assert.equal(inspectSpreadsheetNumber(Number.NaN, mode).status, "invalid");
    assert.equal(inspectSpreadsheetNumber(Number.POSITIVE_INFINITY, mode).status, "invalid");
  }
});

test("numeric parsing policy: ambiguous 3-digit single separators are rejected in auto and resolved explicitly by locale", () => {
  for (const ambiguous of ["1,234", "1.234", "150.000", "150,000", "Rp 1.234", "Rp 150.000"]) {
    const inspected = inspectSpreadsheetNumber(ambiguous, "auto");
    assert.equal(inspected.status, "ambiguous", `expected "${ambiguous}" to be ambiguous in auto mode`);
    assert.equal(inspected.value, null);
    assert.equal(parseSpreadsheetNumber(ambiguous, "auto"), null);
  }

  // Explicit Indonesian mode: "." = thousands, "," = decimal.
  assert.equal(parseSpreadsheetNumber("1,234", "id-ID"), 1.234);
  assert.equal(parseSpreadsheetNumber("1.234", "id-ID"), 1234);
  assert.equal(parseSpreadsheetNumber("150.000", "id-ID"), 150000);
  assert.equal(parseSpreadsheetNumber("150,000", "id-ID"), 150);
  assert.equal(parseSpreadsheetNumber("Rp 1.234", "id-ID"), 1234);
  assert.equal(parseSpreadsheetNumber("Rp 150.000", "id-ID"), 150000);

  // Explicit International mode: "," = thousands, "." = decimal.
  assert.equal(parseSpreadsheetNumber("1,234", "en-US"), 1234);
  assert.equal(parseSpreadsheetNumber("1.234", "en-US"), 1.234);
  assert.equal(parseSpreadsheetNumber("150.000", "en-US"), 150);
  assert.equal(parseSpreadsheetNumber("150,000", "en-US"), 150000);
  assert.equal(parseSpreadsheetNumber("Rp 1.234", "en-US"), 1.234);
});

test("numeric parsing policy: unambiguous mixed, multi-group, decimal, and Indonesian trailing dash formats", () => {
  // Mixed thousands + decimal.
  assert.equal(parseSpreadsheetNumber("1.234,56", "auto"), 1234.56);
  assert.equal(parseSpreadsheetNumber("1.234,56", "id-ID"), 1234.56);
  assert.equal(inspectSpreadsheetNumber("1.234,56", "en-US").status, "invalid");

  assert.equal(parseSpreadsheetNumber("1,234.56", "auto"), 1234.56);
  assert.equal(parseSpreadsheetNumber("1,234.56", "en-US"), 1234.56);
  assert.equal(inspectSpreadsheetNumber("1,234.56", "id-ID").status, "invalid");

  // Multi-group thousands (regression: "1,234,567" previously parsed as 1234.567).
  assert.equal(parseSpreadsheetNumber("1.234.567", "auto"), 1234567);
  assert.equal(parseSpreadsheetNumber("1.234.567", "id-ID"), 1234567);
  assert.equal(inspectSpreadsheetNumber("1.234.567", "en-US").status, "invalid");

  assert.equal(parseSpreadsheetNumber("1,234,567", "auto"), 1234567);
  assert.equal(parseSpreadsheetNumber("1,234,567", "en-US"), 1234567);
  assert.equal(inspectSpreadsheetNumber("1,234,567", "id-ID").status, "invalid");

  // Indonesian trailing currency dash ",-".
  assert.equal(parseSpreadsheetNumber("Rp 150.000,-", "auto"), 150000);
  assert.equal(parseSpreadsheetNumber("Rp 150.000,-", "id-ID"), 150000);
  assert.equal(parseSpreadsheetNumber("150.000,-", "auto"), 150000);
  assert.equal(parseSpreadsheetNumber("1.234.567,-", "auto"), 1234567);
  assert.equal(parseSpreadsheetNumber("Rp 500,-", "auto"), 500);
  assert.equal(inspectSpreadsheetNumber("Rp 150.000,-", "en-US").status, "invalid");

  // Unambiguous decimals (non-3 fractional digits, leading zero, or 4+ integer digits).
  assert.equal(parseSpreadsheetNumber("0,234", "auto"), 0.234);
  assert.equal(parseSpreadsheetNumber("0.234", "auto"), 0.234);
  assert.equal(parseSpreadsheetNumber("0,000", "auto"), 0);
  assert.equal(parseSpreadsheetNumber("0.000", "auto"), 0);
  assert.equal(parseSpreadsheetNumber("1,23", "auto"), 1.23);
  assert.equal(parseSpreadsheetNumber("1.23", "auto"), 1.23);
  assert.equal(parseSpreadsheetNumber("1,2345", "auto"), 1.2345);
  assert.equal(parseSpreadsheetNumber("1.2345", "auto"), 1.2345);
  assert.equal(parseSpreadsheetNumber("1000,234", "auto"), 1000.234);
  assert.equal(parseSpreadsheetNumber("1000.234", "auto"), 1000.234);
});

test("numeric parsing policy: empty, negative, and invalid inputs are accurately classified", () => {
  for (const empty of [null, undefined, "", "   ", "\u00a0"]) {
    assert.equal(inspectSpreadsheetNumber(empty, "auto").status, "empty");
  }

  for (const neg of [
    -1,
    "-5",
    "-1.234,56",
    "-1,234",
    "-1.234",
    "(500)",
    "(1.234,56)",
    "Rp -150.000",
    "-Rp 150.000",
    "(Rp 150.000,-)",
  ]) {
    assert.equal(
      inspectSpreadsheetNumber(neg, "auto").status,
      "negative",
      `expected "${String(neg)}" to be negative`,
    );
    assert.equal(parseSpreadsheetNumber(neg, "auto"), null);
  }

  for (const invalid of [
    true,
    false,
    "abc",
    "abc12",
    "10 m2",
    "#DIV/0!",
    "#REF!",
    "1e3",
    "-",
    "--",
    "—",
    "1.2.3",
    "1,2,3",
    "1.23,45",
    "1,23.45",
    "123.",
    ".5",
    "Rp",
    "Supply by owner",
    "(-500)",
    "--5",
  ]) {
    assert.equal(
      inspectSpreadsheetNumber(invalid, "auto").status,
      "invalid",
      `expected "${String(invalid)}" to be invalid`,
    );
    assert.equal(parseSpreadsheetNumber(invalid, "auto"), null);
  }
});

test("row classification (P0-B): invalid and ambiguous item rows stay visible as problems and never corrupt hierarchy", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    ["I", "PEKERJAAN STRUKTUR", null, null, null, null],
    ["A.", "PEKERJAAN BETON", null, null, null, null],
    [1, "Beton Kolom (both invalid text)", "abc", "m3", "TBD", null],
    [2, "Besi Tulangan (valid after invalid text)", 10, "kg", 25000, 250000],
    [3, "Galian Tanah (both negative)", -5, "m3", -100000, null],
    [4, "Pasang Bata (valid after negative)", 20, "m2", 150000, 3000000],
    [5, "Pengecatan (invalid vol, empty price)", "N/A", "m2", "", null],
    [6, "Pintu Utama (empty vol, text price)", "", "unit", "Supply by owner", null],
    ["", "Plafon (no code, both invalid)", "abc", "m2", "xyz", null],
    [7, "Beton K-250 (ambiguous text volume)", "1,234", "m3", 1000000, 1234000],
    [8, "Keramik (missing vol and price, has unit)", "", "m2", "", null],
    [9, "Bekisting (valid at end)", 5, "m2", 100000, 500000],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  // Only the 3 truly valid rows are imported.
  assert.deepEqual(
    plan.items.map((item) => item.rowNumber),
    [5, 7, 13],
  );

  // Hierarchy of valid items must NEVER be corrupted by preceding invalid rows.
  for (const item of plan.items) {
    assert.equal(item.groupName, "I PEKERJAAN STRUKTUR");
    assert.equal(item.subgroupName, "A. PEKERJAAN BETON");
    assert.equal(item.itemGroupName, null);
  }

  // Every single invalid/ambiguous row must appear in plan.problems (never headings/notes).
  assert.deepEqual(
    plan.problems.map((problem) => problem.rowNumber),
    [4, 6, 8, 9, 10, 11, 12],
  );
  assert.equal(plan.ambiguousNumberCount, 1);
  assert.equal(plan.counts.item_group, 0);

  // Check explicit negative and ambiguous reasons.
  const negativeProblem = plan.problems.find((p) => p.rowNumber === 6);
  assert.ok(negativeProblem?.reasons.some((r) => /negatif/i.test(r)));

  const ambiguousProblem = plan.problems.find((p) => p.rowNumber === 11);
  assert.equal(ambiguousProblem?.hasAmbiguousNumber, true);
  assert.ok(ambiguousProblem?.reasons.some((r) => /ambigu/i.test(r)));
});

test("row classification (P0-B): flat sheet without groups still reports invalid rows instead of dropping to notes", () => {
  const matrix = [
    ["Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan"],
    ["Item Valid", 2, "m2", 50000],
    ["Item Salah Tanpa Kode", "abc", "", "xyz"],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  assert.equal(plan.items.length, 1);
  assert.deepEqual(
    plan.problems.map((p) => p.rowNumber),
    [3],
  );
  assert.equal(plan.counts.note, 0);
});

test("row classification: section total followed by invalid/ambiguous items does not swallow them into recap", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    ["I", "SEKSI 1", null, null, null, null],
    [1, "Item Seksi 1", 2, "m2", 100000, 200000],
    ["", "TOTAL SEKSI 1", null, null, null, 200000],
    ["II", "SEKSI 2", null, null, null, null],
    [1, "Item Seksi 2 Ambigu", "1,234", "m3", 500000, null],
    ["", "GRAND TOTAL", null, null, null, 200000],
    ["", "PPN 11%", null, null, null, 22000],
    ["", "Terbilang: dua ratus ribu", null, null, null, null],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  assert.deepEqual(
    plan.problems.map((p) => p.rowNumber),
    [6],
  );
  // Rows after GRAND TOTAL (recap) remain notes and are not misreported as problems.
  assert.equal(plan.rows.find((r) => r.rowNumber === 8)?.kind, "note");
  assert.equal(plan.rows.find((r) => r.rowNumber === 9)?.kind, "note");
});

test("contextual bare dash handling: structural headings stay headings while attempted item rows are flagged", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    ["I", "PEKERJAAN PERSIAPAN", "-", "", "-", 15000000],
    ["A.", "PEKERJAAN TANAH", "-", "-", "-", null],
    ["A.1", "Pekerjaan Galian", "", "", "-", null],
    [1, "Galian Pondasi (valid)", 10, "m3", 100000, 1000000],
    [2, "Item Opsional (dash with unit)", "-", "ls", "-", null],
    [3, "Item Dash Tanpa Unit", "-", "", "-", null],
    [4, "Item Harga Dash", 5, "m2", "-", null],
    ["", "Item Tanpa Kode Dash", "-", "", "", null],
    ["II", "Heading Dengan Satuan (invalid)", "-", "m3", "-", null],
    ["", "II. PEKERJAAN FINISHING", "-", "", "-", null],
    [5, "Pengecatan (valid)", 20, "m2", 50000, 1000000],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  // Obvious structural headings with bare dashes remain headings.
  assert.equal(plan.rows.find((r) => r.rowNumber === 2)?.kind, "group");
  assert.equal(plan.rows.find((r) => r.rowNumber === 3)?.kind, "subgroup");
  assert.equal(plan.rows.find((r) => r.rowNumber === 4)?.kind, "item_group");
  assert.equal(plan.rows.find((r) => r.rowNumber === 11)?.kind, "item_group");

  // Valid item under structural dash headings retains full hierarchy.
  const galian = plan.items.find((item) => item.rowNumber === 5);
  assert.equal(galian?.groupName, "I PEKERJAAN PERSIAPAN");
  assert.equal(galian?.subgroupName, "A. PEKERJAAN TANAH");
  assert.equal(galian?.itemGroupName, "A.1 Pekerjaan Galian");

  // Attempted item rows with dashes (or structural code with a real unit) are problems.
  assert.deepEqual(
    plan.problems.map((p) => p.rowNumber),
    [6, 7, 8, 9, 10],
  );

  // Valid items are only rows 5 and 12.
  assert.deepEqual(
    plan.items.map((item) => item.rowNumber),
    [5, 12],
  );
});

test("override to item never silently imports zero when numeric fields are missing or invalid", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan"],
    ["I", "JUDUL TANPA ITEM", null, null, null],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0, {
    overrides: { 2: "item" },
  });

  assert.equal(plan.items.length, 0);
  assert.deepEqual(
    plan.problems.map((p) => p.rowNumber),
    [2],
  );
});

test("end-to-end workbook: Excel numeric cells, ambiguous text locale switching, and formula error cells", async () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    ["I", "PEKERJAAN STRUKTUR", null, null, null, null],
    [1, "Beton Numeric Cell", 1.234, "m3", 1000000, 1234000],
    [2, "Beton Text Comma", "1,234", "m3", "Rp 150.000,-", null],
    [3, "Beton Text Dot", "1.234", "m3", 1000000, null],
    [4, "Formula Error Row 1", null, "m3", 100000, null],
    [5, "Formula Error Row 2", null, "m3", null, null],
    [6, "Item Valid Setelah Error", 2, "m3", 500000, 1000000],
  ]);

  // Inject real Excel formula error cells (including one without formatted `w`).
  ws["C6"] = { t: "e", v: 0x07, w: "#DIV/0!" };
  ws["C7"] = { t: "e", v: 0x17 };
  ws["E7"] = { t: "e", v: 0x0f, w: "#VALUE!" };
  ws["!ref"] = "A1:F8";

  XLSX.utils.book_append_sheet(wb, ws, "RAB");
  const parsed = await parseWorkbookFile(makeMockExcelFile(wb));
  const matrix = parsed.sheets["RAB"];
  const headerIdx = detectHeaderRow(matrix);
  const mapping = mapColumns(resolveHeader(matrix, headerIdx).labels);

  // Formula error cells were preserved as strings, never silently dropped to null.
  assert.equal(matrix[5][2], "#DIV/0!");
  assert.equal(matrix[6][2], "#REF!");
  assert.equal(matrix[6][4], "#VALUE!");

  // 1) Default "auto" (strict): numeric cell (row 3) + valid item (row 8) succeed;
  //    ambiguous text rows (4, 5) and formula error rows (6, 7) are problems.
  const autoPlan = classifyImportMatrix(matrix, mapping, headerIdx, {
    numberFormat: "auto",
  });
  assert.deepEqual(
    autoPlan.items.map((item) => item.rowNumber),
    [3, 8],
  );
  assert.equal(autoPlan.items[0].volume, 1.234);
  assert.equal(autoPlan.items[0].amount, 1234000);
  assert.equal(autoPlan.items[1].groupName, "I PEKERJAAN STRUKTUR");
  assert.equal(autoPlan.items[1].itemGroupName, null);
  assert.deepEqual(
    autoPlan.problems.map((p) => p.rowNumber),
    [4, 5, 6, 7],
  );
  assert.equal(autoPlan.ambiguousNumberCount, 2);

  // 2) Explicit "id-ID": "1,234" => 1.234, "Rp 150.000,-" => 150000, "1.234" => 1234;
  //    Excel numeric cell 1.234 stays 1.234; formula error rows (6, 7) remain problems.
  const idPlan = classifyImportMatrix(matrix, mapping, headerIdx, {
    numberFormat: "id-ID",
  });
  assert.deepEqual(
    idPlan.items.map((item) => item.rowNumber),
    [3, 4, 5, 8],
  );
  assert.equal(idPlan.items.find((i) => i.rowNumber === 3)?.volume, 1.234);
  assert.equal(idPlan.items.find((i) => i.rowNumber === 4)?.volume, 1.234);
  assert.equal(idPlan.items.find((i) => i.rowNumber === 4)?.unitPrice, 150000);
  assert.equal(idPlan.items.find((i) => i.rowNumber === 5)?.volume, 1234);
  assert.deepEqual(
    idPlan.problems.map((p) => p.rowNumber),
    [6, 7],
  );

  // 3) Explicit "en-US": "1.234" => 1.234; "Rp 150.000,-" rejected as invalid in en-US;
  //    Excel numeric cell 1.234 still stays 1.234!
  const enPlan = classifyImportMatrix(matrix, mapping, headerIdx, {
    numberFormat: "en-US",
  });
  assert.deepEqual(
    enPlan.items.map((item) => item.rowNumber),
    [3, 5, 8],
  );
  assert.equal(enPlan.items.find((i) => i.rowNumber === 3)?.volume, 1.234);
  assert.equal(enPlan.items.find((i) => i.rowNumber === 5)?.volume, 1.234);
  assert.deepEqual(
    enPlan.problems.map((p) => p.rowNumber),
    [4, 6, 7],
  );
});

test("end-to-end workbook: offset !ref sheet preserves formula error cell positions", async () => {
  const wb = XLSX.utils.book_new();
  const ws = {
    "!ref": "B3:E5",
    B3: { t: "s", v: "Uraian Pekerjaan" },
    C3: { t: "s", v: "Volume" },
    D3: { t: "s", v: "Satuan" },
    E3: { t: "s", v: "Harga Satuan" },
    B4: { t: "s", v: "Item Error" },
    C4: { t: "e", v: 0x07, w: "#DIV/0!" },
    D4: { t: "s", v: "m3" },
    E4: { t: "n", v: 100000 },
    B5: { t: "s", v: "Item Valid" },
    C5: { t: "n", v: 2.5 },
    D5: { t: "s", v: "m3" },
    E5: { t: "n", v: 100000 },
  };
  XLSX.utils.book_append_sheet(wb, ws, "Offset");

  const parsed = await parseWorkbookFile(makeMockExcelFile(wb));
  const matrix = parsed.sheets["Offset"];
  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  assert.equal(matrix[1][1], "#DIV/0!");
  assert.equal(plan.items.length, 1);
  assert.equal(plan.problems.length, 1);
  assert.ok(plan.problems[0].reasons.some((r) => r.includes("#DIV/0!")));
});

test("end-to-end round-trip: workbook exported by buildRabWorkbook imports cleanly with exact total", async () => {
  const detail = {
    id: "rab-1",
    number: "RAB-2026-001",
    title: "RAB Uji",
    projectId: "proj-1",
    projectName: "Proyek Uji",
    client: "Klien Uji",
    location: "Jakarta",
    date: "2026-11-22",
    createdAt: "2026-11-22T00:00:00Z",
    total: 1234000 + 375000,
    itemCount: 2,
    items: [
      {
        id: "item-1",
        description: "Beton K-250",
        volume: 1.234,
        unit: "m3",
        unitPrice: 1000000,
        groupName: "I PEKERJAAN STRUKTUR",
        subgroupName: "A. PEKERJAAN BETON",
      },
      {
        id: "item-2",
        description: "Plesteran Dinding",
        volume: 15,
        unit: "m2",
        unitPrice: 25000,
        groupName: "I PEKERJAAN STRUKTUR",
        subgroupName: "A. PEKERJAAN BETON",
      },
    ],
  };

  const wb = await buildRabWorkbook(detail);
  const parsed = await parseWorkbookFile(makeMockExcelFile(wb, "export.xlsx"));
  const matrix = parsed.sheets["RAB"];
  const headerIdx = detectHeaderRow(matrix);
  const mapping = mapColumns(resolveHeader(matrix, headerIdx).labels);
  const plan = classifyImportMatrix(matrix, mapping, headerIdx);

  assert.equal(plan.problems.length, 0);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].volume, 1.234);
  assert.equal(plan.total, detail.total);
});

test("partial import guard enforces review access, explicit confirmation, and zero-valid block", () => {
  assert.deepEqual(evaluateImportGuard(null, false), {
    canReview: false,
    canImport: false,
    requiresPartialConfirmation: false,
    validItemCount: 0,
    problemRowCount: 0,
  });

  // Zero valid items + problem rows: user CAN review errors, CANNOT import.
  const zeroValidMatrix = [
    ["Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan"],
    ["Item Ambigu", "1,234", "m3", 100000],
    ["Item Negatif", -2, "m3", 100000],
  ];
  const zeroMapping = mapColumns(resolveHeader(zeroValidMatrix, 0).labels);
  const zeroPlan = classifyImportMatrix(zeroValidMatrix, zeroMapping, 0);

  assert.deepEqual(evaluateImportGuard(zeroPlan, false), {
    canReview: true,
    canImport: false,
    requiresPartialConfirmation: false,
    validItemCount: 0,
    problemRowCount: 2,
  });
  assert.equal(evaluateImportGuard(zeroPlan, true).canImport, false);

  // Mixed valid + problem rows: requires explicit confirmation before enabling import.
  const mixedMatrix = [
    ["Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan"],
    ["Item Valid", 2, "m3", 100000],
    ["Item Ambigu", "1,234", "m3", 100000],
  ];
  const mixedMapping = mapColumns(resolveHeader(mixedMatrix, 0).labels);
  const mixedPlan = classifyImportMatrix(mixedMatrix, mixedMapping, 0);

  assert.deepEqual(evaluateImportGuard(mixedPlan, false), {
    canReview: true,
    canImport: false,
    requiresPartialConfirmation: true,
    validItemCount: 1,
    problemRowCount: 1,
  });
  assert.deepEqual(evaluateImportGuard(mixedPlan, true), {
    canReview: true,
    canImport: true,
    requiresPartialConfirmation: true,
    validItemCount: 1,
    problemRowCount: 1,
  });

  // Clean plan (0 problems): import enabled without partial confirmation.
  const cleanPlan = classifyImportMatrix(mixedMatrix, mixedMapping, 0, {
    numberFormat: { volume: "id-ID", money: "auto" },
  });
  assert.deepEqual(evaluateImportGuard(cleanPlan, false), {
    canReview: true,
    canImport: true,
    requiresPartialConfirmation: false,
    validItemCount: 2,
    problemRowCount: 0,
  });
});

test("field-aware numeric config helpers resolve single mode and independent volume/money modes", () => {
  assert.deepEqual(resolveNumberFormatConfig(), { volume: "auto", money: "auto" });
  assert.deepEqual(resolveNumberFormatConfig("id-ID"), {
    volume: "id-ID",
    money: "id-ID",
  });
  assert.deepEqual(resolveNumberFormatConfig({ volume: "en-US", money: "id-ID" }), {
    volume: "en-US",
    money: "id-ID",
  });
  assert.deepEqual(resolveNumberFormatConfig({ volume: "en-US" }), {
    volume: "en-US",
    money: "auto",
  });

  const mixed = { volume: "en-US", money: "id-ID" };
  assert.equal(numberFormatForField("volume", mixed), "en-US");
  assert.equal(numberFormatForField("unitPrice", mixed), "id-ID");
  assert.equal(numberFormatForField("amount", mixed), "id-ID");
  assert.equal(numberFormatForField("description", mixed), "auto");
});

test("QA regression (mixed conventions): Volume TEXT '1.500' (1.5) + Unit Price TEXT '150.000' (150000) = 225000", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    ["I", "PEKERJAAN STRUKTUR", null, null, null, null],
    [1, "Beton Campuran (mixed text)", "1.500", "m3", "150.000", "225.000"],
    [2, "Besi Native Numeric", 1.234, "kg", 10000, 12340],
    ["", "SUBTOTAL", null, null, null, "237.340"],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);

  // 1) Default auto/auto: never silently guesses either text value; native numeric row 4 stays exact.
  const autoPlan = classifyImportMatrix(matrix, mapping, 0);
  assert.deepEqual(
    autoPlan.items.map((i) => i.rowNumber),
    [4],
  );
  assert.equal(autoPlan.items[0].volume, 1.234);
  assert.equal(autoPlan.problems.length, 1);
  assert.equal(autoPlan.problems[0].rowNumber, 3);
  assert.equal(autoPlan.problems[0].hasAmbiguousVolume, true);
  assert.equal(autoPlan.problems[0].hasAmbiguousPrice, true);
  assert.equal(autoPlan.ambiguousVolumeCount, 1);
  assert.equal(autoPlan.ambiguousMoneyCount, 2); // row 3 unitPrice + row 5 subtotal
  assert.equal(autoPlan.unreadableSubtotalCount, 1);

  // 2) Global single modes cannot produce 225,000 for row 3:
  const globalId = classifyImportMatrix(matrix, mapping, 0, { numberFormat: "id-ID" });
  assert.equal(globalId.items.find((i) => i.rowNumber === 3)?.amount, 225000000);
  const globalEn = classifyImportMatrix(matrix, mapping, 0, { numberFormat: "en-US" });
  assert.equal(globalEn.items.find((i) => i.rowNumber === 3)?.amount, 225);

  // 3) Independent field-aware selection: Volume = en-US (dot decimal), Money = id-ID (dot thousands).
  const fieldAware = classifyImportMatrix(matrix, mapping, 0, {
    numberFormat: { volume: "en-US", money: "id-ID" },
  });
  assert.equal(fieldAware.problems.length, 0);
  assert.equal(fieldAware.unreadableSubtotalCount, 0);
  assert.equal(fieldAware.ambiguousNumberCount, 0);
  assert.deepEqual(
    fieldAware.items.map((i) => i.rowNumber),
    [3, 4],
  );
  const mixedRow = fieldAware.items.find((i) => i.rowNumber === 3);
  assert.equal(mixedRow?.volume, 1.5);
  assert.equal(mixedRow?.unitPrice, 150000);
  assert.equal(mixedRow?.amount, 225000);

  // Native Excel numeric cell in row 4 remains completely untouched (1.234 * 10000 = 12340).
  const nativeRow = fieldAware.items.find((i) => i.rowNumber === 4);
  assert.equal(nativeRow?.volume, 1.234);
  assert.equal(nativeRow?.amount, 12340);

  // Total and subtotal match exactly.
  assert.equal(fieldAware.total, 237340);
  assert.equal(fieldAware.subtotalChecks[0].fileValue, 237340);
  assert.equal(fieldAware.subtotalChecks[0].difference, 0);
  assert.equal(hasSubtotalWarning(fieldAware.subtotalChecks[0]), false);
  assert.equal(evaluateImportGuard(fieldAware, false).canImport, true);
});

test("field-aware reverse mixed conventions: Volume TEXT '1,500' (id-ID) + Unit Price TEXT '150,000' (en-US) = 225000", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    [1, "Pekerjaan Campuran Balik", "1,500", "m3", "150,000", "225,000"],
    [2, "Native Numeric", 2.5, "m3", 100000, 250000],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0, {
    numberFormat: { volume: "id-ID", money: "en-US" },
  });

  assert.equal(plan.problems.length, 0);
  assert.equal(plan.items[0].volume, 1.5);
  assert.equal(plan.items[0].unitPrice, 150000);
  assert.equal(plan.items[0].amount, 225000);
  assert.equal(plan.items[1].volume, 2.5);
  assert.equal(plan.total, 475000);
});

test("ambiguous, invalid, negative, and formula-error subtotal/total values are never silently ignored", async () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    ["I", "SEKSI 1", null, null, null, null],
    [1, "Item A", 1.5, "m3", 150000, 225000],
    ["", "SUBTOTAL SEKSI 1", 99, null, null, "225.000"],
    ["", "SUBTOTAL NEGATIF", null, null, null, "(225.000)"],
    ["", "SUBTOTAL KOSONG", null, null, null, ""],
    ["", "GRAND TOTAL", null, null, null, null],
  ]);

  // Inject formula error in GRAND TOTAL Jumlah Harga cell (F7).
  ws["F7"] = { t: "e", v: 0x17, w: "#REF!" };
  ws["!ref"] = "A1:F7";
  XLSX.utils.book_append_sheet(wb, ws, "RAB");

  const parsed = await parseWorkbookFile(makeMockExcelFile(wb, "subtotals.xlsx"));
  const matrix = parsed.sheets["RAB"];
  const mapping = mapColumns(resolveHeader(matrix, 0).labels);

  // Under default auto/auto:
  const plan = classifyImportMatrix(matrix, mapping, 0);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.subtotalChecks.length, 4);

  // Row 4: ambiguous "225.000" must NOT fall back to code column value 99!
  const ambiguousSub = plan.subtotalChecks.find((c) => c.rowNumber === 4);
  assert.equal(ambiguousSub?.fileStatus, "ambiguous");
  assert.equal(ambiguousSub?.fileValue, null);
  assert.equal(ambiguousSub?.fileRaw, "225.000");
  assert.equal(isUnreadableSubtotalCheck(ambiguousSub), true);
  assert.equal(hasSubtotalWarning(ambiguousSub), true);

  // Row 5: negative subtotal is flagged unreadable, not ignored.
  const negativeSub = plan.subtotalChecks.find((c) => c.rowNumber === 5);
  assert.equal(negativeSub?.fileStatus, "negative");
  assert.equal(negativeSub?.fileValue, null);
  assert.equal(isUnreadableSubtotalCheck(negativeSub), true);
  assert.equal(hasSubtotalWarning(negativeSub), true);

  // Row 6: truly blank subtotal row is empty, not falsely flagged as unreadable.
  const emptySub = plan.subtotalChecks.find((c) => c.rowNumber === 6);
  assert.equal(emptySub?.fileStatus, "empty");
  assert.equal(isUnreadableSubtotalCheck(emptySub), false);
  assert.equal(hasSubtotalWarning(emptySub), false);

  // Row 7: GRAND TOTAL formula error "#REF!" is surfaced as invalid against documentSum.
  const errorTotal = plan.subtotalChecks.find((c) => c.rowNumber === 7);
  assert.equal(errorTotal?.fileStatus, "invalid");
  assert.equal(errorTotal?.fileRaw, "#REF!");
  assert.equal(errorTotal?.scope, "document");
  assert.equal(errorTotal?.computedValue, 225000);
  assert.equal(isUnreadableSubtotalCheck(errorTotal), true);
  assert.equal(hasSubtotalWarning(errorTotal), true);

  assert.equal(plan.unreadableSubtotalCount, 3);
  assert.equal(plan.ambiguousMoneyCount, 1);

  // Switching money format to id-ID resolves row 4 subtotal cleanly to 225000 (diff 0).
  const resolvedMoney = classifyImportMatrix(matrix, mapping, 0, {
    numberFormat: { volume: "auto", money: "id-ID" },
  });
  const resolvedSub = resolvedMoney.subtotalChecks.find((c) => c.rowNumber === 4);
  assert.equal(resolvedSub?.fileStatus, "ok");
  assert.equal(resolvedSub?.fileValue, 225000);
  assert.equal(resolvedSub?.difference, 0);
  assert.equal(hasSubtotalWarning(resolvedSub), false);
  assert.equal(resolvedMoney.unreadableSubtotalCount, 2); // negative + #REF! remain visible
});

test("subtotal without mapped amount column scans monetary cells right-to-left and skips code column", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Keterangan"],
    [1, "Item A", 2, "m2", 100000, 200000],
    [99, "TOTAL", null, null, null, "200.000"],
  ];

  const mapping = { ...mapColumns(resolveHeader(matrix, 0).labels), amount: null };
  const autoPlan = classifyImportMatrix(matrix, mapping, 0);

  assert.equal(autoPlan.subtotalChecks.length, 1);
  assert.equal(autoPlan.subtotalChecks[0].fileStatus, "ambiguous");
  assert.equal(autoPlan.subtotalChecks[0].fileRaw, "200.000");
  assert.equal(autoPlan.unreadableSubtotalCount, 1);

  const idPlan = classifyImportMatrix(matrix, mapping, 0, {
    numberFormat: { volume: "auto", money: "id-ID" },
  });
  assert.equal(idPlan.subtotalChecks[0].fileStatus, "ok");
  assert.equal(idPlan.subtotalChecks[0].fileValue, 200000);
  assert.equal(idPlan.subtotalChecks[0].difference, 0);
});

test("P1 regression: amount-only rows become problem without corrupting hierarchy, while structural headings and subtotals remain intact", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    ["I", "PEKERJAAN PERSIAPAN", "", "", "", 15000000],
    ["A.", "PEKERJAAN MOBILISASI", "", "", "", 5000000],
    [1, "Biaya Mobilisasi (amount-only numbered)", "", "", "", 5000000],
    [2, "Pembersihan Lahan (valid after amount-only)", 10, "m2", 50000, 500000],
    ["", "Biaya Lainnya (amount-only uncoded ambiguous)", "", "", "", "500.000"],
    ["", "Biaya Error (amount-only formula error)", "", "", "", "#DIV/0!"],
    [3, "Pek. Ring Balok RB1 (legitimate item_group with dash)", "", "", "", "-"],
    [4, "Beton RB1 (valid under item_group)", 2, "m3", 1000000, 2000000],
    ["", "SUBTOTAL", "", "", "", 2500000],
    ["", "GRAND TOTAL", "", "", "", 2500000],
    ["", "Biaya Overhead Recap", "", "", "", 250000],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  // Structural headings with section totals remain headings.
  assert.equal(plan.rows.find((r) => r.rowNumber === 2)?.kind, "group");
  assert.equal(plan.rows.find((r) => r.rowNumber === 3)?.kind, "subgroup");
  // Legitimate item_group with bare dash in amount stays item_group.
  assert.equal(plan.rows.find((r) => r.rowNumber === 8)?.kind, "item_group");
  // Legitimate subtotal/total and post-grand-total recap remain unaffected.
  assert.equal(plan.rows.find((r) => r.rowNumber === 10)?.kind, "subtotal");
  assert.equal(plan.rows.find((r) => r.rowNumber === 11)?.kind, "total");
  assert.equal(plan.rows.find((r) => r.rowNumber === 12)?.kind, "note");

  // All 3 amount-only rows (rows 4, 6, 7) are classified as problem with clear reasons.
  assert.deepEqual(
    plan.problems.map((p) => p.rowNumber),
    [4, 6, 7],
  );
  const row4Problem = plan.problems.find((p) => p.rowNumber === 4);
  assert.ok(row4Problem?.reasons.includes("Volume kosong"));
  assert.ok(row4Problem?.reasons.includes("Harga satuan kosong"));
  assert.ok(row4Problem?.reasons.some((r) => /Jumlah harga/i.test(r)));

  const row6Problem = plan.problems.find((p) => p.rowNumber === 6);
  assert.ok(row6Problem?.reasons.some((r) => /Jumlah harga.*ambigu/i.test(r)));

  const row7Problem = plan.problems.find((p) => p.rowNumber === 7);
  assert.ok(row7Problem?.reasons.some((r) => /Jumlah harga.*#DIV\/0!/i.test(r)));

  // Valid item after row 4 must NOT inherit row 4 as item_group!
  const itemRow5 = plan.items.find((i) => i.rowNumber === 5);
  assert.equal(itemRow5?.groupName, "I PEKERJAAN PERSIAPAN");
  assert.equal(itemRow5?.subgroupName, "A. PEKERJAAN MOBILISASI");
  assert.equal(itemRow5?.itemGroupName, null);

  // Valid item under legitimate item_group (row 8) retains expected hierarchy.
  const itemRow9 = plan.items.find((i) => i.rowNumber === 9);
  assert.equal(itemRow9?.groupName, "I PEKERJAAN PERSIAPAN");
  assert.equal(itemRow9?.subgroupName, "A. PEKERJAAN MOBILISASI");
  assert.equal(itemRow9?.itemGroupName, "3 Pek. Ring Balok RB1 (legitimate item_group with dash)");
});

test("P2 regression: leading-zero decimals (0.500 and 0,500) parse unambiguously across all locale modes", () => {
  for (const mode of ["auto", "id-ID", "en-US"]) {
    assert.equal(parseSpreadsheetNumber("0.500", mode), 0.5);
    assert.equal(parseSpreadsheetNumber("0,500", mode), 0.5);
    assert.equal(parseSpreadsheetNumber("0.234", mode), 0.234);
    assert.equal(parseSpreadsheetNumber("0,234", mode), 0.234);
    assert.equal(parseSpreadsheetNumber("0.000", mode), 0);
    assert.equal(parseSpreadsheetNumber("0,000", mode), 0);
    assert.equal(inspectSpreadsheetNumber("-0.500", mode).status, "negative");
    assert.equal(inspectSpreadsheetNumber("-0,500", mode).status, "negative");
    assert.equal(inspectSpreadsheetNumber("0.123.456", mode).status, "invalid");
    assert.equal(inspectSpreadsheetNumber("0,123,456", mode).status, "invalid");
    assert.equal(inspectSpreadsheetNumber("0.12,34", mode).status, "invalid");
  }

  // Real sheet scenario: switching Volume to en-US for "1.500" does not break "0,500".
  const matrix = [
    ["Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan"],
    ["Item Setengah", "0,500", "m3", "150.000"],
    ["Item Satu Setengah", "1.500", "m3", "150.000"],
  ];
  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0, {
    numberFormat: { volume: "en-US", money: "id-ID" },
  });

  assert.equal(plan.problems.length, 0);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].volume, 0.5);
  assert.equal(plan.items[0].amount, 75000);
  assert.equal(plan.items[1].volume, 1.5);
  assert.equal(plan.items[1].amount, 225000);
  assert.equal(plan.total, 300000);
});

test("fallbackMergedLabel: unit behavior scans only unmapped columns left of description", () => {
  const mapping = {
    description: 1,
    volume: 2,
    unit: 3,
    unitPrice: 4,
    amount: 5,
  };

  // Merged subtotal/total in col 0 when codeColumn is null.
  assert.equal(
    fallbackMergedLabel(["Subtotal A. BETON", "", "", "", "", 1609000], mapping, null),
    "Subtotal A. BETON",
  );
  assert.equal(
    fallbackMergedLabel(["GRAND TOTAL", "", "", "", "", 1609000], mapping, null),
    "GRAND TOTAL",
  );

  // When codeColumn is 0, col 0 is already mapped as code so fallback returns empty.
  assert.equal(
    fallbackMergedLabel(["Subtotal A. BETON", "", "", "", "", 1609000], mapping, 0),
    "",
  );

  // Unrelated trailing remarks column (right of description) is never returned.
  assert.equal(
    fallbackMergedLabel(["", "", "", "", "", 500000, "TOTAL termasuk PPN"], mapping, null),
    "",
  );
});

test("fallbackMergedLabel: merged subtotal and GRAND TOTAL with codeColumn = null classify cleanly", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga"],
    [1, "Beton K-250", 2, "m3", 500000, 1000000],
    ["Subtotal Pekerjaan Beton", "", "", "", "", 1000000],
    ["GRAND TOTAL", "", "", "", "", 1000000],
    ["PPN 11%", "", "", "", "", 110000],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  assert.equal(plan.codeColumn, null);
  assert.equal(plan.problems.length, 0);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.rows.find((r) => r.rowNumber === 3)?.kind, "subtotal");
  assert.equal(plan.rows.find((r) => r.rowNumber === 4)?.kind, "total");
  assert.equal(plan.rows.find((r) => r.rowNumber === 5)?.kind, "note");
  assert.equal(plan.subtotalChecks.length, 2);
  assert.equal(plan.subtotalChecks[0].label, "Subtotal Pekerjaan Beton");
  assert.equal(plan.subtotalChecks[0].difference, 0);
  assert.equal(plan.subtotalChecks[1].label, "GRAND TOTAL");
  assert.equal(plan.subtotalChecks[1].fileValue, 1000000);
  assert.equal(plan.subtotalChecks[1].difference, 0);
});

test("fallbackMergedLabel: ordinary item with 'TOTAL' in unrelated/unmapped column remains an item", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga", "Catatan"],
    [1, "Beton K-250", 2, "m3", 500000, 1000000, "TOTAL sudah termasuk ongkir"],
    ["TOTAL", "Besi Tulangan", 10, "kg", 20000, 200000, "SUBTOTAL vendor"],
    // Missing description + numeric volume/price + "TOTAL" in unmapped col 0 must be problem, not total.
    ["TOTAL", "", 3, "m2", 100000, 300000, "TOTAL"],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0, { codeColumn: null });

  assert.deepEqual(
    plan.items.map((item) => ({
      rowNumber: item.rowNumber,
      description: item.description,
      amount: item.amount,
    })),
    [
      { rowNumber: 2, description: "Beton K-250", amount: 1000000 },
      { rowNumber: 3, description: "Besi Tulangan", amount: 200000 },
    ],
  );
  assert.equal(plan.counts.total, 0);
  assert.equal(plan.counts.subtotal, 0);
  assert.deepEqual(
    plan.problems.map((p) => p.rowNumber),
    [4],
  );
  assert.ok(plan.problems[0].reasons.includes("Uraian pekerjaan kosong"));
});

test("fallbackMergedLabel: label-less recap-like rows never corrupt item hierarchy", () => {
  const matrix = [
    ["No", "Uraian Pekerjaan", "Volume", "Satuan", "Harga Satuan", "Jumlah Harga", "Catatan"],
    ["I", "PEKERJAAN STRUKTUR", "", "", "", "", ""],
    ["A.", "PEKERJAAN BETON", "", "", "", "", ""],
    [1, "Beton Kolom", 2, "m3", 1000000, 2000000, ""],
    // Label-less amount-only row between items: flagged as problem, does NOT become heading.
    ["", "", "", "", "", 2000000, ""],
    // Label-less row with text only in unmapped remarks column: skipped as empty.
    ["", "", "", "", "", "", "catatan internal"],
    [2, "Beton Balok", 3, "m3", 1000000, 3000000, ""],
    ["GRAND TOTAL", "", "", "", "", 5000000, ""],
    // Label-less recap amount row after GRAND TOTAL: classified as note, not problem.
    ["", "", "", "", "", 550000, ""],
  ];

  const mapping = mapColumns(resolveHeader(matrix, 0).labels);
  const plan = classifyImportMatrix(matrix, mapping, 0);

  assert.deepEqual(
    plan.items.map((i) => i.rowNumber),
    [4, 7],
  );
  for (const item of plan.items) {
    assert.equal(item.groupName, "I PEKERJAAN STRUKTUR");
    assert.equal(item.subgroupName, "A. PEKERJAAN BETON");
    assert.equal(item.itemGroupName, null);
  }
  assert.deepEqual(
    plan.problems.map((p) => p.rowNumber),
    [5],
  );
  assert.ok(plan.skipped.some((s) => s.rowNumber === 6));
  assert.equal(plan.rows.find((r) => r.rowNumber === 8)?.kind, "total");
  assert.equal(plan.rows.find((r) => r.rowNumber === 9)?.kind, "note");
});

test("buildRabWorkbook export/import round-trip with 0, 1, and 2 items", async () => {
  const baseDetail = {
    id: "rab-rt",
    number: "RAB-2026-RT",
    title: "RAB Round Trip",
    projectId: "proj-rt",
    projectName: "Proyek RT",
    client: "Klien RT",
    location: "Jakarta",
    date: "2026-11-22",
    createdAt: "2026-11-22T00:00:00Z",
  };

  const sampleItems = [
    {
      id: "rt-1",
      description: "Beton K-250",
      volume: 1.234,
      unit: "m3",
      unitPrice: 1000000,
      groupName: "I PEKERJAAN STRUKTUR",
      subgroupName: "A. PEKERJAAN BETON",
    },
    {
      id: "rt-2",
      description: "Plesteran Dinding",
      volume: 15,
      unit: "m2",
      unitPrice: 25000,
      groupName: "I PEKERJAAN STRUKTUR",
      subgroupName: "A. PEKERJAAN BETON",
    },
  ];

  for (const count of [0, 1, 2]) {
    const items = sampleItems.slice(0, count);
    const expectedTotal = items.reduce((sum, item) => sum + item.volume * item.unitPrice, 0);
    const wb = await buildRabWorkbook({
      ...baseDetail,
      items,
      itemCount: items.length,
      total: expectedTotal,
    });

    const parsed = await parseWorkbookFile(makeMockExcelFile(wb, `export-${count}.xlsx`));
    const matrix = parsed.sheets["RAB"];
    const headerIdx = detectHeaderRow(matrix);
    const mapping = mapColumns(resolveHeader(matrix, headerIdx).labels);
    const plan = classifyImportMatrix(matrix, mapping, headerIdx);

    assert.equal(plan.problems.length, 0, `expected 0 problems for ${count}-item round-trip`);
    assert.equal(plan.items.length, count, `expected ${count} items for ${count}-item round-trip`);
    assert.equal(plan.total, expectedTotal);
    assert.ok(plan.subtotalChecks.length >= 1, `expected GRAND TOTAL check for ${count} items`);
    for (const check of plan.subtotalChecks) {
      assert.equal(check.fileStatus, "ok");
      assert.equal(check.difference, 0);
    }

    const guard = evaluateImportGuard(plan, false);
    assert.equal(guard.canReview, true);
    assert.equal(guard.canImport, count > 0);
  }
});
