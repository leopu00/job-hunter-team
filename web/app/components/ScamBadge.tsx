import type { ScamSignals } from "@/lib/scam-signals";

type Props = {
  signals: ScamSignals | null | undefined;
  /** «Sospetto», localised by the caller. */
  label: string;
  /** The reasons, one per line, localised by the caller (tooltip and screen readers). */
  reasons: string;
};

/**
 * The «suspicious» badge of a position (JHT-T06). A warning: the position stays
 * visible. `data-csv-skip` keeps it out of the CSV export, whose title cell is the title.
 */
export default function ScamBadge({ signals, label, reasons }: Props) {
  if (!signals) return null;
  return (
    <span
      data-csv-skip=""
      title={reasons}
      aria-label={`${label}: ${reasons}`}
      className="shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider"
      style={{
        color: "var(--color-orange)",
        borderColor: "color-mix(in srgb, var(--color-orange) 55%, transparent)",
        background: "color-mix(in srgb, var(--color-orange) 10%, transparent)",
      }}
    >
      {label}
    </span>
  );
}
