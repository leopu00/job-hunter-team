import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import { describeError, errorCodeOf } from "../lib/error-catalog";
import { ackCurrentTeamImage, applyTeamUpdate, TEAM_UPDATE_GUIDE_CODES, type TeamUpdateOutcome } from "../lib/team-update";
import { TEAM_UPDATE_RUN_TEXT, whereKey } from "./TeamUpdateRun.i18n";

type View =
  | { kind: "confirm" }
  | { kind: "running" }
  | { kind: "done"; outcome: TeamUpdateOutcome }
  | { kind: "failed"; outcome: TeamUpdateOutcome }
  | { kind: "error"; code: string };

const buttonClass = "text-[12px] font-semibold px-4 py-2 rounded border border-[var(--color-border)] text-[var(--color-bright)]";

/**
 * «Update the team» done by the app (JHT-T173): a confirmation that says what will happen, the wait, and the outcome in
 * plain words: updated (from which version to which), or not updated, where it stopped, and whether the version that
 * worked is back. It runs the update only after the person confirms, and shows nothing but the native side's closed
 * answer. When the host cannot be updated from here (an older wrapper), `onGuide` hands over to the guide with the command.
 */
export default function TeamUpdateRun({
  apply = applyTeamUpdate,
  onClose,
  onGuide,
  onDone,
}: {
  apply?: () => Promise<TeamUpdateOutcome>;
  onClose: () => void;
  onGuide?: () => void;
  onDone?: (outcome: TeamUpdateOutcome) => void;
}) {
  const [view, setView] = useState<View>({ kind: "confirm" });
  const locale = appLocale();
  const t = TEAM_UPDATE_RUN_TEXT[locale];

  async function run() {
    setView({ kind: "running" });
    try {
      const outcome = await apply();
      setView(outcome.ok ? { kind: "done", outcome } : { kind: "failed", outcome });
      if (outcome.ok) {
        void ackCurrentTeamImage();
        onDone?.(outcome);
      }
    } catch (error) {
      const code = errorCodeOf(error) ?? "team_update_failed";
      if (onGuide && TEAM_UPDATE_GUIDE_CODES.includes(code)) onGuide();
      else setView({ kind: "error", code });
    }
  }

  const box = "mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-[14px] leading-6 text-[var(--color-base)]";
  const closeButton = (label: string) => (
    <button type="button" data-testid="team-update-close" className={buttonClass} onClick={onClose}>{label}</button>
  );

  if (view.kind === "confirm") {
    return (
      <section data-testid="team-update-confirm" role="region" aria-label={t.button} className={box}>
        <p className="m-0">{t.confirm}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" data-testid="team-update-start" className={buttonClass} onClick={() => void run()}>{t.start}</button>
          {closeButton(t.cancel)}
        </div>
      </section>
    );
  }
  if (view.kind === "running") {
    return (
      <section data-testid="team-update-running" role="status" aria-live="polite" aria-busy="true" className={box}>
        <p className="m-0">{t.running}</p>
      </section>
    );
  }
  if (view.kind === "done") {
    const { outcome } = view;
    const versions = outcome.previousVersion && outcome.currentVersion
      ? t.doneVersions.replace("{from}", outcome.previousVersion).replace("{to}", outcome.currentVersion)
      : null;
    return (
      <section data-testid="team-update-done" role="status" className={box}>
        <p className="m-0 font-semibold text-[var(--color-green)]">{outcome.changed ? t.done : t.already}</p>
        {outcome.changed && versions && <p className="m-0 mt-1">{versions}</p>}
        {outcome.restartRequired && <p className="m-0 mt-1">{t.restart}</p>}
        <div className="mt-3">{closeButton(t.close)}</div>
      </section>
    );
  }
  if (view.kind === "failed") {
    const { outcome } = view;
    const where = whereKey(outcome.phase);
    return (
      <section data-testid="team-update-failed" role="alert" className={box}>
        <p className="m-0 font-semibold text-[var(--color-yellow)]">{t.failed}</p>
        {where && <p className="m-0 mt-1">{t.stoppedAt.replace("{where}", t.where[where])}</p>}
        {outcome.reason && <p className="m-0 mt-1" data-testid="team-update-reason">{t.reasons[outcome.reason]}</p>}
        <p className="m-0 mt-1" data-testid="team-update-rollback">{outcome.rolledBack ? t.rolledBack : t.notRolledBack}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" data-testid="team-update-retry" className={buttonClass} onClick={() => setView({ kind: "confirm" })}>{t.retry}</button>
          {closeButton(t.close)}
        </div>
      </section>
    );
  }
  const described = describeError(view.code, { locale });
  return (
    <section data-testid="team-update-error" role="alert" className={box}>
      <p className="m-0 font-semibold text-[var(--color-yellow)]">{t.failed}</p>
      <p className="m-0 mt-1">{described.text}</p>
      <p className="m-0 mt-1">{described.action}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" data-testid="team-update-retry" className={buttonClass} onClick={() => setView({ kind: "confirm" })}>{t.retry}</button>
        {closeButton(t.close)}
      </div>
    </section>
  );
}
