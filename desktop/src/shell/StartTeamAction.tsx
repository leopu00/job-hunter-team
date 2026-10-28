import { useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { stateText } from "../lib/onboarding-state.i18n";
import { resumeOnboardingTeamStart } from "../lib/onboarding-runtime";
import { TEAM_OFF_TEXT } from "./team-off.i18n";

/** What the page says when it asked for its data again: true it has it, false it does not yet, nothing: not known. */
export type StartedReading = boolean | void | Promise<boolean | void>;

/** The waits before each new reading once the team is up, and between the readings while it starts (ms). */
export interface StartReadWaits {
  after: readonly number[];
  during: number;
  duringMax: number;
}
export const START_READ_WAITS: StartReadWaits = { after: [3_000, 5_000, 8_000], during: 8_000, duringMax: 6 };
/** The Agents page also waits for the flag «stopped by you» to fall, which a start does at its end: five tries. */
export const AGENTS_START_READ_WAITS: StartReadWaits = { ...START_READ_WAITS, after: [3_000, 5_000, 8_000, 10_000, 12_000] };

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * «Start the team» where a page says the team of this computer is stopped (the chat's bar, the Agents page):
 * the same start the setup's resume runs (it wakes the runtime first, and starts only the sessions that are
 * missing). The page reads again by itself: every few seconds while the team starts (a start can take a
 * minute) and, once it is up, up to three more times; `onStarted` says whether the page now has its data
 * (false: not yet). A refusal is told with the catalog's own sentence, never the raw code.
 */
export function StartTeamAction({
  onStarted,
  waits = START_READ_WAITS,
  onBusy,
}: {
  onStarted: () => StartedReading;
  waits?: StartReadWaits;
  /** Told when a start begins and when it is over (with its rereadings): a page whose own data can make this button go away keeps it while this is true. */
  onBusy?: (busy: boolean) => void;
}) {
  const locale = appLocale();
  const [state, setState] = useState<{ phase: "idle" | "starting" } | { phase: "failed"; code: string }>({ phase: "idle" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const latest = useRef(onStarted);
  latest.current = onStarted;

  async function start() {
    onBusy?.(true);
    try {
      await run();
    } finally {
      onBusy?.(false);
    }
  }

  async function run() {
    setState({ phase: "starting" });
    let running = true;
    // while the start runs, the page looks again now and then: it may answer before the start has finished
    const watching = (async () => {
      for (let tries = 0; running && alive.current && tries < waits.duringMax; tries++) {
        await sleep(waits.during);
        if (!running || !alive.current) return;
        if ((await latest.current()) !== false) return;
      }
    })();
    try {
      await resumeOnboardingTeamStart(() => undefined);
    } catch (error) {
      running = false;
      if (alive.current) setState({ phase: "failed", code: (error as { code?: string })?.code ?? (typeof error === "string" ? error : "team_start_failed") });
      return;
    }
    running = false;
    void watching;
    let had = await latest.current();
    for (const wait of waits.after) {
      if (had !== false || !alive.current) break;
      await sleep(wait);
      if (!alive.current) break;
      had = await latest.current();
    }
    if (alive.current) setState({ phase: "idle" });
  }
  const failure = state.phase === "failed" ? describeError(state.code, { locale, fallback: "team_start_failed" }) : null;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="start-team-action">
      {state.phase === "starting" && <span className="text-[var(--color-muted)]">{stateText().startingContainerAndAgents}</span>}
      {failure && <span role="alert" data-testid="start-team-failed">{failure.text} {failure.action}</span>}
      <button
        type="button"
        data-testid="start-team"
        disabled={state.phase === "starting"}
        onClick={() => void start()}
        className="shrink-0 rounded border border-[var(--color-border)] px-3 py-1 text-[12px] font-semibold text-[var(--color-bright)] hover:border-[var(--color-border-glow)] disabled:opacity-50"
      >
        {TEAM_OFF_TEXT[locale].start}
      </button>
    </span>
  );
}
