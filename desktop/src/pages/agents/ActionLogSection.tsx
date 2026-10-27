import { useState } from "react";
import ActionLogPanel from "@/app/components/ActionLogPanel";
import type { Locale } from "@/i18n/config";
import type { WebActionLogClient } from "@/lib/web-action-log";
import { WEB_ACTION_LOG_TEXT } from "@/lib/web-action-log.i18n";
import { appLocale } from "../../lib/app-locale";
import { cloudSessionReadable } from "../../lib/auth-storage-lock";

/** What the section reads the log with: the app's session, or nothing when nobody is signed in with an account. */
export async function appLogClient(): Promise<WebActionLogClient | null> {
  // Loaded when the section is opened, not with the panel: the panel does not need the account to show its agents.
  const { supabase, supabaseConfigured } = await import("../../lib/supabase");
  // A locked session storage (a local profile) answers nothing: no account, said at once.
  if (!supabaseConfigured || !cloudSessionReadable()) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? supabase : null;
}

type Source = { kind: "closed" } | { kind: "reading" } | { kind: "ready"; client: WebActionLogClient } | { kind: "no-account" };

/**
 * «Registro delle azioni» in the agents panel: what the site asked on the
 * person's behalf, closed until it is opened (the panel's own reads stay as
 * they were). The rows are the account's own, read with the app's session; a
 * person who works with a local profile has no account and no site, and is told
 * to sign in rather than shown an empty list that would read as «nothing asked».
 */
export default function ActionLogSection({
  locale = appLocale(),
  loadClient = appLogClient,
}: {
  locale?: Locale;
  loadClient?: () => Promise<WebActionLogClient | null>;
}) {
  const t = WEB_ACTION_LOG_TEXT[locale] ?? WEB_ACTION_LOG_TEXT.en;
  const [source, setSource] = useState<Source>({ kind: "closed" });

  const open = (isOpen: boolean) => {
    if (!isOpen || source.kind !== "closed") return;
    setSource({ kind: "reading" });
    loadClient().then(
      (client) => setSource(client ? { kind: "ready", client } : { kind: "no-account" }),
      () => setSource({ kind: "no-account" }),
    );
  };

  return (
    <details
      data-testid="panel-action-log"
      className="mt-4 rounded border border-[var(--color-border)]"
      onToggle={(event) => open(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        {t.title}
      </summary>
      <div className="px-3 pb-3">
        {source.kind === "reading" && (
          <p role="status" className="text-[12px] text-[var(--color-muted)]">
            {t.reading}
          </p>
        )}
        {source.kind === "no-account" && (
          <p data-testid="action-log-no-account" className="text-[12px] text-[var(--color-muted)]">
            {t.signedOut}
          </p>
        )}
        {source.kind === "ready" && <ActionLogPanel client={source.client} locale={locale} />}
      </div>
    </details>
  );
}
