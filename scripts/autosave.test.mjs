import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Run with `node --test scripts/autosave.test.mjs`. Transpile only the imported
// source files, using the project's compiler and no browser or network.
const require = createRequire(import.meta.url);
const src = fileURLToPath(new URL("../src/", import.meta.url));

function sourceLoader(mocks = {}) {
  const modules = new Map();

  function load(path) {
    const filename = resolve(src, path);
    if (modules.has(filename)) return modules.get(filename).exports;
    const record = { exports: {} };
    modules.set(filename, record);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    const importModule = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith("@/")) return load(`${name.slice(2)}.ts`);
      if (name.startsWith(".")) return load(resolve(dirname(filename), `${name}.ts`));
      return require(name);
    };
    new Function("require", "module", "exports", outputText)(
      importModule, record, record.exports,
    );
    return record.exports;
  }

  return load;
}

const { SaveQueue } = sourceLoader()("lib/save-queue.ts");
const documentId = "source";
const itemId = "item-1";
const source = {
  id: documentId, projectId: "project-1", title: "Before", date: "2026-10-01",
};
const item = {
  id: itemId, description: "Original", volume: 1, unit: "m2", unitPrice: 100,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settledTurn = () => new Promise((done) => setImmediate(done));

function itemQueue(t, handlers = {}) {
  const writes = [];
  const queue = new SaveQueue({
    writeItem(id, patch) {
      const request = deferred();
      writes.push({ id, patch, request });
      return request.promise;
    },
  }, handlers, { debounceMs: 60_000 });
  t.after(() => queue.clearAll());
  return { queue, writes };
}

test("page hide keeps edit B pending behind edit A and waits for B's acknowledgement", async (t) => {
  const phases = [];
  const { queue, writes } = itemQueue(t, {
    onChanged: (id) => phases.push(queue.snapshot(id).phase),
  });
  queue.updateItem(documentId, itemId, { description: "A" });
  const first = queue.flushItem(itemId);
  await settledTurn();
  queue.updateItem(documentId, itemId, { description: "B" });

  queue.flushAllBestEffort();
  assert.equal(writes.length, 1);
  const phaseAtHide = queue.snapshot(documentId).phase;

  writes[0].request.resolve();
  await settledTurn();
  assert.deepEqual({ phaseAtHide, writes: writes.length }, { phaseAtHide: "saving", writes: 2 });
  assert.deepEqual(writes[1].patch, { description: "B" });
  assert.equal(queue.snapshot(documentId).phase, "saving");
  assert.ok(!phases.includes("saved"));

  writes[1].request.resolve();
  await first;
  await settledTurn();
  assert.equal(queue.snapshot(documentId).phase, "saved");
});

test("overlapping lifecycle and document flushes share writes in order", async (t) => {
  const { queue, writes } = itemQueue(t);
  const completed = [];
  queue.updateItem(documentId, itemId, { description: "A", unit: "m3" });
  queue.flushAllBestEffort();
  const first = queue.flushDocument(documentId).then(() => completed.push("first"));
  await settledTurn();

  queue.updateItem(documentId, itemId, { description: "B" });
  queue.flushAllBestEffort();
  const second = queue.flushDocument(documentId).then(() => completed.push("second"));
  assert.deepEqual(writes.map(({ patch }) => patch), [{ description: "A", unit: "m3" }]);

  writes[0].request.resolve();
  await settledTurn();
  assert.deepEqual(writes.map(({ patch }) => patch), [
    { description: "A", unit: "m3" },
    { description: "B" },
  ]);
  assert.deepEqual(completed, []);

  writes[1].request.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(completed, ["first", "second"]);
  assert.equal(queue.snapshot(documentId).phase, "saved");
});

test("a failed save retains its fields and newer values for one explicit retry", async (t) => {
  const { queue, writes } = itemQueue(t);
  queue.updateItem(documentId, itemId, { description: "A", unitPrice: 50 });
  const flushing = queue.flushDocument(documentId);
  const alsoFlushing = queue.flushDocument(documentId);
  const failures = Promise.all([
    assert.rejects(flushing, /offline/),
    assert.rejects(alsoFlushing, /offline/),
  ]);
  await settledTurn();
  queue.updateItem(documentId, itemId, { description: "B", volume: 2 });
  queue.flushAllBestEffort();
  writes[0].request.reject(new Error("offline"));
  await failures;

  assert.deepEqual(queue.snapshot(documentId), { phase: "error", message: "offline" });
  queue.flushAllBestEffort();
  await settledTurn();
  assert.equal(writes.length, 1);

  const retry = queue.retry(documentId);
  assert.equal(queue.retry(documentId), retry);
  await settledTurn();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].patch, { description: "B", unitPrice: 50, volume: 2 });
  writes[1].request.resolve();
  await retry;
  assert.equal(queue.snapshot(documentId).phase, "saved");
});

