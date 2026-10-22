// The pure part of TeamControl: what the buttons ask, what the door answers, how an answer is read.
// No React here, so a test can run it as it is.

export const ACTIONS = ["start", "stop", "restart"] as const;
export type TeamAction = (typeof ACTIONS)[number];

/** "all" first; then the agents the door knows (the same closed list as request_action). */
export const TARGETS = [
  "all",
  "capitano",
  "sentinella",
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "critico",
  "assistente",
] as const;
export type TeamTarget = (typeof TARGETS)[number];

/** The names of the agents are the product's: they are not translated. */
export const AGENT_NAMES: Record<Exclude<TeamTarget, "all">, string> = {
  capitano: "Capitano",
  sentinella: "Sentinella",
  scout: "Scout",
  analista: "Analista",
  scorer: "Scorer",
  scrittore: "Scrittore",
  critico: "Critico",
  assistente: "Assistente",
};

export function isTarget(value: string): value is TeamTarget {
  return (TARGETS as readonly string[]).includes(value);
}

/** The first call: the action is in the URL (fixed by the route), the target in the params. */
export function firstCall(action: TeamAction, target: TeamTarget) {
  return {
    url: `/api/team/command/${action}`,
    body: { params: { target } },
  };
}

/** The second call carries the id of the line the database wrote, nothing else. */
export function confirmCall(action: TeamAction, confirmId: string) {
  return { url: `/api/team/command/${action}`, body: { confirmId } };
}

export function commandUrl(commandId: string) {
  return `/api/team/command/${encodeURIComponent(commandId)}`;
}

export type DoorAnswer =
  | {
      kind: "confirm";
      id: string;
      summary: string;
      expiresAt: string | null;
    }
  | { kind: "queued"; commandId: string | null }
  | { kind: "refused"; code: string };

/** Reads what the door answered. Anything that is not the contract is a generic refusal. */
export function readDoorAnswer(status: number, body: unknown): DoorAnswer {
  const b = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  if (status === 200 && b.ok === true) {
    if (b.state === "awaiting_confirm" && typeof b.id === "string") {
      return {
        kind: "confirm",
        id: b.id,
        summary: typeof b.summary === "string" ? b.summary : "",
        expiresAt: typeof b.expiresAt === "string" ? b.expiresAt : null,
      };
    }
    if (b.state === "queued" || b.state === "done") {
      return {
        kind: "queued",
        commandId: typeof b.commandId === "string" ? b.commandId : null,
      };
    }
  }
  const code = typeof b.error === "string" ? b.error : "";
  return { kind: "refused", code };
}

export type CommandStatus = "pending" | "running" | "done" | "error";

export function readCommandStatus(
  status: number,
  body: unknown,
): CommandStatus | null {
  if (status !== 200 || !body || typeof body !== "object") return null;
  const s = (body as Record<string, unknown>).status;
  return s === "pending" || s === "running" || s === "done" || s === "error"
    ? s
    : null;
}

export const isTerminal = (s: CommandStatus) => s === "done" || s === "error";

/** The message key of a refusal; the codes of the contract, anything else is generic. */
export function errorKey(code: string): string {
  switch (code) {
    case "reauth_required":
    case "rate_limited":
    case "confirm_expired":
    case "unauthenticated":
      return `err_${code}`;
    default:
      return "err_generic";
  }
}

/** "Start {target}?" with the name of the target in it. */
export function fill(template: string, target: string): string {
  return template.replace("{target}", target);
}

export const POLL_MS = 1500;
export const POLL_MAX = 120; // three minutes: then the device is called silent
