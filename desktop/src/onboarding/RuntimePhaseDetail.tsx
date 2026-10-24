import { useEffect, useState } from "react";
import type { OnboardingCopy } from "./onboarding.i18n";

/** What a progress event may say beyond its message (optional: absent means «as before»). */
export interface PhaseInfo {
  /** the install phase the event belongs to (install.ps1's JHT_PHASE): wsl_check, image_pull, … */
  phase?: string | null;
  /** only for `image_pull`: layers done, and bytes when the pull prints them */
  pull?: { blobsDone: number; bytesDone: number | null; bytesTotal: number | null } | null;
}

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

/**
 * Under the step's heading while a long install phase runs: how long this phase has lasted (the
 * clock restarts when the phase changes), and, for the image download, how far it is. A bar and a
 * percentage appear only when the pull said both byte counts; with the layers alone it says how many
 * are done and no percentage is made up. A phase that says nothing more shows only its clock.
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
  useEffect(() => {
    setSince(Date.now());
  }, [phaseKey]);
  const pull = info.phase === "image_pull" ? info.pull ?? null : null;
  // a bar and a percentage only from two real counts: a negative or not-a-number count shows no bar
  const hasBytes =
    !!pull && pull.bytesDone !== null && pull.bytesTotal !== null && Number.isFinite(pull.bytesDone) && Number.isFinite(pull.bytesTotal) && pull.bytesDone >= 0 && pull.bytesTotal > 0;
  const percent = hasBytes ? Math.max(0, Math.min(100, Math.round((pull.bytesDone! / pull.bytesTotal!) * 100))) : null;
  return (
    <div className="onboarding-runtime-phase" data-testid="onboarding-phase-detail">
      <small data-testid="onboarding-phase-clock">
        {t.phaseSince(clock(now - since))}
      </small>
      {info.phase === "image_pull" && <small data-testid="onboarding-pull-long">{t.pullLong}</small>}
      {hasBytes && percent !== null && (
        <div data-testid="onboarding-pull-bytes" className="onboarding-runtime-phase__pull">
          <progress max={100} value={percent} aria-label={t.pullBytes(bytesText(pull!.bytesDone!, locale), bytesText(pull!.bytesTotal!, locale))} />
          <small>
            {t.pullBytes(bytesText(pull!.bytesDone!, locale), bytesText(pull!.bytesTotal!, locale))} · {percent}%
          </small>
        </div>
      )}
      {pull && !hasBytes && pull.blobsDone > 0 && <small data-testid="onboarding-pull-layers">{t.pullLayersCount(pull.blobsDone)}</small>}
    </div>
  );
}