test("rapid consecutive edits coalesce on both sides of an acknowledgement", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queue, writes } = itemQueue(t);
  queue.updateItem(documentId, itemId, { description: "A" });
  t.mock.timers.tick(30_000);
  queue.updateItem(documentId, itemId, { description: "AB" });
  queue.updateItem(documentId, itemId, { volume: 2 });
  t.mock.timers.tick(59_999);
  await settledTurn();
  assert.equal(writes.length, 0);

  t.mock.timers.tick(1);
  await settledTurn();
  assert.deepEqual(writes[0].patch, { description: "AB", volume: 2 });

  queue.updateItem(documentId, itemId, { description: "ABC" });
  queue.updateItem(documentId, itemId, { description: "ABCD", unitPrice: 500 });
  queue.updateItem(documentId, itemId, { unitPrice: 600 });
  const flushing = queue.flushDocument(documentId);
  writes[0].request.resolve();
  await settledTurn();
  assert.deepEqual(writes[1].patch, { description: "ABCD", unitPrice: 600 });

  writes[1].request.resolve();
  await flushing;
  assert.equal(writes.length, 2);
  assert.equal(queue.snapshot(documentId).phase, "saved");
});

const comparisonId = "comparison";
const comparisonItemId = "item-comparison";
const comparisonDocument = { ...source, id: comparisonId, title: "Comparison" };

function workspaceFixture() {
  return {
    documents: [source, comparisonDocument],
    items: {
      [documentId]: [item],
      [comparisonId]: [{ ...item, id: comparisonItemId }],
    },
    projects: [{ id: source.projectId }],
  };
}

function providerFixture(updateDocumentRecord, overrides = {}) {
  // A minimal hook harness for invoking the actual provider's context actions.
  // Render twice around refresh and keep its state and refs across renders.
  const slots = [];
  const effects = [];
  let cursor = 0;
  function useState(initial) {
    const slot = cursor++;
    if (!(slot in slots)) slots[slot] = initial;
    return [slots[slot], (next) => {
      slots[slot] = typeof next === "function" ? next(slots[slot]) : next;
    }];
  }
  const copies = [];
  const inserted = [];
  const load = sourceLoader({
    react: {
      createContext: () => ({ Provider: "provider" }),
      useCallback: (callback) => callback,
      useEffect: (effect) => effects.push(effect),
      useMemo: (compute) => compute(),
      useRef: (current) => useState({ current })[0],
      useState,
    },
    "@/components/providers/auth-provider": { useAuth: () => ({ status: "authenticated" }) },
    "@/lib/legacy-migration": { getLegacyMigrationSummary: () => null },
    "@/lib/supabase/migrate": {},
    "@/lib/supabase/data": {
      EMPTY_WORKSPACE: { documents: [], items: {}, projects: [] },
      fetchWorkspace: async () => workspaceFixture(),
      recomputeWorkspace: (state) => state,
      updateDocumentRecord,
      countDocumentItems: async () => 1,
      createDocumentRecord: async (input) => {
        copies.push(input);
        return { ...input, id: "copy" };
      },
      insertWorkItemsRecord: async (id, items) => {
        inserted.push({ id, items });
        return items;
      },
      ...overrides,
    },
  });
  const { DataProvider } = load("components/providers/data-provider.tsx");
  function render() {
    cursor = 0;
    effects.length = 0;
    return DataProvider({ children: null }).props.value;
  }
  return { render, copies, inserted, startLifecycle: () => effects.at(-1)() };
}

