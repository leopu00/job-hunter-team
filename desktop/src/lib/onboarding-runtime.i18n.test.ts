// @vitest-environment node
/**
 * The onboarding's Rust sends keys, never sentences:
 * - no Italian sentence is written by hand in onboarding.rs, windows_runtime.rs
 *   or profile_import.rs (outside their tests);
 * - every `ui_*` key they send is told in the 7 languages, and every key of
 *   the table is still sent (the stage fallbacks are the app's own).
 * The scan reads Rust literals with a small tokenizer (comments, raw strings
 * and char literals included) and refuses to pass when it reads nothing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { RUNTIME_TEXT } from "./onboarding-runtime.i18n";
import { STATE_TEXT } from "./onboarding-state.i18n";

const RUST = fileURLToPath(new URL("../../src-tauri/src/", import.meta.url));
const ONBOARDING_RUST = ["onboarding.rs", "windows_runtime.rs", "profile_import.rs"];

/** The string literals of Rust source, without its tests module. */
export function rustLiterals(source: string): string[] {
  const cut = source.indexOf("#[cfg(test)]\nmod tests {");
  const code = cut >= 0 ? source.slice(0, cut) : source;
  const literals: string[] = [];
  let i = 0;
  while (i < code.length) {
    if (code.startsWith("//", i)) { const end = code.indexOf("\n", i); i = end < 0 ? code.length : end; continue; }
    if (code.startsWith("/*", i)) { i = code.indexOf("*/", i) + 2; continue; }
    const raw = /^r(#*)"/.exec(code.slice(i, i + 10));
    if (raw && !/[A-Za-z0-9_]/.test(code[i - 1] ?? "")) {
      const close = `"${raw[1]}`;
      const start = i + raw[0].length;
      const end = code.indexOf(close, start);
      literals.push(code.slice(start, end));
      i = end + close.length;
      continue;
    }
    if (code[i] === "'") {
      const char = /^'(\\.|[^'\\])'/.exec(code.slice(i, i + 12));
      i += char ? char[0].length : 1;
      continue;
    }
    if (code[i] === '"') {
      let j = i + 1;
      while (code[j] !== '"') j += code[j] === "\\" ? 2 : 1;
      literals.push(code.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return literals;
}

const ITALIAN_WORDS = new Set([
  "il", "lo", "gli", "di", "del", "della", "dei", "che", "non", "per", "una", "uno", "con", "sono", "nel", "nella", "ancora",
  "riprova", "verifica", "verifico", "avvio", "accesso", "squadra", "configurazione", "completato", "attivo", "pronto",
  "installato", "riesco", "macchina", "cartella", "dati", "chiave", "inserisci", "completa", "apri", "risposta",
]);

/** An Italian sentence: an accented letter or apostrophe, or two Italian words, or one typical UI word. */
export function looksItalian(text: string): boolean {
  if (!/\p{L}{2,}\s+\p{L}{2,}/u.test(text) && !/^\p{Lu}\p{Ll}+$/u.test(text)) return false;
  if (/[àèéìòù’]/.test(text)) return true;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const italian = words.filter((word) => ITALIAN_WORDS.has(word));
  return italian.length >= 2 || italian.some((word) => word.length > 4);
}

describe("the onboarding's Rust sends keys, never sentences", () => {
  const literals = ONBOARDING_RUST.flatMap((file) => rustLiterals(readFileSync(`${RUST}${file}`, "utf8")));

  it("reads the Rust it is meant to read", () => {
    expect(literals.length).toBeGreaterThan(300);
  });

  it("writes no Italian sentence by hand", () => {
    expect(literals.filter(looksItalian)).toEqual([]);
  });

  it("would catch one that comes back", () => {
    const probe = 'fn a() { let c = \'"\'; reporter.run(Stage, "Avvio la squadra", "ui_team_progress", r#"echo ok"#); failure("Riprova") }';
    expect(rustLiterals(probe).filter(looksItalian)).toEqual(["Avvio la squadra", "Riprova"]);
  });

  it("sends only keys the app tells, and the app has no key nobody sends", () => {
    const sent = new Set(literals.filter((literal) => /^ui_[a-z0-9_]+$/.test(literal)));
    const told = new Set(Object.keys(RUNTIME_TEXT.it));
    expect([...sent].filter((key) => !told.has(key))).toEqual([]);
    expect([...told].filter((key) => !sent.has(key) && !key.startsWith("ui_fallback_"))).toEqual([]);
    expect(sent.size).toBeGreaterThan(40);
  });
});

function texts(value: unknown, path = ""): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => texts(item, `${path}[${index}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => texts(item, path ? `${path}.${key}` : key));
  throw new Error(`${path}: not a text`);
}

describe.each([
  ["runtime", RUNTIME_TEXT],
  ["state", STATE_TEXT],
] as const)("%s dictionary", (_name, dictionary) => {
  const source = texts(dictionary.it);
  it.each(locales.filter((locale) => locale !== "it"))("%s has every Italian text, none empty, none left in Italian", (locale) => {
    const translated = texts(dictionary[locale]);
    expect(translated.map(({ path }) => path)).toEqual(source.map(({ path }) => path));
    for (const { path, text } of translated) expect(text.trim(), `${locale} ${path}`).not.toBe("");
    const sentences = source.filter(({ text }) => text.split(" ").length >= 4);
    const copied = sentences.filter(({ path, text }) => translated.find((item) => item.path === path)?.text === text);
    expect(copied.map(({ path }) => path), `${locale}: sentences still in Italian`).toEqual([]);
  });
});
