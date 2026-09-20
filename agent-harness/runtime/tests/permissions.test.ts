import { describe, expect, it } from "vitest";

import { PermissionPolicy, type PermissionAnswer, type PermissionRequest } from "../src/core/permissions.ts";
import type { ToolAccess } from "../src/tools/registry.ts";
import { createWorkspaceTools } from "../src/tools/workspace.ts";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (...paths: string[]): ToolAccess => ({ risk: "read", paths, summary: paths.join(" ") });
const write = (path: string): ToolAccess => ({ risk: "write", paths: [path], summary: path });
const exec = (command: string): ToolAccess => ({ risk: "execute", paths: [], summary: command });

function asker(answer: PermissionAnswer) {
  const requests: PermissionRequest[] = [];
  return { requests, ask: async (r: PermissionRequest) => (requests.push(r), answer) };
}

describe("PermissionPolicy", () => {
  it("lets reads inside a free folder through without asking", async () => {
    const { requests, ask } = asker("deny");
    const policy = new PermissionPolicy({ mode: "ask", freeReadRoots: ["/notes"], ask });
    expect(await policy.decide("read_file", read("/notes/a.md"))).toEqual({ allowed: true, asked: false });
    expect(requests).toHaveLength(0);
  });

  it("asks before reading outside the free folders, writing or running", async () => {
    const { requests, ask } = asker("allow");
    const policy = new PermissionPolicy({ mode: "ask", freeReadRoots: ["/notes"], ask });
    expect(await policy.decide("read_file", read("/etc/hosts"))).toEqual({ allowed: true, asked: true });
    expect(await policy.decide("write_file", write("/notes/a.md"))).toEqual({ allowed: true, asked: true });
    expect(await policy.decide("bash", exec("ls"))).toEqual({ allowed: true, asked: true });
    expect(requests.map((r) => r.reason)).toEqual([
      "reads outside the working folders",
      "changes a file",
      "runs a command",
    ]);
  });

  it("does not treat a sibling folder with a shared prefix as inside", async () => {
    const policy = new PermissionPolicy({ mode: "ask", freeReadRoots: ["/notes"] });
    expect((await policy.decide("read_file", read("/notes-old/a.md"))).allowed).toBe(false);
  });

  it("remembers 'always' for that tool only", async () => {
    const { requests, ask } = asker("allow-always");
    const policy = new PermissionPolicy({ mode: "ask", freeReadRoots: [], ask });
    await policy.decide("bash", exec("ls"));
    expect(await policy.decide("bash", exec("pwd"))).toEqual({ allowed: true, asked: false });
    await policy.decide("write_file", write("/x"));
    expect(requests.map((r) => r.toolName)).toEqual(["bash", "write_file"]);
  });

  it("denies what needs asking when nobody can be asked", async () => {
    const policy = new PermissionPolicy({ mode: "ask", freeReadRoots: [] });
    const decision = await policy.decide("bash", exec("ls"));
    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain("nobody can be asked");
  });

  it("runs everything in auto mode without asking", async () => {
    const { requests, ask } = asker("deny");
    const policy = new PermissionPolicy({ mode: "auto", freeReadRoots: [], ask });
    expect(await policy.decide("bash", exec("rm -rf build"))).toEqual({ allowed: true, asked: false });
    expect(requests).toHaveLength(0);
  });

  it("refuses credential files in auto mode without asking, and points the agent at the captain", async () => {
    const { requests, ask } = asker("allow");
    const policy = new PermissionPolicy({ mode: "auto", freeReadRoots: ["/home/me"], ask });
    const decision = await policy.decide("read_file", read("/home/me/.ssh/id_ed25519"));
    expect(decision.allowed).toBe(false);
    expect(decision.asked).toBe(false);
    expect(decision.allowed === false && decision.message).toContain("request access from the captain");
    expect(requests).toHaveLength(0);
  });

  it("refuses writes and commands in read-only mode, without asking", async () => {
    const { requests, ask } = asker("allow");
    const policy = new PermissionPolicy({ mode: "read-only", freeReadRoots: [], ask });
    expect((await policy.decide("write_file", write("/x"))).allowed).toBe(false);
    expect((await policy.decide("bash", exec("ls"))).allowed).toBe(false);
    expect(await policy.decide("read_file", read("/x"))).toEqual({ allowed: true, asked: true });
    expect(requests).toHaveLength(1);
  });

  it("always asks for credential files in ask mode, even inside a free folder and after 'always'", async () => {
    const { requests, ask } = asker("allow-always");
    const inside = new PermissionPolicy({ mode: "ask", freeReadRoots: ["/repo"], ask });
    await inside.decide("read_file", read("/repo/.env"));
    await inside.decide("read_file", read("/repo/.env"));
    expect(requests).toHaveLength(2);
    expect(requests[0]?.reason).toBe("touches a file that may hold credentials");
    expect(await inside.decide("read_file", read("/repo/.env.example"))).toEqual({ allowed: true, asked: false });
  });
});

