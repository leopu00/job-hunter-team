import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";

/** Keep offsets and newlines while hiding Rust comments and literals. */
function rustMask(source: string): string {
  const chars = source.split("");
  let i = 0;
  while (i < source.length) {
    const start = i;
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
    } else {
      const raw = /^(?:br|r)(#*)"/.exec(source.slice(i, i + 20));
      const char = /^'(?:\\(?:u\{[\da-f]+\}|x[\da-f]{2}|.)|[^'\\\n])'/i.exec(source.slice(i, i + 20));
      if (raw) {
        const end = source.indexOf(`"${raw[1]}`, i + raw[0].length);
        if (end < 0) throw new Error("Unclosed Rust raw string");
        i = end + raw[1].length + 1;
      } else if (char) i += char[0].length;
      else if (source[i] === '"') {
        i++;
        while (i < source.length && source[i] !== '"') i += source[i] === "\\" ? 2 : 1;
        i++;
      } else { i++; continue; }
    }
    for (let j = start; j < i; j++) if (chars[j] !== "\n") chars[j] = " ";
  }
  return chars.join("");
}

type CfgValue = boolean | undefined;

function cfgValue(tokens: string[], cursor: { at: number }): CfgValue {
  const name = tokens[cursor.at++];
  if (tokens[cursor.at] === "=") { cursor.at += 2; return undefined; }
  if (tokens[cursor.at] !== "(") return name === "test" ? false : undefined;
  cursor.at++;
  const values: CfgValue[] = [];
  while (cursor.at < tokens.length && tokens[cursor.at] !== ")") {
    if (tokens[cursor.at] === ",") cursor.at++;
    else values.push(cfgValue(tokens, cursor));
  }
  cursor.at++;
  if (name === "not") return values[0] === undefined ? undefined : !values[0];
  if (name === "all") return values.includes(false) ? false : values.includes(undefined) ? undefined : true;
  if (name === "any") return values.includes(true) ? true : values.includes(undefined) ? undefined : false;
  return undefined;
}

function testOnly(attribute: string): boolean {
  const cfg = /^#\s*\[\s*cfg\s*\((.*)\)\s*\]$/s.exec(attribute);
  if (!cfg) return false;
  const tokens = cfg[1].match(/"(?:\\.|[^"\\])*"|\w+|[(),=]/g) ?? [];
  return cfgValue(tokens, { at: 0 }) === false;
}

function closing(mask: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < mask.length; i++) {
    if (mask[i] === open) depth++;
    if (mask[i] === close && --depth === 0) return i;
  }
  throw new Error(`Unclosed Rust ${open}`);
}

function itemEnd(mask: string, start: number): number {
  let i = start;
  while (i < mask.length) {
    if (/\s/.test(mask[i])) { i++; continue; }
    if (mask.startsWith("#[", i)) { i = closing(mask, i + 1, "[", "]") + 1; continue; }
    break;
  }
  const item = /^(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern|default)\s+)*(?:fn|struct|enum|impl|const|static|type|mod|use|trait|union)\b/.test(mask.slice(i));
  let parens = 0;
  let brackets = 0;
  for (; i < mask.length; i++) {
    if (mask[i] === "(") parens++;
    if (mask[i] === ")") parens--;
    if (mask[i] === "[") brackets++;
    if (mask[i] === "]") brackets--;
    if (!parens && !brackets && mask[i] === ";") return i + 1;
    if (!item && !parens && !brackets && mask[i] === ",") return i + 1;
    if (!parens && !brackets && mask[i] === "}") return i;
    if (!parens && !brackets && mask[i] === "{") return closing(mask, i, "{", "}") + 1;
  }
  throw new Error("Rust test attribute has no item");
}

function attributesStart(mask: string, before: number): number {
  let start = before;
  let i = before - 1;
  while (i >= 0) {
    while (i >= 0 && /\s/.test(mask[i])) i--;
    if (mask[i] !== "]") break;
    let depth = 1;
    while (--i >= 0 && depth) {
      if (mask[i] === "]") depth++;
      if (mask[i] === "[") depth--;
    }
    while (i >= 0 && /\s/.test(mask[i])) i--;
    if (mask[i] !== "#") break;
    start = i--;
  }
  return start;
}

