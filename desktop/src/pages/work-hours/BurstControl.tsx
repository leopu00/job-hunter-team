import { useEffect, useId, useState } from "react";
import { fill } from "../../lib/text-slots";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { burstTimeIsValid, readTeamSettings, startBurst, stopBurst, type TeamSettings, type TeamSettingsResult } from "../../lib/team-settings-native";
import { BURST_TEXT } from "./burst.i18n";

const BUTTON = "text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)] disabled:opacity-50";
/** How often the strip checks whether the time is up: the team puts its hours back by itself, the page only stops showing the strip. */
const TICK_MS = 30_000;

type Note = { kind: "ok" | "error"; text: string } | null;

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "team_settings_unavailable", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

/**
 * «Work flat out until HH:MM»: choose a time, and the team works flat out until then, even outside its
 * hours; when the time is up the hours it had before come back by themselves, with the app closed or
 * not (the team does it, in its container). While a burst runs the control is a strip, «flat out until
 * HH:MM», with «Stop now». What the page shows is what the box answered, read again. A box that does not
 * say whether a burst runs (`burst` absent) gets the gesture and no strip: it is never read as «none».
 */
export default function BurstControl({
  settings,
  onSettings,
  compact = false,
}: {
  settings: TeamSettings;
  onSettings: (next: TeamSettings) => void;
  compact?: boolean;
}) {
  const t = BURST_TEXT[appLocale()];
  const inputId = useId();
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const burst = settings.burst ?? null;
  const running = burst !== null && burst.active && Date.parse(burst.until) > now;

  async function run(call: () => Promise<TeamSettingsResult>, done: (next: TeamSettings) => string) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const result = await call();
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: "error", text: failureText(result.error) });
      return;
    }
    onSettings(result.settings);
    setNote({ kind: "ok", text: done(result.settings) });
  }

  function start() {
    if (!burstTimeIsValid(time)) {
      setNote({ kind: "error", text: t.burstNeedsTime });
      return;
    }
    void run(
      () => startBurst(time, settings.connectionKey),
      (next) => fill(t.burstStarted, { time: next.burst?.active ? next.burst.untilLocal : time }),
    );
  }

  const noteLine = note && (
    <p
      role={note.kind === "ok" ? "status" : "alert"}
      data-testid="burst-note"
      className="m-0 text-[11px]"
      style={{ color: note.kind === "ok" ? "var(--color-green)" : "var(--color-red)" }}
    >
      {note.text}
    </p>
  );

  if (running && burst.active) {
    return (
      <div data-testid="burst" className="flex flex-col gap-1">
        <div
          role="status"
          data-testid="burst-active"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-2 text-[12px]"
          style={{ borderColor: "var(--color-yellow)", color: "var(--color-bright)" }}
        >
          <span className="font-semibold">{fill(t.burstActive, { time: burst.untilLocal })}</span>
          {!compact && <span className="text-[var(--color-muted)]">{t.burstActiveNote}</span>}
          <button
            type="button"
            data-testid="burst-stop"
            disabled={busy}
            onClick={() => void run(() => stopBurst(settings.connectionKey), () => t.burstStopped)}
            className={BUTTON}
          >
            {busy ? t.burstBusy : t.burstStop}
          </button>
        </div>
        {noteLine}
      </div>
    );
  }

  return (
    <div data-testid="burst" className="flex flex-col gap-2">
      {!compact && (
        <>
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-bright)]">{t.burstTitle}</h2>
          <p className="m-0 text-[12px] text-[var(--color-muted)]">{t.burstIntro}</p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-[11px] uppercase tracking-widest text-[var(--color-dim)]">
          {t.burstUntilLabel}
        </label>
        <input
          id={inputId}
          type="time"
          data-testid="burst-time"
          value={time}
          disabled={busy}
          onChange={(event) => setTime(event.target.value)}
          className="rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px] text-[var(--color-bright)]"
        />
        <button type="button" data-testid="burst-start" disabled={busy} onClick={start} className={BUTTON}>
          {busy ? t.burstBusy : compact ? t.burstStartShort : burstTimeIsValid(time) ? fill(t.burstStart, { time }) : t.burstStartShort}
        </button>
      </div>
      {!compact && <p className="m-0 text-[11px] text-[var(--color-dim)]">{t.burstLimit}</p>}
      {noteLine}
    </div>
  );
}

/** The same control for a page that has not read the team's settings: it reads them itself and shows nothing until it can. */
export function BurstStrip() {
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void readTeamSettings().then((read) => {
      if (alive && read.ok) setSettings(read.settings);
    });
    return () => {
      alive = false;
    };
  }, []);
  return settings ? <BurstControl compact settings={settings} onSettings={setSettings} /> : null;
}
