/**
 * `jht-hub`: the one process that holds the team's database and channels.
 *
 * SICUREZZA §8 phase 2 (T18). A role's container no longer mounts `jobs.db`
 * nor `channels/`: from its shell, `node:sqlite` finds no file and no inbox
 * is there to write. Its runtime reaches both through this process, which
 * applies the same rules the tools applied in the role — the code is the
 * same code, run here — with the agent taken from the token, never from the
 * request:
 *
 * - the database tools of the role's skills (`createSkillTools`, with the
 *   role's `skills.list` read here), `role-policy.ts` deciding per role;
 * - `send`, with `from` set by the hub, and `drain` of the caller's inbox only;
 * - `notify`, with the rate limit kept here too;
 * - `take` of the person's replies to the caller.
 *
 * One token per role, in the role's environment. A shell in that role can
 * read it, and gets that role's rights and nothing more: the other tokens
 * are in other containers. The hub listens on the pod's loopback only.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import type { z } from "zod";

import { formatIssues, TurnAccount } from "../core/agent-loop.ts";
import { agentInstanceId } from "../core/agent-id.ts";
import { openJobsDb, type Database } from "../db/jobs-db.ts";
import { roleOf } from "../db/role-policy.ts";
import { DEFAULT_NOTIFY_LIMIT, FileMailbox, FileNotifier, FileUserReplies } from "../parity/jht-tools.ts";
import { loadRolePrompt } from "../parity/role-prompt.ts";
import { createSkillTools } from "../parity/skills/index.ts";
import { requestWrite } from "../db/write-request.ts";
import type { ToolContext, ToolHandler } from "../tools/registry.ts";
import {
  EmptyRequest,
  HUB_PATHS,
  MAX_BODY_BYTES,
  NotifyRequest,
  SendRequest,
  TOKEN,
  ToolRequest,
  UserWriteRequest,
  type ToolResponse,
} from "./protocol.ts";
import { Launcher, SpawnRequest, StopRequest } from "./launcher.ts";

export interface HubOptions {
  /** token → agent id (`scout-1`). */
  tokens: ReadonlyMap<string, string>;
  /** The team's jobs.db. */
  dbPath: string;
  /** `mailbox/`, `replies/` and `notify.jsonl`. */
  channelsDir: string;
  /** The folder holding `agents/`: each role's `skills.list` is read from there. */
  appRoot: string;
  /** The person's profile, read-only: profile_gate and the enrichment policy. */
  profileDir?: string;
  /** The hub's own state: the salary cache, `scout-dedup.log`. */
  stateDir: string;
  /** `$JHT_HOME`, as the feedback display reads it. */
  jhtHome?: string;
  notifyLimit?: { max: number; windowMs: number };
  /** Messages one agent may send in a window (HUB-3): a loop fills no inbox. */
  sendLimit?: { max: number; windowMs: number };
  /** How often the launcher takes in the executor's results with nobody asking. */
  sweepMs?: number;
  now?: () => number;
  /** The CAPITANO's launcher (SICUREZZA §9). Absent: no one spawns through this hub. */
  launcher?: Launcher;
  /**
   * The host's own token, kept apart from the roles' (T24): with it, and only
   * with it, `run-team` starts the base set. No role has it.
   */
  teamToken?: string;
  /** Test seam: the tools of an agent, instead of the ones its role lists. */
  toolsFor?: (agent: string, db: () => Database) => Promise<ToolHandler[]>;
}

