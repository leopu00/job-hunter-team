import { useCallback, useEffect, useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { useConnectTeam } from "../../lib/connect-team";
import { describeError, errorCodeOf } from "../../lib/error-catalog";
import { vpsLinkStatusBridge, type VpsLinkStatus } from "../../lib/vps-link-status";
import type { PageProps } from "../types";
import { VPS_CONNECTION_TEXT } from "../settings/settings.i18n";

type Reading =
  | { kind: "loading" }
  | { kind: "ready"; status: VpsLinkStatus }
  | { kind: "error"; code: string | null };

/** Do not trust even a native regression to put a whole host address in the DOM. */
export function maskAddress(value: string): string {
  const address = value.trim();
  if (/^\d{1,3}\.\d{1,3}\.xxx\.xxx$/.test(address)) return address;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return `${address.split(".").slice(0, 2).join(".")}.xxx.xxx`;
  if (address.length < 3) return "•••";
  return `${address[0]}…${address.at(-1)}`;
}

/** A declaration is useful for identification, not as a place to echo arbitrary long values. */
export function shortDeclaration(value: string | null, limit = 48): string | null {
  if (!value) return null;
  const plain = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return plain ? (plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain) : null;
}

function when(at: number | null, locale: string, never: string): string {
  if (!at || !Number.isFinite(at) || at <= 0) return never;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at * 1000));
}

export function VpsConnectionScreen() {
  const locale = appLocale();
  const t = VPS_CONNECTION_TEXT[locale];
  const connectTeam = useConnectTeam();
  const [reading, setReading] = useState<Reading>({ kind: "loading" });
  const [retrying, setRetrying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinked, setUnlinked] = useState(false);
  const [operationCode, setOperationCode] = useState<string | null>(null);
  const request = useRef(0);

  const read = useCallback(async () => {
    const mine = ++request.current;
    setReading({ kind: "loading" });
    try {
      const status = await vpsLinkStatusBridge.status();
      if (request.current === mine) setReading({ kind: "ready", status });
    } catch (error) {
      if (request.current === mine) setReading({ kind: "error", code: errorCodeOf(error) });
    }
  }, []);

  useEffect(() => {
    void read();
    return () => { request.current++; };
  }, [read]);

  async function retry() {
    if (!connectTeam || retrying) return;
    setRetrying(true);
    try {
      await connectTeam.reopen();
    } finally {
      await read();
      setRetrying(false);
    }
  }

  async function unlink() {
    if (unlinking) return;
    setUnlinking(true);
    setOperationCode(null);
    try {
      await vpsLinkStatusBridge.unlink();
      connectTeam?.unlinked();
      setUnlinked(true);
      setConfirming(false);
    } catch (error) {
      setOperationCode(errorCodeOf(error));
    } finally {
      setUnlinking(false);
    }
  }

  if (unlinked) {
    return (
      <section className="max-w-3xl mx-auto px-5 py-8 text-[12px]" aria-labelledby="vps-connection-title">
        <h1 id="vps-connection-title" className="text-[16px] font-bold">{t.title}</h1>
        <p className="mt-3" role="status">{t.unlinked}</p>
      </section>
    );
  }

  const status = reading.kind === "ready" ? reading.status : null;
  const errorCode = operationCode ?? (reading.kind === "error" ? reading.code : status?.lastErrorCode ?? null);
  const failure = reading.kind === "error" || errorCode
    ? describeError(errorCode, { fallback: "existing_team_unavailable", locale })
    : null;
  const state = status ? t[status.state] : null;
  const item = (label: string, value: string | null, testId: string) => (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <dt className="text-[11px] text-[var(--color-muted)]">{label}</dt>
      <dd className="m-0 break-words text-[var(--color-bright)]">{value ?? t.notDeclared}</dd>
    </div>
  );

  return (
    <section className="max-w-3xl mx-auto px-5 py-8 text-[12px]" aria-labelledby="vps-connection-title">
      <h1 id="vps-connection-title" className="text-[16px] font-bold">{t.title}</h1>
      <p className="mt-1 text-[var(--color-muted)]">{t.intro}</p>

      {reading.kind === "loading" && <p className="mt-5" role="status">{t.loading}</p>}
      {reading.kind === "error" && (
        <div className="mt-5" role="alert">
          <p>{t.unavailable}</p>
          <p>{failure?.text} {failure?.action}</p>
          {reading.code && <p>{t.lastError}: <code>{reading.code}</code></p>}
        </div>
      )}
      {status && (
        <>
          <dl className="mt-5 grid gap-4 rounded border border-[var(--color-border)] p-4 sm:grid-cols-2">
            {item(t.address, maskAddress(status.addressMasked), "vps-connection-address")}
            {item(t.user, shortDeclaration(status.user), "vps-connection-user")}
            {item(t.fingerprint, shortDeclaration(status.fingerprint, 64) ?? t.noFingerprint, "vps-connection-fingerprint")}
            {item(t.state, state, "vps-connection-state")}
            {item(t.lastOk, when(status.lastOkAt, locale, t.never), "vps-connection-last-ok")}
            {item(t.mode, status.mode === "read" ? t.read : t.full, "vps-connection-mode")}
            {item(t.container, shortDeclaration(status.container), "vps-connection-container")}
            {item(t.image, shortDeclaration(status.image), "vps-connection-image")}
            {item(t.revision, shortDeclaration(status.revision), "vps-connection-revision")}
            {item(t.chat, status.chatReady ? t.chatReady : t.chatNotReady, "vps-connection-chat")}
          </dl>
          <div className="mt-4 rounded border border-[var(--color-border)] px-4 py-3" data-testid="vps-connection-error">
            <p className="m-0 text-[11px] text-[var(--color-muted)]">{t.lastError}</p>
            {failure ? <p className="mt-1 mb-0">{errorCode && <><code>{errorCode}</code> · </>}{failure.text} {failure.action}</p> : <p className="mt-1 mb-0">{t.noError}</p>}
          </div>
        </>
      )}

      {connectTeam && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => void retry()} disabled={retrying || unlinking} className="rounded border border-[var(--color-border)] px-3 py-1.5 font-semibold disabled:opacity-60">
            {retrying ? t.retrying : t.retry}
          </button>
          <button type="button" onClick={() => connectTeam.open()} disabled={unlinking} className="rounded border border-[var(--color-border)] px-3 py-1.5 font-semibold disabled:opacity-60">
            {t.reconnect}
          </button>
          <button type="button" onClick={() => setConfirming(true)} disabled={unlinking} className="rounded border border-[var(--color-border)] px-3 py-1.5 font-semibold text-[var(--color-red)] disabled:opacity-60">
            {t.unlink}
          </button>
        </div>
      )}

      {confirming && (
        <div className="mt-4 rounded border border-[var(--color-border)] p-4" role="dialog" aria-modal="false" aria-labelledby="vps-unlink-title">
          <h2 id="vps-unlink-title" className="text-[13px] font-semibold">{t.unlinkPrompt}</h2>
          <p className="mt-1 text-[var(--color-muted)]">{t.unlinkExplain}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={unlinking} className="rounded border border-[var(--color-border)] px-3 py-1.5 font-semibold">{t.cancel}</button>
            <button type="button" onClick={() => void unlink()} disabled={unlinking} className="rounded border border-[var(--color-border)] px-3 py-1.5 font-semibold text-[var(--color-red)] disabled:opacity-60">
              {unlinking ? t.unlinking : t.confirmUnlink}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function VpsConnectionPage(_props: PageProps) {
  return <VpsConnectionScreen />;
}