function editorFixture(readData) {
  const slots = [];
  let cursor = 0;
  const errors = [];
  function useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next) => { slots[index] = next; }];
  }

  const components = {
    "rab/ahsp-picker-dialog": "AhspPickerDialog",
    "rab/catalog-picker-dialog": "CatalogPickerDialog",
    "rab/duplicate-document-dialog": "DuplicateDocumentDialog",
    "rab/compare-documents-dialog": "CompareDocumentsDialog",
    "rab/editor/document-header": "DocumentHeader",
    "rab/editor/rab-not-found": "RabNotFound",
    "rab/editor/rab-summary": "RabSummary",
    "rab/editor/work-items-table": "WorkItemsTable",
    "shared/confirm-dialog": "ConfirmDialog",
    "shared/data-error": "DataError",
    "shared/empty-state": "EmptyState",
    "ui/button": "Button",
    "ui/skeleton": "Skeleton",
  };
  const load = sourceLoader({
    ...Object.fromEntries(Object.entries(components).map(([path, name]) => [
      `@/components/${path}`, { [name]: name },
    ])),
    react: {
      useCallback: (callback) => callback,
      useEffect: (effect) => effect(),
      useMemo: (compute) => compute(),
      useRef: (current) => useState({ current })[0],
      useState,
    },
    "next/navigation": { useRouter: () => ({}) },
    sonner: { toast: { error: (...args) => errors.push(args), success: () => {} } },
    "@/components/layout/header-override": { useSetHeaderOverride: () => {} },
    "@/components/providers/data-provider": { useData: readData },
  });
  const { RabEditor } = load("components/rab/editor/rab-editor.tsx");
  function find(node, type) {
    if (Array.isArray(node)) {
      for (const child of node) {
        const match = find(child, type);
        if (match) return match;
      }
    } else if (node?.type === type) {
      return node;
    } else if (node?.props?.children) {
      return find(node.props.children, type);
    }
  }

  return {
    errors,
    props(type) {
      cursor = 0;
      return find(RabEditor({ documentId }), type)?.props;
    },
  };
}

test("rapid empty-state Add clicks send one request until it settles", async () => {
  const insert = deferred();
  const attempts = [];
  const { render } = providerFixture(undefined, {
    fetchWorkspace: async () => ({ ...workspaceFixture(), items: { [documentId]: [] } }),
    async createWorkItemRecord(id, preset) {
      attempts.push({ id, preset });
      await insert.promise;
      return { ...item, ...preset };
    },
  });
  await render().refresh();
  const editor = editorFixture(render);
  const add = editor.props("EmptyState").action.props.onClick;
  add();
  add();
  await settledTurn();
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].id, documentId);
  assert.deepEqual(render().getDocumentDetail(documentId).items, []);

  insert.resolve();
  await settledTurn();
  assert.deepEqual(editor.props("WorkItemsTable").items.map(({ id }) => id), [attempts[0].preset.id]);
});

test("Catalog and AHSP picks share the Add guard, and each picker closes after acknowledgment", async () => {
  const attempts = [];
  const { render } = providerFixture(undefined, {
    async createWorkItemRecord(_id, preset) {
      const response = deferred();
      attempts.push({ preset, response });
      await response.promise;
      return { ...item, ...preset };
    },
  });
  await render().refresh();
  const editor = editorFixture(render);

  editor.props("WorkItemsTable").onAddFromCatalog();
  const catalog = editor.props("CatalogPickerDialog");
  const entry = { name: "Catalog item", unit: "m2", unitPrice: 75 };
  catalog.onPick(entry);
  catalog.onPick(entry);
  editor.props("WorkItemsTable").onAddItem();
  await settledTurn();
  assert.deepEqual(attempts.map(({ preset }) => preset.description), ["Catalog item"]);
  assert.equal(editor.props("CatalogPickerDialog").open, true);
  attempts[0].response.resolve();
  await settledTurn();
  assert.equal(editor.props("CatalogPickerDialog"), undefined);

  editor.props("WorkItemsTable").onAddFromAhsp();
  const ahsp = editor.props("AhspPickerDialog");
  const analysis = { name: "AHSP item", unit: "m2", components: [] };
  ahsp.onPick(analysis);
  ahsp.onPick(analysis);
  await settledTurn();
  assert.deepEqual(attempts.map(({ preset }) => preset.description), ["Catalog item", "AHSP item"]);
  assert.equal(editor.props("AhspPickerDialog").open, true);
  attempts[1].response.resolve();
  await settledTurn();
  assert.equal(editor.props("AhspPickerDialog"), undefined);
});

