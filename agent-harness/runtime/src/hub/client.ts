/**
 * The role's side of `jht-hub`: the database tools and the channels as thin
 * clients. Each tool keeps the spec the model sees and its classification;
 * only its execution moves to the hub, which runs the same code with the
 * agent its token names.
 */

import { HarnessError } from "../core/errors.ts";
import type { AgentMessage, Mailbox, Notifier, UserNotification, UserReplies, UserReply } from "../parity/jht-tools.ts";
import type { ToolHandler } from "../tools/registry.ts";
import { HUB_PATHS, type ToolResponse } from "./protocol.ts";

/** Longest a hub call may take: a logo fetch runs its own network requests. */
const HUB_TIMEOUT_MS = 120_000;

export interface HubSettings {
  /** `http://127.0.0.1:<port>`: the pod's loopback. */
  url: string;
  token: string;
}

export class HubClient {
  readonly #url: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(settings: HubSettings, fetchImpl: typeof fetch = fetch) {
    this.#url = settings.url.replace(/\/+$/, "");
    this.#token = settings.token;
    this.#fetch = fetchImpl;
  }

  async post<T>(path: string, body: unknown, timeoutMs = HUB_TIMEOUT_MS): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#url}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.#token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (cause) {
      throw new HarnessError("hub_unreachable", "The hub did not answer.", { cause });
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HarnessError("hub_failed", `The hub answered ${response.status} with no JSON.`);
    }
    if (!response.ok) {
      const message = (parsed as { error?: unknown }).error;
      throw new HarnessError("hub_failed", `The hub refused (${response.status}): ${typeof message === "string" ? message : "no reason"}`);
    }
    return parsed as T;
  }
}

/** `tool`, with its execution on the hub. */
export function remoteTool(tool: ToolHandler, hub: HubClient): ToolHandler {
  return {
    spec: tool.spec,
    classify: (args) => tool.classify(args),
    async execute(args, context) {
      try {
        const result = await hub.post<ToolResponse>(HUB_PATHS.tool, { name: tool.spec.name, args }, Math.min(HUB_TIMEOUT_MS, context.remainingMs()));
        return { ok: result.ok, content: result.content, ...(result.details ? { details: result.details } : {}) };
      } catch (error) {
        // For the model a refusal is information, as a failed script is.
        return { ok: false, content: `Error: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}

export class HubMailbox implements Mailbox {
  readonly #hub: HubClient;
  constructor(hub: HubClient) {
    this.#hub = hub;
  }
  /** `from` and `ts` are the hub's to set. */
  async send(message: AgentMessage): Promise<void> {
    await this.#hub.post(HUB_PATHS.send, { to: message.to, text: message.text });
  }
  /** The caller's inbox; which one is the hub's to know. */
  async drain(_agent: string): Promise<AgentMessage[]> {
    return (await this.#hub.post<{ messages: AgentMessage[] }>(HUB_PATHS.drain, {})).messages;
  }
}

export class HubNotifier implements Notifier {
  readonly #hub: HubClient;
  constructor(hub: HubClient) {
    this.#hub = hub;
  }
  async notify(n: UserNotification): Promise<void> {
    await this.#hub.post(HUB_PATHS.notify, { kind: n.kind, text: n.text, ...(n.positionId === undefined ? {} : { positionId: n.positionId }) });
  }
}

export class HubUserReplies implements UserReplies {
  readonly #hub: HubClient;
  constructor(hub: HubClient) {
    this.#hub = hub;
  }
  async take(_agent: string): Promise<UserReply[]> {
    return (await this.#hub.post<{ replies: UserReply[] }>(HUB_PATHS.replies, {})).replies;
  }
}
