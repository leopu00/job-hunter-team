import { describe, expect, it } from "vitest";

import { createPathRewriter, documentPaths } from "../src/parity/prompt-paths.ts";

const rewrite = createPathRewriter({
  appRoot: "/srv/app",
  homeSkills: new Set(["throttle", "scout-coord"]),
  dedupLog: "/api/logs/scout-dedup.log",
});

describe("createPathRewriter", () => {
  it("sends a skill the agent has to its home, and any other to the repo", () => {
    expect(rewrite("see `agents/_skills/throttle/DESIGN-NOTES.md`")).toBe("see `skills/throttle/DESIGN-NOTES.md`");
    expect(rewrite("read /jht_home/agents/_skills/scout-coord/SKILL.md")).toBe("read skills/scout-coord/SKILL.md");
    expect(rewrite("(/app/agents/_skills/tmux-send/jht-tmux-send)")).toBe("(/srv/app/agents/_skills/tmux-send/jht-tmux-send)");
    expect(rewrite("- `agents/_skills/expiration-tracking/SKILL.md`")).toBe("- `/srv/app/agents/_skills/expiration-tracking/SKILL.md`");
  });

  it("finds the manual in the repo and the team docs beside the home", () => {
    expect(rewrite("[rules](../_manual/communication-rules.md)")).toBe("[rules](/srv/app/agents/_manual/communication-rules.md)");
    expect(rewrite("[x](../../_manual/anti-collision.md) agents/_manual/db-schema.md")).toBe(
      "[x](/srv/app/agents/_manual/anti-collision.md) /srv/app/agents/_manual/db-schema.md",
    );
    expect(rewrite("`agents/_team/team-rules.md`")).toBe("`../_team/team-rules.md`");
  });

  it("rewrites the TUI container's own paths, and leaves the person's data and other words alone", () => {
    expect(rewrite("`/app/shared/skills/linkedin_check.py`")).toBe("`/srv/app/shared/skills/linkedin_check.py`");
    expect(rewrite("default `/jht_home/jobs.db`")).toBe("default `the team database (reach it only through the db tools)`");
    expect(rewrite("log to /jht_home/logs/scout-dedup.log")).toBe("log to /api/logs/scout-dedup.log");
    for (const same of ["$JHT_HOME/profile/candidate_profile.yml", "$JHT_HOME/agents/_team/scout_workspace.json", "web/app/api/team/queue/", "master/jht_home/{state}", "my_agents/_skills/x"]) {
      expect(rewrite(same)).toBe(same);
    }
  });

  it("lists the documents a text points at, without placeholders", () => {
    expect(documentPaths("skills/a/SKILL.md, ../_team/r.md. /srv/app/agents/_manual/x.md and /srv/app/<role>/y", "/srv/app").sort()).toEqual(
      ["../_team/r.md", "/srv/app/agents/_manual/x.md", "skills/a/SKILL.md"],
    );
  });
});
