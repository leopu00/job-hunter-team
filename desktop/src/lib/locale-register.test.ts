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

// "vous" and the verbs that the "vous" imperative ends in: a line that says "Réessayez." has no "vous".
const FORMAL_FRENCH_VERBS = [
  "veuillez", "vérifiez", "réessayez", "essayez", "cliquez", "saisissez", "choisissez", "utilisez", "ouvrez",
  "copiez", "terminez", "redémarrez", "démarrez", "attendez", "consultez", "reliez", "envoyez", "contactez",
  "sélectionnez", "confirmez", "ajoutez", "retournez", "revenez", "fermez", "actualisez", "continuez", "suivez",
  "lisez", "entrez", "complétez", "rechargez", "relancez", "supprimez", "mettez", "prenez", "demandez",
  "appuyez", "patientez", "souhaitez", "pouvez", "voulez", "devez",
];
// A word boundary that knows accents: `\b` does not see the "é" of "vérifiez" or the "Ö" of "Öffnen".
const START = "(?<![\\p{L}\\p{N}_])";
const END = "(?![\\p{L}\\p{N}_])";
const FORMAL_FRENCH = new RegExp(`${START}(?:vous|votre|vos|${FORMAL_FRENCH_VERBS.join("|")})${END}`, "iu");
const FORMAL_GERMAN = new RegExp(
  [
    `${START}Ihr(?:e|en|em|er|es)?${END}`,
    `${START}Ihnen${END}`,
    `${START}\\p{Lu}\\p{Ll}+en Sie${END}`,
    `${START}\\p{Ll}+(?:en|et|st) Sie${END}`,
  ].join("|"),
  "u",
);

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
