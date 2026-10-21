/**
 * JHT-T31: every text the user can see is written in the user's language, whatever the language of the
 * message the agent is answering. The rule (RULE-T14) sits at the top of EVERY role's identity prompt,
 * in all seven languages, so no agent can read its first line without reading it. A prompt that loses
 * it, or buries it under the role's own sections, turns red here.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { composeSystemPrompt, LOCALES, loadRolePrompt, resolveUserLocale, type Locale } from "../src/parity/role-prompt.ts";
import { guessLanguage, userLanguage } from "../src/parity/skills/text-language.ts";
import { runValidateProfile } from "../src/parity/skills/validate-profile.ts";
import { pythonSkillsOfThisTree, runPython } from "./helpers/python-skills.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ROLES = readdirSync(join(REPO_ROOT, "agents")).filter(
  (name) => !name.startsWith("_") && statSync(join(REPO_ROOT, "agents", name)).isDirectory(),
);

/** What each language's rule says about the incoming message, in that language: it never decides the answer's. */
const NEVER_DECIDES: Record<Locale, string> = {
  en: "never decides yours",
  it: "non decide mai la tua",
  de: "bestimmt nie deine eigene",
  es: "nunca decide el tuyo",
  fr: "ne décide jamais de la tienne",
  hu: "soha nem dönti el a tiédet",
  pt: "nunca decide o teu",
};

/** The rule block: the quote that starts with the globe, up to the first heading. */
function ruleBlock(identity: string): { block: string; before: string } {
  const lines = identity.split("\n");
  const at = lines.findIndex((l) => l.startsWith("> 🌍") && l.includes("RULE-T14"));
  const heading = lines.findIndex((l) => l.startsWith("## "));
  return { block: at >= 0 ? lines[at]! : "", before: at >= 0 && heading >= 0 && at < heading ? "top" : at < 0 ? "missing" : "buried" };
}

