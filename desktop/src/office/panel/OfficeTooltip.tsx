import { formatRelative } from "@/lib/message-display";
import { publicPositionState, publicPositionStateLabel } from "@/lib/position-state";
import { useLocale } from "@/lib/use-locale";
import type { AgentStatuses, OfficeClick, OfficeLayout, OfficeSnapshot, Vec } from "../contract";
import { fill, ofCount, officeText } from "../office.i18n";
import { tagOf } from "../status";
import { deptName } from "./OfficePanel";

/**
 * The tag under the pointer (D07): the essentials of what is hovered, from
 * what the page already holds (the snapshot, the statuses): no query per
 * move of the mouse. The panel, on click, has the rest.
 */
export type TooltipLines = { title: string; lines: string[] };

export function tooltipFor(
  target: OfficeClick,
  ctx: { layout: OfficeLayout; snapshot: OfficeSnapshot | null; statuses: AgentStatuses | null; locale: string; now?: number },
): TooltipLines {
  const { layout, snapshot, statuses, locale } = ctx;
  const t = officeText(locale);
  const piles = snapshot?.piles;
  switch (target.kind) {
    case "agent": {
      const s = statuses?.agents[target.uid.toLowerCase()];
      const last = snapshot?.transitions.find((t) => t.byAgent === target.uid);
      const lines = [s ? tagOf(s, ctx.now, locale).label : t.tipNotPublished];
      if (last) {
        const state = last.to ? publicPositionStateLabel(publicPositionState(last.to), locale) : "";
        const what = [last.position.title, last.position.company].filter(Boolean).join(" · ");
        lines.push(`${formatRelative(last.ts, locale)}: ${[state, what].filter(Boolean).join(" — ")}`);
      }
      return { title: target.uid.toUpperCase(), lines };
    }
    case "pile":
      return { title: deptName(layout, target.dept), lines: [piles ? ofCount(locale, piles[target.dept] ?? "—", t.tipPile) : t.tipPileNoCount] };
    case "department": {
      const d = layout.departments.find((x) => x.id === target.dept);
      const lines = [d?.tagline ?? ""].filter(Boolean);
      if (piles) lines.push(fill(t.tipIncoming, { count: piles[target.dept] ?? "—" }));
      return { title: deptName(layout, target.dept), lines };
    }
    case "shelf":
    case "printer":
      return { title: t.cvTitle, lines: [piles?.critici != null ? ofCount(locale, piles.critici, t.tipCvReady) : t.tipCvWritten] };
    case "board":
      return { title: t.boardTitle, lines: [t.tipBoard] };
    case "hologram":
      return { title: t.mapTitle, lines: [t.tipMap] };
  }
}

export default function OfficeTooltip(props: {
  target: OfficeClick;
  at: Vec;
  layout: OfficeLayout;
  snapshot: OfficeSnapshot | null;
  statuses: AgentStatuses | null;
}) {
  const locale = useLocale();
  const { title, lines } = tooltipFor(props.target, { ...props, locale });
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-30 max-w-[260px] rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[11px] shadow-xl"
      style={{ left: props.at.x + 14, top: props.at.y + 14 }}
    >
      <div className="font-bold tracking-widest text-[var(--color-white)]">{title}</div>
      {lines.map((l, i) => (
        <div key={i} className="text-[var(--color-muted)]">
          {l}
        </div>
      ))}
    </div>
  );
}
