import { useEffect, useId, useState } from "react";
import { fill } from "../../lib/text-slots";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import { burstTimeIsValid, readTeamSettings, startBurst, stopBurst, type TeamSettings, type TeamSettingsResult } from "../../lib/team-settings-native";
import { BURST_TEXT } from "./burst.i18n";

const BUTTON = "text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)] disabled:opacity-50";
/** How long «Started until HH:MM, Undo» stays after a start: long enough to notice a wrong tap, short enough not to be furniture. */
export const UNDO_MS = 10_000;
/** How often the strip checks whether the time is up: the team puts its hours back by itself, the page only stops showing the strip. */
const TICK_MS = 30_000;

type Note = { kind: "ok" | "error"; text: string } | null;

function failureText(code: string): string {
  const copy = describeError(code, { fallback: "team_settings_unavailable", locale: appLocale() });
  return `${copy.text} ${copy.action}`;
}

/** The lengths of time offered as one tap (hours). */
export const QUICK_HOURS = [1, 2, 4] as const;
/** The field starts on this many hours from now, rounded up to a quarter of an hour (inside the 12 hours the team takes). */
export const DEFAULT_HOURS = 4;
const QUARTER_MS = 15 * 60_000;

/** The wall clock `HH:MM` of a zone at an instant; null when the zone is not one the platform knows. */
export function clockIn(zone: string | null | undefined, at: Date): string | null {
  if (!zone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    return hour && minute ? `${hour === "24" ? "00" : hour}:${minute}` : null;
  } catch {
    return null;
  }
}

/**
 * The time the team reads `hours` from now, as the team's wall clock reads it (the box takes HH:MM in the zone of the team's
 * hours, and the person's computer may be in another). Null while that zone is not known: then nothing is guessed, the field
 * stays empty and the person types the time. `roundTo` rounds up to the minute (a length of time) or to the quarter of an hour
 * (the field's first value).
 */
export function untilIn(zone: string | null | undefined, hours: number, now: Date, roundTo: "minute" | "quarter"): string | null {
  const step = roundTo === "quarter" ? QUARTER_MS : 60_000;
  const at = new Date(Math.ceil((now.getTime() + hours * 3_600_000) / step) * step);
  return clockIn(zone, at);
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
  const zone = settings.workingHours?.timezone ?? null;
  const [time, setTime] = useState(() => untilIn(zone, DEFAULT_HOURS, new Date(), "quarter") ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [now, setNow] = useState(() => Date.now());
  /** The clock time of the burst this control has just started, for the ten seconds in which it can be taken back. */
  const [justStarted, setJustStarted] = useState<string | null>(null);
  useEffect(() => {
    if (justStarted === null) return;
    const timer = setTimeout(() => setJustStarted(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [justStarted]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const burst = settings.burst ?? null;
  const running = burst !== null && burst.active && Date.parse(burst.until) > now;

  async function run(call: () => Promise<TeamSettingsResult>, done: (next: TeamSettings) => string | null) {
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
    const text = done(result.settings);
    setNote(text === null ? null : { kind: "ok", text });
  }

  function begin(until: string) {
    void run(
      () => startBurst(until, settings.connectionKey),
      (next) => {
        // The confirmation is the undo line, not a note: «Started until HH:MM» with «Undo» for ten seconds.
        setJustStarted(next.burst?.active ? next.burst.untilLocal : until);
        return null;
      },
    );
  }

  function start() {
    if (!burstTimeIsValid(time)) {
      setNote({ kind: "error", text: t.burstNeedsTime });
      return;
    }
    begin(time);
  }

  /** One tap: the team works flat out for this many hours from now (the time is the team's own clock, never the computer's). */
  function startFor(hours: number) {
    const until = untilIn(zone, hours, new Date(), "minute");
    if (until === null || busy) return;
    setTime(until);
    begin(until);
  }

  const quick = zone !== null && clockIn(zone, new Date()) !== null;
  const quickLabels: Record<(typeof QUICK_HOURS)[number], string> = { 1: t.burstFor1, 2: t.burstFor2, 4: t.burstFor4 };

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
        {justStarted !== null && (
          <div
            role="status"
            data-testid="burst-undo"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-3 py-1 text-[12px]"
            style={{ borderColor: "var(--color-green)", color: "var(--color-bright)" }}
          >
            <span className="font-semibold">{fill(t.burstStarted, { time: justStarted })}</span>
            <button
              type="button"
              data-testid="burst-undo-button"
              disabled={busy}
              onClick={() => void run(() => stopBurst(settings.connectionKey), () => { setJustStarted(null); return t.burstStopped; })}
              className={BUTTON}
            >
              {busy ? t.burstBusy : t.burstUndo}
            </button>
          </div>
        )}
        <div
          role="status"
          data-testid="burst-active"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border-2 px-3 py-2 text-[12px]"
          style={{ borderColor: "var(--color-yellow)", backgroundColor: "color-mix(in srgb, var(--color-yellow) 12%, transparent)", color: "var(--color-bright)" }}
        >
          <span className="font-semibold">{fill(t.burstActive, { time: burst.untilLocal })}</span>
          {!compact && <span className="text-[var(--color-muted)]">{t.burstActiveNote}</span>}
          <button
            type="button"
            data-testid="burst-stop"
            disabled={busy}
            onClick={() => void run(() => stopBurst(settings.connectionKey), () => { setJustStarted(null); return t.burstStopped; })}
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
      {quick && (
        <div role="group" aria-label={t.burstQuickLabel} data-testid="burst-quick" className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-widest text-[var(--color-dim)]">{t.burstQuickLabel}</span>
          {QUICK_HOURS.map((hours) => (
            <button key={hours} type="button" data-testid={`burst-quick-${hours}`} disabled={busy} onClick={() => startFor(hours)} className={BUTTON}>
              {quickLabels[hours]}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="text-[11px] uppercase tracking-widest text-[var(--color-dim)]">
          {quick ? t.burstExactLabel : t.burstUntilLabel}
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

/**
 * The same control for a page that has not read the team's settings: it reads them itself and shows nothing until it can.
 * Short (the agents' panel) unless `compact={false}`: with its title and its line, as in the Settings team card.
 */
export function BurstStrip({ compact = true }: { compact?: boolean }) {
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
  return settings ? <BurstControl compact={compact} settings={settings} onSettings={setSettings} /> : null;
}
