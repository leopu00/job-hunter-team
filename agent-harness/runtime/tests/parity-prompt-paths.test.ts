import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createPathRewriter, documentPaths } from "../src/parity/prompt-paths.ts";

const rewrite = createPathRewriter({
  appRoot: "/srv/app",
  homeSkills: new Set(["throttle", "scout-coord"]),
  dedupLog: "/api/logs/scout-dedup.log",
  homeDir: "/api/agents/scout-1",
  profileDir: "/data/profile",
});

describe("createPathRewriter", () => {
  it("sends a skill the agent has to its home, and any other to the repo", () => {
    expect(rewrite("see `agents/_skills/throttle/DESIGN-NOTES.md`")).toBe("see `/api/agents/scout-1/skills/throttle/DESIGN-NOTES.md`");
    expect(rewrite("read /jht_home/agents/_skills/scout-coord/SKILL.md")).toBe("read /api/agents/scout-1/skills/scout-coord/SKILL.md");
    expect(rewrite("(/app/agents/_skills/tmux-send/jht-tmux-send)")).toBe("(/srv/app/agents/_skills/tmux-send/jht-tmux-send)");
    expect(rewrite("- `agents/_skills/expiration-tracking/SKILL.md`")).toBe("- `/srv/app/agents/_skills/expiration-tracking/SKILL.md`");
  });

  it("finds the manual and the team docs in the repo, never in the runtime's state beside the home", () => {
    expect(rewrite("[rules](../_manual/communication-rules.md)")).toBe("[rules](/srv/app/agents/_manual/communication-rules.md)");
    expect(rewrite("[x](../../_manual/anti-collision.md) agents/_manual/db-schema.md")).toBe(
      "[x](/srv/app/agents/_manual/anti-collision.md) /srv/app/agents/_manual/db-schema.md",
    );
    expect(rewrite("`agents/_team/team-rules.md`")).toBe("`/srv/app/agents/_team/team-rules.md`");
    expect(rewrite("[r](../_team/team-rules.md)")).toBe("[r](/srv/app/agents/_team/team-rules.md)");
  });

  it("rewrites the TUI container's own paths, and leaves the person's data and other words alone", () => {
    expect(rewrite("`/app/shared/skills/linkedin_check.py`")).toBe("`/srv/app/shared/skills/linkedin_check.py`");
    expect(rewrite("default `/jht_home/jobs.db`")).toBe("default `the team database (reach it only through the db tools)`");
    expect(rewrite("log to /jht_home/logs/scout-dedup.log")).toBe("log to /api/logs/scout-dedup.log");
    for (const same of ["$JHT_HOME/agents/_team/scout_workspace.json", "web/app/api/team/queue/", "master/jht_home/{state}", "my_agents/_skills/x"]) {
      expect(rewrite(same)).toBe(same);
    }
  });

  it("sends the person's profile where the runtime has it, whichever way the TUI names it (T10b)", () => {
    for (const tui of ["$JHT_HOME/profile/candidate_profile.yml", "${JHT_HOME}/profile/candidate_profile.yml", "${JHT_HOME:-/jht_home}/profile/candidate_profile.yml", "/jht_home/profile/candidate_profile.yml", "~/.jht/profile/candidate_profile.yml"]) {
      expect(rewrite(`Read from \`${tui}\``), tui).toBe("Read from `/data/profile/candidate_profile.yml`");
    }
    expect(rewrite("$JHT_HOME/profile/")).toBe("/data/profile/");
    expect(rewrite("$JHT_HOME/profiles/x $JHT_HOME/agents/profile/x")).toBe("$JHT_HOME/profiles/x $JHT_HOME/agents/profile/x");
  });

  it("points a team doc at the person's language when the repo has it, as the launcher copies it", () => {
    const app = mkdtempSync(join(tmpdir(), "jht-paths-"));
    mkdirSync(join(app, "agents", "_team"), { recursive: true });
    writeFileSync(join(app, "agents", "_team", "team-rules.it.md"), "regole");
    const it_ = createPathRewriter({ appRoot: app, homeSkills: new Set(), dedupLog: "/l", homeDir: "/h", profileDir: "/p", locale: "it" });
    expect(it_("../_team/team-rules.md and agents/_team/architettura.md")).toBe(
      `${app}/agents/_team/team-rules.it.md and ${app}/agents/_team/architettura.md`,
    );
    rmSync(app, { recursive: true, force: true });
  });

  it("does not take a route inside a longer path for a file of the root (T10b)", () => {
    expect(documentPaths("rename `web/app/api/team/queue/` and /app/agents/_manual/x.md", "/app")).toEqual(["/app/agents/_manual/x.md"]);
  });

  it("lists the documents a text points at, without placeholders", () => {
    expect(documentPaths("skills/a/SKILL.md, ../_team/r.md. /srv/app/agents/_manual/x.md and /srv/app/<role>/y", "/srv/app").sort()).toEqual(
      ["../_team/r.md", "/srv/app/agents/_manual/x.md", "skills/a/SKILL.md"],
    );
    // Absolute paths under the other roots the caller names: the home and the profile.
    expect(documentPaths("`/h/skills/a/SKILL.md` and /p/candidate_profile.yml", "/srv/app", ["/h", "/p"]).sort()).toEqual(
      ["/h/skills/a/SKILL.md", "/p/candidate_profile.yml"],
    );
  });
});
