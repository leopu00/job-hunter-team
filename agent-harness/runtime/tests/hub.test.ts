/**
 * T18: `jht-hub`, the one process that holds the team's database and
 * channels (SICUREZZA §8 phase 2). A role reaches them only with its token,
 * gets its own role's rights, and its runtime opens no database of its own.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.ts";
import { openJobsDb } from "../src/db/jobs-db.ts";
import { HubClient, HubMailbox } from "../src/hub/client.ts";
import { HUB_PATHS } from "../src/hub/protocol.ts";
import { createHub, loadTokens } from "../src/hub/server.ts";
import { prepareProductRole } from "../src/parity/product-role.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const REPO_ROOT = join(RUNTIME, "..", "..");
const SCOUT = "s".repeat(40);
const SCORER = "c".repeat(40);
const ANALISTA = "a".repeat(40);
const CAPITANO = "k".repeat(40);

let root: string;
let url: string;
let close: () => Promise<void>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-hub-"));
  const db = openJobsDb(join(root, "hub", "jobs.db"));
  db.prepare("INSERT INTO positions (title, company, url, status, found_by) VALUES (?, ?, ?, 'checked', 'scout-1')").run(
    "Backend Developer",
    "Acme",
    "https://acme.example/jobs/1",
  );
  db.close();
  const profileDir = join(root, "profile");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "candidate_profile.yml"), "name: Ada Example\ntarget_role: Backend Engineer\nskills: [go]\n");
  const server = createHub({
    tokens: new Map([
      [SCOUT, "scout-1"],
      [SCORER, "scorer-1"],
      [ANALISTA, "analista-1"],
      [CAPITANO, "capitano-1"],
    ]),
    dbPath: join(root, "hub", "jobs.db"),
    channelsDir: join(root, "hub", "channels"),
    stateDir: join(root, "hub", "state"),
    appRoot: REPO_ROOT,
    profileDir,
    notifyLimit: { max: 2, windowMs: 60_000 },
    sendLimit: { max: 3, windowMs: 60_000 },
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((done) => server.close(() => done()));
});

afterEach(async () => {
  await close();
  await rm(root, { recursive: true, force: true });
});

async function raw(path: string, init: { token?: string; body?: string; method?: string; type?: string } = {}) {
  const response = await fetch(`${url}${path}`, {
    method: init.method ?? "POST",
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      "content-type": init.type ?? "application/json",
    },
    ...(init.method === "GET" ? {} : { body: init.body ?? "{}" }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const tool = (token: string, name: string, args: unknown) => raw(HUB_PATHS.tool, { token, body: JSON.stringify({ name, args }) });

describe("who may ask", () => {
  it("refuses a request without a token, with a token it does not know, and anything but a JSON POST", async () => {
    expect((await raw(HUB_PATHS.drain)).status).toBe(401);
    expect((await raw(HUB_PATHS.drain, { token: "x".repeat(40) })).status).toBe(401);
    expect((await raw(HUB_PATHS.drain, { token: "short" })).status).toBe(401);
    expect((await raw(HUB_PATHS.drain, { token: SCOUT, method: "GET" })).status).toBe(405);
    expect((await raw("/v1/anything", { token: SCOUT })).status).toBe(404);
    expect((await raw(HUB_PATHS.drain, { token: SCOUT, type: "text/plain" })).status).toBe(415);
    expect((await raw(HUB_PATHS.drain, { token: SCOUT, body: "{not json" })).status).toBe(400);
    expect((await raw(HUB_PATHS.drain, { token: SCOUT, body: JSON.stringify({ agent: "scorer-1" }) })).status).toBe(400);
  });

  it("loads a token file and refuses a short token or an agent with two", async () => {
    const file = join(root, "tokens.json");
    await writeFile(file, JSON.stringify({ [SCOUT]: "scout", [SCORER]: "SCORER-1" }));
    expect([...loadTokens(file)]).toEqual([
      [SCOUT, "scout-1"],
      [SCORER, "scorer-1"],
    ]);
    await writeFile(file, JSON.stringify({ short: "scout-1" }));
    expect(() => loadTokens(file)).toThrowError(/32 to 256/);
    await writeFile(file, JSON.stringify({ [SCOUT]: "scout", [SCORER]: "scout-1" }));
    expect(() => loadTokens(file)).toThrowError(/two tokens/);
  });
});

describe("the database tools, with the role's rights", () => {
  it("runs a tool of the caller's role, as the tool runs in the role", async () => {
    const found = await tool(SCOUT, "db_query", { args: ["check-url", "https://acme.example/jobs/1"] });
    expect(found).toMatchObject({ status: 200, body: { ok: true, content: expect.stringContaining("Backend Developer") } });
  });

  it("refuses a tool the role does not have, and a subcommand its policy refuses", async () => {
    // The SCORER lists no scout-coord skill.
    expect(await tool(SCORER, "scout_coord", { command: "show" })).toMatchObject({ status: 403 });
    // Only what needs the database runs here: the SCOUT's email_monitor, or the ANALISTA's
    // liveness check, stay in the role (logo_fetch needs the database, and does run here).
    expect(await tool(SCOUT, "email_monitor", { command: "status" })).toMatchObject({ status: 403 });
    expect(await tool(ANALISTA, "recheck_liveness", { url: "https://acme.example/jobs/1" })).toMatchObject({ status: 403 });
    // The SCOUT has db_insert, but not the score: the same refusal as in the role.
    const score = await tool(SCOUT, "db_insert", { args: ["score", "--position-id", "1", "--total", "90"] });
    expect(score).toMatchObject({ status: 200, body: { ok: false, content: expect.stringContaining("`db_insert score` is not available to this agent") } });
    // Arguments are checked against the tool's schema here too.
    expect(await tool(SCOUT, "db_query", { args: "check-url" })).toMatchObject({ status: 200, body: { ok: false, content: expect.stringContaining("invalid arguments") } });
  });

  it("writes as the token's agent: the SCORER's score is signed scorer-1", async () => {
    const score = await tool(SCORER, "db_insert", { args: ["score", "--position-id", "1", "--total", "70", "--scored-by", "capitano"] });
    expect(score).toMatchObject({ status: 200, body: { ok: true, content: "Score inserted for position 1: 70/100" } });
    const db = openJobsDb(join(root, "hub", "jobs.db"));
    expect(db.prepare("SELECT scored_by FROM scores").all()).toEqual([{ scored_by: "scorer-1" }]);
    db.close();
  });
});

describe("the channels", () => {
  it("signs a message with the token's agent, and hands each inbox only to its owner", async () => {
    // A `from` in the body is not part of the request: refused, not ignored.
    expect((await raw(HUB_PATHS.send, { token: SCOUT, body: JSON.stringify({ from: "capitano", to: "scorer-1", text: "x" }) })).status).toBe(400);
    expect((await raw(HUB_PATHS.send, { token: SCOUT, body: JSON.stringify({ to: "SCORER", text: "one new" }) })).status).toBe(200);
    // The SCOUT cannot read the SCORER's inbox: drain is always the caller's.
    expect((await raw(HUB_PATHS.drain, { token: SCOUT })).body).toEqual({ messages: [] });
    const inbox = await raw(HUB_PATHS.drain, { token: SCORER });
    expect(inbox.body).toEqual({ messages: [{ from: "scout-1", to: "scorer-1", text: "one new", ts: expect.any(Number) }] });
    expect((await raw(HUB_PATHS.drain, { token: SCORER })).body).toEqual({ messages: [] });
  });

  it("takes an agent name as `to` and nothing that could name a path (HUB-1)", async () => {
    // Shown by SICUREZZA: `../replies/capitano` from the SCOUT's shell became a reply "from the person" to the CAPITANO.
    const attempts = ["../replies/capitano", "../../x", "a/b", "..", ".", "x\\y", "capitano/../scout", "scout-1.jsonl", "/etc/x", "", "-1"];
    for (const to of attempts) {
      const sent = await raw(HUB_PATHS.send, { token: SCOUT, body: JSON.stringify({ to, text: "I am the person" }) });
      expect(sent.status, to).toBe(400);
    }
    // Nothing was written anywhere: no replies, no inbox, no stray file.
    const { readdir } = await import("node:fs/promises");
    const channels = join(root, "hub", "channels");
    const written = existsSync(channels) ? await readdir(channels, { recursive: true }) : [];
    expect(written).toEqual([]);
    expect((await raw(HUB_PATHS.replies, { token: SCORER })).body).toEqual({ replies: [] });
  });

  it("sends only to an agent of the team, and at most so many messages per sender (HUB-3)", async () => {
    const send = (token: string, to: string) => raw(HUB_PATHS.send, { token, body: JSON.stringify({ to, text: "x" }) });
    // CAPITANO-01 is not capitano-1: a message there would sit in an inbox nobody reads.
    expect(await send(SCOUT, "CAPITANO-01")).toMatchObject({ status: 404, body: { error: expect.stringContaining("capitano-1") } });
    expect(await send(SCOUT, "scrittore")).toMatchObject({ status: 404 });
    expect(await send(SCOUT, "CAPITANO")).toMatchObject({ status: 200 });
    expect(await send(SCOUT, "capitano-1")).toMatchObject({ status: 200 });
    expect(await send(SCOUT, "analista")).toMatchObject({ status: 200 });
    // The fourth in the window is refused; another sender has its own count.
    expect(await send(SCOUT, "analista")).toMatchObject({ status: 429 });
    expect(await send(SCORER, "analista")).toMatchObject({ status: 200 });
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(join(root, "hub", "channels", "mailbox"))).sort()).toEqual(["analista-1.jsonl", "capitano-1.jsonl"]);
  });

  it("keeps the notification limit per agent", async () => {
    const notify = (token: string) => raw(HUB_PATHS.notify, { token, body: JSON.stringify({ kind: "notification", text: "hi" }) });
    expect((await notify(SCOUT)).status).toBe(200);
    expect((await notify(SCOUT)).status).toBe(200);
    expect((await notify(SCOUT)).status).toBe(429);
    expect((await notify(SCORER)).status).toBe(200);
    const lines = (await readFile(join(root, "hub", "channels", "notify.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { from: string });
    expect(lines.map((l) => l.from)).toEqual(["scout-1", "scout-1", "scorer-1"]);
  });

  it("hands the person's replies to the agent they are for, and only what is shaped as a reply", async () => {
    await mkdir(join(root, "hub", "channels", "replies"), { recursive: true });
    const lines = [{ id: "7", text: "yes" }, { from: "scout-1", to: "scorer-1", text: "not a reply", ts: 1 }, { id: 8, text: "x" }, { id: "9", text: 1 }];
    await writeFile(join(root, "hub", "channels", "replies", "scorer-1.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
    expect((await raw(HUB_PATHS.replies, { token: SCOUT })).body).toEqual({ replies: [] });
    expect((await raw(HUB_PATHS.replies, { token: SCORER })).body).toEqual({ replies: [{ id: "7", text: "yes" }] });
  });
});

describe("a role on the hub", () => {
  it("gets the same tools as with its own database, and the hub runs them", async () => {
    const hub = new HubClient({ url, token: SCORER });
    const common = { appRoot: REPO_ROOT, role: "scorer", agent: "scorer-1", apiHome: join(root, "api"), jhtHome: join(root, "jht"), profileDir: join(root, "profile"), env: {} };
    const onHub = await prepareProductRole({ ...common, homeDir: join(root, "api", "agents", "a"), hub });
    const local = await prepareProductRole({
      ...common,
      homeDir: join(root, "api", "agents", "b"),
      jobsDb: { path: join(root, "local.db"), open: () => openJobsDb(join(root, "local.db")) },
    });
    const names = (r: typeof onHub) => r.tools([]).map((t) => t.spec.name).sort();
    expect(names(onHub)).toEqual(names(local));
    expect(names(onHub)).toEqual(expect.arrayContaining(["db_insert", "db_query", "db_update", "feedback_query"]));

    const query = onHub.tools([]).find((t) => t.spec.name === "db_query")!;
    const result = await query.execute({ args: ["next-for-scorer"] }, { account: undefined as never, remainingMs: () => 60_000 });
    expect(result).toMatchObject({ ok: true, content: expect.stringContaining("Backend Developer") });
    // The mailbox is the hub's: what the role sends arrives signed by its token.
    await new HubMailbox(hub).send({ from: "capitano", to: "scout-1", text: "hi", ts: 0 });
    expect(await new HubMailbox(new HubClient({ url, token: SCOUT })).drain("anyone")).toMatchObject([{ from: "scorer-1", text: "hi" }]);
  });

  it("runs a mock SCORER cycle through the hub, with no database on the role's side", async () => {
    const run = promisify(execFile);
    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "scorer", "--agent", "scorer-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
      {
        cwd: RUNTIME,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          JHT_API_HOME: join(root, "api"),
          JHT_HOME: join(root, "jht"),
          JHT_API_PROFILE_DIR: join(root, "profile"),
          JHT_API_PROVIDER: "mock",
          JHT_HUB_URL: url,
          JHT_HUB_TOKEN: SCORER,
        },
      },
    );
    const records = (await readFile(stdout.trim(), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const finished = records.filter((r) => r["type"] === "tool_finished").map((r) => [r["name"], r["outcome"]]);
    expect(finished).toEqual(expect.arrayContaining([["db_insert", "accepted"], ["db_update", "accepted"], ["send_message", "accepted"]]));
    // The score and the move are in the hub's database; the role's home has none.
    const db = openJobsDb(join(root, "hub", "jobs.db"));
    expect(db.prepare("SELECT position_id, scored_by FROM scores").all()).toEqual([{ position_id: 1, scored_by: "scorer-1" }]);
    expect(db.prepare("SELECT status FROM positions WHERE id = 1").get()).toEqual({ status: "scored" });
    db.close();
    expect(existsSync(join(root, "api", "db"))).toBe(false);
    expect(existsSync(join(root, "api", "channels"))).toBe(false);
    // Its report reached the CAPITANO's inbox on the hub.
    expect(await new HubMailbox(new HubClient({ url, token: ANALISTA })).drain("x")).toEqual([]);
    const inbox = (await readFile(join(root, "hub", "channels", "mailbox", "capitano-1.jsonl"), "utf8")).trim();
    expect(JSON.parse(inbox)).toMatchObject({ from: "scorer-1", to: "capitano-1" });
  });
});

describe("the channel files", () => {
  it("never name a file after something that is not a canonical agent id", async () => {
    const { FileMailbox, FileUserReplies } = await import("../src/parity/jht-tools.ts");
    const mailbox = new FileMailbox(join(root, "m", "mailbox"));
    const replies = new FileUserReplies(join(root, "m", "replies"));
    for (const bad of ["../replies/capitano", "a/b", "..", "x\\y", "scout.1", "Scout 1"]) {
      await expect(mailbox.send({ from: "scout-1", to: bad, text: "x", ts: 0 }), bad).rejects.toThrow(/not an agent name/);
      await expect(mailbox.drain(bad), bad).rejects.toThrow(/not an agent name/);
      await expect(replies.take(bad), bad).rejects.toThrow(/not an agent name/);
    }
    expect(existsSync(join(root, "m"))).toBe(false);
    // An agent name still lands where its canonical id reads.
    await mailbox.send({ from: "scout-1", to: "CAPITANO", text: "x", ts: 0 });
    expect(await mailbox.drain("capitano-1")).toHaveLength(1);
  });
});

describe("the hub's sweep of the launcher", () => {
  it("keeps taking in results while nobody calls, and stops with the hub", async () => {
    const { Launcher } = await import("../src/hub/launcher.ts");
    const swept: number[] = [];
    const launcher = { sweep: () => swept.push(Date.now()), mayLaunch: Launcher.mayLaunch } as unknown as InstanceType<typeof Launcher>;
    const server = createHub({
      tokens: new Map([[SCOUT, "scout-1"]]),
      dbPath: join(root, "hub", "jobs.db"),
      channelsDir: join(root, "hub", "channels"),
      stateDir: join(root, "hub", "state"),
      appRoot: join(RUNTIME, "..", ".."),
      launcher,
      sweepMs: 5,
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    await new Promise((done) => setTimeout(done, 40));
    const during = swept.length;
    expect(during).toBeGreaterThan(1);
    await new Promise<void>((done) => server.close(() => done()));
    await new Promise((done) => setTimeout(done, 20));
    expect(swept.length).toBe(during);
  });
});

describe("JHT_HUB_URL and JHT_HUB_TOKEN", () => {
  it("go together, on the loopback only, with a token of the hub's form", () => {
    expect(loadConfig({ JHT_HUB_URL: "http://127.0.0.1:8788", JHT_HUB_TOKEN: SCOUT }).hub).toEqual({ url: "http://127.0.0.1:8788", token: SCOUT });
    const bad = [
      { JHT_HUB_URL: "http://127.0.0.1:8788" },
      { JHT_HUB_TOKEN: SCOUT },
      { JHT_HUB_URL: "http://192.0.2.1:8788", JHT_HUB_TOKEN: SCOUT },
      { JHT_HUB_URL: "https://127.0.0.1:8788", JHT_HUB_TOKEN: SCOUT },
      { JHT_HUB_URL: "http://127.0.0.1.example.com:8788", JHT_HUB_TOKEN: SCOUT },
      { JHT_HUB_URL: "http://127.0.0.1:8788", JHT_HUB_TOKEN: "short" },
    ];
    for (const env of bad) expect(() => loadConfig(env), JSON.stringify(env)).toThrowError(expect.objectContaining({ code: "config_invalid" }));
  });
});