const productionSources = new Map<string, string>();

/** Remove individual test-only items, keeping production that follows them. */
export function withoutRustTests(source: string): string {
  const cached = productionSources.get(source);
  if (cached !== undefined) return cached;
  const mask = rustMask(source);
  const attributes = /#\s*\[/g;
  const chunks: string[] = [];
  let kept = 0;
  for (let match; (match = attributes.exec(mask));) {
    const bracket = mask.indexOf("[", match.index);
    const end = closing(mask, bracket, "[", "]") + 1;
    if (!testOnly(source.slice(match.index, end))) continue;
    const until = itemEnd(mask, end);
    const start = attributesStart(mask, match.index);
    // A separator keeps adjacent production tokens apart without leaving huge
    // whitespace blocks for the catalog's multiline regular expressions.
    chunks.push(source.slice(kept, start), "\n");
    kept = until;
    attributes.lastIndex = until;
  }
  const production = chunks.join("") + source.slice(kept);
  productionSources.set(source, production);
  return production;
}

function explicitPath(source: string, mask: string, before: number): string | undefined {
  let i = before - 1;
  while (i >= 0) {
    while (i >= 0 && /\s/.test(mask[i])) i--;
    if (mask[i] !== "]") return undefined;
    const end = i + 1;
    let depth = 1;
    while (--i >= 0 && depth) {
      if (mask[i] === "]") depth++;
      if (mask[i] === "[") depth--;
    }
    const attribute = source.slice(i + 1, end);
    const path = /^\[\s*path\s*=\s*"([^"]+)"\s*\]$/.exec(attribute);
    if (path) return path[1];
    while (i >= 0 && /\s/.test(mask[i])) i--;
    if (mask[i] === "#") i--;
  }
  return undefined;
}

type ModuleRef = { name: string; path?: string; directory: string; explicitDirectory: string };

function moduleRefs(source: string, directory: string, explicitDirectory: string): ModuleRef[] {
  const mask = rustMask(source);
  const found: ModuleRef[] = [];
  const declarations = /\b(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*(;|\{)/g;
  let cursor = 0;
  let depth = 0;
  for (let match; (match = declarations.exec(mask));) {
    for (; cursor < match.index; cursor++) {
      if (mask[cursor] === "{") depth++;
      if (mask[cursor] === "}") depth--;
    }
    if (depth) continue;
    const name = match[1];
    if (match[2] === ";") found.push({ name, path: explicitPath(source, mask, match.index), directory, explicitDirectory });
    else {
      const open = declarations.lastIndex - 1;
      const end = closing(mask, open, "{", "}");
      found.push(...moduleRefs(source.slice(open + 1, end), join(directory, name), join(directory, name)));
      declarations.lastIndex = end + 1;
      cursor = end + 1;
    }
  }
  return found;
}

/** Follow Rust's mod name, mod.rs and #[path] edges, excluding test-only items. */
export function compiledRustSourceFiles(
  root: string,
  read = (file: string) => readFileSync(file, "utf8"),
  exists: (file: string) => boolean = existsSync,
): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = withoutRustTests(read(file));
    const directory = ["lib.rs", "main.rs", "mod.rs"].includes(basename(file))
      ? dirname(file) : join(dirname(file), basename(file, extname(file)));
    for (const mod of moduleRefs(source, directory, dirname(file))) {
      const candidates = mod.path ? [join(mod.explicitDirectory, mod.path)]
        : [join(mod.directory, `${mod.name}.rs`), join(mod.directory, mod.name, "mod.rs")];
      const next = candidates.find(exists);
      if (!next) throw new Error(`${file}: missing production module ${mod.name}`);
      visit(next);
    }
  };
  visit(root);
  return [...seen].map((file) => relative(dirname(root), file).replaceAll("\\", "/"));
}
