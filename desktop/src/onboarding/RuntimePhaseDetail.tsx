import { useEffect, useRef, useState } from "react";
import type { OnboardingActivityEntry } from "../lib/onboarding";
import { INSTALL_PHASES } from "../lib/onboarding-runtime";
import type { OnboardingCopy } from "./onboarding.i18n";

/** What a progress event says beyond its message: its install phase and the image pull's progress (both optional). */
export type PhaseInfo = Pick<OnboardingActivityEntry, "phase" | "pull">;

function clock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 1536 → «1.5 KiB»: the biggest binary unit that keeps the number above one. */
export function bytesText(bytes: number, locale: string): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/** The image download's bytes when podman gave both, done and the total found so far; null otherwise. */
export function pullBar(info: PhaseInfo): { done: number; total: number } | null {
  const pull = info.phase === "image_pull" ? info.pull ?? null : null;
  if (!pull || pull.bytesDone === null || pull.bytesTotal === null) return null;
  const { bytesDone: done, bytesTotal: total } = pull;
  if (!Number.isFinite(done) || !Number.isFinite(total) || done < 0 || total <= 0 || done > total) return null;
  return { done, total };
}

/** The bar never shows more than this before the step itself says it is done. */
const BAR_CEILING = 0.95;
/** The speed is read over the last stretch of samples, not over the whole phase: a slow start must not make the end look far. */
const SPEED_WINDOW_MS = 30_000;
/** An estimate needs a stretch at least this long behind it, and this much downloaded in it. */
const ESTIMATE_AFTER_MS = 10_000;
const ESTIMATE_AFTER_BYTES = 1024 ** 2;

interface PullSample {
  at: number;
  done: number;
}

/**
 * About this many whole minutes are left, or null when the stretch since `since` is too short, too little
 * came in it, or less than a minute is left. The speed is that of the stretch (the oldest sample of the
 * moving window up to now), the total only grows while podman finds the layers, and the minutes are
 * rounded down: the text says «or more», never a promise.
 */
export function minutesLeftAtLeast(since: PullSample, now: number, done: number, total: number): number | null {
  const span = now - since.at;
  const gained = done - since.done;
  if (span < ESTIMATE_AFTER_MS || gained < ESTIMATE_AFTER_BYTES) return null;
  const minutes = Math.floor((((total - done) / gained) * span) / 60_000);
  return minutes >= 1 ? minutes : null;
}

/**
 * Under the step's heading while a long install phase runs: which phase of the installer this is,
 * how long it has lasted (the clock restarts when the phase changes), and, for the image download,
 * what has come so far. Podman finds the layers as it goes, so the total only grows: the bar is the
 * bytes done over the bytes found so far, it never goes back and stops short of the end, the text
 * says «of at least» and never a percentage, and the time left is «about N min or more» at the speed
 * of the last seconds. A phase that says nothing more shows only its clock.
 */
export default function RuntimePhaseDetail({
  t,
  locale,
  info,
  phaseKey,
  now,
}: {
  t: OnboardingCopy;
  locale: string;
  info: PhaseInfo;
  /** what identifies the phase now: its id, or its text; when it changes the clock restarts */
  phaseKey: string;
  now: number;
}) {
  const [since, setSince] = useState(() => Date.now());
  const shown = useRef({ key: phaseKey, fraction: 0, samples: [] as PullSample[] });
  useEffect(() => {
    setSince(Date.now());
  }, [phaseKey]);
  if (shown.current.key !== phaseKey) shown.current = { key: phaseKey, fraction: 0, samples: [] };
  const pull = info.phase === "image_pull" ? info.pull ?? null : null;
  const bar = pullBar(info);
  const bytes = pull && pull.bytesDone !== null && Number.isFinite(pull.bytesDone) && pull.bytesDone >= 0 ? pull.bytesDone : null;
  const layers = pull && pull.blobsDone > 0 ? pull.blobsDone : null;
  let left: number | null = null;
  if (bar) {
    const state = shown.current;
    state.fraction = Math.max(state.fraction, Math.min(BAR_CEILING, bar.done / bar.total));
    // one sample per tick, and none older than the window
    if (state.samples[state.samples.length - 1]?.at !== now) state.samples.push({ at: now, done: bar.done });
    state.samples = state.samples.filter((sample) => now - sample.at <= SPEED_WINDOW_MS);
    left = minutesLeftAtLeast(state.samples[0], now, bar.done, bar.total);
  }
  const phaseNumber = info.phase ? INSTALL_PHASES.indexOf(info.phase) + 1 : 0;
  return (
    <div className="onboarding-runtime-phase" data-testid="onboarding-phase-detail">
      {phaseNumber > 0 && <small data-testid="onboarding-phase-step">{t.phaseStep(phaseNumber, INSTALL_PHASES.length)}</small>}
      <small data-testid="onboarding-phase-clock">{t.phaseSince(clock(now - since))}</small>
      {info.phase === "image_pull" && <small data-testid="onboarding-pull-long">{t.pullLong}</small>}
      {bar && (
        <div
          className="onboarding-runtime-pullbar"
          role="progressbar"
          data-testid="onboarding-pull-bar"
          aria-label={t.pullBarAria}
          aria-valuemin={0}
          aria-valuemax={bar.total}
          aria-valuenow={bar.done}
          aria-valuetext={t.pullBytesOfAtLeast(bytesText(bar.done, locale), bytesText(bar.total, locale))}
        >
          <i style={{ width: `${(shown.current.fraction * 100).toFixed(1)}%` }} />
        </div>
      )}
      {/* the bytes against what podman found so far, or the bytes alone, or the layers alone: never a made-up share */}
      {bar && (
        <small data-testid="onboarding-pull-bytes">
          {t.pullBytesOfAtLeast(bytesText(bar.done, locale), bytesText(bar.total, locale))}
          {layers !== null && ` · ${t.pullLayersShort(layers)}`}
        </small>
      )}
      {!bar && bytes !== null && (
        <small data-testid="onboarding-pull-bytes">
          {t.pullBytesDone(bytesText(bytes, locale))}
          {layers !== null && ` · ${t.pullLayersShort(layers)}`}
        </small>
      )}
      {left !== null && <small data-testid="onboarding-pull-estimate">{t.pullEstimate(left)}</small>}
      {bytes === null && layers !== null && <small data-testid="onboarding-pull-layers">{t.pullLayersCount(layers)}</small>}
    </div>
  );
}
