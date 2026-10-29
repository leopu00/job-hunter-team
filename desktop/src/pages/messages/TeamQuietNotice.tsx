import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../../lib/app-locale";
import { WEEKDAYS } from "../../lib/team-settings-native";
import { QUIET_AFTER_MS, quietCause, type QuietCause, type QuietFacts } from "./team-quiet";
import { TEAM_QUIET_TEXT } from "./team-quiet.i18n";

/** How often the clock is looked at again, and how often the team is asked again while its silence is being explained. */
export const QUIET_CLOCK_MS = 60_000;
export const QUIET_FACTS_REFRESH_MS = 5 * 60_000;

function weekdayName(locale: Locale, weekday: (typeof WEEKDAYS)[number]): string {
  // 1 January 2024 was a Monday
  const date = new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(weekday)));
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
  } catch {
    return weekday;
  }
}

/** The sentence for a cause, in the person's language. */
export function quietSentence(cause: QuietCause, locale: Locale): string {
  const t = TEAM_QUIET_TEXT[locale];
  switch (cause.kind) {
    case "containment":
      return t.containment;
    case "provider":
      return t.provider;
    case "budget": {
      const { minutes } = cause;
      const when = minutes < 60
        ? t.inMinutes.replace("{n}", String(minutes))
        : t.inHours.replace("{h}", String(Math.floor(minutes / 60))).replace("{m}", String(minutes % 60).padStart(2, "0"));
      return cause.full
        ? t.budgetFull.replace("{when}", when)
        : t.budgetNear.replace("{pct}", String(Math.floor(cause.usagePct))).replace("{when}", when);
    }
    case "outside_hours": {
      const { time, daysAhead, weekday } = cause.opens;
      if (daysAhead <= 0) return t.outsideToday.replace("{time}", time);
      if (daysAhead === 1) return t.outsideTomorrow.replace("{time}", time);
      return t.outsideDay.replace("{day}", weekdayName(locale, weekday)).replace("{time}", time);
    }
  }
}

/**
 * Why the team has not written for a while: said only when the team has been silent for half an hour (`lastAgentAt` is the time of the
 * newest message of any agent, in the seconds the messages carry) and the facts of the team give a reason. With no reason, or no facts,
 * there is nothing on screen: a guess would be one more thing the person cannot trust.
 */
export default function TeamQuietNotice({
  lastAgentAt,
  loadFacts,
  now = Date.now,
}: {
  lastAgentAt: number;
  loadFacts: () => Promise<QuietFacts | null>;
  now?: () => number;
}) {
  const [clock, setClock] = useState(() => now());
  const [facts, setFacts] = useState<QuietFacts | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setClock(now()), QUIET_CLOCK_MS);
    return () => clearInterval(timer);
  }, [now]);

  const silent = lastAgentAt > 0 && clock - lastAgentAt * 1000 > QUIET_AFTER_MS;
  useEffect(() => {
    if (!silent) {
      setFacts(null);
      return;
    }
    let active = true;
    const read = () => {
      loadFacts().then((next) => active && setFacts(next), () => active && setFacts(null));
    };
    read();
    const timer = setInterval(read, QUIET_FACTS_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [silent, loadFacts]);

  const cause = silent && facts ? quietCause(facts, new Date(clock)) : null;
  if (!cause) return null;
  return (
    <div
      role="status"
      data-testid="team-quiet"
      data-cause={cause.kind}
      className="shrink-0 px-4 py-2 border-b border-[var(--color-border)] text-[12px]"
      style={{ color: cause.kind === "containment" || cause.kind === "provider" || (cause.kind === "budget" && cause.full) ? "var(--color-yellow)" : "var(--color-muted)" }}
    >
      {quietSentence(cause, appLocale())}
    </div>
  );
}