test("an intentional Add after acknowledgment gets a new ID and the next group position", async () => {
  const first = deferred();
  const attempts = [];
  const { render } = providerFixture(undefined, {
    fetchWorkspace: async () => ({
      ...workspaceFixture(),
      items: { [documentId]: [{ ...item, groupName: "Group A", sortOrder: 10 }] },
    }),
    async createWorkItemRecord(_id, preset) {
      attempts.push(preset);
      if (attempts.length === 1) await first.promise;
      return { ...item, ...preset };
    },
  });
  await render().refresh();
  const editor = editorFixture(render);
  const table = editor.props("WorkItemsTable");
  table.onAddItem({ groupName: "Group A" });
  first.resolve();
  await settledTurn();
  editor.props("WorkItemsTable").onAddItem();
  await settledTurn();

  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].id, attempts[1].id);
  assert.deepEqual(attempts.map(({ groupName, sortOrder }) => [groupName, sortOrder]), [
    ["Group A", 11], ["Group A", 12],
  ]);
  assert.deepEqual(editor.props("WorkItemsTable").items.map(({ id }) => id), [
    itemId, attempts[0].id, attempts[1].id,
  ]);
});

test("a failed Add releases the guard and Coba lagi recovers the original ID", async () => {
  const first = deferred();
  const attempts = [];
  const lookups = [];
  const { render } = providerFixture(undefined, {
    async createWorkItemRecord(_id, preset) {
      attempts.push(preset);
      if (attempts.length === 1) await first.promise;
      return { ...item, ...preset };
    },
    async fetchWorkItemRecord(id) {
      lookups.push(id);
      return { documentId, item: { ...item, id } };
    },
  });
  await render().refresh();
  const editor = editorFixture(render);
  editor.props("WorkItemsTable").onAddItem();
  await settledTurn();
  first.reject(new Error("insert response lost"));
  await settledTurn();
  const failed = render();
  assert.deepEqual(failed.getDocumentSaveState(documentId), { phase: "error", message: "insert response lost" });
  assert.equal(editor.errors.length, 1);

  editor.props("WorkItemsTable").onAddItem();
  await settledTurn();
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].id, attempts[1].id);
  await failed.retryDocumentSave(documentId);
  assert.deepEqual(lookups, [attempts[0].id]);
  assert.equal(attempts.length, 2);
  const saved = render();
  assert.equal(saved.getDocumentSaveState(documentId).phase, "saved");
  assert.deepEqual(saved.getDocumentDetail(documentId).items.map(({ id }) => id), [
    itemId, attempts[1].id, attempts[0].id,
  ]);
});

test("visibilitychange and pagehide keep newer metadata behind the active request", async (t) => {
  const requests = [];
  const { render, startLifecycle } = providerFixture((_id, patch) => {
    const request = deferred();
    requests.push({ patch, request });
    return request.promise;
  });
  await render().refresh();
  const data = render();
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  const stopLifecycle = startLifecycle();
  t.after(() => {
    stopLifecycle();
    delete globalThis.window;
    delete globalThis.document;
  });

  const first = data.updateDocument(documentId, { title: "A" });
  await settledTurn();
  const latest = { title: "B", date: "2026-11-22" };
  const second = data.updateDocument(documentId, latest);
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  assert.deepEqual(requests.map(({ patch }) => patch), [{ title: "A" }]);
  assert.equal(render().getDocumentSaveState(documentId).phase, "saving");

  requests[0].request.resolve({ ...source, title: "A" });
  await settledTurn();
  assert.deepEqual(requests.map(({ patch }) => patch), [{ title: "A" }, latest]);
  assert.equal(render().getDocumentSaveState(documentId).phase, "saving");

  requests[1].request.resolve({ ...source, ...latest });
  await Promise.all([first, second]);
  assert.equal(render().getDocumentSaveState(documentId).phase, "saved");
  assert.equal(render().getDocumentDetail(documentId).title, "B");
});

