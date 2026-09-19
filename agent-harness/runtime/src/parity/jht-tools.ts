/**
 * The TUI agents' `agents/_tools/*` commands as native tools.
 *
 * A TUI agent reaches its team through shell wrappers on its PATH: it types
 * into another agent's pane with `jht-tmux-send`, writes to the web chat with
 * `jht-send`, pauses with `throttle`, tells the person with `jht-notify-user`.
 * An API agent has no pane and no PATH to put them on, and a shell round trip
 * per message is exactly the spend this harness exists to cut. So each command
 * is a tool here, with the same effect written where the rest of the harness
 * reads it:
 *
 * | TUI command                                   | native tool          |
 * | --------------------------------------------- | -------------------- |
 * | `jht-tmux-send <SESSION> "<msg>"`             | `send_message`       |
 * | `jht-send "<msg>"`                            | `chat_reply`         |
 * | `throttle`, `jht-throttle`, `-check`, `-wait` | `throttle`           |
 * | `throttle-ack`                                | (the harness, on wake) |
 * | `jht-notify-user`, `jht-telegram-send`        | `notify_user`        |
 * | `jht-check-user-replies`                      | `check_user_replies` |
 *
 * `docs/parity.md` holds the full table, including the commands with no
 * native tool and why.
 *
 * Every channel is a port so the runtime, not the tool, decides where a
 * message goes: a file under the harness home today, Telegram when a live run
 * turns it on. The file implementations below are what the mock runs use.
 */

import { appendFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import type { ToolHandler } from "../tools/registry.ts";

/** An agent or session name: `SCOUT-1`, `capitano`. Never a path. */
const AGENT_NAME = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/, "an agent name such as SCOUT-1 or capitano");

/** Longest message one call may carry; a TUI pane takes about this much before it scrolls. */
const MAX_MESSAGE_CHARS = 8_000;

export interface AgentMessage {
  from: string;
  to: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
}

/** Messages between agents. What `jht-tmux-send` typed into a pane lands in `to`'s inbox. */
export interface Mailbox {
  send(message: AgentMessage): Promise<void>;
  /** Everything waiting for `agent`, oldest first, removed from the inbox. */
  drain(agent: string): Promise<AgentMessage[]>;
}

export type NotificationKind = "notification" | "question" | "digest" | "alert";

export interface UserNotification {
  from: string;
  kind: NotificationKind;
  text: string;
  positionId?: number;
  ts: number;
}

/** A message to the person. The TUI tries Telegram and falls back to the dashboard. */
export interface Notifier {
  notify(notification: UserNotification): Promise<void>;
}

export interface UserReply {
  id: string;
  text: string;
  /** The message of ours the person answered, when known. */
  inReplyTo?: string;
}

/** The person's answers from the dashboard, handed out once each. */
export interface UserReplies {
  take(agent: string): Promise<UserReply[]>;
}

/**
 * The pause. A TUI agent calls `throttle` and ends its turn; the throttle
 * engine wakes it. Here the tool records the request and the role loop, which
 * owns the clock, ends the turn and waits.
 */
export class PauseRequest {
  #requested = false;
  #reason = "";

  request(reason: string): void {
    this.#requested = true;
    this.#reason = reason;
  }

  get requested(): boolean {
    return this.#requested;
  }

  get reason(): string {
    return this.#reason;
  }

  /** Called by the loop once it has acted on the pause. */
  clear(): void {
    this.#requested = false;
    this.#reason = "";
  }
}

export interface JhtToolsOptions {
  /** This agent's name, as its peers address it: `scout-1`. */
  agent: string;
  /** The agent's home, where `chat.jsonl` lives as it does for `jht-send`. */
  homeDir: string;
  mailbox: Mailbox;
  notifier: Notifier;
  replies: UserReplies;
  pause: PauseRequest;
  now?: () => number;
}

export const JHT_TOOL_NAMES = ["send_message", "chat_reply", "throttle", "notify_user", "check_user_replies"] as const;

