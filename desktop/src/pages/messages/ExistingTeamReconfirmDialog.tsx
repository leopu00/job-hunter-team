import { useEffect, useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeError } from "../../lib/error-catalog";
import {
  existingTeamBridge,
  existingTeamErrorCode,
  type ExistingTeamBridge,
  type ExistingTeamReconfirmSummary,
} from "../../lib/existing-team";
import type { ReconfirmExistingTeam } from "../../lib/reconfirm-existing-team";
import { EXISTING_TEAM_RECEIPT_TEXT } from "../../onboarding/existing-team-receipt.i18n";
import { ONBOARDING_TEXT } from "../../onboarding/onboarding.i18n";
import { EXISTING_TEAM_RECONFIRM_TEXT } from "./existing-team-reconfirm.i18n";

const SETUP = "existing_team_reconfirm_setup";

type Stage = { kind: "loading" } | { kind: "confirm"; summary: ExistingTeamReconfirmSummary } | { kind: "working" } | { kind: "failed"; code: string };

/**
 * The chat's «Collega il team» in the read-only view: the full connection of the setup, confirmed
 * with one click, for the host and team this profile saved. It shows what the setup shows (host and
 * port, the fingerprint of the key already pinned, team and account) and asks the native side for
 * the same connection; anything that does not match what was saved goes back to the setup. It opens
 * only on the person's click and never by itself.
 */
export default function ExistingTeamReconfirmDialog({
  reconfirm,
  onClose,
  bridge = existingTeamBridge,
}: {
  reconfirm: ReconfirmExistingTeam;
  onClose: () => void;
  bridge?: ExistingTeamBridge;
}) {
  const locale = appLocale();
  const t = EXISTING_TEAM_RECONFIRM_TEXT[locale];
  const r = EXISTING_TEAM_RECEIPT_TEXT[locale];
  const setupText = ONBOARDING_TEXT[locale].existingTeam;
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    bridge.reconfirmSummary().then(
      (summary) => { if (live.current) setStage({ kind: "confirm", summary }); },
      (error) => {
        if (!live.current) return;
        const code = existingTeamErrorCode(error);
        if (code === SETUP) reconfirm.onSetup();
        else setStage({ kind: "failed", code });
      },
    );
    return () => { live.current = false; };
  }, [bridge, reconfirm]);

  async function confirm(summary: ExistingTeamReconfirmSummary) {
    setStage({ kind: "working" });
    try {
      const result = await bridge.connect({ teamId: summary.teamId, host: summary.host, reconfirm: true }, () => undefined);
      await reconfirm.onConnected(result);
    } catch (error) {
      if (!live.current) return;
      const code = existingTeamErrorCode(error);
      if (code === SETUP) reconfirm.onSetup();
      else setStage({ kind: "failed", code });
    }
  }

  const failure = stage.kind === "failed" ? describeError(stage.code, { fallback: "existing_team_connect_failed", locale }) : null;
  return (
    <div className="existing-team-modal" role="dialog" aria-modal="true" aria-labelledby="existing-team-reconfirm-title">
      <section className="existing-team-modal__confirm" aria-live="polite">
        <h2 id="existing-team-reconfirm-title">{t.title}</h2>
        {stage.kind === "loading" && <p>{t.loading}</p>}
        {stage.kind === "working" && <p>{t.working}</p>}
        {stage.kind === "confirm" && (
          <>
            <p>{t.intro}</p>
            <dl>
              <div><dt>{r.team}</dt><dd>{stage.summary.teamId}</dd></div>
              <div><dt>{r.vps}</dt><dd>{stage.summary.host.address}:{stage.summary.host.port}</dd></div>
              <div><dt>{r.fingerprint}</dt><dd>{stage.summary.fingerprint}</dd></div>
              {reconfirm.accountLabel && <div><dt>{t.account}</dt><dd>{reconfirm.accountLabel}</dd></div>}
            </dl>
            <p className="existing-team-modal__warning">{r.cautionFull}</p>
          </>
        )}
        {failure && (
          <div className="existing-team-modal__failure" role="alert">
            <p>{failure.text}</p>
            <p>{failure.action}</p>
          </div>
        )}
        <div className="existing-team-modal__actions">
          <button type="button" className="existing-team-modal__secondary" onClick={onClose} disabled={stage.kind === "working"}>{r.cancel}</button>
          {stage.kind === "confirm" && (
            <button type="button" className="existing-team-modal__primary" onClick={() => void confirm(stage.summary)}>{setupText.confirmAndLink}</button>
          )}
        </div>
      </section>
    </div>
  );
}
