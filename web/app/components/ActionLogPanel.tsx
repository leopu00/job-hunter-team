"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import {
  readWebActionLog,
  WEB_ACTION_LOG_LIMIT,
  type WebActionLogClient,
  type WebActionLogRead,
} from "@/lib/web-action-log";
import { WEB_ACTION_LOG_TEXT } from "@/lib/web-action-log.i18n";
import ActionLogList from "./ActionLogList";

/**
 * The action log with its own reading: the web page and the desktop's agents
 * panel mount this and give it the client they have (the browser's, the
 * app's). A `null` client is a copy that has no log of its own (the web run
 * inside the person's own container): it says so and reads nothing.
 */
export default function ActionLogPanel({
  client,
  locale,
}: {
  client: WebActionLogClient | null;
  locale: Locale;
}) {
  const t = WEB_ACTION_LOG_TEXT[locale] ?? WEB_ACTION_LOG_TEXT.en;
  const [read, setRead] = useState<WebActionLogRead | null>(null);
  const turn = useRef(0);

  const load = useCallback(async () => {
    if (!client) return;
    const mine = ++turn.current;
    setRead(null);
    const result = await readWebActionLog(client);
    // A slower read that comes back after a newer one started must not overwrite it.
    if (mine === turn.current) setRead(result);
  }, [client]);

  useEffect(() => {
    void load();
    return () => {
      turn.current += 1;
    };
  }, [load]);

  let body;
  if (!client) {
    body = <p className="text-[12px] text-[var(--color-muted)]">{t.localCopy}</p>;
  } else if (read === null) {
    body = (
      <p role="status" className="text-[12px] text-[var(--color-muted)]">
        {t.reading}
      </p>
    );
  } else if (!read.ok) {
    const sentence = { not_active: t.notYet, signed_out: t.signedOut, unavailable: t.unavailable }[read.reason];
    body = (
      <p
        role={read.reason === "unavailable" ? "alert" : "status"}
        data-testid="action-log-reason"
        data-reason={read.reason}
        className="text-[12px] text-[var(--color-muted)]"
      >
        {sentence}
      </p>
    );
  } else if (read.rows.length === 0) {
    body = (
      <p data-testid="action-log-empty" className="text-[12px] text-[var(--color-muted)]">
        {t.empty}
      </p>
    );
  } else {
    body = (
      <>
        <ActionLogList rows={read.rows} locale={locale} />
        {read.rows.length >= WEB_ACTION_LOG_LIMIT && (
          <p className="text-[11px] mt-2 text-[var(--color-dim)]">
            {t.limitNote.replace("{n}", String(WEB_ACTION_LOG_LIMIT))}
          </p>
        )}
      </>
    );
  }

  return (
    <div data-testid="action-log">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[12px] text-[var(--color-muted)] max-w-prose">{t.intro}</p>
        {client && (
          <button
            type="button"
            onClick={() => void load()}
            disabled={read === null}
            className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)] shrink-0 disabled:opacity-50"
          >
            {t.refresh}
          </button>
        )}
      </div>
      {body}
      <p className="text-[11px] mt-3 text-[var(--color-dim)]">{t.footnote}</p>
    </div>
  );
}
