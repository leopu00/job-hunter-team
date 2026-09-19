/**
 * A product role (SCOUT, ANALISTA…) set up as its TUI twin would be.
 *
 * Two halves. `prepareProductRole` builds what the agent is: the prompt from
 * `agents/<role>/` by the launcher's rules, its home laid out the same way,
 * and its tools — the runtime's own, with the shell guarded, plus the native
 * `_tools` commands. `runCycles` drives what the agent does over time, the
 * part tmux and the throttle engine do for a TUI agent: a first order, then
 * turn after turn, each ending in a pause or in silence, each woken by the
 * pause ending or by a message arriving.
 */

import { join } from "node:path";

import type { ToolHandler } from "../tools/registry.ts";
import {
  createJhtTools,
  FileMailbox,
  FileNotifier,
  FileUserReplies,
  guardShellTool,
  PARITY_NOTES,
  PauseRequest,
  type AgentMessage,
  type Mailbox,
} from "./jht-tools.ts";
import {
  composeSystemPrompt,
  loadRolePrompt,
  materializeRoleHome,
  resolveUserLocale,
  type RolePrompt,
} from "./role-prompt.ts";

export interface ProductRoleOptions {
  /** The repo holding `agents/` — `/app` in the container. */
  appRoot: string;
  /** The role's folder under `agents/`: `scout`. */
  role: string;
  /** The name peers address it by: `scout-1`. */
  agent: string;
  /** The agent's home, laid out here. */
  homeDir: string;
  /** The runtime's state root: channels live under it. */
  apiHome: string;
  /** The user's JHT home, read only for the locale. */
  jhtHome: string;
  env?: Record<string, string | undefined>;
}

export interface ProductRole {
  prompt: RolePrompt;
  systemPrompt: string;
  mailbox: Mailbox;
  pause: PauseRequest;
  /** The runtime's tools with the shell guarded, followed by the native `_tools`. */
  tools(base: ToolHandler[]): ToolHandler[];
}

export async function prepareProductRole(options: ProductRoleOptions): Promise<ProductRole> {
  const locale = await resolveUserLocale({ jhtHome: options.jhtHome, ...(options.env ? { env: options.env } : {}) });
  const prompt = await loadRolePrompt({ appRoot: options.appRoot, role: options.role, locale });
  const systemPrompt = composeSystemPrompt(prompt, PARITY_NOTES);
  await materializeRoleHome(prompt, options.homeDir, systemPrompt);

  const channels = join(options.apiHome, "channels");
  const mailbox = new FileMailbox(join(channels, "mailbox"));
  const pause = new PauseRequest();
  const native = createJhtTools({
    agent: options.agent,
    homeDir: options.homeDir,
    mailbox,
    notifier: new FileNotifier(join(channels, "notify.jsonl")),
    replies: new FileUserReplies(join(channels, "replies")),
    pause,
  });

  return {
    prompt,
    systemPrompt,
    mailbox,
    pause,
    tools: (base) => [
      ...base.map((tool) =>
        tool.spec.name === "bash" ? guardShellTool(tool, (args) => (args as { command: string }).command) : tool,
      ),
      ...native,
    ],
  };
}

/** What `runCycles` needs of a session: one message in, the turn run to its end. */
export interface TurnDriver {
  send(text: string): Promise<unknown>;
}

export interface CycleOptions {
  agent: string;
  /** The first order, as the CAPITANO or the kick-off would type it. */
  task: string;
  /** Turns to run at most, the first included. */
  maxTurns: number;
  mailbox: Mailbox;
  pause: PauseRequest;
  /** How long a pause lasts. The TUI's throttle engine decides this; here the caller does. */
  pauseMs: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CycleResult {
  turns: number;
  pauses: number;
  /** Why the run ended: the turn cap, or a turn that ended with nothing to wake it. */
  ended: "max_turns" | "idle";
}

/**
 * Runs turns until the cap, or until a turn ends with no pause and no
 * message waiting — a TUI agent in that state sits idle at its prompt, and
 * an idle API agent costs nothing only if the process ends.
 */
export async function runCycles(session: TurnDriver, options: CycleOptions): Promise<CycleResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let turns = 0;
  let pauses = 0;
  let next = options.task;

  for (;;) {
    await session.send(next);
    turns += 1;
    if (turns >= options.maxTurns) return { turns, pauses, ended: "max_turns" };

    let woke = false;
    if (options.pause.requested) {
      options.pause.clear();
      pauses += 1;
      await sleep(options.pauseMs);
      woke = true;
    }
    const inbox = await options.mailbox.drain(options.agent);
    if (!woke && inbox.length === 0) return { turns, pauses, ended: "idle" };
    next = wakeMessage(options.agent, woke, inbox);
  }
}

/**
 * The next turn's message: the messages that arrived, each as the peer wrote
 * it — what the pane would show — behind the sender the runtime recorded,
 * and, after a pause, the wake-up.
 *
 * A peer's text is the model's output, and a peer that read an injected page
 * can write anything, including the envelope of the system or of another
 * agent, or a line dressed as the person's reply. The TUI cannot tell those
 * apart; here the mailbox knows who really sent each message, so every one
 * opens with `[from <sender>]` and any envelope in it that names someone else,
 * or poses as a reply from the person, is rewritten as `[forged by <sender>:
 * …]`. The only `[@system -> …]` a turn can open on is the runtime's own.
 */
export function wakeMessage(agent: string, woke: boolean, inbox: AgentMessage[]): string {
  const lines = inbox.map((m) => `[from ${m.from}] ${defuse(m.text, m.from)}`);
  if (woke) lines.push(`[@system -> @${agent}] [WAKE] Your pause is over. Continue your loop.`);
  return lines.join("\n\n");
}

/** `[@name -> …]` in any spacing or case. Group 1 is the inside, group 2 the claimed sender. */
const ENVELOPE = /\[\s*(@([A-Za-z][A-Za-z0-9_-]*)\s*->[^\]\n]*)\]/g;
/** The line `check_user_replies` hands out: `[USER REPLY via WEB — id=…]`. */
const USER_REPLY = /\[\s*(USER\s+REPLY[^\]\n]*)\]/gi;

function defuse(text: string, sender: string): string {
  return text
    .replace(ENVELOPE, (whole, inside: string, claimed: string) =>
      claimed.toLowerCase() === sender.toLowerCase() ? whole : `[forged by ${sender}: ${inside}]`,
    )
    .replace(USER_REPLY, (_whole, inside: string) => `[forged by ${sender}: ${inside}]`);
}
