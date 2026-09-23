/**
 * The dashboard's fourth page: start the base team (B-02, round 4).
 *
 * The one place of the dashboard that can spend money, and the MASTER's
 * conditions for it, each kept here:
 * 1. only `/v1/team/start`: the host's token opens other routes too, and this
 *    file names no other path — `startTeam` takes no path at all;
 * 2. through the launcher, taking its refusals: its answer is shown as it
 *    came, never read into, never retried;
 * 3. no free text: the only thing to choose is whether to start the team the
 *    launcher's configuration describes. Nothing typed reaches a prompt;
 * 4. an explicit confirmation showing the most it can cost — the piggy bank's
 *    `sessionUsd`, read from the configuration, not a figure written here —
 *    and never one key that starts;
 * 5. only from an interactive terminal: nothing starts by itself, nothing
 *    starts again (the key handler is the only caller, `--once` has none);
 * 6. who started and what was shown to them is written down before the call,
 *    and the hub's answer after it, beside the traces.
 *
 * What starts is shown as the configuration states it, member by member, with
 * the cap and the model the launcher gives each. If the configuration cannot
 * be read, nothing can start, and the page says why.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname } from "node:path";

import { LauncherConfigSchema } from "../hub/launcher.ts";
import { HUB_PATHS, TOKEN } from "../hub/protocol.ts";
import { c, usd } from "./render.ts";

/** One member of the base team, as the launcher will order it. */
export interface PlannedMember {
  role: string;
  instances: number;
  capUsd: number;
  model: string;
  delayS?: number;
}

export type TeamPlan =
  | {
      ok: true;
      path: string;
      session: string;
      /** The piggy bank of the session: the most the team and its children can spend. */
      sessionUsd: number;
      spawnReserveUsd: number;
      maxMinutes: number;
      members: PlannedMember[];
    }
  | { ok: false; path?: string; reason: string };

/**
 * The team `/v1/team/start` would start, read from the launcher's own
 * configuration file and checked with the launcher's own schema. Each
 * member's cap and model resolve as `Launcher.startTeam` resolves them;
 * `tests/dashboard-start.test.ts` holds the two side by side.
 */
export function readTeamPlan(path: string | undefined): TeamPlan {
  if (!path) return { ok: false, reason: "JHT_LAUNCHER_CONFIG is not set here: the dashboard does not know what would start." };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, path, reason: `The launcher's configuration cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"}).` };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, path, reason: "The launcher's configuration is not JSON." };
  }
  const parsed = LauncherConfigSchema.safeParse(json);
  if (!parsed.success) return { ok: false, path, reason: "The launcher's configuration does not pass the launcher's own schema." };
  const config = parsed.data;
  if (!config.team || config.team.length === 0) return { ok: false, path, reason: "The launcher's configuration has no team to start." };
  return {
    ok: true,
    path,
    session: config.session,
    sessionUsd: config.sessionUsd,
    spawnReserveUsd: config.spawnReserveUsd,
    maxMinutes: config.maxMinutes,
    members: config.team.map((m) => ({
      role: m.role,
      instances: m.instances,
      capUsd: m.cap_usd ?? (m.role === "capitano" ? config.captainUsd : (config.roles[m.role]?.capUsd ?? 0)),
      model: m.model ?? config.models[0] ?? "",
      ...(m.delay_s === undefined ? {} : { delayS: m.delay_s }),
    })),
  };
}

/** What the hub said to a start, or why it said nothing. */
export type StartOutcome = { answered: true; status: number; body: unknown } | { answered: false; error: string };

export interface HubAccess {
  /** The hub on the loopback, as the roles reach it. */
  url: string;
  /** The host's own token for the team's start, read when the key is pressed and never kept. */
  token: () => string;
}

/**
 * Where the start page reaches the hub: `JHT_HUB_URL`, loopback only, and
 * the host's team token from `JHT_HUB_TEAM_TOKEN_FILE` (or, failing that,
 * `JHT_HUB_TEAM_TOKEN`). Anything missing or off the loopback is a reason,
 * shown, and the page does not start.
 */