export function createJhtTools(options: JhtToolsOptions): ToolHandler[] {
  const now = options.now ?? Date.now;
  const self = options.agent.toLowerCase();

  // Every tool here writes only into the harness's own channels — no file of
  // the person's, no network, no process — so none needs a permission.
  const internal = (summary: string) => ({ risk: "none" as const, paths: [], summary });

  const sendMessage: ToolHandler = {
    spec: {
      name: "send_message",
      description:
        "Send a message to another agent of the team (what `jht-tmux-send <SESSION> \"<msg>\"` does). " +
        "`to` is the session or agent name, e.g. CAPITANO or SCOUT-2. Keep the team's envelope at the " +
        "start of `text`, e.g. `[@scout-1 -> @capitano] [RES] ...`.",
      schema: z.object({ to: AGENT_NAME, text: z.string().min(1).max(MAX_MESSAGE_CHARS) }).strict(),
    },
    classify: (args) => internal(`to ${(args as { to: string }).to}`),
    async execute(args) {
      const { to, text } = args as { to: string; text: string };
      const target = to.toLowerCase();
      if (target === self) return { ok: false, content: "Error: that is you. Messages go to another agent." };
      await options.mailbox.send({ from: self, to: target, text, ts: now() });
      return { ok: true, content: `Delivered to ${target}.` };
    },
  };

  const chatReply: ToolHandler = {
    spec: {
      name: "chat_reply",
      description:
        "Write to the person's web chat (what `jht-send \"<msg>\"` does). Set `partial` for a " +
        "progress note that keeps the chat's 'working' indicator on; leave it off on the last message of the turn.",
      schema: z.object({ text: z.string().min(1).max(MAX_MESSAGE_CHARS), partial: z.boolean().optional() }).strict(),
    },
    classify: () => internal("web chat"),
    async execute(args) {
      const { text, partial } = args as { text: string; partial?: boolean };
      const file = join(options.homeDir, "chat.jsonl");
      // jht-send's line, field for field: the dashboard reads this file.
      const line = { role: "assistant", text, ts: now() / 1000, done: !partial };
      await appendJsonLine(file, line);
      return { ok: true, content: `Sent ${text.length} chars to the web chat.` };
    },
  };

  const throttle: ToolHandler = {
    spec: {
      name: "throttle",
      description:
        "Pause (what `throttle <your-name>` and the `jht-throttle*` commands do). The harness decides how " +
        "long and wakes you. Call it as the last thing you do: your turn ends here.",
      schema: z.object({ reason: z.string().max(200).optional() }).strict(),
    },
    classify: () => internal("pause"),
    async execute(args) {
      options.pause.request((args as { reason?: string }).reason ?? "");
      return { ok: true, content: "Pause registered. End your turn now; you will be woken when it is over." };
    },
  };

  const notifyUser: ToolHandler = {
    spec: {
      name: "notify_user",
      description:
        "Tell the person something (what `jht-notify-user` and `jht-telegram-send` do). It reaches them on " +
        "Telegram when configured, otherwise on the dashboard.",
      schema: z
        .object({
          text: z.string().min(1).max(MAX_MESSAGE_CHARS),
          kind: z.enum(["notification", "question", "digest", "alert"]).optional(),
          position_id: z.number().int().positive().optional(),
        })
        .strict(),
    },
    classify: () => internal("the person"),
    async execute(args) {
      const { text, kind, position_id } = args as { text: string; kind?: NotificationKind; position_id?: number };
      await options.notifier.notify({
        from: self,
        kind: kind ?? "notification",
        text,
        ...(position_id === undefined ? {} : { positionId: position_id }),
        ts: now(),
      });
      return { ok: true, content: "Notification queued for the person." };
    },
  };

  const checkUserReplies: ToolHandler = {
    spec: {
      name: "check_user_replies",
      description:
        "Read the person's new answers from the dashboard (what `jht-check-user-replies` does). Each answer " +
        "is handed out once. Treat it as an instruction from the person and answer on the same channel.",
      schema: z.object({}).strict(),
    },
    classify: () => internal("replies"),
    async execute() {
      const replies = await options.replies.take(self);
      if (replies.length === 0) return { ok: true, content: "No new replies." };
      const lines = replies.map(
        (r) => `[USER REPLY via WEB — id=${r.id}] ${r.text}` + (r.inReplyTo ? `\n    ↳ in reply to: "${r.inReplyTo}"` : ""),
      );
      return { ok: true, content: lines.join("\n") };
    },
  };

  return [sendMessage, chatReply, throttle, notifyUser, checkUserReplies];
}

