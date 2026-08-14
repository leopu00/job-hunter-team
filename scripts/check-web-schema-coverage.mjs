#!/usr/bin/env node

/**
 * Fail-closed bridge from the shipped web Supabase queries to the versioned
 * live-schema receipts.  The default command is entirely offline: it reads
 * TypeScript and JSON from the checkout and never reads credentials or opens
 * a network connection.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_COVERAGE = path.join(
  ROOT,
  "supabase/live-schema/web-code-coverage.v1.json",
);
const DEFAULT_CANARY = path.join(
  ROOT,
  "supabase/live-schema/078-084.web.v4.json",
);
const DEFAULT_SOURCE_ROOT = path.join(ROOT, "web");

const TOP_KEYS = ["schema_version", "source_roots", "canary", "coverage"];
const CANARY_KEYS = ["path", "sha256", "contract_id"];
const COVERAGE_KEYS = ["rpcs", "tables", "columns", "ambiguous_sites"];
const ENTRY_KEYS = new Set(["receipts", "exception"]);
const EXCEPTIONS = new Set([
  "legacy_pre_078_schema",
  "unreceipted_rpc_reviewed",
  "reviewed_dynamic_schema_use",
]);
const FILTER_METHODS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "textSearch",
  "filter",
  "not",
  "order",
]);
const WRITE_METHODS = new Set(["insert", "update", "upsert"]);
const ORPHAN_METHODS = new Set([
  "select",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "not",
  "or",
  "order",
  "insert",
  "update",
  "upsert",
]);

class GateError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function isExactInteger(value, expected) {
  return typeof value === "number" && Number.isInteger(value) && value === expected;
}

async function readJsonExact(file) {
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new GateError("input_unreadable");
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    if (error instanceof RangeError) throw new GateError("input_malformed");
    throw new GateError("input_malformed");
  }
}

async function sourceFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new GateError("source_unreadable");
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        files.push(target);
      }
    }
  }
  for (const child of ["app", "lib"]) await walk(path.join(root, child));
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function staticString(ts, node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isParenthesizedExpression(node)) return staticString(ts, node.expression);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(ts, node.left);
    const right = staticString(ts, node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function compact(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function enclosingName(ts, node) {
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isFunctionExpression(current)
    ) {
      return current.name?.getText(current.getSourceFile()) ?? "anonymous";
    }
    if (ts.isArrowFunction(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent)) return parent.name.getText(parent.getSourceFile());
      if (ts.isPropertyAssignment(parent)) return parent.name.getText(parent.getSourceFile());
      return "anonymous";
    }
    current = current.parent;
  }
  return "module";
}

function ambiguityId(ts, kind, node, sourceFile, relativePath) {
  const identity = [
    relativePath.replaceAll(path.sep, "/"),
    // A reviewed dynamic alias is valid only for this exact source file. This
    // binds local constant/allowlist changes to the exception instead of
    // letting an unchanged `.from(table)` expression hide a new table.
    sha256(sourceFile.text),
    enclosingName(ts, node),
    kind,
    compact(node, sourceFile),
  ].join("\u0000");
  return `sha256:${sha256(identity)}`;
}

function parseSelector(selector, rootTable) {
  const columns = new Set();
  let ambiguous = false;
  let index = 0;

  function skipSpace() {
    while (/\s/.test(selector[index] ?? "")) index += 1;
  }

  function identifier() {
    skipSpace();
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(selector.slice(index));
    if (!match) return null;
    index += match[0].length;
    return match[0];
  }

  function list(table, terminal = null) {
    while (index < selector.length && selector[index] !== terminal) {
      skipSpace();
      if (selector[index] === ",") {
        index += 1;
        continue;
      }
      if (selector[index] === "*") {
        ambiguous = true;
        index += 1;
        continue;
      }
      let name = identifier();
      if (!name) {
        ambiguous = true;
        index += 1;
        continue;
      }
      skipSpace();
      if (selector[index] === ":") {
        index += 1;
        const target = identifier();
        if (!target) {
          ambiguous = true;
          continue;
        }
        name = target;
        skipSpace();
      }
      while (selector[index] === "!") {
        index += 1;
        if (!identifier()) ambiguous = true;
        skipSpace();
      }
      if (selector[index] === "(") {
        index += 1;
        list(name, ")");
        if (selector[index] === ")") index += 1;
        else ambiguous = true;
      } else {
        columns.add(`${table}.${name}`);
      }
      skipSpace();
    }
  }

  list(rootTable);
  return { columns, ambiguous };
}

function objectColumns(ts, node, table) {
  const columns = new Set();
  let ambiguous = false;

  function visit(value) {
    if (ts.isParenthesizedExpression(value)) return visit(value.expression);
    if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements) visit(element);
      return;
    }
    if (!ts.isObjectLiteralExpression(value)) {
      ambiguous = true;
      return;
    }
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        ambiguous = true;
        continue;
      }
      if (
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        ts.isMethodDeclaration(property)
      ) {
        const name = property.name;
        if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
          columns.add(`${table}.${name.text}`);
        } else {
          ambiguous = true;
        }
        continue;
      }
      ambiguous = true;
    }
  }

  visit(node);
  return { columns, ambiguous };
}

function chainCalls(ts, fromCall) {
  const calls = [];
  let base = fromCall;
  let current = fromCall.parent;
  while (current) {
    if (ts.isPropertyAccessExpression(current) && current.expression === base) {
      current = current.parent;
      continue;
    }
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.expression === base
    ) {
      calls.push(current);
      base = current;
      current = current.parent;
      continue;
    }
    if (
      (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) &&
      current.expression === base
    ) {
      base = current;
      current = current.parent;
      continue;
    }
    break;
  }
  return calls;
}

async function loadTypeScript(root) {
  const modulePath = path.join(root, "web/node_modules/typescript/lib/typescript.js");
  try {
    return (await import(pathToFileURL(modulePath).href)).default;
  } catch {
    throw new GateError("dependency_missing");
  }
}

async function census({ sourceRoot = DEFAULT_SOURCE_ROOT, repoRoot = ROOT } = {}) {
  const ts = await loadTypeScript(repoRoot);
  const rpcs = new Set();
  const tables = new Set();
  const columns = new Set();
  const ambiguous = new Set();
  const handled = new Set();
  const files = await sourceFiles(sourceRoot);

  for (const file of files) {
    let source;
    try {
      source = await readFile(file, "utf8");
    } catch {
      throw new GateError("source_unreadable");
    }
    const relativePath = path.relative(repoRoot, file);
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const declarations = new Map();

    function scopeOf(node) {
      let current = node;
      while (current && current !== sourceFile) {
        if (ts.isFunctionLike(current)) return current;
        current = current.parent;
      }
      return sourceFile;
    }

    function collectDeclarations(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const scope = scopeOf(node);
        const values = declarations.get(scope) ?? new Map();
        values.set(node.name.text, node.initializer);
        declarations.set(scope, values);
      }
      ts.forEachChild(node, collectDeclarations);
    }
    collectDeclarations(sourceFile);

    function declarationFor(identifier) {
      let scope = scopeOf(identifier);
      while (scope) {
        const value = declarations.get(scope)?.get(identifier.text);
        if (value) return value;
        if (scope === sourceFile) break;
        scope = scopeOf(scope.parent);
      }
      return null;
    }

    function isSchemaExpression(node, seen = new Set()) {
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (
        ts.isParenthesizedExpression(node) ||
        ts.isAwaitExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node)
      ) {
        return isSchemaExpression(node.expression, seen);
      }
      if (ts.isConditionalExpression(node)) {
        return (
          isSchemaExpression(node.whenTrue, seen) ||
          isSchemaExpression(node.whenFalse, seen)
        );
      }
      if (ts.isIdentifier(node)) {
        return isSchemaExpression(declarationFor(node), seen);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (node.expression.name.text === "from") {
          const receiver = compact(node.expression.expression, sourceFile);
          return (
            receiver !== "Array" &&
            receiver !== "Buffer" &&
            !receiver.endsWith(".storage")
          );
        }
        return isSchemaExpression(node.expression.expression, seen);
      }
      return false;
    }

    function schemaTable(node, seen = new Set()) {
      if (!node || seen.has(node)) return null;
      seen.add(node);
      if (
        ts.isParenthesizedExpression(node) ||
        ts.isAwaitExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node)
      ) {
        return schemaTable(node.expression, seen);
      }
      if (ts.isConditionalExpression(node)) {
        const left = schemaTable(node.whenTrue, seen);
        const right = schemaTable(node.whenFalse, seen);
        return left && left === right ? left : null;
      }
      if (ts.isIdentifier(node)) return schemaTable(declarationFor(node), seen);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (node.expression.name.text === "from") {
          const table = staticString(ts, node.arguments[0]);
          return table && /^[a-z][a-z0-9_]*$/.test(table) ? table : null;
        }
        return schemaTable(node.expression.expression, seen);
      }
      return null;
    }

    function addAmbiguous(kind, node) {
      ambiguous.add(ambiguityId(ts, kind, node, sourceFile, relativePath));
    }

    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === "rpc") {
          handled.add(node);
          const name = staticString(ts, node.arguments[0]);
          if (name === null || !/^[a-z][a-z0-9_]*$/.test(name)) {
            addAmbiguous("rpc_name", node);
          } else {
            rpcs.add(name);
          }
        }

        if (method === "from") {
          const receiver = compact(node.expression.expression, sourceFile);
          const ignored =
            receiver === "Array" ||
            receiver === "Buffer" ||
            receiver.endsWith(".storage");
          if (!ignored) {
            handled.add(node);
            const calls = chainCalls(ts, node);
            for (const call of calls) handled.add(call);
            const table = staticString(ts, node.arguments[0]);
            if (table === null || !/^[a-z][a-z0-9_]*$/.test(table)) {
              addAmbiguous("table_name", node);
            } else {
              tables.add(table);
              for (const call of calls) {
                const callMethod = call.expression.name.text;
                if (callMethod === "select") {
                  const selector = staticString(ts, call.arguments[0]);
                  if (selector === null) {
                    addAmbiguous("select_columns", call);
                  } else {
                    const parsed = parseSelector(selector, table);
                    for (const column of parsed.columns) columns.add(column);
                    if (parsed.ambiguous) addAmbiguous("select_columns", call);
                  }
                } else if (FILTER_METHODS.has(callMethod)) {
                  const column = staticString(ts, call.arguments[0]);
                  if (column === null || !/^[a-z][a-z0-9_]*$/.test(column)) {
                    addAmbiguous("filter_column", call);
                  } else {
                    columns.add(`${table}.${column}`);
                  }
                } else if (callMethod === "or") {
                  addAmbiguous("compound_filter", call);
                } else if (WRITE_METHODS.has(callMethod)) {
                  const payload = call.arguments[0];
                  if (!payload) {
                    addAmbiguous("write_columns", call);
                  } else {
                    const parsed = objectColumns(ts, payload, table);
                    for (const column of parsed.columns) columns.add(column);
                    if (parsed.ambiguous) addAmbiguous("write_columns", call);
                  }
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    function findOrphans(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        ORPHAN_METHODS.has(node.expression.name.text) &&
        !handled.has(node) &&
        isSchemaExpression(node.expression.expression)
      ) {
        const method = node.expression.name.text;
        const table = schemaTable(node.expression.expression);
        if (WRITE_METHODS.has(method) && table && node.arguments[0]) {
          const parsed = objectColumns(ts, node.arguments[0], table);
          for (const column of parsed.columns) columns.add(column);
          if (parsed.ambiguous) addAmbiguous("write_columns", node);
        } else {
          addAmbiguous("detached_query", node);
        }
      }
      ts.forEachChild(node, findOrphans);
    }
    findOrphans(sourceFile);
  }

  return {
    rpcs: [...rpcs].sort((a, b) => a.localeCompare(b, "en")),
    tables: [...tables].sort((a, b) => a.localeCompare(b, "en")),
    columns: [...columns].sort((a, b) => a.localeCompare(b, "en")),
    ambiguous_sites: [...ambiguous].sort((a, b) => a.localeCompare(b, "en")),
  };
}

function validateCoverageMap(map, kind, receipts) {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new GateError("coverage_malformed");
  }
  const names = Object.keys(map);
  if (!names.every((name, index) => index === 0 || names[index - 1] < name)) {
    throw new GateError("coverage_nondeterministic");
  }
  for (const [name, entry] of Object.entries(map)) {
    if (!name || !entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new GateError("coverage_malformed");
    }
    const keys = Object.keys(entry);
    if (keys.length !== 1 || !ENTRY_KEYS.has(keys[0])) {
      throw new GateError("coverage_malformed");
    }
    if (keys[0] === "exception") {
      if (typeof entry.exception !== "string" || !EXCEPTIONS.has(entry.exception)) {
        throw new GateError("coverage_malformed");
      }
    } else {
      if (
        !Array.isArray(entry.receipts) ||
        entry.receipts.length === 0 ||
        !entry.receipts.every((receipt) => typeof receipt === "string") ||
        !entry.receipts.every((receipt, index) => index === 0 || entry.receipts[index - 1] < receipt)
      ) {
        throw new GateError("coverage_malformed");
      }
      for (const receipt of entry.receipts) {
        if (!receipts.has(receipt)) throw new GateError("receipt_missing");
      }
    }
    if (kind === "ambiguous" && keys[0] !== "exception") {
      throw new GateError("coverage_malformed");
    }
  }
}

function compareExact(actual, configured, missingCode, staleCode) {
  const expected = Object.keys(configured);
  if (actual.some((item) => !Object.hasOwn(configured, item))) {
    throw new GateError(missingCode);
  }
  const actualSet = new Set(actual);
  if (expected.some((item) => !actualSet.has(item))) throw new GateError(staleCode);
}

async function verify({
  coveragePath = DEFAULT_COVERAGE,
  canaryPath = DEFAULT_CANARY,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  repoRoot = ROOT,
} = {}) {
  const coverageFile = await readJsonExact(coveragePath);
  const canaryFile = await readJsonExact(canaryPath);
  const manifest = coverageFile.value;
  const canary = canaryFile.value;

  if (!exactKeys(manifest, TOP_KEYS) || !isExactInteger(manifest.schema_version, 1)) {
    throw new GateError("coverage_malformed");
  }
  if (
    !Array.isArray(manifest.source_roots) ||
    manifest.source_roots.length !== 2 ||
    manifest.source_roots[0] !== "web/app" ||
    manifest.source_roots[1] !== "web/lib" ||
    !exactKeys(manifest.canary, CANARY_KEYS) ||
    !exactKeys(manifest.coverage, COVERAGE_KEYS)
  ) {
    throw new GateError("coverage_malformed");
  }
  if (
    typeof manifest.canary.path !== "string" ||
    typeof manifest.canary.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.canary.sha256) ||
    typeof manifest.canary.contract_id !== "string" ||
    manifest.canary.path !== path.relative(repoRoot, canaryPath).replaceAll(path.sep, "/") ||
    manifest.canary.sha256 !== sha256(canaryFile.raw) ||
    canary?.contract_id !== manifest.canary.contract_id ||
    !Array.isArray(canary?.expected_checks)
  ) {
    throw new GateError("canary_mismatch");
  }
  const receipts = new Set(canary.expected_checks);
  if (
    receipts.size !== canary.expected_checks.length ||
    !canary.expected_checks.every((item) => typeof item === "string")
  ) {
    throw new GateError("canary_malformed");
  }

  validateCoverageMap(manifest.coverage.rpcs, "rpc", receipts);
  validateCoverageMap(manifest.coverage.tables, "table", receipts);
  validateCoverageMap(manifest.coverage.columns, "column", receipts);
  validateCoverageMap(manifest.coverage.ambiguous_sites, "ambiguous", receipts);

  const actual = await census({ sourceRoot, repoRoot });
  compareExact(actual.rpcs, manifest.coverage.rpcs, "rpc_uncovered", "rpc_stale");
  compareExact(
    actual.tables,
    manifest.coverage.tables,
    "table_uncovered",
    "table_stale",
  );
  compareExact(actual.columns, manifest.coverage.columns, "column_uncovered", "column_stale");
  compareExact(
    actual.ambiguous_sites,
    manifest.coverage.ambiguous_sites,
    "ambiguous_uncovered",
    "ambiguous_stale",
  );
  return {
    rpc_count: actual.rpcs.length,
    table_count: actual.tables.length,
    column_count: actual.columns.length,
    ambiguous_count: actual.ambiguous_sites.length,
    receipt_count: receipts.size,
  };
}

function parseArgs(argv) {
  const options = {};
  let inventory = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--inventory") {
      inventory = true;
      continue;
    }
    const key = {
      "--coverage": "coveragePath",
      "--canary": "canaryPath",
      "--source-root": "sourceRoot",
      "--repo-root": "repoRoot",
    }[arg];
    const value = argv[index + 1];
    if (!key || !value) throw new GateError("arguments_invalid");
    options[key] = path.resolve(value);
    index += 1;
  }
  return { inventory, options };
}

async function main() {
  try {
    const { inventory, options } = parseArgs(process.argv.slice(2));
    if (inventory) {
      const result = await census(options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    const counts = await verify(options);
    process.stdout.write(
      `WEB-SCHEMA-COVERAGE PASS rpcs=${counts.rpc_count} tables=${counts.table_count} ` +
        `columns=${counts.column_count} ` +
        `ambiguous=${counts.ambiguous_count} receipts=${counts.receipt_count}\n`,
    );
  } catch (error) {
    const code = error instanceof GateError ? error.code : "internal_error";
    process.stderr.write(`WEB-SCHEMA-COVERAGE FAIL code=${code}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();

export { GateError, census, parseSelector, verify };
