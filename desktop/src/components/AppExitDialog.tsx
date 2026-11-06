import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
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
  type ExitMachine,
  type ExitMode,
} from "../lib/app-exit";
import { setupExit, type SetupExit } from "../lib/setup-exit";
import { fill } from "../lib/text-slots";
import { APP_EXIT_TEXT } from "./AppExitDialog.i18n";

/** How often the ordered stop is looked at, and how long the agents get before the person is offered the forced one. */
const POLL_MS = 2000;
const SLOW_MS = 120_000;

type Phase =
  | { kind: "closed" }
  | { kind: "choose"; remember: boolean }
  | { kind: "waiting"; active: number; slow: boolean; remaining: string[] }
  | { kind: "stopping" }
  | { kind: "failed"; code?: string }
  /** During the setup, before the team's start: what is left on, and the failure of turning the machine off, if any. */
  | { kind: "setup"; code?: string };

/** What the setup dialog says: where the setup is, and the machine as the native side found it. */
interface SetupView {
  info: SetupExit;
  machine: Exclude<ExitMachine, "none">;
  teamContainers: number;
}

/** Asks how to leave: the window's close button and ⌘Q come here first (native side), and so does the navbar button. */
export default function AppExitDialog({ pollMs = POLL_MS, slowMs = SLOW_MS }: { pollMs?: number; slowMs?: number }) {
  const [phase, setPhase] = useState<Phase>({ kind: "closed" });
  const [remembered, setRemembered] = useState<ExitMode | null>(null);
  // containers that are not the team's on its machine: stopping leaves the machine on for them, and the dialog says it
  const [others, setOthers] = useState(0);
  const [setup, setSetup] = useState<SetupView | null>(null);
  // a new request, or a cancel, ends the wait that was running
  const runRef = useRef(0);
  const firstRef = useRef<HTMLButtonElement>(null);
  // the phase the requests below see: a request while the agents are being waited for, or the stop is on, changes nothing
  const busyRef = useRef(false);

  // `quiet`: nothing was asked, so nothing is shown while the window closes (no team here, or the remembered choice)
  // `machine`: the setup's way out, only the machine is turned off; its failure is told on the setup's own choices
  const leave = useCallback(async (mode: ExitMode | "machine", run: number, quiet = false) => {
    if (!quiet) setPhase({ kind: "stopping" });
    try {
      await exitFinish(mode);
    } catch (error) {
      const code = exitErrorCode(error);
      if (runRef.current === run) setPhase(mode === "machine" ? { kind: "setup", code } : { kind: "failed", code });
    }
  }, []);

  const stopInOrder = useCallback(async (run: number) => {
    setPhase({ kind: "waiting", active: 0, slow: false, remaining: [] });
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
        setPhase({ kind: "waiting", active: progress.active, slow: Date.now() - started >= slowMs, remaining: progress.remaining });
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
    const info = setupExit();
    const state = await exitState(info !== null);
    if (runRef.current !== id) return;
    // a setup before the team's start, on a computer with a machine: no team to stop, and no remembered choice applies
    const machine = state?.machine;
    if (info && state && state.team !== "vps" && machine && machine !== "none") {
      setOthers(state.otherContainers);
      setSetup({ info, machine, teamContainers: state.teamContainers });
      return void setPhase({ kind: "setup" });
    }
    setSetup(null);
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

  // during the setup there is no team to bring down: only the machine is turned off, and a failure keeps the app open
  const stopMachine = () => void leave("machine", ++runRef.current);
  const closeOnly = () => void leave("detach", ++runRef.current, true);

  const stay = () => {
    runRef.current += 1;
    setPhase({ kind: "closed" });
    void exitCancel().catch(() => {});
  };

  useEffect(() => {
    if (phase.kind === "choose" || phase.kind === "setup") firstRef.current?.focus();
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
        {setup ? (
          <>
            <p id="app-exit-body" data-testid="app-exit-setup" className="text-[12px] text-[var(--color-bright)]">
              {fill(setup.info.failed ? t.setupFailed : t.setupRunning, { step: setup.info.step, total: setup.info.total, label: setup.info.label })}
            </p>
            <p className="text-[12px] text-[var(--color-muted)]">{t.setupNoTeam}</p>
          </>
        ) : (
          <p id="app-exit-body" className="text-[12px] text-[var(--color-muted)]">{t.body}</p>
        )}
        {phase.kind === "setup" && setup && (
          <SetupChoices t={t} setup={setup} others={others} code={phase.code} firstRef={firstRef} onStop={stopMachine} onClose={closeOnly} />
        )}
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
            {/* the app's global label and input rules (block, capitals, full width) are undone here: box and words on one line */}
            <label className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]" style={REMEMBER_LABEL}>
              <input
                type="checkbox"
                className="m-0 w-auto shrink-0 p-0"
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
            {phase.remaining.length > 0 && (
              <p data-testid="app-exit-remaining" className="text-[11px] text-[var(--color-muted)]">{fill(t.stillOn, { names: phase.remaining.join(", ") })}</p>
            )}
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
        {busy && <p role="status" data-testid="app-exit-stopping" className="text-[12px] text-[var(--color-bright)]">{setup ? t.setupStopping : t.stopping}</p>}
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

/** web/app/globals.css styles every label outside the layers, so a utility class cannot undo it: this style can. */
const REMEMBER_LABEL = { display: "flex", marginBottom: 0, textTransform: "none", letterSpacing: "normal", fontWeight: 400 } as const;

type ExitCopy = (typeof APP_EXIT_TEXT)[keyof typeof APP_EXIT_TEXT];

/** The setup's choices: what is left on, then turning the machine off or leaving it as it is. */
function SetupChoices({ t, setup, others, code, firstRef, onStop, onClose }: {
  t: ExitCopy;
  setup: SetupView;
  others: number;
  code?: string;
  firstRef: RefObject<HTMLButtonElement | null>;
  onStop: () => void;
  onClose: () => void;
}) {
  const { machine, teamContainers } = setup;
  const leftOn = machine === "off" ? t.leftNothing
    : machine === "unknown" ? t.leftUnknown
    : teamContainers > 0 ? t.leftMachineAndContainer : t.leftMachine;
  // a machine that is on for other containers too stays on whatever the choice: then there is only closing
  const canStop = (machine === "on" && others === 0) || machine === "unknown";
  const choices = canStop
    ? [
        { key: "machine", label: machine === "on" ? t.stopMachine : t.tryStopMachine, hint: machine === "on" ? t.stopMachineHint : t.tryStopMachineHint, onClick: onStop },
        { key: "detach", label: machine === "on" ? t.keepMachine : t.closeOnly, hint: machine === "on" ? t.keepMachineHint : t.closeOnlyHint, onClick: onClose },
      ]
    : [{ key: "detach", label: t.closeOnly, hint: t.closeOnlyHint, onClick: onClose }];
  return (
    <>
      <div data-testid="app-exit-left-on" className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[12px] text-[var(--color-base)]">
        <span className="block text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">{t.leftOn}</span>
        {leftOn}
        {machine === "on" && others > 0 && <span data-testid="app-exit-others" className="block mt-1 text-[11px] text-[var(--color-muted)]">{fill(t.setupOthers, { count: others })}</span>}
      </div>
      {code && (
        <p role="alert" data-testid="app-exit-failed" className="text-[11px] text-[var(--color-red)]">
          {code === "app_exit_machine_state_unknown" ? t.setupMachineUnknown : t.setupStopFailed}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {choices.map((choice, index) => (
          <button
            key={choice.key}
            ref={index === 0 ? firstRef : undefined}
            type="button"
            data-testid={`app-exit-setup-${choice.key}`}
            onClick={choice.onClick}
            className="text-left rounded border border-[var(--color-border)] px-3 py-2 hover:bg-[var(--color-panel)]"
          >
            <span className="block text-[12px] font-semibold text-[var(--color-bright)]">{choice.label}</span>
            <span className="block text-[11px] text-[var(--color-muted)]">{choice.hint}</span>
          </button>
        ))}
      </div>
    </>
  );
}
