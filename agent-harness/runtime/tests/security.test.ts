/**
 * Security baseline of the API harness (T3, HQ-SICUREZZA).
 *
 * Each case is an attack an agent can be steered into — by a prompt injection
 * in a scraped job page, or by its own mistake — and the refusal the runtime
 * owes. Everything is synthetic: fake keys, a temporary home, a loopback
 * server. Nothing leaves the machine and no provider is called.
 *
 * What this suite does NOT claim: the permission gate is not a sandbox. In
 * `auto` mode `bash` may `cat` any file the process can read; keeping the
 * provider key out of that reach is the container's job (see
 * agents-hq/piani/SICUREZZA-HARNESS.md, finding H-3).
 */

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SafeHttpsClient, isPublicAddress, type SafeHttpResponse } from "../../../api-worker/src/safe-http.ts";

import { TurnAccount } from "../src/core/agent-loop.ts";
import { PermissionPolicy } from "../src/core/permissions.ts";
import { createBashTool, scrubEnv } from "../src/tools/bash.ts";
import { isSensitivePath } from "../src/tools/paths.ts";
import type { ToolHandler } from "../src/tools/registry.ts";
import { createWebFetchTool } from "../src/tools/web-fetch.ts";
import { createWorkspaceTools } from "../src/tools/workspace.ts";
import { buildToolkit } from "../src/tools/toolkit.ts";
import { jobsDbPath, openJobsDb } from "../src/db/jobs-db.ts";
import { MockProvider } from "../src/core/provider/mock.ts";
import { MOCK_PROFILE } from "../src/core/provider/mock.ts";

const CONTEXT = { account: new TurnAccount(Date.now), remainingMs: () => 60_000 };
const FAKE_KEY = "sk-proj-SECURITYTESTFAKEKEY0000000000000000000000";

let home: string;
let workdir: string;
let tools: Map<string, ToolHandler>;
let server: Server;
let port: number;

/** What the runtime does with a call: classify, ask the policy, run only if allowed. */
async function call(policy: PermissionPolicy, name: string, args: Record<string, unknown>) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const parsed = tool.spec.schema.parse(args);
  const decision = await policy.decide(name, tool.classify(parsed));
  if (!decision.allowed) return { allowed: false as const, content: decision.message ?? "" };
  const result = await tool.execute(parsed, CONTEXT);
  return { allowed: true as const, ok: result.ok, content: result.content };
}

const autoPolicy = () => new PermissionPolicy({ mode: "auto", freeReadRoots: [workdir] });

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "jht-api-sec-")));
  workdir = join(home, ".jht-api", "agents", "scout");
  await mkdir(workdir, { recursive: true });
  await mkdir(join(home, ".ssh"), { recursive: true });
  await writeFile(join(home, ".ssh", "id_ed25519"), `-----FAKE KEY----- ${FAKE_KEY}\n`, { mode: 0o600 });
  await writeFile(join(home, ".ssh", "config"), "Host example\n", { mode: 0o600 });
  await writeFile(join(workdir, ".env"), `OPENAI_API_KEY=${FAKE_KEY}\n`, { mode: 0o600 });
  await writeFile(join(workdir, ".env.production"), `OPENAI_API_KEY=${FAKE_KEY}\n`, { mode: 0o600 });
  await writeFile(join(workdir, "notes.md"), "ordinary notes\n");

  tools = new Map(
    [
      ...createWorkspaceTools({ workdir, homeDir: home }),
      createBashTool({ workdir }),
      createWebFetchTool({ timeoutMs: 3_000 }),
    ].map((t) => [t.spec.name, t]),
  );

  // A real local service: if a guard lets a request through, its page shows up.
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("LOCAL-ONLY-PAGE");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server?.close();
  await rm(home, { recursive: true, force: true });
});