describe("JHT-T31 · the user's language rule heads every prompt", () => {
  it("knows the twelve roles of the team", () => {
    expect(ROLES.length).toBeGreaterThanOrEqual(12);
  });

  for (const locale of LOCALES) {
    it(`is the first thing in the ${locale} prompt of every role, and says the incoming language never decides`, async () => {
      for (const role of ROLES) {
        const prompt = await loadRolePrompt({ appRoot: REPO_ROOT, role, locale });
        const { block, before } = ruleBlock(prompt.identity);
        expect(before, `${role}.${locale}`).toBe("top");
        expect(block, `${role}.${locale}`).toContain("i18n-prefs.json");
        expect(block, `${role}.${locale}`).toContain("$JHT_LANG");
        expect(block, `${role}.${locale}`).toContain(NEVER_DECIDES[locale]);
        // It is the identity's prefix as the model sees it: the composed system prompt keeps it whole.
        expect(composeSystemPrompt(prompt, "").includes(block), `${role}.${locale}`).toBe(true);
      }
    });
  }

  it("is written in each language, not copied from English", async () => {
    const blocks = new Set<string>();
    for (const locale of LOCALES) {
      const prompt = await loadRolePrompt({ appRoot: REPO_ROOT, role: "assistente", locale });
      blocks.add(ruleBlock(prompt.identity).block);
    }
    expect(blocks.size).toBe(LOCALES.length);
  });

  it("with JHT_LANG=en the agent gets the English prompt and its rule, whatever language the message is in", async () => {
    const home = await mkdtemp(join(tmpdir(), "jht-lang-"));
    try {
      const locale = await resolveUserLocale({ jhtHome: home, env: { JHT_LANG: "en" } });
      expect(locale).toBe("en");
      for (const role of ["assistente", "capitano", "mentor", "scout"]) {
        const prompt = await loadRolePrompt({ appRoot: REPO_ROOT, role, locale });
        expect(ruleBlock(prompt.identity).block, role).toContain(NEVER_DECIDES.en);
        // The message that arrives (here in Italian) is not an input to the choice of the prompt.
        const system = composeSystemPrompt(prompt, "");
        expect(system.indexOf("RULE-T14")).toBeLessThan(system.indexOf("## "));
      }
      // The canonical file wins over the environment: a user who chose Italian gets it even with JHT_LANG=en.
      await writeFile(join(home, "i18n-prefs.json"), JSON.stringify({ locale: "it" }));
      expect(await resolveUserLocale({ jhtHome: home, env: { JHT_LANG: "en" } })).toBe("it");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

/** A paragraph of a profile, in each language: long enough to be judged. */
const SAMPLES: Record<Locale, string> = {
  en: "I am a developer with a lot of experience working with data, and I have always tried to improve the way our team builds the products that our customers use.",
  it: "Sono uno sviluppatore con molta esperienza nel lavoro con i dati, e ho sempre cercato di migliorare il modo in cui la nostra squadra costruisce i prodotti che usano i clienti.",
  de: "Ich bin ein Entwickler mit viel Erfahrung in der Arbeit mit Daten, und ich habe immer versucht, die Art zu verbessern, wie unser Team die Produkte baut, die unsere Kunden nutzen.",
  es: "Soy un desarrollador con mucha experiencia en el trabajo con datos, y siempre he intentado mejorar la forma en que nuestro equipo construye los productos que usan los clientes.",
  fr: "Je suis un développeur avec beaucoup d'expérience dans le travail avec les données, et j'ai toujours essayé d'améliorer la façon dont notre équipe construit les produits que les clients utilisent.",
  hu: "Fejlesztő vagyok, sok tapasztalattal az adatokkal való munkában, és mindig igyekeztem javítani azon, ahogyan a csapatunk az ügyfelek által használt termékeket építi.",
  pt: "Sou um desenvolvedor com muita experiência no trabalho com dados, e sempre procurei melhorar a forma como a nossa equipa constrói os produtos que os clientes usam.",
};

describe("JHT-T31 · the language of a free text", () => {
  for (const locale of LOCALES) {
    it(`recognises a paragraph written in ${locale}`, () => {
      expect(guessLanguage(SAMPLES[locale])).toBe(locale);
    });
  }

  it("gives no answer for a short text, a list of tools or a mix", () => {
    expect(guessLanguage("Backend developer, Python, SQL")).toBeNull();
    expect(guessLanguage("")).toBeNull();
    expect(guessLanguage(`${SAMPLES.en} ${SAMPLES.it}`)).toBeNull();
  });

  it("follows the person's language: the file first, then JHT_LANG, then English", async () => {
    const home = await mkdtemp(join(tmpdir(), "jht-lang-"));
    try {
      expect(userLanguage(home, {})).toBe("en");
      expect(userLanguage(home, { JHT_LANG: "de" })).toBe("de");
      expect(userLanguage(home, { JHT_LANG: "klingon" })).toBe("en");
      await writeFile(join(home, "i18n-prefs.json"), JSON.stringify({ locale: "hu" }));
      expect(userLanguage(home, { JHT_LANG: "de" })).toBe("hu");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("keeps the word lists of the script and of the port byte for byte the same", () => {
    const script = readFileSync(join(REPO_ROOT, "shared", "skills", "text_language_words.json"));
    const port = readFileSync(join(REPO_ROOT, "agent-harness", "runtime", "src", "parity", "skills", "text-language-words.json"));
    expect(port.equals(script)).toBe(true);
  });
});

const PROFILE = (about: string) => `name: Ada Example
target_role: Backend Developer
location: Milan
experience_years: 6
has_degree: true
seniority_target: mid
skills:
  primary: [python, sql]
languages:
  - language: English
    level: C1
blocks:
  - key: about
    title: About
    kind: narrative
    content: ${JSON.stringify(about)}
`;

describe("JHT-T31 · the profile validator warns on a text in the wrong language", () => {
  const TREE = pythonSkillsOfThisTree();

  it("warns, without refusing, when the person's language is English and the summary is Italian", () => {
    const dir = mkdtempSync(join(tmpdir(), "jht-prof-"));
    try {
      writeFileSync(join(dir, "p.yml"), PROFILE(SAMPLES.it));
      const wrong = runValidateProfile([join(dir, "p.yml")], (p) => p, () => "en");
      expect(wrong.exitCode).toBe(0);
      expect(wrong.stdout).toBe("VALID_PROFILE\n");
      expect(wrong.stderr).toContain("WARN: LANGUAGE: blocks[0] (about) looks it, the user's language is en");
      // Not counted by --strict: a notice is not a legacy spelling.
      expect(runValidateProfile([join(dir, "p.yml"), "--strict"], (p) => p, () => "en").exitCode).toBe(0);
      // In the right language, or with the language forced, there is nothing to say.
      expect(runValidateProfile([join(dir, "p.yml")], (p) => p, () => "it").stderr).toBe("");
      expect(runValidateProfile([join(dir, "p.yml"), "--lang", "it"], (p) => p, () => "en").stderr).toBe("");
      writeFileSync(join(dir, "q.yml"), PROFILE(SAMPLES.en));
      expect(runValidateProfile([join(dir, "q.yml")], (p) => p, () => "en").stderr).toBe("");
      const json = JSON.parse(runValidateProfile([join(dir, "p.yml"), "--json"], (p) => p, () => "en").stdout) as { ok: boolean; language_warnings: string[] };
      expect(json.ok).toBe(true);
      expect(json.language_warnings).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(TREE === null)("says the same as the script for every sample against three expected languages", () => {
    const dir = mkdtempSync(join(tmpdir(), "jht-prof-"));
    try {
      for (const locale of LOCALES) {
        for (const expected of ["en", "it", "de"]) {
          const file = join(dir, `${locale}.yml`);
          writeFileSync(file, PROFILE(SAMPLES[locale]));
          for (const flags of [[], ["--json"], ["--strict"]] as string[][]) {
            const mine = runValidateProfile([file, ...flags, "--lang", expected], (p) => p, () => "en");
            const script = runPython(TREE!, [join(TREE!, "validate_profile.py"), file, ...flags, "--lang", expected], {});
            expect(mine.stdout, `${locale} vs ${expected} ${flags.join(" ")}`).toBe(script.stdout);
            expect(mine.stderr, `${locale} vs ${expected} ${flags.join(" ")}`).toBe(script.stderr);
            expect(mine.exitCode).toBe(script.status);
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(TREE === null)("guesses the same language as the script for every sample", () => {
    for (const locale of LOCALES) {
      const script = runPython(TREE!, [join(TREE!, "text_language.py"), "guess", SAMPLES[locale]], {});
      expect(script.stdout.trim(), locale).toBe(guessLanguage(SAMPLES[locale]) ?? "unknown");
    }
  });
});
