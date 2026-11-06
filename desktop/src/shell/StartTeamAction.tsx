import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { resumeOnboardingTeamStart, type OnboardingNativeProgress, type TeamResumeStep } from "../lib/onboarding-runtime";
import { RUNTIME_TEXT } from "../lib/onboarding-runtime.i18n";
import { START_TEAM_PROGRESS_TEXT } from "./start-team-progress.i18n";
import { TEAM_OFF_TEXT } from "./team-off.i18n";
import { PlayIcon } from "./icons";

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

/** Where a start is, from the events the native side gives: the first step it said (the machine only when it had to be turned on) and the one it is at. */
interface StartRun {
  startedAt: number;
  first: TeamResumeStep | null;
  step: TeamResumeStep | null;
  /** The native start is over and the page is looking for its data. */
  nativeDone: boolean;
}

/** The steps this start has, in order: the machine and the container only when the first thing said was turning them on. */
export function startSteps(first: TeamResumeStep | null): TeamResumeStep[] {
  return first === "machine" ? ["machine", "agents", "verify"] : ["agents", "verify"];
}

const stepName = (locale: Locale, step: TeamResumeStep) => RUNTIME_TEXT[locale][`ui_team_resume_step_${step}` as const];
const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** «Step 2 of 3 · Starting the agents · 0:45», the steps as dots, and nothing that is not an event: no percentage. */
function StartProgress({ run, now, locale }: { run: StartRun; now: number; locale: Locale }) {
  const text = START_TEAM_PROGRESS_TEXT[locale];
  const steps = startSteps(run.first);
  const at = run.step ? steps.indexOf(run.step) : -1;
  const label = run.nativeDone
    ? text.loading
    : run.step
      ? `${text.stepOf.replace("{n}", String(at + 1)).replace("{m}", String(steps.length))} · ${stepName(locale, run.step)}`
      : text.preparing;
  return (
    <span role="status" data-testid="start-team-progress" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--color-muted)]">
      <span data-testid="start-team-step">{label}</span>
      {run.step && !run.nativeDone && (
        <span aria-hidden className="flex items-center gap-1" data-testid="start-team-dots">
          {steps.map((step, i) => (
            <span
              key={step}
              data-state={i < at ? "done" : i === at ? "current" : "todo"}
              className="inline-block h-2 w-2 rounded-full border"
              style={{
                borderColor: i <= at ? "var(--color-green)" : "var(--color-border)",
                background: i < at ? "var(--color-green)" : "transparent",
                opacity: i === at ? 1 : i < at ? 0.9 : 0.6,
              }}
            />
          ))}
        </span>
      )}
      <span data-testid="start-team-elapsed" className="tabular-nums">{clock(now - run.startedAt)}</span>
    </span>
  );
}
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
  const [state, setState] = useState<
    { phase: "idle" } | { phase: "starting"; run: StartRun } | { phase: "failed"; code: string; first: TeamResumeStep | null; step: TeamResumeStep | null }
  >({ phase: "idle" });
  // the page counts the time itself (the events carry it too, but only every few seconds): a start of a minute must not look stuck
  const [now, setNow] = useState(() => Date.now());
  const starting = state.phase === "starting";
  useEffect(() => {
    if (!starting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [starting]);
  const progress = useRef<StartRun | null>(null);
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

  /** The events of the native start: the step it says it is at, and that it is done. */
  function heard(event: OnboardingNativeProgress) {
    const run = progress.current;
    if (!run || event.stage !== "team" || !alive.current) return;
    const next: StartRun = {
      ...run,
      first: run.first ?? event.step ?? null,
      step: event.step ?? run.step,
      nativeDone: run.nativeDone || event.status === "done",
    };
    progress.current = next;
    setState({ phase: "starting", run: next });
  }

  async function run() {
    const begun: StartRun = { startedAt: Date.now(), first: null, step: null, nativeDone: false };
    progress.current = begun;
    setState({ phase: "starting", run: begun });
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
      await resumeOnboardingTeamStart(heard);
    } catch (error) {
      running = false;
      const stopped = progress.current;
      if (alive.current) {
        setState({
          phase: "failed",
          code: (error as { code?: string })?.code ?? (typeof error === "string" ? error : "team_start_failed"),
          first: stopped?.first ?? null,
          step: stopped?.step ?? null,
        });
      }
      return;
    }
    if (progress.current && alive.current) {
      progress.current = { ...progress.current, nativeDone: true };
      setState({ phase: "starting", run: progress.current });
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
  // Where it stopped: the step and its place among the steps this start had, then the catalog's sentence and what to do.
  const stoppedAt = (() => {
    if (state.phase !== "failed") return "";
    const text = START_TEAM_PROGRESS_TEXT[locale];
    if (!state.step) return text.stoppedEarly;
    const steps = startSteps(state.first);
    return text.stoppedAt.replace("{n}", String(steps.indexOf(state.step) + 1)).replace("{m}", String(steps.length)).replace("{step}", stepName(locale, state.step));
  })();
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="start-team-action">
      {state.phase === "starting" && <StartProgress run={state.run} now={now} locale={locale} />}
      {failure && <span role="alert" data-testid="start-team-failed">{stoppedAt} {failure.text} {failure.action}</span>}
      {state.phase !== "starting" && <button
        type="button"
        data-testid="start-team"
        onClick={() => void start()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1 text-[12px] font-semibold text-[var(--color-bright)] hover:border-[var(--color-border-glow)] disabled:opacity-50"
      >
        <PlayIcon />
        {TEAM_OFF_TEXT[locale].start}
      </button>}
    </span>
  );
}