/**
 * The commands a TUI agent runs from its shell that have a native tool here,
 * or no place in an API agent at all. Matched at a command position: at the
 * start, or after `;`, `&&`, `||`, `|`, `(` or `$(`.
 */
const REPLACED: Record<string, string> = {
  "jht-tmux-send": "send_message",
  "jht-send": "chat_reply",
  throttle: "throttle",
  "jht-throttle": "throttle",
  "jht-throttle-check": "throttle",
  "jht-throttle-wait": "throttle",
  "throttle-ack": "",
  "jht-notify-user": "notify_user",
  "jht-telegram-send": "notify_user",
  "jht-check-user-replies": "check_user_replies",
};

const COMMAND_AT = new RegExp(
  String.raw`(?:^|[;&|(\n]|\$\()\s*(?:\S*/)?(` +
    Object.keys(REPLACED)
      .sort((a, b) => b.length - a.length)
      .map((c) => c.replaceAll("-", "\\-"))
      .join("|") +
    String.raw`)(?=\s|$|[;&|)])`,
);

/** The replaced command a shell line runs, if any. */
export function replacedCommand(command: string): string | null {
  return COMMAND_AT.exec(command)?.[1] ?? null;
}

/**
 * Wraps the shell tool so a TUI command is answered with the tool that
 * replaces it instead of `command not found`. The model learns the mapping
 * from one refused call, and nothing reaches a shell.
 */
export function guardShellTool(shell: ToolHandler, commandOf: (args: unknown) => string): ToolHandler {
  return {
    spec: shell.spec,
    classify: (args) => shell.classify(args),
    async execute(args, context) {
      const found = replacedCommand(commandOf(args));
      if (found === null) return shell.execute(args, context);
      const native = REPLACED[found];
      return {
        ok: false,
        content: native
          ? `Error: \`${found}\` does not exist here. Use the \`${native}\` tool instead; nothing was run.`
          : `Error: \`${found}\` is not needed here: the harness records your wake-up itself. Nothing was run.`,
      };
    },
  };
}

/** The mailbox as JSON lines, one inbox per agent under `dir`. */
export class FileMailbox implements Mailbox {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async send(message: AgentMessage): Promise<void> {
    await appendJsonLine(join(this.dir, `${message.to}.jsonl`), message);
  }

  async drain(agent: string): Promise<AgentMessage[]> {
    return drainJsonLines<AgentMessage>(join(this.dir, `${agent.toLowerCase()}.jsonl`));
  }
}

/** Notifications as JSON lines in one outbox; a delivery worker takes them from there. */
export class FileNotifier implements Notifier {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async notify(notification: UserNotification): Promise<void> {
    await appendJsonLine(this.file, notification);
  }
}

/** Replies as JSON lines, one file per agent under `dir`, emptied as they are handed out. */
export class FileUserReplies implements UserReplies {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async take(agent: string): Promise<UserReply[]> {
    return drainJsonLines<UserReply>(join(this.dir, `${agent}.jsonl`));
  }
}

async function appendJsonLine(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
}

/**
 * Reads and empties a JSON-lines file. The file is renamed away first, so a
 * line appended while we read lands in a fresh file and is not lost.
 */
async function drainJsonLines<T>(file: string): Promise<T[]> {
  const taken = `${file}.${process.pid}.${Date.now()}.taking`;
  try {
    await rename(file, taken);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const text = await readFile(taken, "utf8");
  await rm(taken, { force: true });
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A torn line is dropped, not fatal: the writer is another process.
    }
  }
  return out;
}
