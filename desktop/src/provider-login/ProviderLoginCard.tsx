import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { PROVIDER_LOGIN_TEXT, PROVIDER_NAMES, withProvider } from "./provider-login.i18n";
import { useProviderLogin } from "./ProviderLoginProvider";

const buttonCls = "rounded border border-[var(--color-border)] px-2 py-1 text-[12px] hover:border-[var(--color-border-glow)] disabled:opacity-60";

/**
 * In Settings → Team → Provider: the state of the sign-in as the team says it, and «Sign in again» as an action of its own.
 * It signs in and nothing else (no setup, no reinstall, no new containers). Nothing shows where the team uses no subscription sign-in.
 */
export function ProviderLoginCard({ locale: localeOverride }: { locale?: Locale }) {
  const login = useProviderLogin();
  if (!login) return null;
  const locale = localeOverride ?? appLocale();
  const t = PROVIDER_LOGIN_TEXT[locale];
  const { view } = login;
  if (view.kind === "state" && view.state === "not_applicable") return null;
  const name = view.kind === "state" && view.provider !== "none" ? PROVIDER_NAMES[view.provider] : t.providerFallback;
  const failure = view.kind === "failed" ? describeError(view.code, { locale }) : null;
  const lines = {
    ready: t.ready,
    probably_expired: t.probablyExpired,
    expired: t.expired,
    missing: t.missing,
    unreadable: t.unreadable,
    not_applicable: "",
  } as const;
  return (
    <div data-testid="provider-login-card" className="flex flex-col gap-2">
      <p
        data-testid="provider-login-state"
        data-state={view.kind === "state" ? view.state : view.kind}
        role={view.kind === "state" && view.state === "expired" ? "alert" : "status"}
        className="text-[12px] text-[var(--color-muted)]"
      >
        {view.kind === "loading" && withProvider(t.loading, name)}
        {view.kind === "state" && withProvider(lines[view.state], name)}
        {failure && `${failure.text} ${failure.action}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {view.kind !== "loading" && (
          <button type="button" data-testid="provider-login-signin" disabled={login.signingIn} onClick={login.signIn} className={buttonCls}>
            {login.signingIn ? t.signingIn : t.signIn}
          </button>
        )}
        {view.kind === "failed" && (
          <button
            type="button"
            data-testid={view.code === "disconnected" ? "provider-login-reconnect" : "provider-login-retry"}
            onClick={view.code === "disconnected" ? login.reconnect : login.reread}
            className={buttonCls}
          >
            {view.code === "disconnected" ? t.reconnect : t.retry}
          </button>
        )}
      </div>
      {view.kind === "state" && <p className="text-[11px] text-[var(--color-muted)]">{t.note}</p>}
    </div>
  );
}
