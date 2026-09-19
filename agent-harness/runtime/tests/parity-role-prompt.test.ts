import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  composeSystemPrompt,
  frontMatterField,
  loadRolePrompt,
  materializeRoleHome,
  parseSkillsList,
  resolveUserLocale,
} from "../src/parity/role-prompt.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-parity-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text, "utf8");
}

const skill = (name: string, description: string, body = "") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n${body}`;

/** A repo in the launcher's layout: one role, shared and private skills, team docs. */
async function fixtureRepo(): Promise<string> {
  const app = join(root, "app");
  await put("app/agents/scout/scout.md", "# SCOUT\nbaseline\n");
  await put("app/agents/scout/scout.it.md", "# SCOUT\nitaliano\n");
  await put(
    "app/agents/scout/skills.list",
    "# header comment\n\ntmux-send\n  db-query   # inline comment\n_lib\nghost\n",
  );
  await put("app/agents/_skills/tmux-send/SKILL.md", skill("tmux-send", "Deliver a message."));
  await put("app/agents/_skills/tmux-send/SKILL.it.md", skill("tmux-send", '"Consegna un messaggio."'));
  await put("app/agents/_skills/tmux-send/jht-tmux-send", "#!/bin/sh\n");
  await put("app/agents/_skills/db-query/SKILL.md", skill("db-query", "Query the DB."));
  await put("app/agents/_skills/unlisted/SKILL.md", skill("unlisted", "Not for scouts."));
  await put("app/agents/scout/_skills/scout-private/SKILL.md", skill("scout-private", "Only mine."));
  await put("app/agents/scout/_skills/db-query/SKILL.md", skill("db-query", "Private override."));
  await put("app/agents/_team/team-rules.md", "rules en\n");
  await put("app/agents/_team/team-rules.it.md", "regole it\n");
  await put("app/agents/_team/architettura.md", "arch en\n");
  return app;
}

describe("resolveUserLocale", () => {
  it("follows the launcher cascade: prefs, then JHT_LANG, then host.env, then en", async () => {
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    expect(await resolveUserLocale({ jhtHome: home, env: {} })).toBe("en");

    await writeFile(join(home, "host.env"), 'FOO=1\nJHT_LANG="fr"\n');
    expect(await resolveUserLocale({ jhtHome: home, env: {} })).toBe("fr");
    expect(await resolveUserLocale({ jhtHome: home, env: { JHT_LANG: "de" } })).toBe("de");

    await writeFile(join(home, "i18n-prefs.json"), JSON.stringify({ locale: "it" }));
    expect(await resolveUserLocale({ jhtHome: home, env: { JHT_LANG: "de" } })).toBe("it");
  });

  it("skips an unknown value at any step instead of failing", async () => {
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "i18n-prefs.json"), JSON.stringify({ locale: "klingon" }));
    await writeFile(join(home, "host.env"), "JHT_LANG=xx\n");
    expect(await resolveUserLocale({ jhtHome: home, env: { JHT_LANG: "pt" } })).toBe("pt");
    expect(await resolveUserLocale({ jhtHome: home, env: { JHT_LANG: "zz" } })).toBe("en");

    await writeFile(join(home, "i18n-prefs.json"), "{ not json");
    expect(await resolveUserLocale({ jhtHome: home, env: { JHT_LANG: "hu" } })).toBe("hu");
  });
});

describe("loadRolePrompt", () => {
  it("reads the localized template and skills, falling back to the baseline", async () => {
    const app = await fixtureRepo();

    const it_ = await loadRolePrompt({ appRoot: app, role: "scout", locale: "it" });
    expect(it_.identity).toBe("# SCOUT\nitaliano\n");
    expect(it_.skills.find((s) => s.name === "tmux-send")?.description).toBe("Consegna un messaggio.");

    const de = await loadRolePrompt({ appRoot: app, role: "scout", locale: "de" });
    expect(de.identity).toBe("# SCOUT\nbaseline\n");
    expect(de.skills.find((s) => s.name === "tmux-send")?.description).toBe("Deliver a message.");
  });

  it("takes skills.list in order, then the private skills, and never an unlisted one", async () => {
    const app = await fixtureRepo();
    const prompt = await loadRolePrompt({ appRoot: app, role: "scout", locale: "en" });

    expect(prompt.skills.map((s) => s.name)).toEqual(["tmux-send", "db-query", "scout-private"]);
    // Same destination folder in the launcher: the private copy lands last and wins.
    expect(prompt.skills.find((s) => s.name === "db-query")?.description).toBe("Private override.");
    expect(prompt.missingSkills).toEqual(["ghost"]);
  });

  it("refuses a role with no template", async () => {
    const app = await fixtureRepo();
    await expect(loadRolePrompt({ appRoot: app, role: "nobody", locale: "en" })).rejects.toMatchObject({
      code: "config_invalid",
    });
  });
});

describe("composeSystemPrompt", () => {
  it("keeps the identity whole as the prefix, then the notes, then the skill index", async () => {
    const app = await fixtureRepo();
    const prompt = await loadRolePrompt({ appRoot: app, role: "scout", locale: "en" });
    const system = composeSystemPrompt(prompt, "# Notes\nparity");

    expect(system.startsWith("# SCOUT\nbaseline")).toBe(true);
    expect(system.indexOf("# Notes")).toBeLessThan(system.indexOf("# Skills"));
    expect(system).toContain("- tmux-send: Deliver a message. (skills/tmux-send/SKILL.md)");
    expect(system).not.toContain("unlisted");
  });
});

describe("materializeRoleHome", () => {
  it("lays out skills, team docs and the identity as the launcher does", async () => {
    const app = await fixtureRepo();
    const home = join(root, "agents", "scout");
    await mkdir(join(home, "skills", "stale"), { recursive: true });

    const prompt = await loadRolePrompt({ appRoot: app, role: "scout", locale: "it" });
    await materializeRoleHome(prompt, home, "SYSTEM\n");

    expect((await readdir(join(home, "skills"))).sort()).toEqual(["db-query", "scout-private", "tmux-send"]);
    // The locale's SKILL.md becomes SKILL.md and no variant is left behind.
    expect(await readdir(join(home, "skills", "tmux-send"))).toEqual(["SKILL.md", "jht-tmux-send"]);
    expect(await readFile(join(home, "skills", "tmux-send", "SKILL.md"), "utf8")).toContain("Consegna");
    // `../_team/team-rules.md` from the prompt resolves, localized.
    expect(await readFile(join(root, "agents", "_team", "team-rules.md"), "utf8")).toBe("regole it\n");
    expect(await readFile(join(root, "agents", "_team", "architettura.md"), "utf8")).toBe("arch en\n");
    expect(await readdir(join(root, "agents", "_team"))).not.toContain("team-rules.it.md");
    expect(await readFile(join(home, "AGENTS.md"), "utf8")).toBe("SYSTEM\n");
  });
});

describe("helpers", () => {
  it("parses skills.list like the launcher's read loop", () => {
    expect(parseSkillsList("a\n# c\n b # x\n\n_lib\nc")).toEqual(["a", "b", "c"]);
  });

  it("reads a front matter field and ignores the body", () => {
    expect(frontMatterField("---\nname: x\ndescription: 'quoted: yes'\n---\ndescription: no", "description")).toBe(
      "quoted: yes",
    );
    expect(frontMatterField("no front matter", "description")).toBeNull();
  });
});

describe("the real SCOUT", () => {
  it("loads from this repo with every listed skill present and described", async () => {
    const prompt = await loadRolePrompt({ appRoot: REPO_ROOT, role: "scout", locale: "en" });
    expect(prompt.identity.length).toBeGreaterThan(1_000);
    expect(prompt.missingSkills).toEqual([]);
    expect(prompt.skills.length).toBeGreaterThan(5);
    for (const s of prompt.skills) expect(s.description, s.name).not.toBe("");
  });
});
