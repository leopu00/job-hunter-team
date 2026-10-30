import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import type { DashboardStats } from "../../../web/lib/types";
import { appLocale } from "../lib/app-locale";
import { cloudClient } from "../lib/cloud-client";
import { getDashboardStats } from "../lib/dashboard-data";
import {
  awayCounts,
  awaySentence,
  awaySince,
  HEARTBEAT_MS,
  loadSnapshot,
  saveSnapshot,
  worthSaving,
  type Away,
  type AwayCounts,
} from "../lib/away-greeting";
import { AWAY_GREETING_TEXT } from "../lib/away-greeting.i18n";
import { existingTeamConnectionKey, useExistingTeamView } from "../lib/existing-team-readonly";
import { readDesktopVpsStats } from "../lib/existing-team-positions";
import { useLocalTeamData } from "../lib/local-team-data";
import { withReadDeadline } from "../lib/read-deadline";
import Link from "../web-shims/next-link";
import { useCloudDataBlocked } from "./CloudDataNotice";

export type StatsReader = () => Promise<DashboardStats | null>;

/** From the team's own database (a VPS, or this computer's team): the native read says no when it cannot. */
const readTeamStats: StatsReader = async () => {
  const reply = await readDesktopVpsStats();
  return reply.source === "vps" ? reply.data.stats : null;
};

/** From the signed-in account's cloud. */
const readCloudStats: StatsReader = () => getDashboardStats(cloudClient());

/**
 * A strip, once, on coming back: «While you were away: 5 new positions, 3 evaluated and 1 CV or letter ready», with
 * the links to the pages. It compares the dashboard's numbers now with the ones saved the last time the app was seen
 * (saved at the start and every few minutes, so a closed window leaves a recent one), says only what went up, and
 * only after at least `AWAY_MINUTES`. A click closes it and nothing brings it back until the app is opened again.
 * Nothing is asked of the team that the dashboard does not ask already, and nothing native is added.
 */
export function AwayGreeting({
  identityKey,
  readStats,
  now = Date.now,
  locale: localeOverride,
}: {
  identityKey: string;
  /** Where the numbers come from; the default is the one the dashboard uses for the person's data. */
  readStats?: StatsReader;
  now?: () => number;
  locale?: Locale;
}) {
  const locale = localeOverride ?? appLocale();
  const text = AWAY_GREETING_TEXT[locale];
  const viaTeam = useExistingTeamView() !== null;
  // This computer's team, read as the pages read it (a profile with no cloud account), or a profile with no cloud session at all:
  // the team's own database answers, and when that read cannot answer there is no greeting.
  const local = useLocalTeamData();
  const blocked = useCloudDataBlocked();
  const source = viaTeam ? `team:${existingTeamConnectionKey() ?? ""}` : local || blocked ? "team:local" : "cloud";
  const key = `${identityKey}|${source}`;
  const reader = readStats ?? (viaTeam || local || blocked ? readTeamStats : readCloudStats);
  const readerRef = useRef(reader);
  readerRef.current = reader;
  const nowRef = useRef(now);
  nowRef.current = now;
  const [away, setAway] = useState<Away | null>(null);

  useEffect(() => {
    let live = true;
    let last: AwayCounts | null = null;
    const visit = async (first: boolean) => {
      let stats: DashboardStats | null = null;
      try {
        stats = await withReadDeadline(readerRef.current());
      } catch {
        return;
      }
      if (!live || !stats) return;
      const counts = awayCounts(stats);
      const previous = loadSnapshot(key);
      if (first) {
        const found = awaySince(previous, counts, nowRef.current());
        if (found) setAway(found);
      }
      if (worthSaving(previous, counts)) {
        last = counts;
        saveSnapshot(key, { at: nowRef.current(), counts });
      }
    };
    void visit(true);
    const timer = setInterval(() => void visit(false), HEARTBEAT_MS);
    // closing the window: the last reading, with the time it was closed
    const leaving = () => {
      if (last) saveSnapshot(key, { at: nowRef.current(), counts: last });
    };
    window.addEventListener("pagehide", leaving);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("pagehide", leaving);
    };
  }, [key]);

  if (!away) return null;
  return (
    <div
      role="status"
      aria-label={text.intro}
      data-testid="away-greeting"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <strong>{awaySentence(locale, away)}</strong>
      <Link href="/positions" className="underline text-[11px]" onClick={() => setAway(null)}>
        {text.seePositions}
      </Link>
      <Link href="/dashboard" className="underline text-[11px]" onClick={() => setAway(null)}>
        {text.seeDashboard}
      </Link>
      <button
        type="button"
        className="ml-auto px-3 py-1 rounded border border-[var(--color-border)] text-[11px]"
        onClick={() => setAway(null)}
      >
        {text.close}
      </button>
    </div>
  );
}