/** Reads `{ "<token>": "<agent>" }`; a token that is short or an agent twice refuses to start. */
export function loadTokens(file: string): Map<string, string> {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${file}: expected an object of token → agent.`);
  const tokens = new Map<string, string>();
  const agents = new Set<string>();
  for (const [token, agent] of Object.entries(raw)) {
    if (!TOKEN.test(token)) throw new Error(`${file}: a token must be 32 to 256 characters of [A-Za-z0-9_-].`);
    if (typeof agent !== "string") throw new Error(`${file}: every token names an agent.`);
    const id = agentInstanceId(agent);
    if (agents.has(id)) throw new Error(`${file}: ${id} has two tokens.`);
    agents.add(id);
    tokens.set(token, id);
  }
  return tokens;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Often enough that a child's booking comes back while its session runs, cheap enough to ignore. */
const DEFAULT_SWEEP_MS = 5_000;

/** A report or an order every minute for an hour; far below a loop. */
export const DEFAULT_SEND_LIMIT = { max: 60, windowMs: 60 * 60_000 };

const digest = (text: string) => createHash("sha256").update(text).digest();

export function createHub(options: HubOptions): Server {
  const now = options.now ?? Date.now;
  // Compared as digests, in constant time, against every token: which one
  // matched, or how much of one, does not show in the timing.
  const known = [...options.tokens].map(([token, agent]) => ({ digest: digest(token), agent }));
  const teamDigest = options.teamToken === undefined ? undefined : digest(options.teamToken);
  const tokenOf = (header: string | undefined): string => {
    const token = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
    if (!token || !TOKEN.test(token)) throw new HttpError(401, "A role's token is required.");
    return token;
  };
  const agentOf = (header: string | undefined): string => {
    const offered = digest(tokenOf(header));
    let agent: string | undefined;
    for (const k of known) if (timingSafeEqual(k.digest, offered)) agent = k.agent;
    if (!agent) throw new HttpError(401, "Unknown token.");
    return agent;
  };

  let opened: Database | undefined;
  const db = () => (opened ??= openJobsDb(options.dbPath));
  const mailbox = new FileMailbox(join(options.channelsDir, "mailbox"));
  const notifier = new FileNotifier(join(options.channelsDir, "notify.jsonl"));
  const replies = new FileUserReplies(join(options.channelsDir, "replies"));
  const notifyLimit = options.notifyLimit ?? DEFAULT_NOTIFY_LIMIT;
  const sendLimit = options.sendLimit ?? DEFAULT_SEND_LIMIT;
  const notified = new Map<string, number[]>();
  const sent = new Map<string, number[]>();
  /** Counts one more for `agent` in a sliding window, or refuses it past `limit`. */
  const within = (log: Map<string, number[]>, agent: string, limit: { max: number; windowMs: number }, what: string) => {
    const at = now();
    const window = (log.get(agent) ?? []).filter((t) => at - t < limit.windowMs);
    if (window.length >= limit.max) throw new HttpError(429, `${what} limit reached (${limit.max} per ${Math.round(limit.windowMs / 60_000)} min).`);
    window.push(at);
    log.set(agent, window);
    return at;
  };
  // The agents that exist are the ones with a token: a message to anyone else
  // would sit in an inbox nobody reads (CAPITANO-01 is not capitano-1).
  const agents = new Set(options.tokens.values());

  const toolsFor =
    options.toolsFor ??
    (async (agent: string, open: () => Database) => {
      // The role's skills as its runtime reads them; the locale changes texts, never names.
      const prompt = await loadRolePrompt({ appRoot: options.appRoot, role: roleOf(agent), locale: "en" });
      const common = {
        skills: prompt.skills.map((s) => s.name),
        agent,
        jhtHome: options.jhtHome,
        dedupLog: join(options.stateDir, "logs", "scout-dedup.log"),
        profileDir: options.profileDir,
        stateDir: options.stateDir,
      };
      // Only what needs the database runs here: the rest stays in the role.
      const without = new Set(createSkillTools(common).map((t) => t.spec.name));
      return createSkillTools({ ...common, jobsDb: { open, path: options.dbPath } }).filter((t) => !without.has(t.spec.name));
    });
  const tools = new Map<string, Promise<Map<string, ToolHandler>>>();
  const toolOf = async (agent: string, name: string): Promise<ToolHandler> => {
    let forAgent = tools.get(agent);
    if (!forAgent) {
      forAgent = toolsFor(agent, db).then((list) => new Map(list.map((t) => [t.spec.name, t])));
      tools.set(agent, forAgent);
    }
    const tool = (await forAgent).get(name);
    if (!tool) throw new HttpError(403, `\`${name}\` is not a tool of ${agent} on the hub.`);
    return tool;
  };

  const handle = async (path: string, agent: string, body: unknown): Promise<unknown> => {
    switch (path) {
      case HUB_PATHS.tool: {
        const request = parse(ToolRequest, body);
        const tool = await toolOf(agent, request.name);
        const args = tool.spec.schema.safeParse(request.args);
        if (!args.success) return { ok: false, content: `Error: invalid arguments for ${request.name}: ${formatIssues(args.error)}` } satisfies ToolResponse;
        const context: ToolContext = { account: new TurnAccount(now), remainingMs: () => 120_000 };
        const result = await tool.execute(args.data, context);
        return { ok: result.ok, content: result.content, ...(result.details ? { details: result.details } : {}) } satisfies ToolResponse;
      }
      case HUB_PATHS.send: {
        const request = parse(SendRequest, body);
        const to = agentInstanceId(request.to);
        if (!agents.has(to)) throw new HttpError(404, `No agent ${to} on this team. Agents: ${[...agents].sort().join(", ")}.`);
        const at = within(sent, agent, sendLimit, "Message");
        // The sender is the token's agent, whatever the role's runtime believes it is.
        await mailbox.send({ from: agent, to, text: request.text, ts: at });
        return {};
      }
      case HUB_PATHS.drain:
        parse(EmptyRequest, body);
        return { messages: await mailbox.drain(agent) };
      case HUB_PATHS.notify: {
        const request = parse(NotifyRequest, body);
        const at = within(notified, agent, notifyLimit, "Notification");
        await notifier.notify({ from: agent, kind: request.kind, text: request.text, ts: at, ...(request.positionId === undefined ? {} : { positionId: request.positionId }) });
        return {};
      }
      case HUB_PATHS.replies:
        parse(EmptyRequest, body);
        return { replies: await replies.take(agent) };
      case HUB_PATHS.spawn:
      case HUB_PATHS.spawnStop:
      case HUB_PATHS.spawnList: {
        // Only a CAPITANO starts or stops children; a child never does, so the tree is one deep.
        if (!Launcher.mayLaunch(agent)) throw new HttpError(403, "Only the CAPITANO starts or stops agents.");
        const launcher = options.launcher;
        if (!launcher) throw new HttpError(503, "This hub has no launcher.");
        if (path === HUB_PATHS.spawn) return launcher.spawn(agent, parse(SpawnRequest, body));
        if (path === HUB_PATHS.spawnStop) return launcher.stop(agent, parse(StopRequest, body).spawn_id);
        parse(EmptyRequest, body);
        return launcher.list(agent);
      }
      default:
        throw new HttpError(404, "No such operation.");
    }
  };

  const server = createServer((req, res) => {
    void serve(req, res);
  });
  // The launcher learns what the executor reported when a call arrives; a
  // child that ends after the last call would keep its booking until then.
  const sweep = options.launcher
    ? setInterval(() => {
        try {
          options.launcher?.sweep();
        } catch {
          // A disk that will not take the log or the state is the next real
          // call's to report: the hub holds the team's database and channels,
          // and a throw here would end it from inside a timer nobody catches.
        }
      }, options.sweepMs ?? DEFAULT_SWEEP_MS).unref()
    : undefined;
  const serve = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method !== "POST") throw new HttpError(405, "POST only.");
      const path = req.url ?? "";
      if (!Object.values(HUB_PATHS).includes(path as never)) throw new HttpError(404, "No such operation.");
      const body = await readBody(req);
      // T28: the person's own request, from the host. The hub is the only
      // process that opens jobs.db during a run, so the operator's command
      // goes through it — with the team's token, which no role has.
      if (path === HUB_PATHS.userRequest) {
        const offered = digest(tokenOf(req.headers.authorization));
        if (!teamDigest || !timingSafeEqual(teamDigest, offered)) throw new HttpError(403, "A CV is requested by the person, with the host's own token.");
        const request = parse(UserWriteRequest, body);
        reply(res, 200, requestWrite(db(), request.position_id, request.mode, request.kind));
        return;
      }
      // The team's start is the host's, not an agent's: its token is another
      // file, and a role's token never matches it.
      if (path === HUB_PATHS.teamStart) {
        const launcher = options.launcher;
        if (!launcher) throw new HttpError(503, "This hub has no launcher.");
        const offered = digest(tokenOf(req.headers.authorization));
        if (!teamDigest || !timingSafeEqual(teamDigest, offered)) throw new HttpError(403, "The team is started with the host's own token.");
        parse(EmptyRequest, body);
        reply(res, 200, launcher.startTeam("host"));
        return;
      }
      reply(res, 200, await handle(path, agentOf(req.headers.authorization), body));
    } catch (error) {
      if (error instanceof HttpError) reply(res, error.status, { error: error.message });
      else reply(res, 500, { error: "The hub failed on this request." });
    }
  };
  server.on("close", () => {
    if (sweep) clearInterval(sweep);
    opened?.close();
  });
  return server;
}

function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, "Malformed request.");
  return result.data;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "JSON only.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Malformed JSON.");
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}
