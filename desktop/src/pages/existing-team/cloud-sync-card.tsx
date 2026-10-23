import { useCallback, useEffect, useRef, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { readExistingTeamCloudSync, type CloudSyncReading } from "../../lib/existing-team-cloud-sync";
import { useRefresh } from "../../shell/router";
import { CLOUD_SYNC_CARD_TEXT } from "./cloud-sync-card.i18n";

function stamp(value: string | number): string {
  return new Date(value).toLocaleString(appLocale(), { dateStyle: "short", timeStyle: "short" });
}

// The statuses of a push that did not go through and is tried again by the box.
const FAILING = new Set(["partial", "timeout", "failed", "signature_unavailable", "other"]);

/**
 * How the box's push to the website is going, read from the team's VPS at each visit and at
 * «Aggiorna». A token the website refuses is said in red with the way to renew it: on 23/10 a box
 * had been refused for 16 days and nothing in the app said so.
 */
export function CloudSyncCard() {
  const t = CLOUD_SYNC_CARD_TEXT[appLocale()];
  const [reading, setReading] = useState<CloudSyncReading | null>(null);
  const latest = useRef(0);

  const read = useCallback(async () => {
    const ticket = ++latest.current;
    const result = await readExistingTeamCloudSync();
    if (ticket === latest.current) setReading(result);
  }, []);

  useEffect(() => {
    void read();
    return () => {
      latest.current++;
    };
  }, [read]);
  useRefresh(() => void read());

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
      if (sync.status === "auth_failed") {
        tone = "var(--color-red)";
        lines = [t.refused, t.refusedAction, last];
      } else if (FAILING.has(sync.status) && sync.consecutiveFailures > 0) {
        tone = "var(--color-yellow)";
        lines = [t.failing.replace("{count}", String(sync.consecutiveFailures)), last];
      } else {
        tone = "var(--color-green)";
        lines = [sync.lastSuccessAt ? t.ok.replace("{time}", stamp(sync.lastSuccessAt)) : t.okNever];
      }
    }
  }
  const refused = reading?.kind === "read" && reading.sync.state === "ok" && reading.sync.status === "auth_failed";

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
    </section>
  );
}
