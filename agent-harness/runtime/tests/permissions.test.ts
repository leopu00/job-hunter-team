import { describe, expect, it } from "vitest";

import { PermissionPolicy, type PermissionAnswer, type PermissionRequest } from "../src/core/permissions.ts";
import type { ToolAccess } from "../src/tools/registry.ts";

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
