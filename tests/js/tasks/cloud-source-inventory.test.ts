/** Source acquisition guards: moving a reader must not hide its implementation or its forbidden effects. */
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CLOUD_GROUP, CLOUD_ROOT, cloudSources, dependencyInventory, literalDependencies,
  operation, operationInventory, requireOperation, sourceAt, violations, type Sources,
} from "../helpers/cloud-source-inventory";

const ROOT = resolve(__dirname, "../../..");
const STORE = `${CLOUD_GROUP}/push-store.js`;
const dirs: string[] = [];
const put = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
function tree() {
  const root = mkdtempSync(join(tmpdir(), "jht-cloud-census-"));
  dirs.push(root);
  put(root, CLOUD_ROOT, `import { read } from '../lib/cloud-pipeline/push-store.js';\n`);
  put(root, STORE, "export function read() {\n  return 1;\n}\n");
  return root;
}
afterEach(() => {
  for (const root of dirs.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("acquires every nested JS leaf in stable order and observes an artificial violation", () => {
  const root = tree();
  const nested = `${CLOUD_GROUP}/nested/deep/reader.js`;
  put(root, nested, "export function readDeep() {\n  forbiddenTransport();\n}\n");
  put(root, `${CLOUD_GROUP}/notes.txt`, "not JavaScript");
  const sources = cloudSources(root);
  expect([...sources.keys()]).toEqual([CLOUD_ROOT, nested, STORE].sort());
  expect(violations(sources, /forbiddenTransport\(/)).toEqual([nested]);
  expect(requireOperation(sources, "readDeep", ["forbiddenTransport();"]).path).toBe(nested);
});

it("refuses absent roots, absent expected directories, missing required leaves and empty sources", () => {
  const root = tree();
  rmSync(join(root, CLOUD_ROOT));
  expect(() => cloudSources(root)).toThrow();
  put(root, CLOUD_ROOT, "export const root = true;");
  rmSync(join(root, CLOUD_GROUP), { recursive: true });
  expect(() => cloudSources(root)).toThrow();
  mkdirSync(join(root, CLOUD_GROUP));
  expect(() => sourceAt(cloudSources(root), STORE)).toThrow(/absent or empty/);
  put(root, STORE, " \n");
  expect(() => cloudSources(root)).toThrow(/empty cloud source/);
});

it("censuses import, export-from and literal import() without executing any module", () => {
  const root = tree();
  const nested = `${CLOUD_GROUP}/deep.js`;
  put(root, nested, "throw new Error('must never execute');\n");
  put(root, STORE, "import 'node:fs';\nexport { deep } from './deep.js';\nconst later = () => import('./deep.js');\n");
  const inventory = dependencyInventory(root, cloudSources(root));
  expect(inventory.get(CLOUD_ROOT)).toEqual([STORE]);
  expect(inventory.get(STORE)).toEqual([nested, "node:fs"]);
  expect(literalDependencies("import {\n value\n} from './value.js';\nexport * from './more.js';\nimport('./async.js');"))
    .toEqual(["./async.js", "./more.js", "./value.js"]);
  put(root, STORE, "export * from './absent.js';\n");
  expect(() => dependencyInventory(root, cloudSources(root))).toThrow();
});

it("never accepts a marker from restore to cover an absent push, or a delegating wrapper as its implementation", () => {
  const sources: Sources = new Map([[CLOUD_ROOT,
    "function handleRestore() {\n  sendChunked();\n}\nfunction performPush() {\n  return delegate();\n}\n"]]);
  expect(() => requireOperation(sources, "performPush", ["sendChunked("])).toThrow(/lacks/);
  expect(() => requireOperation(sources, "missingPush", ["sendChunked("])).toThrow(/found 0/);
  const duplicate = new Map([...sources, [STORE, "function performPush() {\n  return another();\n}\n"]]);
  expect(() => operation(duplicate, "performPush")).toThrow(/found 2/);
  expect(() => operation(new Map([[STORE, "function empty() {\n}\n"]]), "empty")).toThrow(/empty/);
  expect(() => operation(new Map([[STORE, "function unclosed() {\n  return 1;\n"]]), "unclosed")).toThrow(/unclosed/);
});

it("detects every same-line dependency and ignores imports quoted in strings and comments", () => {
  const root = tree();
  put(root, STORE, "export const present = true;\n");
  put(root, CLOUD_ROOT, "import '../lib/cloud-pipeline/push-store.js'; import './missing.js';\n");
  expect(() => dependencyInventory(root, cloudSources(root))).toThrow();
  const text = `const quoted = "import './not-code.js'"; /* import './comment.js' */
    import'./one.js'; export{value}from'./two.js'; const later = () => import('./three.js');`;
  expect(literalDependencies(text)).toEqual(["./one.js", "./three.js", "./two.js"]);
});

it("censuses multiline operations and refuses an inventory with no implementations", () => {
  const sources: Sources = new Map([[CLOUD_ROOT, "async function publish(\n  options = {},\n) {\n  return options;\n}\n"]]);
  expect(operationInventory(sources).get("publish")?.body).toContain("return options");
  expect(() => operationInventory(new Map([[CLOUD_ROOT, "export const wrapper = true;"]]))).toThrow(/empty/);
  expect(operationInventory(cloudSources(ROOT)).size).toBeGreaterThan(6);
});

it("sees the real root and store, their real dependencies, and the single ownership cursor path", () => {
  const sources = cloudSources(ROOT);
  expect(sources.size).toBeGreaterThanOrEqual(2);
  const root = sourceAt(sources, CLOUD_ROOT);
  const store = sourceAt(sources, STORE);
  const deps = dependencyInventory(ROOT, sources);
  expect(deps.get(CLOUD_ROOT)).toContain(STORE);
  expect(deps.get(STORE)).not.toContain(CLOUD_ROOT);
  expect(literalDependencies(store)).toEqual([
    "../../jht-paths.js", "../secure-config-io.js", "node:fs", "node:path", "picocolors",
  ]);
  const all = [...sources.values()].join("\n");
  expect(all.match(/const CLOUD_CURSOR_FILE =/g)).toHaveLength(1);
  expect(root).not.toMatch(/const CLOUD_CURSOR_FILE =/);
  expect(store).toContain("join(JHT_HOME, '.cloud-sync-cursor.json')");
  const start = root.indexOf("const CLOUD_OWNERSHIP_CURSOR_FILES = [");
  const end = root.indexOf("];", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  expect(root.slice(start, end)).toContain("CLOUD_CURSOR_FILE,");
  expect(root.match(/createExclusiveRunner\(performPush\)/g)).toHaveLength(1);
  expect(violations(new Map([[STORE, store]]), /\b(fetch|setTimeout|setInterval|token|client|createExclusiveRunner)\b/)).toEqual([]);
});

const HELPERS: Record<string, string[]> = {
  readSqliteTable: ["db.prepare", "no such table", "throw err"],
  sqliteHasColumn: ["PRAGMA table_info", ".some((r) => r.name === col)"],
  readSqliteTableDelta: ["WHERE updated_at > ?", "return readSqliteTable(db, table, columns)"],
  loadCloudCursor: ["JSON.parse(readFileSync(CLOUD_CURSOR_FILE", "return {}"],
  saveCloudCursor: ["writePrivateJson(CLOUD_CURSOR_FILE, cursor)", "return false"],
  settledCursor: ["for (const r of rows)", "v > max"],
};
it.each(Object.entries(HELPERS))("acquires the real moved implementation of %s", (name, fragments) => {
  expect(requireOperation(cloudSources(ROOT), name, fragments).path).toBe(STORE);
});

const COORDINATOR: Record<string, string[]> = {
  performPush: ["readSqliteTableDelta", "async function sendChunked", "async function checkpointTable"],
  handleRestore: ["new DatabaseSync", "saveCloudCursor"],
  handleChatSync: ["chat.chatChannelFor", "const shouldPull = pending && channel"],
  handleDaemon: ["while (running)", "await handlePullDesiredState", "await handleChatSync"],
  runRealtimeLoop: ["coalescingGuardedLane", "rt.subscribe", "haltGate('slow')"],
};
it.each(Object.entries(COORDINATOR))("keeps a nonempty real operation for %s in the coordinator", (name, fragments) => {
  expect(requireOperation(cloudSources(ROOT), name, fragments).path).toBe(CLOUD_ROOT);
});
