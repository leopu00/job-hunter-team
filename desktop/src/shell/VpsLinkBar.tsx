import { useEffect, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { readVpsLinkIdentity, retryVpsLink, useVpsLink, type LinkStatus, type VpsLinkIdentity } from "../lib/vps-link";
import { VPS_LINK_TEXT } from "../lib/vps-link.i18n";

const FAILED: readonly LinkStatus[] = ["network", "application", "version", "blocked"];
const COLORS: Record<LinkStatus, string> = {
  idle: "var(--color-muted)",
  connected: "var(--color-green)",
  reconnecting: "var(--color-yellow, var(--color-muted))",
  network: "var(--color-red)",
  application: "var(--color-red)",
  version: "var(--color-red)",
  blocked: "var(--color-red)",
};

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit" });
}

function copy(value: string) {
  try {
    void navigator.clipboard?.writeText(value)?.catch(() => undefined);
  } catch {
    // no clipboard in this webview: the value stays visible to copy by hand
  }
}

/**
 * The header of the read-only view of an existing team: the link's state with
 * the catalog's sentence and the last working read. Which team (pinned revision
 * and image, copyable) and the error's code are for whoever has to report it:
 * they sit behind «Dettagli tecnici». «Riprova» only where nothing retries by itself;
 * a changed SSH key sends the person back to the setup to look at it again.
 */
export function VpsLinkBar({ onCloseReadOnly }: { onCloseReadOnly?: () => void }) {
  const locale = appLocale();
  const t = VPS_LINK_TEXT[locale];
  const state = useVpsLink();
  const [identity, setIdentity] = useState<VpsLinkIdentity | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void readVpsLinkIdentity().then((value) => { if (live) setIdentity(value); });
    return () => { live = false; };
  }, []);

  const failed = FAILED.includes(state.status);
  const failure = state.code ? describeError(state.code, { locale, fallback: "existing_team_unavailable" }) : null;
  const waiting = state.status === "reconnecting" && state.nextAt !== null
    ? describeError("vps_reconnecting", { locale, resetsAt: Math.ceil(state.nextAt / 1000) })
    : null;
  const label = state.status === "idle" ? t.checking : t[state.status];

  return (
    <div
      data-testid="vps-link-bar"
      data-state={state.status}
      role={failed ? "alert" : "status"}
      className="px-4 py-2 text-[11px] border-b border-[var(--color-border)] flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{ color: failed ? "var(--color-red)" : "var(--color-muted)" }}
    >
      <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS[state.status] }} />
      <strong className="text-[var(--color-bright)]">{label}</strong>
      {state.status === "connected" && state.lastContact !== null && (
        <span data-testid="vps-link-contact">{t.lastContact.replace("{time}", clock(state.lastContact))}</span>
      )}
      {state.status === "reconnecting" && (
        <span data-testid="vps-link-sentence">
          {[waiting && `${waiting.text} ${waiting.action}`, failure?.text].filter(Boolean).join(" ")}
        </span>
      )}
      {failed && failure && (
        <span data-testid="vps-link-sentence">{`${failure.text} ${failure.action}`}</span>
      )}
      {(identity || (failed && state.code)) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="vps-link-details"
          onClick={() => setOpen((value) => !value)}
          className="underline px-2 py-1"
        >
          {t.details}
        </button>
      )}
      {(state.status === "network" || state.status === "application" || state.status === "version") && (
        <button type="button" onClick={retryVpsLink} className="ml-auto underline text-[var(--color-bright)]">{t.retry}</button>
      )}
      {state.status === "blocked" && onCloseReadOnly && (
        <button type="button" onClick={onCloseReadOnly} className="ml-auto underline text-[var(--color-bright)]">{t.reviewKey}</button>
      )}
      {open && (
        <div id="vps-link-details" data-testid="vps-link-details" className="basis-full flex flex-wrap items-center gap-x-4 gap-y-1">
          {failed && state.code && (
            <span data-testid="vps-link-code">{t.errorCode} <code>{state.code}</code></span>
          )}
          {identity && (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="vps-link-identity">
              <span className="flex items-center gap-2">
                {t.revision} <code title={identity.revision}>{identity.revision.slice(0, 7)}</code>
                <button type="button" aria-label={t.copyRevision} onClick={() => copy(identity.revision)} className="underline px-2 py-1">{t.copy}</button>
              </span>
              <span className="flex items-center gap-2">
                {t.image} <code title={identity.digest}>{`${identity.digest.slice(0, 11)}…${identity.digest.slice(-4)}`}</code>
                <button type="button" aria-label={t.copyDigest} onClick={() => copy(identity.digest)} className="underline px-2 py-1">{t.copy}</button>
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
