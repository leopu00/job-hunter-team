// @vitest-environment node
/**
 * The onboarding and the Mail page speak the 7 languages of the app:
 * - every language has every key of the Italian source, nothing empty, every
 *   list as long, and is not the Italian copied over;
 * - the three screens hold no sentence written by hand: their text comes from
 *   the dictionaries. The scan reads the source with the TypeScript parser and
 *   fails when it finds nothing to scan, so it cannot pass by not looking.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { MAIL_TEXT } from "../pages/mail/mail.i18n";
import { WINDOWS_SETUP } from "./windows-setup";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

type Leaf = { path: string; text: string };

/** Every text of a dictionary, functions called with sample values. */
function leaves(value: unknown, path = ""): Leaf[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (typeof value === "function") {
    const sample = (value as (...args: unknown[]) => unknown).length >= 2
      ? (value as (a: number, b: number) => unknown)(2, 7)
      : (value as (a: unknown) => unknown)(path.endsWith("installs") ? WINDOWS_SETUP : path.endsWith("hello") ? "Ada" : path.match(/Count|Number/) ? 3 : "X");
    return leaves(sample, `${path}()`);
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, path ? `${path}.${key}` : key));
  }
  throw new Error(`${path}: not a text`);
}

describe.each([
  ["onboarding", ONBOARDING_TEXT],
  ["mail", MAIL_TEXT],
] as const)("%s dictionary", (_name, dictionary) => {
  const source = leaves(dictionary.it);

  it("has the 7 languages of the app", () => {
    expect(Object.keys(dictionary).sort()).toEqual([...locales].sort());
  });

  it.each(locales.filter((locale) => locale !== "it"))("%s has every Italian text, none empty, none left in Italian", (locale) => {
    const translated = leaves(dictionary[locale]);
    expect(translated.map(({ path }) => path)).toEqual(source.map(({ path }) => path));
    for (const { path, text } of translated) expect(text.trim(), `${locale} ${path}`).not.toBe("");
    // Names (Runtime, Provider, Scout, Podman...) may stay the same; whole
    // sentences may not.
    const sentences = source.filter(({ text }) => text.split(" ").length >= 4);
    expect(sentences.length).toBeGreaterThan(5);
    const copied = sentences.filter(({ path, text }) => translated.find((item) => item.path === path)?.text === text);
    expect(copied.map(({ path }) => path), `${locale}: sentences still in Italian`).toEqual([]);
  });
});

const SCREENS = [
  "src/onboarding/OnboardingFlow.tsx",
  "src/pages/mail/index.tsx",
  "src/shell/MailRotationBanner.tsx",
];
// Text that is the same in every language: product names, marks, symbols.
const SAME_IN_EVERY_LANGUAGE = new Set([
  "Job Hunter Team", "Codex", "Claude Code", "Kimi", "OpenAI · ChatGPT Plus/Pro", "Anthropic · Claude Pro/Max",
  "PC", "VPS", "CX", "CL", "KM", "J", "—", "✓", "→", "!", "••", "01", "/",
]);
const TEXT_ATTRIBUTES = new Set(["aria-label", "aria-valuetext", "placeholder", "title", "alt", "label"]);

/** The hand-written texts of a screen: JSX text, text attributes, prose literals. */
function handWritten(file: string, text = readFileSync(file, "utf8")): { scanned: number; found: string[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let scanned = 0;
  const found: string[] = [];
  const prose = /\p{L}{2,}[\s,.:;’']+\p{L}{2,}/u;
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText().trim();
      if (text) {
        scanned += 1;
        if (/\p{L}/u.test(text) && !SAME_IN_EVERY_LANGUAGE.has(text)) found.push(text);
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      scanned += 1;
      const text = node.text.trim();
      const attribute = ts.isJsxAttribute(node.parent) ? node.parent.name.getText() : null;
      const isClassName = attribute === "className" || /^(onboarding|is-|text-|flex|max-w|mt-|px-|rounded|self-|ml-|grid)/.test(text);
      const isModule = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent);
      if (text && !isClassName && !isModule && !SAME_IN_EVERY_LANGUAGE.has(text)) {
        if ((attribute && TEXT_ATTRIBUTES.has(attribute) && /\p{L}/u.test(text)) || prose.test(text)) found.push(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { scanned, found };
}

describe("the onboarding and mail screens hold no hand-written sentence", () => {
  it.each(SCREENS)("%s", (file) => {
    const { scanned, found } = handWritten(file);
    expect(scanned, "the scan found nothing to look at").toBeGreaterThan(10);
    expect(found).toEqual([]);
  });

  it("would catch one that comes back", () => {
    const probe = 'export const A = () => <div className="onboarding-x"><p aria-label="Stato">ok</p><p>{"Prepara la squadra"}</p>Ciao a tutti</div>;';
    expect(handWritten("probe.tsx", probe).found).toEqual(["Stato", "ok", "Prepara la squadra", "Ciao a tutti"]);
  });
});
