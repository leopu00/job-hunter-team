import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { composeSystemPrompt, loadRolePrompt, materializeRoleHome } from "../src/parity/role-prompt.ts";
import { createPathRewriter } from "../src/parity/prompt-paths.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// The output under test is the runtime's materialized prompt/skill, not a source
// guard: localized templates must reach both the API system and the agent home.
it.each(["en", "it", "de", "es", "fr", "pt", "hu"] as const)(
  "materializes the geographic contract and rewrites its profile path in %s", async (locale) => {
    const root = await mkdtemp(join(tmpdir(), "scout-scope-"));
    try {
      const prompt = await loadRolePrompt({ appRoot, role: "scout", locale });
      const home = join(root, "scout");
      const rewrite = createPathRewriter({ appRoot, homeDir: home, profileDir: join(root, "profile"),
        homeSkills: new Set(["scout-coverage"]), dedupLog: join(root, "dedup.log"), locale });
      const selected = { ...prompt, skills: prompt.skills.filter((entry) => entry.name === "scout-coverage"), teamDocs: [] };
      const system = rewrite(composeSystemPrompt(selected, "", home));
      await materializeRoleHome(selected, home, system, rewrite);
      expect(await readFile(join(home, "AGENTS.md"), "utf8")).toBe(system);
      expect(system).toContain("[SCOUT-SEARCH-SCOPE]");
      expect(system).toContain(join(home, "skills/scout-coverage/SKILL.md"));
      const skill = await readFile(join(home, "skills/scout-coverage/SKILL.md"), "utf8");
      expect(skill).toContain(`--profile "${join(root, "profile/candidate_profile.yml")}"`);
      expect(skill).toContain("--log --country");
      expect(skill).toContain("scope_match");
      expect(skill).toContain("scout_search_geo_mismatch");
      expect(skill).not.toContain("$JHT_HOME/profile/candidate_profile.yml");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
