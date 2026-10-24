import type { ReactNode } from "react";
import type { AgentUsage } from "../../lib/existing-team-agents";
import type { AgentsPanelText } from "./AgentsPanel.i18n";
import { compactCount, contextHigh, usageTooltip } from "./AgentUsage";

/** Who the agent is, in pieces: the provider, the model and how hard it thinks (null where the session has none). */
export type IdentityParts = { provider: string; model: string | null; effort: string | null };

function Piece({ label, testId, title, children }: { label: string; testId: string; title?: string; children: ReactNode }) {
  return (
    <div data-testid={testId} title={title} className="min-w-0 flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-widest text-[var(--color-dim)]">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-[12px] font-semibold text-[var(--color-bright)]">{children}</dd>
    </div>
  );
}

/**
 * The bar over the terminal: provider, model, how full the context is and what the last hour
 * cost, each under its own label. Only shown, never decided on. What the team does not say is «?»,
 * never 0; the whole sentences (the exact numbers, when they were read) are in the usage's tooltip.
 */
export default function AgentStatusBar({
  t,
  identity,
  identityText,
  usage,
}: {
  t: AgentsPanelText;
  identity: IdentityParts | null;
  identityText: string;
  usage: AgentUsage | null;
}) {
  const pct = usage?.contextPct ?? null;
  const context = pct !== null ? `${Math.round(pct)}%` : usage?.contextTokens != null ? compactCount(usage.contextTokens) : "?";
  const hour = usage?.tokensHour != null ? t.usageHourShort.replace("{tokens}", compactCount(usage.tokensHour)) : t.usageHourUnknownShort;
  const detail = usage ? usageTooltip(t, usage) : undefined;
  return (
    <dl
      data-testid="panel-bar"
      aria-label={t.barLabel}
      className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 border-t px-3 py-2 md:grid-cols-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
    >
      <Piece label={t.barProvider} testId="panel-bar-provider" title={identityText}>
        {identity ? identity.provider : "—"}
      </Piece>
      <Piece label={t.barModel} testId="panel-bar-model" title={identityText}>
        {identity ? [identity.model, identity.effort].filter(Boolean).join(" · ") || "—" : identityText}
      </Piece>
      <Piece label={t.barContext} testId="panel-bar-context" title={detail}>
        <span style={{ color: usage && contextHigh(usage) ? "var(--color-yellow)" : undefined }} className="tabular-nums">
          {context}
        </span>
        {pct !== null && (
          <span
            role="meter"
            aria-label={t.barContext}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            className="mt-1 block h-1 overflow-hidden rounded-full"
            style={{ background: "var(--color-border)" }}
          >
            <span
              className="block h-full"
              style={{
                width: `${Math.min(100, Math.max(0, pct))}%`,
                background: usage && contextHigh(usage) ? "var(--color-yellow)" : "var(--color-green)",
              }}
            />
          </span>
        )}
      </Piece>
      <Piece label={t.barUsage} testId="panel-bar-usage" title={detail}>
        <span className="tabular-nums">{hour}</span>
      </Piece>
    </dl>
  );
}