test("page hide retries a retained metadata patch once and keeps it after another failure", async (t) => {
  const requests = [];
  const queue = new SaveQueue({
    writeDocument(_id, patch) {
      const request = deferred();
      requests.push({ patch, request });
      return request.promise;
    },
  });
  t.after(() => queue.clearAll());

  const first = queue.updateDocument(documentId, { title: "A", date: "2026-11-22" });
  await settledTurn();
  const second = queue.updateDocument(documentId, { title: "B" });
  queue.flushAllBestEffort();
  queue.flushAllBestEffort();
  assert.equal(requests.length, 1);

  requests[0].request.reject(new Error("offline"));
  await Promise.all([first, second]);
  await settledTurn();
  assert.equal(requests.length, 2);
  const latest = { title: "B", date: "2026-11-22" };
  assert.deepEqual(requests[1].patch, latest);
  requests[1].request.reject(new Error("still offline"));
  await settledTurn();
  queue.flushAllBestEffort();
  await settledTurn();
  assert.equal(requests.length, 2);
  assert.equal(queue.snapshot(documentId).message, "still offline");

  const retry = queue.retry(documentId);
  await settledTurn();
  assert.deepEqual(requests[2].patch, latest);
  requests[2].request.resolve({ ...source, ...latest });
  await retry;
  assert.equal(queue.snapshot(documentId).phase, "saved");
});

test("duplicate waits for in-flight metadata and uses its acknowledged snapshot", async () => {
  const first = deferred();
  const last = deferred();
  const writes = [];
  const { render, copies } = providerFixture((_id, patch) => {
    writes.push(patch);
    return writes.length === 1 ? first.promise : last.promise;
  });
  await render().refresh();
  const data = render();

  const saving = data.updateDocument(documentId, { title: "Intermediate" });
  await settledTurn();
  const duplicating = data.duplicateDocument(documentId);
  // Attach a handler now so the known baseline rejection is observable below.
  void duplicating.catch(() => {});
  const finalPatch = { title: "After", date: "2026-11-22" };
  const savingLatest = data.updateDocument(documentId, finalPatch);
  await settledTurn();
  assert.deepEqual(copies, []);
  assert.deepEqual(writes, [{ title: "Intermediate" }]);

  first.resolve({ ...source, title: "Intermediate" });
  await settledTurn();
  assert.deepEqual(writes, [{ title: "Intermediate" }, finalPatch]);
  assert.deepEqual(copies, []);

  last.resolve({ ...source, ...finalPatch });
  await Promise.all([saving, savingLatest, duplicating]);
  assert.deepEqual(copies, [
    { projectId: source.projectId, title: "After — Salinan", date: "2026-11-22" },
  ]);
});

test("duplicate aborts after a metadata failure and succeeds after retry", async () => {
  const first = deferred();
  const writes = [];
  const { render, copies } = providerFixture((_id, patch) => {
    writes.push(patch);
    return writes.length === 1 ? first.promise : Promise.resolve({ ...source, ...patch });
  });
  await render().refresh();
  const data = render();

  const saving = data.updateDocument(documentId, { date: "2026-11-22" });
  const duplicateFailure = assert.rejects(data.duplicateDocument(documentId), /offline/);
  await settledTurn();
  const savingLatest = data.updateDocument(documentId, { title: "After" });
  first.reject(new Error("offline"));
  await Promise.all([saving, savingLatest, duplicateFailure]);
  assert.deepEqual(copies, []);
  assert.equal(writes.length, 1);

  await data.retryDocumentSave(documentId);
  await data.duplicateDocument(documentId);
  assert.deepEqual(writes[1], { date: "2026-11-22", title: "After" });
  assert.equal(copies[0].title, "After — Salinan");
  assert.equal(copies[0].date, "2026-11-22");
});