describe("protected paths: ssh keys and .env never reach the model", () => {
  it.each([
    ["~/.ssh/id_ed25519"],
    ["~/.ssh/config"],
    [".env"],
    [".env.production"],
  ])("read_file %s is refused in auto mode", async (path) => {
    const result = await call(autoPolicy(), "read_file", { path });
    expect(result.allowed).toBe(false);
    expect(result.content).not.toContain(FAKE_KEY);
  });

  it("a .env inside a free-read folder is still refused", async () => {
    const policy = new PermissionPolicy({ mode: "auto", freeReadRoots: [workdir, join(home, ".ssh")] });
    expect((await call(policy, "read_file", { path: join(workdir, ".env") })).allowed).toBe(false);
    expect((await call(policy, "read_file", { path: join(home, ".ssh", "id_ed25519") })).allowed).toBe(false);
  });

  it("'ask' mode asks for a .env even after 'allow-always' on the tool", async () => {
    const asked: string[] = [];
    const policy = new PermissionPolicy({
      mode: "ask",
      freeReadRoots: [workdir],
      ask: async (r) => (asked.push(r.reason), "allow-always"),
    });
    await call(policy, "read_file", { path: "/etc/hosts" });
    await call(policy, "read_file", { path: ".env" });
    expect(asked.at(-1)).toBe("touches a file that may hold credentials");
  });

  it("grep over the workdir does not surface the key from .env", async () => {
    const result = await call(autoPolicy(), "grep", { pattern: "sk-proj-" });
    expect(result.content).not.toContain(FAKE_KEY);
  });

  it("a symlink with an innocent name does not unlock a key", async () => {
    await symlink(join(home, ".ssh", "id_ed25519"), join(workdir, "readme-link.txt"));
    const result = await call(autoPolicy(), "read_file", { path: "readme-link.txt" });
    expect(result.content).not.toContain(FAKE_KEY);
  });

  it("another role's home is not readable (scout cannot read analista)", async () => {
    const other = join(home, ".jht-api", "agents", "analista");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "notes.md"), `private notes ${FAKE_KEY}\n`);
    const result = await call(autoPolicy(), "read_file", { path: join(other, "notes.md") });
    expect(result.content).not.toContain(FAKE_KEY);
  });

  it("grep from a parent folder does not walk into another role's home", async () => {
    const other = join(home, ".jht-api", "agents", "analista");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "walked.md"), `walked ${FAKE_KEY}\n`);
    for (const path of [home, join(home, ".jht-api"), join(home, ".jht-api", "agents")]) {
      const result = await call(autoPolicy(), "grep", { pattern: "walked", path });
      expect(result.content, path).not.toContain(FAKE_KEY);
    }
  });

  it("recognises other common credential files", () => {
    for (const p of ["/h/.git-credentials", "/h/.config/gh/hosts.yml", "/h/.aws/credentials", "/h/.netrc"]) {
      expect(isSensitivePath(p), p).toBe(true);
    }
    expect(isSensitivePath("/h/proj/.env.example")).toBe(false);
  });
});

