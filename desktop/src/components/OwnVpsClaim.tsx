import { useState } from "react";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { claimOwnVps, type OwnVpsClaimCode } from "../lib/own-vps-claim";
import { OWN_VPS_CLAIM_TEXT } from "./OwnVpsClaim.i18n";

/**
 * The invitation to claim a VPS the app set up before it marked them (or whose key changed): reads work,
 * writes need the person's «this VPS is mine», confirmed in a dialog that says what it allows.
 * `onClaimed` runs once the native side wrote the mark.
 */
export default function OwnVpsClaim({
  reason,
  onClaimed,
}: {
  reason: OwnVpsClaimCode;
  onClaimed: () => void;
}) {
  const t = OWN_VPS_CLAIM_TEXT[appLocale()];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const changed = reason === "own_vps_key_changed";

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    const done = await claimOwnVps();
    setBusy(false);
    if (done.ok) {
      setConfirming(false);
      onClaimed();
      return;
    }
    const copy = describeError(done.code, { fallback: "unknown", locale: appLocale() });
    setFailure(`${copy.text} ${copy.action}`);
  };

  return (
    <div
      role="region"
      data-testid="own-vps-invite"
      className="mb-3 rounded border px-3 py-2 text-[11px]"
      style={{ borderColor: "var(--color-border)", color: "var(--color-bright)" }}
    >
      <p>{changed ? t.inviteKeyChanged : t.inviteClaim}</p>
      {!confirming && (
        <button
          type="button"
          data-testid="own-vps-claim"
          onClick={() => setConfirming(true)}
          className="mt-2 text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)]"
        >
          {t.button}
        </button>
      )}
      {confirming && (
        <div role="dialog" aria-modal="false" aria-label={t.confirmTitle} data-testid="own-vps-confirm" className="mt-2">
          <strong>{t.confirmTitle}</strong>
          <p>{t.confirmBody}</p>
          {changed && <p>{t.confirmKeyChanged}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="own-vps-cancel"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-muted)]"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              data-testid="own-vps-confirm-yes"
              onClick={() => void confirm()}
              disabled={busy}
              className="text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded border disabled:opacity-60 disabled:cursor-wait"
              style={{ color: "var(--color-green)", borderColor: "var(--color-green)" }}
            >
              {busy ? t.working : t.confirm}
            </button>
          </div>
        </div>
      )}
      {failure && (
        <p role="alert" data-testid="own-vps-failure" className="mt-2 text-[var(--color-red)]">
          {failure}
        </p>
      )}
    </div>
  );
}