test("duplicate snapshots items after the edits it waited for", async () => {
  const firstWrite = deferred();
  const writes = [];
  const { render, inserted } = providerFixture(undefined, {
    updateWorkItemRecord: (_id, patch) => {
      writes.push(patch);
      return writes.length === 1 ? firstWrite.promise : Promise.resolve();
    },
  });
  await render().refresh();
  const data = render();

  data.updateWorkItem(documentId, itemId, { description: "A" });
  const duplicating = data.duplicateDocument(documentId);
  await settledTurn();
  data.updateWorkItem(documentId, itemId, { description: "B" });
  firstWrite.resolve();
  await duplicating;

  assert.deepEqual(writes, [{ description: "A" }, { description: "B" }]);
  assert.deepEqual(inserted.map(({ items }) => items[0].description), ["B"]);
});

test("duplicate waits for an item insert and captures the updated list", async () => {
  const itemInsert = deferred();
  let storedCount = 1;
  const { render, copies, inserted } = providerFixture(undefined, {
    createWorkItemRecord: async (_id, preset) => {
      await itemInsert.promise;
      storedCount += 1;
      return { ...item, ...preset };
    },
    countDocumentItems: async () => storedCount,
  });
  await render().refresh();
  const data = render();

  const adding = data.addWorkItem(documentId, { id: "item-2", description: "New item" });
  const duplicating = data.duplicateDocument(documentId);
  await settledTurn();
  assert.deepEqual(copies, []);

  itemInsert.resolve();
  await Promise.all([adding, duplicating]);
  assert.deepEqual(inserted[0].items.map(({ description }) => description), ["Original", "New item"]);
});

test("duplicate copies an empty document reloaded from Supabase only when its count is zero", async () => {
  const createdAt = "2026-10-01T00:00:00Z";
  const rows = {
    projects: [{ id: source.projectId, name: "Project", status: "active", created_at: createdAt }],
    rab_documents: [{
      id: documentId,
      project_id: source.projectId,
      title: source.title,
      date: source.date,
      created_at: createdAt,
    }],
    rab_items: [],
  };
  const { fetchWorkspace } = sourceLoader({
    "./client": {
      getSupabaseClient: () => ({
        from(table) {
          return {
            select() { return this; },
            order() { return this; },
            async range(from, to) {
              return { data: rows[table].slice(from, to + 1), error: null };
            },
          };
        },
      }),
    },
  })("lib/supabase/data.ts");
  let storedCount = 0;
  const countChecks = [];
  const { render, copies, inserted } = providerFixture(undefined, {
    fetchWorkspace,
    countDocumentItems: async (id) => {
      countChecks.push(id);
      return storedCount;
    },
  });

  await render().refresh();
  const copy = await render().duplicateDocument(documentId);
  assert.deepEqual(copies, [
    { projectId: source.projectId, title: "Before — Salinan", date: source.date },
  ]);
  assert.deepEqual(render().getDocumentDetail(copy.id).items, []);
  assert.deepEqual(inserted, []);

  storedCount = 1;
  await assert.rejects(render().duplicateDocument(documentId), /1 item, tetapi baru 0/);
  assert.deepEqual(countChecks, [documentId, documentId]);
  assert.equal(copies.length, 1);
});

test("duplicate still rejects a loading workspace and a missing item collection", async () => {
  const load = deferred();
  const { render, copies } = providerFixture(undefined, {
    fetchWorkspace: () => load.promise,
    countDocumentItems: async () => assert.fail("an incomplete workspace must not reach the count query"),
  });
  const reloading = render().refresh();
  await assert.rejects(render().duplicateDocument(documentId), /Data dokumen belum siap/);

  load.resolve({ ...workspaceFixture(), items: {} });
  await reloading;
  await assert.rejects(render().duplicateDocument(documentId), /Item dokumen sumber belum termuat/);
  assert.deepEqual(copies, []);
});

test("duplicate keeps its snapshot when a later edit arrives during the count check", async () => {
  const countStarted = deferred();
  const count = deferred();
  const { render, inserted } = providerFixture(undefined, {
    countDocumentItems: () => {
      countStarted.resolve();
      return count.promise;
    },
    updateWorkItemRecord: async () => {},
  });
  await render().refresh();
  const data = render();

  const duplicating = data.duplicateDocument(documentId);
  await countStarted.promise;
  data.updateWorkItem(documentId, itemId, { description: "Later edit" });
  count.resolve(1);
  await duplicating;
  await data.flushDocumentWrites(documentId);

  assert.deepEqual(inserted.map(({ items }) => items[0].description), ["Original"]);
});