describe("PermissionPolicy — network and internal tools", () => {
  const net: ToolAccess = { risk: "network", paths: [], summary: "https://example.com" };
  const none: ToolAccess = { risk: "none", paths: [], summary: "3 items" };

  it("asks before reaching the internet, in ask and read-only mode, and not in auto", async () => {
    const { requests, ask } = asker("allow");
    expect(await new PermissionPolicy({ mode: "ask", freeReadRoots: [], ask }).decide("web_fetch", net)).toEqual({ allowed: true, asked: true });
    expect(await new PermissionPolicy({ mode: "read-only", freeReadRoots: [], ask }).decide("web_fetch", net)).toEqual({ allowed: true, asked: true });
    expect(await new PermissionPolicy({ mode: "auto", freeReadRoots: [], ask }).decide("web_fetch", net)).toEqual({ allowed: true, asked: false });
    expect(requests.map((r) => r.reason)).toEqual(["reaches the internet", "reaches the internet"]);
  });

  it("never gates a tool that touches nothing outside the session", async () => {
    const policy = new PermissionPolicy({ mode: "read-only", freeReadRoots: [] });
    expect(await policy.decide("todo_write", none)).toEqual({ allowed: true, asked: false });
  });
});

describe("PermissionPolicy — read-only folders (T10b: the person's profile)", () => {
  it("reads freely, and refuses any write in every mode, even to a person who would allow it", async () => {
    for (const mode of ["auto", "ask", "read-only"] as const) {
      const { requests, ask } = asker("allow-always");
      const policy = new PermissionPolicy({ mode, freeReadRoots: ["/work", "/data/profile"], readOnlyRoots: ["/data/profile"], ask });
      expect(await policy.decide("read_file", read("/data/profile/candidate_profile.yml")), mode).toEqual({ allowed: true, asked: false });
      for (const path of ["/data/profile/candidate_profile.yml", "/data/profile/new.md", "/data/profile"]) {
        const decision = await policy.decide("write_file", write(path));
        expect(decision.allowed, `${mode} ${path}`).toBe(false);
        expect(decision.message).toMatch(/profile.*read.*never change/i);
      }
      expect(requests, mode).toHaveLength(0);
    }
  });

  it("leaves a sibling with a shared prefix writable", async () => {
    const policy = new PermissionPolicy({ mode: "auto", freeReadRoots: ["/work"], readOnlyRoots: ["/data/profile"] });
    expect((await policy.decide("write_file", write("/data/profile-old/x.md"))).allowed).toBe(true);
  });
});

describe("PermissionPolicy — runtime state", () => {
  const policy = () =>
    new PermissionPolicy({
      mode: "auto",
      freeReadRoots: ["/srv/state/agents/scout"],
      ownRoots: ["/srv/state/agents/scout"],
      stateRoots: ["/srv/state"],
    });

  it("lets a role use its own home", async () => {
    expect((await policy().decide("write_file", write("/srv/state/agents/scout/notes.md"))).allowed).toBe(true);
  });

  it("refuses another role's home, the traces and the audit under a custom JHT_API_HOME", async () => {
    for (const path of ["/srv/state/agents/analyst/notes.md", "/srv/state/logs/analyst/run.jsonl", "/srv/state/audit/run.jsonl"]) {
      expect((await policy().decide("read_file", read(path))).allowed, path).toBe(false);
      expect((await policy().decide("write_file", write(path))).allowed, path).toBe(false);
    }
  });

  it("does not mistake a sibling of the state folder for state", async () => {
    expect((await policy().decide("read_file", read("/srv/state-old/x.md"))).allowed).toBe(true);
  });
});

describe("workspace walks — runtime state", () => {
  it("glob and grep from a parent folder skip other roles' state, not the role's own", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "jht-api-walk-")));
    try {
      const own = join(root, "state", "agents", "scout");
      await mkdir(own, { recursive: true });
      await mkdir(join(root, "state", "agents", "analyst"), { recursive: true });
      await mkdir(join(root, "state", "logs", "analyst"), { recursive: true });
      await writeFile(join(own, "mine.md"), "needle mine\n");
      await writeFile(join(root, "state", "agents", "analyst", "theirs.md"), "needle theirs\n");
      await writeFile(join(root, "state", "logs", "analyst", "run.jsonl"), "needle trace\n");
      // A link with an innocent name, outside the state, pointing into another role's home.
      await mkdir(join(root, "proj", "shared"), { recursive: true });
      await symlink(join(root, "state", "agents", "analyst", "theirs.md"), join(root, "proj", "shared", "notes.md"));
      const tools = createWorkspaceTools({ workdir: own, ownRoots: [own], stateRoots: [join(root, "state")] });
      const run = async (name: string, args: Record<string, unknown>) => {
        const tool = tools.find((t) => t.spec.name === name)!;
        return (await tool.execute(tool.spec.schema.parse(args), { account: undefined as never, remainingMs: () => 1 })).content;
      };
      const grep = await run("grep", { pattern: "needle", path: root });
      const glob = await run("glob", { pattern: "**/*", path: root });
      for (const out of [grep, glob]) {
        expect(out).toContain("mine");
        expect(out).not.toContain("theirs");
        expect(out).not.toContain("run.jsonl");
        expect(out).not.toContain("notes.md");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
