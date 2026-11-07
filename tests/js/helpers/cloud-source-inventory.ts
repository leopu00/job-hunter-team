import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";

// Use the runner's declared lexer, without a second parser or a shared manifest change.
const lexer = createRequire(import.meta.resolve("vitest"))("es-module-lexer") as {
  initSync(): void;
  parse(source: string): [ReadonlyArray<{ n?: string }>];
};
lexer.initSync();

export const CLOUD_ROOT = "cli/src/commands/cloud.js";
export const CLOUD_GROUP = "cli/src/lib/cloud-pipeline";
export type Sources = Map<string, string>;

function readSource(root: string, path: string): string {
  const text = readFileSync(resolve(root, path), "utf8");
  if (!text.trim()) throw new Error(`empty cloud source: ${path}`);
  return text;
}

function groupFiles(root: string, directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`cloud source symlink: ${path}`);
    if (entry.isDirectory()) files.push(...groupFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files.sort();
}

/** null selects the inline baseline; an expected module directory may never be silently absent. */
export function cloudSources(root: string, group: string | null = CLOUD_GROUP): Sources {
  const files = [CLOUD_ROOT, ...(group === null ? [] : groupFiles(root, group))];
  return new Map(files.sort().map((path) => [path, readSource(root, path)]));
}

export function sourceAt(sources: Sources, path: string): string {
  const source = sources.get(path);
  if (!source?.trim()) throw new Error(`required cloud source absent or empty: ${path}`);
  return source;
}

/** Literal imports and re-exports, including same-line declarations; no module is executed. */
export function literalDependencies(source: string): string[] {
  const [imports] = lexer.parse(source);
  return [...new Set(imports.flatMap((entry) => entry.n === undefined ? [] : [entry.n]))].sort();
}

export function dependencyInventory(root: string, sources: Sources): Map<string, string[]> {
  return new Map([...sources].map(([path, source]) => {
    const dependencies = literalDependencies(source).map((specifier) => {
      if (!specifier.startsWith(".")) return specifier;
      const full = resolve(root, dirname(path), specifier);
      if (!statSync(full).isFile()) throw new Error(`cloud dependency is not a file: ${specifier}`);
      return relative(root, full).replaceAll("\\", "/");
    });
    return [path, dependencies];
  }));
}

export type Operation = { path: string; declaration: string; body: string };

/** Top-level cloud functions close on their own line. Reject missing, empty or ambiguous acquisitions. */
export function operation(sources: Sources, name: string): Operation {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name)) throw new Error("invalid cloud operation name");
  const start = new RegExp("^(?:export )?(?:async )?function " + name + "[(]", "gm");
  const found: Operation[] = [];
  for (const [path, text] of sources) {
    for (const match of text.matchAll(start)) {
      const end = text.indexOf("\n}", match.index);
      if (end < 0) throw new Error(`unclosed cloud operation: ${name}`);
      const declaration = text.slice(match.index, end + 2);
      // Current cloud declarations, including multiline parameter lists, end their signature with ') {'.
      const signatureEnd = declaration.indexOf(") {");
      if (signatureEnd < 0) throw new Error(`cloud signature not recognized: ${name}`);
      const open = signatureEnd + 2;
      const body = declaration.slice(open + 1, -1);
      if (!body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim()) {
        throw new Error(`empty cloud operation: ${name}`);
      }
      found.push({ path, declaration, body });
    }
  }
  if (found.length !== 1) throw new Error(`cloud operation ${name}: expected one implementation, found ${found.length}`);
  return found[0];
}

export function operationInventory(sources: Sources): Map<string, Operation> {
  const names = [...sources.values()].flatMap((text) =>
    [...text.matchAll(/^(?:export )?(?:async )?function ([a-zA-Z_][a-zA-Z_0-9]*)[(]/gm)].map((match) => match[1]));
  if (names.length === 0) throw new Error("empty cloud operation inventory");
  const entries = names.map((name): [string, Operation] => [name, operation(sources, name)]);
  return new Map(entries.sort(([a], [b]) => a.localeCompare(b)));
}

export function requireOperation(sources: Sources, name: string, fragments: string[]): Operation {
  const result = operation(sources, name);
  for (const fragment of fragments) {
    if (!result.body.includes(fragment)) throw new Error(`cloud operation ${name} lacks ${fragment}`);
  }
  return result;
}

export function violations(sources: Sources, forbidden: RegExp): string[] {
  return [...sources].filter(([, body]) => new RegExp(forbidden.source, forbidden.flags).test(body)).map(([path]) => path);
}