function comparisonFixture(data) {
  const downloads = [];
  const errors = [];
  const load = sourceLoader({
    react: {
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
      useMemo: (compute) => compute(),
    },
    sonner: { toast: { error: (...args) => errors.push(args), success: () => {} } },
    "@/components/providers/data-provider": { useData: () => data },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/dialog": {
      Dialog: "dialog",
      DialogContent: "dialog-content",
      DialogDescription: "dialog-description",
      DialogFooter: "dialog-footer",
      DialogHeader: "dialog-header",
      DialogTitle: "dialog-title",
    },
    "@/components/ui/label": { Label: "label" },
    "@/components/ui/select": {
      Select: "select",
      SelectContent: "select-content",
      SelectItem: "select-item",
      SelectTrigger: "select-trigger",
      SelectValue: "select-value",
    },
    "@/lib/rab-compare-excel": {
      downloadComparisonExcel: async (input) => {
        downloads.push(input);
        return "comparison.xlsx";
      },
    },
  });
  const { CompareDocumentsDialog } = load("components/rab/compare-documents-dialog.tsx");
  const tree = CompareDocumentsDialog({
    document: data.getDocumentDetail(documentId),
    onOpenChange: () => {},
  });
  const footer = tree.props.children.props.children.find(({ type }) => type === "dialog-footer");
  const exportButton = footer.props.children[0];
  assert.equal(exportButton.props.disabled, false);
  return { clickExport: exportButton.props.onClick, downloads, errors };
}

test("compare export waits for both documents and reads the acknowledged titles and totals", async () => {
  const metadata = deferred();
  const itemWrite = deferred();
  const { render } = providerFixture(() => metadata.promise, {
    updateWorkItemRecord: () => itemWrite.promise,
  });
  await render().refresh();
  const data = render();
  const comparison = comparisonFixture(data);

  const saving = data.updateDocument(documentId, { title: "Acknowledged title" });
  data.updateWorkItem(comparisonId, comparisonItemId, { unitPrice: 225 });
  comparison.clickExport();
  await settledTurn();
  assert.deepEqual(comparison.downloads, []);

  metadata.resolve({ ...source, title: "Acknowledged title" });
  await saving;
  await settledTurn();
  assert.deepEqual(comparison.downloads, []);

  itemWrite.resolve();
  await settledTurn();
  assert.deepEqual(comparison.errors, []);
  assert.equal(comparison.downloads.length, 1);
  const [download] = comparison.downloads;
  assert.equal(download.baseline.title, "Acknowledged title");
  assert.equal(download.result.baselineTotal, 100);
  assert.equal(download.result.comparisonTotal, 225);
});

test("compare export checks both queues again before reading a snapshot", async () => {
  const otherDocumentWrite = deferred();
  const writes = [];
  const { render } = providerFixture(undefined, {
    updateWorkItemRecord: (id, patch) => {
      writes.push({ id, patch });
      return id === comparisonItemId ? otherDocumentWrite.promise : Promise.resolve();
    },
  });
  await render().refresh();
  const data = render();
  const comparison = comparisonFixture(data);

  data.updateWorkItem(comparisonId, comparisonItemId, { unitPrice: 225 });
  comparison.clickExport();
  await settledTurn();
  assert.equal(writes.length, 1);
  data.updateWorkItem(documentId, itemId, { unitPrice: 350 });
  otherDocumentWrite.resolve();
  await settledTurn();
  assert.deepEqual(comparison.downloads, []);
  assert.match(comparison.errors[0][1].description, /Before.*tersimpan/);

  comparison.clickExport();
  await settledTurn();
  assert.equal(comparison.downloads.length, 1);
  assert.equal(comparison.downloads[0].result.baselineTotal, 350);
});

