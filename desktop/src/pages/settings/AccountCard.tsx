import { useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { loadAccountIdentity, useSignOut, type AccountIdentity } from "../../lib/account-actions";
import { navigate } from "../../shell/router";
import { ACCOUNT_TEXT } from "./account.i18n";

const buttonCls =
  "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-50";

/** Who is signed in, «Sign out» (the shell's own) and the way to the account's data export. */
export default function AccountCard({ load = loadAccountIdentity }: { load?: () => Promise<AccountIdentity> }) {
  const t = ACCOUNT_TEXT[appLocale()];
  const signOut = useSignOut();
  const [who, setWho] = useState<AccountIdentity | undefined>(undefined);
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    load().then((found) => live && setWho(found)).catch(() => live && setWho(null));
    return () => {
      live = false;
    };
  }, [load]);

  async function leave() {
    if (!signOut || signingOut) return;
    setSigningOut(true);
    setFailed(false);
    try {
      await signOut();
    } catch {
      setFailed(true);
      setSigningOut(false);
    }
  }

  const line = who === undefined ? "" : who === null ? t.signedInNobody : (who.kind === "google" ? t.signedInGoogle : t.signedInLocal).replace("{who}", who.label);
  return (
    <section data-testid="settings-account" aria-labelledby="settings-account-title" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-2">
      <h2 id="settings-account-title" className="text-[13px] font-semibold text-[var(--color-bright)]">{t.accountTitle}</h2>
      <p className="text-[12px] text-[var(--color-muted)]" data-testid="settings-account-who">{line}</p>
      <p className="text-[11px] text-[var(--color-muted)]">{t.signOutNote}</p>
      {failed && <p role="alert" className="text-[11px] text-[var(--color-red)]">{t.signOutFailed}</p>}
      <div className="flex flex-wrap gap-2">
        {signOut && (
          <button type="button" className={buttonCls} onClick={() => void leave()} disabled={signingOut}>
            {signingOut ? t.signingOut : t.signOut}
          </button>
        )}
        <button type="button" className={buttonCls} onClick={() => navigate("/export")}>{t.exportAccount}</button>
      </div>
    </section>
  );
}
