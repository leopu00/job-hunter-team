import { invoke } from "@tauri-apps/api/core";
import { reconnectDirectChat } from "../lib/direct-chat";
import { errorCodeOf } from "../lib/error-catalog";

/**
 * Whether the provider's sign-in of the team still works, as the team itself says it (the native `provider_login_state`, which
 * asks the team's container; it is never «the credentials file exists»). The reply is closed again here: one of the states
 * below and one of the providers, nothing else; an answer off that shape is `provider_login_reply_unexpected`.
 *
 * `ready` it works as far as anything shows; `probably_expired` it is old enough to be worth signing in again, and the team
 * keeps working; `expired` an agent of the team was refused after the last sign-in; `missing` there is no sign-in; `unreadable`
 * there is a file and it is no sign-in; `not_applicable` the team uses no subscription sign-in.
 */
export type ProviderLoginState = "ready" | "probably_expired" | "expired" | "missing" | "unreadable" | "not_applicable";
export type LoginProvider = "claude" | "codex" | "kimi" | "none";
/**
 * `here`: the team runs on this computer, so its sign-in can be redone from the app (false for a team on a server). A failed read
 * says it too; it is missing only when the native side could not answer at all.
 */
export type ProviderLoginResult =
  | { ok: true; state: ProviderLoginState; provider: LoginProvider; here: boolean }
  | { ok: false; error: string; here?: boolean };

const STATES: readonly string[] = ["ready", "probably_expired", "expired", "missing", "unreadable", "not_applicable"];
const PROVIDERS: readonly string[] = ["claude", "codex", "kimi", "none"];
const UNREADABLE = "provider_login_unreadable";
const READ_FAILED = "read_failed";
const KNOWN_ERRORS: ReadonlySet<string> = new Set([UNREADABLE, "provider_login_reply_unexpected"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The reply of `provider_login_state` as the page uses it. */
export function pickProviderLoginState(reply: unknown): ProviderLoginResult {
  const unexpected: ProviderLoginResult = { ok: false, error: "provider_login_reply_unexpected" };
  if (!isRecord(reply)) return unexpected;
  if (reply.ok === false) {
    const said = errorCodeOf(reply.error);
    // the native side's own codes and the chat's (disconnected, process_timeout…) pass; the chat's «cannot read the messages»
    // and anything else is the sign-in's own «cannot be read»
    const error = said !== null && (KNOWN_ERRORS.has(said) || (!said.startsWith("provider_login_") && said !== READ_FAILED)) ? said : UNREADABLE;
    return typeof reply.here === "boolean" ? { ok: false, error, here: reply.here } : { ok: false, error };
  }
  const keys = Object.keys(reply);
  if (reply.ok !== true || keys.length !== 4 || !("state" in reply) || !("provider" in reply) || !("here" in reply)) return unexpected;
  const { state, provider, here } = reply;
  if (typeof state !== "string" || !STATES.includes(state) || typeof provider !== "string" || !PROVIDERS.includes(provider)) return unexpected;
  if (typeof here !== "boolean") return unexpected;
  return { ok: true, state: state as ProviderLoginState, provider: provider as LoginProvider, here };
}

type Call = (command: string) => Promise<unknown>;
const nativeCall: Call = (command) => invoke<unknown>(command);

async function readOnce(call: Call): Promise<ProviderLoginResult> {
  try {
    return pickProviderLoginState(await call("provider_login_state"));
  } catch (error) {
    const code = errorCodeOf(error);
    // the chat's «cannot read the messages» is not a sentence for the sign-in: its own «cannot be read» says it
    return { ok: false, error: code === null || code === "read_failed" ? "provider_login_unreadable" : code };
  }
}

/**
 * Reads the state. When the native side says the chat is not connected (the page was opened before the team was, or the team
 * was restarted under it), the chat is connected again once and the read repeated: the person is told the reason only if that
 * does not help.
 */
export async function readProviderLoginState(call: Call = nativeCall, reconnect: () => Promise<unknown> = reconnectDirectChat): Promise<ProviderLoginResult> {
  const first = await readOnce(call);
  if (first.ok || first.error !== "disconnected") return first;
  try {
    await reconnect();
  } catch {
    return first;
  }
  return readOnce(call);
}

/** The states in which the team has no working sign-in, whatever its credentials file says. */
export const WITHOUT_SIGN_IN: readonly ProviderLoginState[] = ["expired", "missing", "unreadable"];

/**
 * Whether the team refuses the sign-in it has: an agent refused after it, or no credentials in it. Only a word of the team says yes;
 * a read that cannot be made says no, and the caller goes on as the credentials file told it.
 */
export async function teamRefusesSignIn(read: () => Promise<ProviderLoginResult> = readProviderLoginState): Promise<boolean> {
  const said = await read();
  return said.ok && WITHOUT_SIGN_IN.includes(said.state);
}
