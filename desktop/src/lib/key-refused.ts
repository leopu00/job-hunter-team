import { useEffect, useState } from "react";
import { describeError, type DescribedError } from "./error-catalog";
import { readHarnessChoice, type HarnessChoice, type HarnessOutcome } from "./harness-choice";
import type { AgentStateInfo } from "@/lib/agent-state";

/**
 * Why an agent is blocked when the provider refused its access, said for a team on an API key (glm or kimi on Pi) the way
 * `jht agents` and the chat of the CLI say it: the key was refused, and the command that puts it right. The state catalog's
 * own sentence for this reason («login expired: sign in again») is for a login; for a team with a key it sends the person to
 * a sign-in that does not exist.
 *
 * The state says only «access refused»; whether the team works with a key comes from the CLI's own read of the team
 * (`jht providers harness --json`, harness_choice.rs): Pi, and a login that is «not needed» because the provider is used with a key.
 */
const KEY_REFUSED_CODE: Record<string, string> = {
  glm: "agent_key_refused_glm",
  kimi: "agent_key_refused_kimi",
  // Moonshot's own name for kimi
  moonshot: "agent_key_refused_kimi",
};

/** The reason the state catalog words as a login that expired. */
export function isAccessRefused(state: AgentStateInfo | null | undefined): boolean {
  return state?.state === "bloccato" && state.reason === "accesso_scaduto";
}

/** The catalog code for a team on an API key, or null when the team works with a login (or the read says nothing). */
export function keyRefusedCode(choice: HarnessChoice | null): string | null {
  if (!choice || choice.harness !== "pi" || choice.login !== "not_needed") return null;
  return KEY_REFUSED_CODE[choice.provider] ?? null;
}

/** The team's provider does not change by itself while a screen is open: one read per half minute is enough for every line. */
const FRESH_MS = 30_000;
let last: { at: number; outcome: HarnessOutcome } | null = null;

/** For the tests: forget the last read. */
export function forgetKeyRefusedRead(): void {
  last = null;
}

async function currentChoice(read: () => Promise<HarnessOutcome>, now: number): Promise<HarnessChoice | null> {
  if (last && now - last.at < FRESH_MS) return last.outcome.ok ? last.outcome.value : null;
  const outcome = await read().catch((): HarnessOutcome => ({ ok: false, code: "harness_unavailable" }));
  last = { at: now, outcome };
  return outcome.ok ? outcome.value : null;
}

/**
 * The sentence and the command for a blocked agent whose access was refused on a team with an API key; null for any other state,
 * for a team with a login, and until the read is back. The read is made only when the state is that block.
 */
export function useKeyRefusedNotice(
  state: AgentStateInfo | null | undefined,
  locale: string,
  read: () => Promise<HarnessOutcome> = readHarnessChoice,
): DescribedError | null {
  const refused = isAccessRefused(state);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (!refused) {
      setCode(null);
      return;
    }
    let live = true;
    void currentChoice(read, Date.now()).then((choice) => {
      if (live) setCode(keyRefusedCode(choice));
    });
    return () => {
      live = false;
    };
  }, [refused, read]);
  return refused && code ? describeError(code, { locale }) : null;
}
