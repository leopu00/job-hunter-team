import { useEffect, useState } from "react";
import type { OnboardingActivityEntry } from "../lib/onboarding";
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

/**
 * Under the step's heading while a long install phase runs: how long this phase has lasted (the
 * clock restarts when the phase changes), and, for the image download, what has come so far. There
 * is no percentage and no bar: podman finds the layers as it goes, so the total grows while it
 * downloads and a percentage would go backwards. It says the bytes downloaded when podman said them,
 * and how many layers are done; a phase that says nothing more shows only its clock.
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
  const bytes = pull && pull.bytesDone !== null && Number.isFinite(pull.bytesDone) && pull.bytesDone >= 0 ? pull.bytesDone : null;
  const layers = pull && pull.blobsDone > 0 ? pull.blobsDone : null;
  return (
    <div className="onboarding-runtime-phase" data-testid="onboarding-phase-detail">
      <small data-testid="onboarding-phase-clock">{t.phaseSince(clock(now - since))}</small>
      {info.phase === "image_pull" && <small data-testid="onboarding-pull-long">{t.pullLong}</small>}
      {/* the bytes with the layers, or the layers alone: never a made-up share of an unknown total */}
      {bytes !== null && (
        <small data-testid="onboarding-pull-bytes">
          {t.pullBytesDone(bytesText(bytes, locale))}
          {layers !== null && ` · ${t.pullLayersShort(layers)}`}
        </small>
      )}
      {bytes === null && layers !== null && <small data-testid="onboarding-pull-layers">{t.pullLayersCount(layers)}</small>}
    </div>
  );
}
