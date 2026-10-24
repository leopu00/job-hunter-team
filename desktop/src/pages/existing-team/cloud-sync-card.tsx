import { useCallback, useEffect, useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { readExistingTeamCloudSync, type CloudSyncReading } from "../../lib/existing-team-cloud-sync";
import {
  checkCloudToken,
  isSyncToken,
  openCloudTokenSite,
  renewCloudToken,
  type CloudTokenCheck,
  type RenewFailure,
} from "../../lib/existing-team-cloud-token";
import { useRefresh } from "../../shell/router";
import { CLOUD_SYNC_CARD_TEXT } from "./cloud-sync-card.i18n";

function stamp(value: string | number): string {
  return new Date(value).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "short" });
}

// The statuses of a push that did not go through and is tried again by the box.
const FAILING = new Set(["partial", "timeout", "failed", "signature_unavailable", "other"]);

const BUTTON =
  "text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-wait";

/**
 * How the box's push to the website is going, read from the team's VPS at each visit and at
 * «Aggiorna». A token the website refuses is said in red, and one that is about to expire is said
 * before it does, each with the way to renew it from here: on 23/10 a box had been refused for 16
 * days and nothing in the app said so, and the way back was a command on the box. The token is
 * minted on the website (the app never does) and handed to the box by the app: the field holds it
 * only until the box has it, and nothing of it is stored or logged.
 */
export function CloudSyncCard() {
  const t = CLOUD_SYNC_CARD_TEXT[appLocale()];
  const [reading, setReading] = useState<CloudSyncReading | null>(null);
  const [token, setToken] = useState<CloudTokenCheck>({ kind: "unknown" });
  const [secret, setSecret] = useState("");
  const [renewing, setRenewing] = useState(false);
  const [outcome, setOutcome] = useState<{ done: true } | { done: false; failure: RenewFailure } | null>(null);
  const latest = useRef(0);

  const read = useCallback(async () => {
    const ticket = ++latest.current;
    const result = await readExistingTeamCloudSync();
    if (ticket !== latest.current) return;
    setReading(result);
    // The box's own view of its token, asked only when the push state could be read: a team whose
    // image has no such reader, or whose website cannot be reached, simply says nothing more.
    const checked = result.kind === "read" && result.sync.state === "ok" ? await checkCloudToken() : { kind: "unknown" as const };
    if (ticket === latest.current) setToken(checked);
  }, []);

  useEffect(() => {
    void read();
    return () => {
      latest.current++;
    };
  }, [read]);
  useRefresh(() => void read());

  const accepted = token.kind === "fine" || token.kind === "expiring";
  const stalePush = reading?.kind === "read" && reading.sync.state === "ok" && reading.sync.status === "auth_failed" && accepted;
  let tone = "var(--color-muted)";
  let lines: string[] = [t.reading];
  if (reading?.kind === "unsupported") {
    lines = [t.unsupported];
  } else if (reading?.kind === "error") {
    lines = [t.failed.replace("{code}", reading.code)];
  } else if (reading?.kind === "read") {
    const sync = reading.sync;
    if (sync.state === "absent") lines = [t.absent];
    else if (sync.state === "unreadable") lines = [t.unreadable];
    else {
      const last = sync.lastSuccessAt ? t.lastSuccess.replace("{time}", stamp(sync.lastSuccessAt)) : t.lastSuccessNever;
      if (stalePush) {
        // The push still says «refused», but the box's token is accepted by the website now:
        // it was renewed, and the next push is the one that clears this.
        tone = "var(--color-yellow)";
        lines = [t.renewed, last];
      } else if (sync.status === "auth_failed" || token.kind === "expired") {
        tone = "var(--color-red)";
        lines = [t.refused, last];
      } else if (token.kind === "expiring") {
        tone = "var(--color-yellow)";
        lines = [token.daysLeft <= 1 ? t.expiringOne : t.expiring.replace("{days}", String(token.daysLeft)), last];
      } else if (FAILING.has(sync.status) && sync.consecutiveFailures > 0) {
        tone = "var(--color-yellow)";
        lines = [t.failing.replace("{count}", String(sync.consecutiveFailures)), last];
      } else {
        tone = "var(--color-green)";
        lines = [sync.lastSuccessAt ? t.ok.replace("{time}", stamp(sync.lastSuccessAt)) : t.okNever];
      }
    }
  }
  const refused =
    reading?.kind === "read" &&
    reading.sync.state === "ok" &&
    !stalePush &&
    (reading.sync.status === "auth_failed" || token.kind === "expired");
  const renewable = refused || token.kind === "expiring";

  const openSite = async () => {
    const result = await openCloudTokenSite();
    setOutcome(result.ok ? null : { done: false, failure: result.failure });
  };

  const renew = async () => {
    if (renewing || !isSyncToken(secret)) return;
    setRenewing(true);
    setOutcome(null);
    const result = await renewCloudToken(secret);
    setRenewing(false);
    if (result.ok) {
      setSecret("");
      setOutcome({ done: true });
      void read();
    } else {
      setOutcome({ done: false, failure: result.failure });
    }
  };

  return (
    <section
      data-testid="cloud-sync-card"
      role={refused ? "alert" : undefined}
      className="mb-4 rounded-lg border p-3 text-[12px]"
      style={{ borderColor: tone === "var(--color-muted)" ? "var(--color-border)" : tone, background: "var(--color-card)" }}
    >
      <h2 className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
        {t.title}
      </h2>
      {lines.map((line, index) => (
        <p key={index} style={{ color: index === 0 ? tone : "var(--color-muted)" }}>
          {line}
        </p>
      ))}
      {renewable && (
        <form
          data-testid="cloud-token-renew"
          className="mt-2 flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void renew();
          }}
        >
          <p style={{ color: "var(--color-muted)" }}>{t.refusedAction}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BUTTON} onClick={() => void openSite()}>
              {t.openSite}
            </button>
            <label className="flex items-center gap-2" style={{ color: "var(--color-muted)" }}>
              <span>{t.tokenLabel}</span>
              <input
                type="password"
                name="jht-sync-token"
                aria-label={t.tokenLabel}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="jht_sync_…"
                value={secret}
                disabled={renewing}
                onChange={(event) => setSecret(event.target.value)}
                className="w-64 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px]"
              />
            </label>
            <button type="submit" className={BUTTON} disabled={renewing || !isSyncToken(secret)}>
              {renewing ? t.renewing : t.renew}
            </button>
          </div>
        </form>
      )}
      {outcome && (
        <p
          role="status"
          data-testid="cloud-token-outcome"
          className="mt-2"
          style={{ color: outcome.done ? "var(--color-green)" : "var(--color-red)" }}
        >
          {outcome.done ? t.renewed : t.renewFailures[outcome.failure]}
        </p>
      )}
    </section>
  );
}
