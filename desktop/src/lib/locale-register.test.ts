// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * French and German speak to the person in one form everywhere in the app:
 * "tu" and "du". A screen that says "vous" or "Sie" breaks that, and nothing
 * else notices. This reads every source file of the app and fails on the formal
 * forms.
 *
 * The `from:` lines of desktop-texts/overrides.ts are the web's own words, which
 * are matched as they are and replaced: they are not ours to reword.
 */
const src = fileURLToPath(new URL("..", import.meta.url));

const FORMAL_FRENCH = /\b(?:vous|Vous|votre|Votre|vos|Vos)\b/;
const FORMAL_GERMAN =
  /\bIhr(?:e|en|em|er|es)?\b|\bIhnen\b|\b[a-zäöüß]+(?:en|et|st) Sie\b|\b(?:Wählen|Kopieren|Schließen|Geben|Klicken|Öffnen|Starten) Sie\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function formalLines(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(src)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (line.trimStart().startsWith("from:")) return;
        if (pattern.test(line)) found.push(`${relative(src, file)}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  return found;
}

describe("the form of address in French and German", () => {
  it("never uses the formal French forms", () => {
    expect(formalLines(FORMAL_FRENCH)).toEqual([]);
  });

  it("never uses the formal German forms", () => {
    expect(formalLines(FORMAL_GERMAN)).toEqual([]);
  });
});
