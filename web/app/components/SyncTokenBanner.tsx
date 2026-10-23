"use client";

// The band that says a box no longer syncs, or is about to stop, because of its
// sync token (lib/cloud-sync/token-banner.ts). Here, on every page, and not
// only in the token list: on 23/10 a box had been disconnected for 16 days
// and nobody had opened that list.
//
// Same transport as useBoxClient: a direct browser-Supabase read under RLS,
// once at mount, no Vercel invocation. In local mode, or without a session,
// the read gives nothing and the band stays away. It cannot be closed: the
// only way to make it go is to renew the token (or revoke it).

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/use-locale";
import { makeT } from "@/lib/i18n-dict";
import { SYNC_TOKEN_BANNER_T } from "@/lib/sync-token-banner.i18n";
import {
  boxTokenTroubles,
  type BannerTokenRow,
  type BoxTokenTrouble,
} from "@/lib/cloud-sync/token-banner";

export default function SyncTokenBanner() {
  const locale = useLocale();
  const t = makeT(SYNC_TOKEN_BANNER_T, locale);
  const [troubles, setTroubles] = useState<BoxTokenTrouble[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await createClient()
          .from("cloud_sync_tokens")
          .select("name, expires_at, client_seen_at")
          .is("revoked_at", null);
        if (!cancelled)
          setTroubles(boxTokenTroubles((data ?? []) as BannerTokenRow[]));
      } catch {
        /* local mode, offline: no band, which is better than a wrong one */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (troubles.length === 0) return null;
  const first = troubles[0];
  const expired = first.kind === "expired";
  const color = expired ? "var(--color-red)" : "var(--color-yellow)";
  const text = t(expired ? "expired" : "expiring")
    .replace("{name}", first.name)
    .replace("{date}", first.expiresAt.slice(0, 10))
    .replace("{days}", first.kind === "expiring" ? String(first.daysLeft) : "");

  return (
    <div
      className="sticky top-14 z-20 border-b px-4 py-2"
      style={{
        background: `color-mix(in srgb, ${color} 12%, var(--color-panel))`,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
      }}
      role={expired ? "alert" : "status"}
      data-sync-token-banner={first.kind}
    >
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="text-[10px] font-bold tracking-[0.14em] uppercase shrink-0"
          style={{ color }}
        >
          {t(expired ? "expiredLabel" : "expiringLabel")}
        </span>
        <span className="text-[11px] text-[var(--color-muted)] min-w-0">
          {text}
          {troubles.length > 1 ? ` (+${troubles.length - 1})` : ""}
        </span>
        <Link
          href="/settings/cloud-sync"
          className="ml-auto shrink-0 text-[10px] font-semibold tracking-[0.08em] uppercase no-underline px-2.5 py-1 rounded border transition-colors"
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
          }}
        >
          {t("renew")}
        </Link>
      </div>
    </div>
  );
}
