"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLocale } from "@/lib/use-locale";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { createClient } from "@/lib/supabase/client";
import { WEB_ACTION_LOG_TEXT } from "@/lib/web-action-log.i18n";
import ActionLogPanel from "@/app/components/ActionLogPanel";

// The person's action log: what the site asked on their behalf. Read-only by
// construction: the page has no write path, and the table has no write policy
// for the person. On the site the browser's own Supabase session reads it (the
// owner's policy picks the rows); a copy running in the person's container has
// no log of its own and says so.
export default function ActionLogPage() {
  const locale = useLocale();
  const t = WEB_ACTION_LOG_TEXT[locale] ?? WEB_ACTION_LOG_TEXT.en;
  const cloud = useIsCloud();
  const client = useMemo(() => (cloud ? createClient() : null), [cloud]);

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">
            {t.title}
          </span>
        </nav>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">
          {t.title}
        </h1>
      </div>
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-4">
        {cloud === null ? (
          <p role="status" className="text-[12px] text-[var(--color-muted)]">
            {t.reading}
          </p>
        ) : (
          <ActionLogPanel client={client} locale={locale} />
        )}
      </div>
    </div>
  );
}
