import { useCallback, useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { openLiveScreen } from "../../lib/live-screen";
import { readScreenState, setScreen, type ScreenOutcome, type ScreenState } from "../../lib/screen-control";
import { LIVE_SCREEN_CARD_TEXT } from "./live-screen-card.i18n";

const cardCls = "rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2";
const buttonCls =
  "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-50";

/** Where the screen cannot be switched from the app at all: the card is not shown. */
const NOT_HERE = new Set(["desktop_only", "screen_local_only"]);

type Busy = null | "on" | "off" | "open";

/**
 * «Live screen» of the Settings (Team): the CLOSER's screen is a container that starts only on request. Here the person
 * turns it on, opens its window (a view only, on 127.0.0.1 of this computer) and turns it off, through `jht screen`
 * (screen_control.rs). A change is shown only as the state read after it. `read`, `set` and `open` are for the tests.
 */
export default function LiveScreenCard({
  read = readScreenState,
  set = setScreen,
  open = openLiveScreen,
}: {
  read?: () => Promise<ScreenOutcome>;
  set?: (on: boolean) => Promise<ScreenOutcome>;
  open?: () => Promise<boolean>;
}) {
  const t = LIVE_SCREEN_CARD_TEXT[appLocale()];
  const [state, setState] = useState<ScreenState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const load = useCallback(async () => {
    const result = await read().catch((): ScreenOutcome => ({ ok: false, code: "screen_failed" }));
    if (result.ok) {
      setState(result.state);
      setError(null);
    } else if (NOT_HERE.has(result.code)) {
      setHidden(true);
    } else {
      setState(null);
      setError(result.code);
    }
  }, [read]);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(on: boolean) {
    if (busy) return;
    setBusy(on ? "on" : "off");
    setError(null);
    const result = await set(on).catch((): ScreenOutcome => ({ ok: false, code: "screen_failed" }));
    if (result.ok) setState(result.state);
    else setError(result.code);
    setBusy(null);
  }

  async function show() {
    if (busy) return;
    setBusy("open");
    setError(null);
    try {
      await open();
    } catch (failure) {
      const code = (failure as { code?: unknown } | null)?.code;
      setError(typeof code === "string" ? code : "live_screen_failed");
    }
    setBusy(null);
  }

  if (hidden) return null;
  const on = state === "running";
  const told = error ? describeError(error, { locale: appLocale(), fallback: "screen_failed" }) : null;
  const word =
    busy === "on" ? t.turningOn : busy === "off" ? t.turningOff :
    state === null ? (error ? t.unknown : t.loading) :
    state === "running" ? t.on : state === "downloading" ? t.downloading : state === "error" ? t.broken : t.off;
  return (
    <section data-testid="settings-live-screen" aria-labelledby="settings-live-screen-title" className={cardCls}>
      <h2 id="settings-live-screen-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.title}</h2>
      <p className="text-[12px] text-[var(--color-muted)]">{t.text}</p>
      <p className="text-[12px]" role="status" data-testid="live-screen-state" data-state={state ?? "unknown"}>
        {t.stateLabel} {word}
      </p>
      <div className="flex flex-wrap gap-2">
        {state !== null && !on && state !== "downloading" && (
          <button type="button" data-testid="live-screen-on" className={buttonCls} disabled={busy !== null} onClick={() => void change(true)}>{t.turnOn}</button>
        )}
        {on && (
          <>
            <button type="button" data-testid="live-screen-open" className={buttonCls} disabled={busy !== null} onClick={() => void show()}>
              {busy === "open" ? t.opening : t.open}
            </button>
            <button type="button" data-testid="live-screen-off" className={buttonCls} disabled={busy !== null} onClick={() => void change(false)}>{t.turnOff}</button>
          </>
        )}
        {(state === null || state === "downloading" || state === "error") && (
          <button type="button" data-testid="live-screen-recheck" className={buttonCls} disabled={busy !== null} onClick={() => void load()}>{t.recheck}</button>
        )}
      </div>
      {told && (
        <p role="alert" data-testid="live-screen-error" className="text-[12px]" style={{ color: "var(--color-red)" }}>
          {told.text} {told.action}
        </p>
      )}
    </section>
  );
}