describe("bash: environment scrub", () => {
  it.each(["OPENAI_API_KEY", "JHT_API_OPENAI_KEY", "GITHUB_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "DB_PASSWORD"])(
    "%s is not visible to the command",
    async (name) => {
      process.env[name] = FAKE_KEY;
      try {
        const result = await call(autoPolicy(), "bash", { command: "env; printf '%s' \"$" + name + '"' });
        expect(result.content).not.toContain(FAKE_KEY);
      } finally {
        delete process.env[name];
      }
    },
  );

  it("credentials inside a URL-shaped variable are scrubbed too", () => {
    const env = scrubEnv({ DATABASE_URL: `postgres://u:${FAKE_KEY}@db/x`, PATH: "/usr/bin" });
    expect(JSON.stringify(env)).not.toContain(FAKE_KEY);
    expect(env["PATH"]).toBe("/usr/bin");
  });

  it("gets no stdin and dies with its process group on timeout", async () => {
    const started = Date.now();
    const result = await call(autoPolicy(), "bash", { command: "cat; sleep 30 & sleep 30", timeout_ms: 1_000 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.content).toContain("timed out");
  });
});

describe("web_fetch: no local network, no cloud metadata", () => {
  const refused = async (url: string, tool = tools.get("web_fetch")!) => {
    const result = await tool.execute(tool.spec.schema.parse({ url }), CONTEXT);
    expect(result.ok, url).toBe(false);
    expect(result.content).not.toContain("LOCAL-ONLY-PAGE");
    return result;
  };

  /**
   * A client whose DNS and socket are scripted, so nothing leaves the machine.
   * 3ffe:ffff::1 stands for "a public address": global unicast, returned to
   * IANA with the 6bone and assigned to nobody.
   */
  function scripted(dns: Record<string, string[]>, reply: (url: URL) => SafeHttpResponse) {
    const connected: string[] = [];
    const client = new SafeHttpsClient({
      resolveHostname: async (host) => dns[host] ?? [],
      requestPinned: async (url, addresses) => {
        connected.push(`${url.hostname}@${addresses.map((a) => a.address).join(",")}`);
        return reply(url);
      },
    });
    return { connected, tool: createWebFetchTool({ client, timeoutMs: 3_000 }) };
  }

  it.each([
    "https://169.254.169.254/latest/meta-data/",
    "https://localhost:PORT/",
    "https://127.0.0.1:PORT/",
    "https://127.1:PORT/",
    "https://0x7f000001:PORT/",
    "https://[::1]:PORT/",
    "https://0.0.0.0:PORT/",
    "https://10.0.0.1/",
    "https://192.168.1.1/",
    // IPv4-mapped IPv6: the URL parser rewrites [::ffff:127.0.0.1] as
    // [::ffff:7f00:1], and the socket still lands on loopback.
    "https://[::ffff:127.0.0.1]:PORT/",
    "https://[::ffff:7f00:1]:PORT/",
    "https://[::ffff:169.254.169.254]/",
  ])("%s is refused", async (template) => {
    await refused(template.replace("PORT", String(port)));
  });

  it.each(["http://127.0.0.1:PORT/", "file:///etc/passwd", "ftp://example.com/"])(
    "%s is refused: https only",
    async (template) => {
      await refused(template.replace("PORT", String(port)));
    },
  );

  it("a public name that resolves to the metadata address is refused before connecting", async () => {
    const { connected, tool } = scripted({ "evil.example": ["169.254.169.254"] }, () => ({ status: 200, headers: {}, body: Buffer.from("x") }));
    await refused("https://evil.example/", tool);
    expect(connected).toEqual([]);
  });

  it("one private address among public ones is enough to refuse (rebinding)", async () => {
    const { connected, tool } = scripted({ "mixed.example": ["3ffe:ffff::1", "127.0.0.1"] }, () => ({ status: 200, headers: {}, body: Buffer.from("x") }));
    await refused("https://mixed.example/", tool);
    expect(connected).toEqual([]);
  });

  it("a redirect to the metadata address is refused at the second hop", async () => {
    const { connected, tool } = scripted({ "jobs.example": ["3ffe:ffff::1"] }, () => ({
      status: 302,
      headers: { location: "https://169.254.169.254/latest/meta-data/" },
      body: Buffer.alloc(0),
    }));
    await refused("https://jobs.example/offer", tool);
    expect(connected).toEqual(["jobs.example@3ffe:ffff::1"]);
  });

  it.each(["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "fe80::1", "::1", "fd00::1"])(
    "%s is not public",
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
    },
  );
});

describe("jobs.db outside apiHome (SICUREZZA D-1): only the database tools touch it", () => {
  /**
   * The ashley layout: JHT_API_DB=/jht_home/db/jobs.db, outside the runtime's
   * home, next to the candidate's profile under the same JHT home. The file
   * tools must not rewrite, truncate or read the database or SQLite's files
   * beside it — by name or through a link — and the profile stays readable.
   */
  it("refuses write_file, edit_file and read_file on the database, its -wal, -shm and -journal, and through a link", async () => {
    const jht = join(home, "jht_home");
    const apiHome = join(home, ".jht-api");
    const agentHome = join(apiHome, "agents", "scout-1");
    await mkdir(join(jht, "profile"), { recursive: true });
    await mkdir(agentHome, { recursive: true });
    await writeFile(join(jht, "profile", "candidate_profile.yml"), "role: backend\n");

    const dbFile = jobsDbPath({ JHT_API_DB: join(jht, "db", "jobs.db") }, apiHome);
    const db = openJobsDb(dbFile); // WAL: -wal and -shm exist while it is open
    db.prepare("INSERT INTO scout_claims (job_id, scout) VALUES (?, ?)").run("https://jobs.example/1", "scout-1");
    await symlink(dbFile, join(agentHome, "notes.db"));

    const toolkit = await buildToolkit(
      {
        workdir: agentHome,
        agentHome,
        apiHome,
        profileDir: join(jht, "profile"),
        permissionMode: "auto",
        profile: MOCK_PROFILE,
      },
      { provider: new MockProvider([]), jobsDbFile: dbFile },
    );
    const byName = new Map(toolkit.tools.map((tool) => [tool.spec.name, tool]));
    const run = async (name: string, args: Record<string, unknown>) => {
      const tool = byName.get(name)!;
      const parsed = tool.spec.schema.parse(args);
      const decision = await toolkit.permissions.decide(name, tool.classify(parsed));
      if (!decision.allowed) return { allowed: false, content: decision.message ?? "" };
      return { allowed: true, content: (await tool.execute(parsed, CONTEXT)).content };
    };

    for (const target of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}-journal`, join(agentHome, "notes.db")]) {
      expect((await run("write_file", { path: target, content: "" })).allowed, target).toBe(false);
      expect((await run("edit_file", { path: target, old_string: "SQLite", new_string: "x" })).allowed, target).toBe(false);
      expect((await run("read_file", { path: target })).allowed, target).toBe(false);
    }
    // Walks from the shared folder skip the database files.
    const grep = await run("grep", { pattern: "jobs.example", path: jht });
    const glob = await run("glob", { pattern: "**/*", path: jht });
    for (const out of [grep.content, glob.content]) expect(out).not.toMatch(/jobs\.db/);
    // The profile next to it is still the agent's to read.
    expect((await run("read_file", { path: join(jht, "profile", "candidate_profile.yml") })).content).toContain("role: backend");

    // And the database is intact.
    expect(db.prepare("SELECT job_id FROM scout_claims").all()).toEqual([{ job_id: "https://jobs.example/1" }]);
    db.close();
    await toolkit.close();
  });
});
