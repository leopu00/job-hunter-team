import { appLocale } from "../../lib/app-locale";
import type { AgentUsage } from "../../lib/existing-team-agents";
import type { AgentsPanelText } from "./AgentsPanel.i18n";

/**
 * An agent's health in small: how full its context is and its tokens of the
 * last hour. Short numbers in the list, the whole sentence in the detail and
 * on hover. What the team does not say is «?» / «non so», never 0: a zero is
 * shown only when it was read.
 */

/** A context this full is close to being compacted or cut: it is shown in amber. */
export const CONTEXT_HIGH_PCT = 80;

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

/** 12345 → «12K» where the language shortens thousands, the whole number where it does not. */
export function compactCount(value: number, locale = appLocale()): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function fullCount(value: number, locale = appLocale()): string {
  return new Intl.NumberFormat(locale).format(value);
}

function when(at: number): string {
  return new Date(at).toLocaleTimeString(appLocale(), { timeStyle: "short" });
}

function pct(value: number): string {
  return String(Math.round(value));
}

/** The two short pieces of the list's row: context, then tokens of the hour. */
export function usageShort(t: AgentsPanelText, usage: AgentUsage): [string, string] {
  const context =
    usage.contextPct !== null
      ? fill(t.usageContextShort, { pct: pct(usage.contextPct) })
      : usage.contextTokens !== null
        ? fill(t.usageContextTokensShort, { tokens: compactCount(usage.contextTokens) })
        : t.usageContextUnknownShort;
  const hour = usage.tokensHour !== null ? fill(t.usageHourShort, { tokens: compactCount(usage.tokensHour) }) : t.usageHourUnknownShort;
  return [context, hour];
}

/** The whole sentences, for the detail and the tooltip. */
export function usageLong(t: AgentsPanelText, usage: AgentUsage): [string, string] {
  let context: string;
  if (usage.contextPct !== null && usage.contextTokens !== null && usage.contextWindow !== null) {
    context = fill(t.usageContext, { pct: pct(usage.contextPct), tokens: fullCount(usage.contextTokens), window: fullCount(usage.contextWindow) });
  } else if (usage.contextPct !== null) {
    context = fill(t.usageContextPct, { pct: pct(usage.contextPct) });
  } else if (usage.contextTokens !== null) {
    context = fill(t.usageContextTokens, { tokens: fullCount(usage.contextTokens) });
  } else {
    context = t.usageContextUnknown;
  }
  if (usage.contextAt !== null && (usage.contextPct !== null || usage.contextTokens !== null)) {
    context += ` (${fill(t.usageReadAt, { time: when(usage.contextAt) })})`;
  }
  const hour =
    usage.tokensHour !== null
      ? `${fill(t.usageHour, { tokens: fullCount(usage.tokensHour) })}${usage.tokensAt !== null ? ` (${fill(t.usageCountedAt, { time: when(usage.tokensAt) })})` : ""}`
      : t.usageHourUnknown;
  return [context, hour];
}

function tooltip(t: AgentsPanelText, usage: AgentUsage): string {
  const lines = usageLong(t, usage);
  const unknown = usage.contextPct === null || usage.tokensHour === null;
  return [...lines, ...(usage.tokensHour !== null ? [t.usageHowCounted] : []), ...(unknown ? [t.usageUnknownWhy] : [])].join("\n");
}

const high = (usage: AgentUsage) => usage.contextPct !== null && usage.contextPct >= CONTEXT_HIGH_PCT;

/** Under the state, in the list's row. */
export function UsageShort({ t, usage }: { t: AgentsPanelText; usage: AgentUsage }) {
  const [context, hour] = usageShort(t, usage);
  return (
    // each piece stays whole: a narrow row breaks between the two, never inside a number
    <span data-testid="panel-usage-short" className="block tabular-nums" title={tooltip(t, usage)}>
      <span className="whitespace-nowrap">
        <span style={{ color: high(usage) ? "var(--color-yellow)" : undefined }}>{context}</span> ·
      </span>{" "}
      <span className="whitespace-nowrap">{hour}</span>
    </span>
  );
}

/** In the detail, under the times. */
export function UsageLine({ t, usage }: { t: AgentsPanelText; usage: AgentUsage }) {
  const [context, hour] = usageLong(t, usage);
  return (
    <p data-testid="panel-usage" className="text-[11px] mt-0.5 text-[var(--color-muted)]" title={tooltip(t, usage)}>
      <span style={{ color: high(usage) ? "var(--color-yellow)" : undefined }}>{context}</span> · {hour}
    </p>
  );
}
