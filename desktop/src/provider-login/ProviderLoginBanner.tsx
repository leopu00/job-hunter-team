import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { PROVIDER_LOGIN_TEXT, PROVIDER_NAMES, withProvider } from "./provider-login.i18n";
import { useProviderLogin } from "./ProviderLoginProvider";

/**
 * The fixed warning while the team's agents are refused by the provider (the sign-in expired): it says so and offers the sign-in
 * on its own, in every page. It shows only for a refusal the team itself saw after the last sign-in, never for a sign-in that
 * is merely old (the card in Settings says that one, without alarm), and never while the state is unknown.
 */
export function ProviderLoginBanner({ locale: localeOverride }: { locale?: Locale }) {
  const login = useProviderLogin();
  if (!login || login.view.kind !== "state" || login.view.state !== "expired") return null;
  const t = PROVIDER_LOGIN_TEXT[localeOverride ?? appLocale()];
  const name = login.view.provider === "none" ? t.providerFallback : PROVIDER_NAMES[login.view.provider];
  return (
    <div
      role="alert"
      data-testid="provider-login-banner"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <strong>{t.bannerTitle}</strong>
      <span className="text-[var(--color-muted)]">{withProvider(login.canSignIn ? t.bannerText : t.onServer, name)}</span>
      {login.canSignIn && <button
        type="button"
        data-testid="provider-login-banner-signin"
        disabled={login.signingIn}
        onClick={login.signIn}
        className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60"
      >
        {login.signingIn ? t.signingIn : t.signIn}
      </button>}
    </div>
  );
}
