import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { appLocale } from "../lib/app-locale";
import {
  EXIT_OPEN_EVENT,
  exitAcknowledge,
  exitCancel,
  exitErrorCode,
  exitFinish,
  exitOrder,
  exitPoll,
  exitState,
  onExitRequested,
  rememberExit,
  rememberedExit,
  type ExitMode,
} from "../lib/app-exit";
import { fill } from "../lib/text-slots";
import { APP_EXIT_TEXT } from "./AppExitDialog.i18n";

/** How often the ordered stop is looked at, and how long the agents get before the person is offered the forced one. */
const POLL_MS = 2000;
const SLOW_MS = 120_000;

type Phase =
  | { kind: "closed" }
  | { kind: "choose"; remember: boolean }
  | { kind: "waiting"; active: number; slow: boolean }
  | { kind: "stopping" }
  | { kind: "failed"; code?: string };

/** Asks how to leave: the window's close button and ⌘Q come here first (native side), and so does the navbar button. */
export default function AppExitDialog({ pollMs = POLL_MS, slowMs = SLOW_MS }: { pollMs?: number; slowMs?: number }) {
  const [phase, setPhase] = useState<Phase>({ kind: "closed" });
  const [remembered, setRemembered] = useState<ExitMode | null>(null);
  // containers that are not the team's on its machine: stopping leaves the machine on for them, and the dialog says it
  const [others, setOthers] = useState(0);
  // a new request, or a cancel, ends the wait that was running
  const runRef = useRef(0);
  const firstRef = useRef<HTMLButtonElement>(null);
  // the phase the requests below see: a request while the agents are being waited for, or the stop is on, changes nothing
  const busyRef = useRef(false);

  // `quiet`: nothing was asked, so nothing is shown while the window closes (no team here, or the remembered choice)
  const leave = useCallback(async (mode: ExitMode, run: number, quiet = false) => {
    if (!quiet) setPhase({ kind: "stopping" });
    try {
      await exitFinish(mode);
    } catch (error) {
      if (runRef.current === run) setPhase({ kind: "failed", code: exitErrorCode(error) });
    }
  }, []);

  const stopInOrder = useCallback(async (run: number) => {
    setPhase({ kind: "waiting", active: 0, slow: false });
    try {
      await exitOrder();
    } catch {
      if (runRef.current === run) setPhase({ kind: "failed" });
      return;
    }
    const started = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if (runRef.current !== run) return;
      try {
        const progress = await exitPoll();
        if (runRef.current !== run) return;
        // only the Capitano's flag says the agents are done: a session list that could not be read looks like «none open»
        if (progress.ready) return void (await leave("ordered", run));
        setPhase({ kind: "waiting", active: progress.active, slow: Date.now() - started >= slowMs });
      } catch {
        if (runRef.current === run) setPhase({ kind: "failed" });
        return;
      }
    }
  }, [leave, pollMs, slowMs]);

  const run = useCallback((mode: ExitMode, remember: boolean, quiet = false) => {
    rememberExit(remember ? mode : null);
    setRemembered(remember ? mode : null);
    const id = ++runRef.current;
    if (mode === "ordered") void stopInOrder(id);
    else void leave(mode, id, quiet);
  }, [leave, stopInOrder]);

  const request = useCallback(async (fromWindow: boolean) => {
    await exitAcknowledge().catch(() => {});
    if (busyRef.current) return;
    const id = ++runRef.current;
    const state = await exitState();
    if (runRef.current !== id) return;
    // nothing of the team here to decide about (none, on a VPS, or not told): the window closes
    if (state?.team !== "local") return void (await leave("detach", id, true));
    setOthers(state.otherContainers);
    const choice = rememberedExit();
    setRemembered(choice);
    // the close button applies what the person asked to remember; the navbar button always asks
    if (fromWindow && choice) return run(choice, true, true);
    setPhase({ kind: "choose", remember: choice !== null });
  }, [leave, run]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void onExitRequested(() => void request(true)).then((stop) => {
      if (alive) unlisten = stop;
      else stop();
    });
    const fromButton = () => void request(false);
    window.addEventListener(EXIT_OPEN_EVENT, fromButton);
    return () => {
      alive = false;
      unlisten?.();
      window.removeEventListener(EXIT_OPEN_EVENT, fromButton);
    };
  }, [request]);

  // a wait that is still running when the dialog goes away must not go on asking the team
  useEffect(() => () => { runRef.current += 1; }, []);

  const stay = () => {
    runRef.current += 1;
    setPhase({ kind: "closed" });
    void exitCancel().catch(() => {});
  };

  useEffect(() => {
    if (phase.kind === "choose") firstRef.current?.focus();
  }, [phase.kind]);

  busyRef.current = phase.kind === "waiting" || phase.kind === "stopping";
  if (phase.kind === "closed") return null;
  const t = APP_EXIT_TEXT[appLocale()];
  const busy = phase.kind === "stopping";

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !busy) stay();
  };

  const choices: { mode: ExitMode; label: string; hint: string }[] = [
    { mode: "ordered", label: t.ordered, hint: t.orderedHint },
    { mode: "forced", label: t.forced, hint: t.forcedHint },
    { mode: "detach", label: t.detach, hint: t.detachHint },
  ];
  const remember = phase.kind === "choose" ? phase.remember : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" data-testid="app-exit-dialog">
      <div
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-exit-title"
        aria-describedby="app-exit-body"
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5 flex flex-col gap-3"
      >
        <h2 id="app-exit-title" className="text-[14px] font-semibold text-[var(--color-bright)]">{t.title}</h2>
        <p id="app-exit-body" className="text-[12px] text-[var(--color-muted)]">{t.body}</p>
        {(phase.kind === "choose" || phase.kind === "failed") && (
          <>
            {phase.kind === "failed" && (
              <p role="alert" data-testid="app-exit-failed" className="text-[11px] text-[var(--color-red)]">{phase.code === "app_exit_machine_state_unknown" ? t.machineUnknown : t.failed}</p>
            )}
            {others > 0 && (
              <p data-testid="app-exit-others" className="text-[11px] text-[var(--color-muted)]">{fill(t.othersKept, { count: others })}</p>
            )}
            <div className="flex flex-col gap-2">
              {choices.map((choice, index) => (
                <button
                  key={choice.mode}
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  data-testid={`app-exit-${choice.mode}`}
                  onClick={() => run(choice.mode, remember)}
                  className="text-left rounded border border-[var(--color-border)] px-3 py-2 hover:bg-[var(--color-panel)]"
                >
                  <span className="block text-[12px] font-semibold text-[var(--color-bright)]">{choice.label}</span>
                  <span className="block text-[11px] text-[var(--color-muted)]">{choice.hint}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <input
                type="checkbox"
                data-testid="app-exit-remember"
                checked={remember}
                onChange={(event) => setPhase({ kind: "choose", remember: event.target.checked })}
                disabled={phase.kind !== "choose"}
              />
              {t.remember}
            </label>
          </>
        )}
        {phase.kind === "waiting" && (
          <div role="status" data-testid="app-exit-waiting" className="flex flex-col gap-2 text-[12px] text-[var(--color-bright)]">
            <p>{fill(t.waiting, { count: phase.active })}</p>
            {phase.slow && (
              <>
                <p className="text-[11px] text-[var(--color-muted)]">{t.slow}</p>
                <button
                  type="button"
                  data-testid="app-exit-force-now"
                  onClick={() => run("forced", remembered === "forced")}
                  className="self-start text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-bright)]"
                >
                  {t.forceNow}
                </button>
              </>
            )}
          </div>
        )}
        {busy && <p role="status" data-testid="app-exit-stopping" className="text-[12px] text-[var(--color-bright)]">{t.stopping}</p>}
        {!busy && (
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="app-exit-stay"
              onClick={stay}
              className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
            >
              {t.stay}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