export function hubAccess(env: NodeJS.ProcessEnv = process.env): HubAccess | { reason: string } {
  const url = env["JHT_HUB_URL"]?.trim();
  if (!url) return { reason: "JHT_HUB_URL is not set here: the dashboard does not know where the hub is." };
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/?$/.test(url)) {
    return { reason: `JHT_HUB_URL is '${url}'; the hub is reached on the loopback only.` };
  }
  const file = env["JHT_HUB_TEAM_TOKEN_FILE"]?.trim();
  const inline = env["JHT_HUB_TEAM_TOKEN"]?.trim();
  if (!file && !inline) return { reason: "Neither JHT_HUB_TEAM_TOKEN_FILE nor JHT_HUB_TEAM_TOKEN is set: only the host starts the team." };
  return {
    url: url.replace(/\/+$/, ""),
    token: () => {
      const token = file ? readFileSync(file, "utf8").trim() : inline!;
      if (!TOKEN.test(token)) throw new Error("the host's team token is not a token");
      return token;
    },
  };
}

/**
 * Asks the hub to start the base team: one POST to `/v1/team/start` with an
 * empty body, once. The answer comes back as it is, refusals included.
 */
export async function startTeam(hub: HubAccess, fetchImpl: typeof fetch = fetch): Promise<StartOutcome> {
  let token: string;
  try {
    token = hub.token();
  } catch (error) {
    return { answered: false, error: `The host's team token cannot be read: ${error instanceof Error ? error.message : String(error)}.` };
  }
  let response: Response;
  try {
    response = await fetchImpl(`${hub.url}${HUB_PATHS.teamStart}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch (error) {
    return { answered: false, error: `The hub did not answer: ${error instanceof Error ? error.message : String(error)}.` };
  }
  const text = await response.text();
  try {
    return { answered: true, status: response.status, body: JSON.parse(text) };
  } catch {
    return { answered: true, status: response.status, body: text };
  }
}

/** Written beside the traces, a file the monitor does not take for an agent. */
export function startsFile(logsDir: string): string {
  return `${logsDir}/dashboard-starts.jsonl`;
}

export type StartRecord =
  | { ts: string; type: "team_start_requested"; by: string; config: string; session: string; sessionUsd: number; members: PlannedMember[] }
  | { ts: string; type: "team_start_answered"; by: string; outcome: StartOutcome };

export function appendStart(file: string, record: StartRecord): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function readStarts(file: string): StartRecord[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as StartRecord];
      } catch {
        return [];
      }
    });
}

/** Who pressed the keys: the host's user running the dashboard. */
export function operator(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

/**
 * The whole start, as the key handler runs it: the request written down, the
 * one call, the answer written down. The record goes first, so a start whose
 * answer never comes is still attributed.
 */
export async function startAndRecord(plan: TeamPlan & { ok: true }, hub: HubAccess, file: string, by = operator(), fetchImpl: typeof fetch = fetch): Promise<StartOutcome> {
  appendStart(file, { ts: new Date().toISOString(), type: "team_start_requested", by, config: plan.path, session: plan.session, sessionUsd: plan.sessionUsd, members: plan.members });
  const outcome = await startTeam(hub, fetchImpl);
  appendStart(file, { ts: new Date().toISOString(), type: "team_start_answered", by, outcome });
  return outcome;
}

/** Where the page is: looking, asked to confirm, waiting for the hub, or with its answer. */
export type StartStep = { step: "idle" } | { step: "confirm" } | { step: "asking" } | { step: "answered"; outcome: StartOutcome };

/**
 * One key on the START page. `s` asks for a confirmation and only `y` given
 * to that confirmation starts: no single key ever starts, and any other key
 * drops the confirmation. `consumed` is false for a key the page does not
 * take, so the dashboard can still move between pages with it.
 */
export function onStartKey(step: StartStep, key: string, ready: boolean): { step: StartStep; start: boolean; consumed: boolean } {
  if (step.step === "asking") return { step, start: false, consumed: true };
  if (step.step === "confirm") {
    if (key === "y" && ready) return { step: { step: "asking" }, start: true, consumed: true };
    return { step: { step: "idle" }, start: false, consumed: !NAVIGATION.has(key) };
  }
  if (key === "s" && ready) return { step: { step: "confirm" }, start: false, consumed: true };
  return { step, start: false, consumed: false };
}

/** The keys that move between pages, which a dropped confirmation lets through. */
const NAVIGATION = new Set(["\x1b[C", "\x1b[D", "\t", "\x1b[Z", "h", "l", "1", "2", "3", "4"]);

/** The page, as lines. The frame clips them to the pane. */
export function startPageLines(plan: TeamPlan, hub: HubAccess | { reason: string }, step: StartStep, starts: StartRecord[], interactive: boolean): string[] {
  const lines: string[] = [];
  if (!plan.ok) {
    lines.push(` ${c.red("✗ nothing can start from here")}`, `   ${plan.reason}`);
    if (plan.path) lines.push(c.dim(`   ${plan.path}`));
  } else {
    lines.push(` ${c.bold("THE TEAM THE LAUNCHER WILL START")} ${c.dim(`· session ${plan.session} · ${plan.path}`)}`);
    const roleWidth = Math.max(...plan.members.map((m) => m.role.length)) + 2;
    for (const m of plan.members) {
      lines.push(`   ${m.role.padEnd(roleWidth)} ×${m.instances}   cap ${usd(m.capUsd)} each   ${m.model}${m.delayS ? c.dim(`   after ${m.delayS}s`) : ""}`);
    }
    lines.push(
      "",
      ` ${c.bold("AT MOST")} ${c.bold(usd(plan.sessionUsd))} ${c.dim(`— the piggy bank of session ${plan.session} (sessionUsd), for the team and every child the CAPITANO spawns; ${usd(plan.spawnReserveUsd)} of it kept for those spawns · runs stop after ${plan.maxMinutes} min`)}`,
    );
  }
  if ("reason" in hub) lines.push("", ` ${c.red("✗ the hub cannot be reached from here")}`, `   ${hub.reason}`);
  lines.push("");

  const ready = plan.ok && !("reason" in hub);
  if (!interactive) lines.push(c.dim(" a start is asked from an interactive terminal only"));
  else if (!ready) lines.push(c.dim(" nothing to start: fix what is above and open the page again"));
  else if (step.step === "idle") lines.push(` press ${c.bold("s")} to start this team ${c.dim("· you will be asked to confirm")}`);
  else if (step.step === "confirm" && plan.ok) {
    lines.push(
      ` ${c.yellow(`▶ Start the team of session ${plan.session}? It may spend up to ${usd(plan.sessionUsd)}.`)}`,
      ` ${c.bold("y")} to start · any other key cancels`,
    );
  } else if (step.step === "asking") lines.push(c.yellow(" asking the hub…"));
  else if (step.step === "answered") lines.push(...answerLines(step.outcome));

  const past = starts.filter((s) => s.type === "team_start_requested").slice(-5).reverse();
  if (past.length) {
    lines.push("", ` ${c.bold("STARTED FROM HERE")} ${c.dim("· newest first")}`);
    for (const s of past) if (s.type === "team_start_requested") lines.push(c.dim(`   ${new Date(s.ts).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" })}  ${s.by}  session ${s.session}  up to ${usd(s.sessionUsd)}`));
  }
  return lines;
}

/** The hub's answer, as it came: each member's booking or refusal, the note, the money left. */
function answerLines(outcome: StartOutcome): string[] {
  if (!outcome.answered) return [` ${c.red("✗")} ${outcome.error}`];
  const body = outcome.body as { ok?: unknown; reason?: unknown; started?: unknown; left_usd?: unknown; note?: unknown; error?: unknown } | string;
  if (typeof body !== "object" || body === null) return [` ${c.red(`✗ the hub answered ${outcome.status}:`)} ${String(body)}`];
  const lines = [
    body.ok === true
      ? ` ${c.green(`✓ the hub started the team (${outcome.status})`)}`
      : ` ${c.red(`✗ the hub did not start it (${outcome.status})${typeof body.reason === "string" ? `: ${body.reason}` : typeof body.error === "string" ? `: ${body.error}` : ""}`)}`,
  ];
  if (Array.isArray(body.started)) {
    for (const s of body.started as Array<{ ok?: unknown; agent?: unknown; booked_usd?: unknown; reason?: unknown }>) {
      lines.push(
        s.ok === true
          ? `   ${c.green("✓")} ${String(s.agent)}  booked ${typeof s.booked_usd === "number" ? usd(s.booked_usd) : "—"}`
          : `   ${c.red("✗")} ${typeof s.reason === "string" ? s.reason : "refused"}`,
      );
    }
  }
  if (typeof body.left_usd === "number") lines.push(`   left in the piggy bank: ${usd(body.left_usd)}`);
  if (typeof body.note === "string") lines.push(c.yellow(`   ${body.note}`));
  return lines;
}
