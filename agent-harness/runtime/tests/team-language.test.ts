/**
 * JHT-T140: the team's language is told to the agent by name. The rule (RULE-T14) says "the user's
 * language", and an agent used to read it off the message it was answering: two messages in Italian
 * moved the analysts and scorers of an English team. The harness puts the language, by name, in the
 * notes the role reads every round, in the same words as the TUI's kickoff and resume messages.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.ts";
import { prepareAgentHome } from "../src/core/agent-home.ts";
import { jobsDbPath, openJobsDb } from "../src/db/jobs-db.ts";
import { prepareProductRole } from "../src/parity/product-role.ts";
import { TEXT_LANGUAGES, teamLanguageLine } from "../src/parity/skills/text-language.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NAMES: Record<string, string> = {
  en: "English", it: "Italian", hu: "Hungarian", es: "Spanish", de: "German", fr: "French", pt: "Portuguese",
};
const ITALIAN_MESSAGE = "Ciao, per favore scrivimi in italiano le note sui punteggi.";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-team-language-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The system prompt of a SCOUT started on a team whose language is `locale` (prefs file) or `env`. */
async function systemPromptOf(options: { prefs?: string; env?: Record<string, string> }): Promise<{ system: string; identity: string }> {
  const jhtHome = join(root, "jht");
  if (options.prefs) {
    await import("node:fs/promises").then((fs) => fs.mkdir(jhtHome, { recursive: true }));
    await writeFile(join(jhtHome, "i18n-prefs.json"), JSON.stringify({ locale: options.prefs }));
  }
  const env = { JHT_API_HOME: join(root, "api") };
  const config = loadConfig(env, "scout-1");
  const dbFile = jobsDbPath(env, config.apiHome);
  await prepareAgentHome({ dir: config.agentHome, role: config.role, fresh: true });
  const role = await prepareProductRole({
    appRoot: REPO_ROOT,
    role: "scout",
    agent: "scout-1",
    homeDir: config.agentHome,
    apiHome: config.apiHome,
    jhtHome,
    env: options.env ?? {},
    jobsDb: { path: dbFile, open: () => openJobsDb(dbFile) },
  });
  return { system: role.systemPrompt, identity: role.systemPrompt.split("\n").find((l) => l.includes("RULE-T14")) ?? "" };
}

describe("the line that names the team's language", () => {
  for (const locale of TEXT_LANGUAGES) {
    it(`is the same words as the python skill's, in ${locale}`, () => {
      const python = spawnSync("python3", [join(REPO_ROOT, "shared", "skills", "text_language.py"), "line"], {
        encoding: "utf8",
        env: { ...process.env, JHT_LANG: locale, JHT_HOME: join(root, "empty") },
      });
      if (python.error) return; // no python3 here: the pytest side holds python and bash together
      expect(python.stdout.trimEnd()).toBe(teamLanguageLine(locale));
      expect(teamLanguageLine(locale)).toContain(`${NAMES[locale]} (${locale})`);
    });
  }

  it("is English for a language that is not one of the seven", () => {
    expect(teamLanguageLine("sv")).toContain("English (en)");
    expect(teamLanguageLine("")).toContain("English (en)");
  });
});

describe("what the agent is shown", () => {
  it("with the team in English and a message in Italian, the notes say English by name, and the rule points at the line", async () => {
    const { system, identity } = await systemPromptOf({ env: { JHT_LANG: "en" } });
    // the message that arrives is not an input of the prompt: the Italian text above is what the agent will answer
    expect(ITALIAN_MESSAGE).toMatch(/italiano/);
    expect(system).toContain("[TEAM-LANGUAGE] English (en). Write in English every text the user can see");
    expect(system).not.toContain("Italian (it)");
    expect(identity).toContain("`[TEAM-LANGUAGE]`");
    // the command of the TUI is not here: the line of the notes is the answer, and nothing says "not available"
    expect(identity).toContain("the `[TEAM-LANGUAGE]` line of your notes");
    expect(identity).not.toContain("text_language.py");
  });

  it("follows the choice of the person: the prefs file wins over the environment, the next round reads it again", async () => {
    const { system } = await systemPromptOf({ prefs: "it", env: { JHT_LANG: "en" } });
    expect(system).toContain("[TEAM-LANGUAGE] Italian (it).");
    expect(system).not.toContain("[TEAM-LANGUAGE] English (en).");
  });

  it("with no choice at all the team is English by name", async () => {
    const { system } = await systemPromptOf({});
    expect(system).toContain("[TEAM-LANGUAGE] English (en).");
  });

  it("puts the line after the identity, so the identity stays the prefix the TUI has", async () => {
    const { system } = await systemPromptOf({ env: { JHT_LANG: "en" } });
    expect(system.indexOf("RULE-T14")).toBeLessThan(system.indexOf("[TEAM-LANGUAGE] English"));
    expect(system.startsWith("# ")).toBe(true);
  });
});