test("failed add and delete both survive, and comparison and duplication recover after retry", async () => {
  const lostItem = { ...item, id: "lost-add", description: "Already committed" };
  const stored = new Map([[itemId, item]]);
  let insertCount = 0;
  let deleteCount = 0;
  let loadCount = 0;
  let lookupFails = true;
  const deleting = deferred();
  const { render, copies, inserted } = providerFixture(undefined, {
    fetchWorkspace: async () => {
      loadCount += 1;
      return workspaceFixture();
    },
    createWorkItemRecord: async (_id, preset) => {
      assert.equal(preset.id, lostItem.id);
      insertCount += 1;
      stored.set(preset.id, lostItem);
      throw new Error("insert response lost");
    },
    fetchWorkItemRecord: async (id) => {
      if (lookupFails) throw new Error("lookup offline");
      return { documentId, item: stored.get(id) };
    },
    deleteWorkItemRecord: async (id) => {
      deleteCount += 1;
      if (deleteCount === 1) await deleting.promise;
      stored.delete(id);
    },
    updateWorkItemRecord: async () => {},
    countDocumentItems: async () => stored.size,
  });
  await render().refresh();
  const data = render();
  const comparison = comparisonFixture(data);

  const addFailure = assert.rejects(data.addWorkItem(documentId, { id: lostItem.id }), /insert response lost/);
  const deleteFailure = assert.rejects(data.removeWorkItem(documentId, itemId), /delete offline/);
  data.updateWorkItem(comparisonId, comparisonItemId, { unitPrice: 275 });
  deleting.reject(new Error("delete offline"));
  await Promise.all([addFailure, deleteFailure]);
  assert.equal(loadCount, 1);
  assert.equal(render().getDocumentDetail(comparisonId).items[0].unitPrice, 275);
  assert.deepEqual(render().getDocumentDetail(documentId).items.map(({ id }) => id), [itemId]);

  await assert.rejects(data.duplicateDocument(documentId), /Before.*insert response lost.*Coba lagi/);
  comparison.clickExport();
  await settledTurn();
  assert.deepEqual(comparison.downloads, []);
  assert.match(comparison.errors[0][1].description, /Before.*Coba lagi/);
  assert.deepEqual(copies, []);

  await assert.rejects(data.retryDocumentSave(documentId), /lookup offline/);
  assert.equal(deleteCount, 2);
  assert.equal(insertCount, 1);
  assert.deepEqual(render().getDocumentDetail(documentId).items, []);

  lookupFails = false;
  const retry = data.retryDocumentSave(documentId);
  const copy = data.duplicateDocument(documentId);
  comparison.clickExport();
  await Promise.all([retry, copy]);
  await settledTurn();

  assert.equal(render().getDocumentSaveState(documentId).phase, "saved");
  assert.equal(insertCount, 1);
  assert.equal(deleteCount, 2);
  assert.deepEqual(inserted[0].items.map(({ description }) => description), [lostItem.description]);
  assert.equal(comparison.downloads.length, 1);
  assert.equal(comparison.downloads[0].result.comparisonTotal, 275);
});

test("repeated delete and retry share one request and preserve the row until acknowledged", async () => {
  const retryDelete = deferred();
  let deletes = 0;
  const { render } = providerFixture(undefined, {
    deleteWorkItemRecord: () => {
      deletes += 1;
      return deletes === 1 ? Promise.reject(new Error("offline")) : retryDelete.promise;
    },
    updateWorkItemRecord: async () => {},
  });
  await render().refresh();
  const data = render();
  data.updateWorkItem(documentId, itemId, { unitPrice: 310 });
  await assert.rejects(data.removeWorkItem(documentId, itemId), /offline/);
  assert.equal(render().getDocumentDetail(documentId).items[0].unitPrice, 310);

  const retry = data.retryDocumentSave(documentId);
  const secondRetry = data.retryDocumentSave(documentId);
  const manualDelete = data.removeWorkItem(documentId, itemId);
  await settledTurn();
  assert.equal(deletes, 2);
  assert.equal(render().getDocumentDetail(documentId).items.length, 1);
  retryDelete.resolve();
  await Promise.all([retry, secondRetry, manualDelete]);
  assert.equal(deletes, 2);
  assert.deepEqual(render().getDocumentDetail(documentId).items, []);
});
