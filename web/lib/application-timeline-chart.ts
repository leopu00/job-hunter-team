import type { ApplicationTimelinePoint } from "./application-timeline";

export type DivergingTimelineScale = {
  maxMagnitude: number;
  /** Quanto asse sotto lo zero: 0 quando nessun giorno ha rifiuti (niente metà vuota). */
  minMagnitude: number;
  ticks: number[];
};

export type TimelineBarLayout = {
  slotWidth: number;
  groupWidth: number;
  barWidth: number;
  gap: number;
};

function niceCeiling(value: number): number {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const nice = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

/** Una sola unità verticale per invii, colloqui e rifiuti. */
export function applicationTimelineScale(
  points: readonly ApplicationTimelinePoint[],
): DivergingTimelineScale {
  const maxMagnitude = niceCeiling(
    Math.max(
      1,
      ...points.flatMap((point) => [
        point.submitted,
        point.accepted,
        point.rejected,
      ]),
    ),
  );
  const half = Math.ceil(maxMagnitude / 2);
  // Senza rifiuti la metà sotto lo zero resterebbe vuota: l'asse parte da 0.
  const hasRejections = points.some((point) => point.rejected > 0);
  const minMagnitude = hasRejections ? maxMagnitude : 0;
  return {
    maxMagnitude,
    minMagnitude,
    ticks: [
      ...new Set(
        hasRejections
          ? [-maxMagnitude, -half, 0, half, maxMagnitude]
          : [0, half, maxMagnitude],
      ),
    ],
  };
}

export function projectTimelineY(
  value: number,
  scale: DivergingTimelineScale,
  top: number,
  height: number,
): number {
  return (
    top +
    ((scale.maxMagnitude - value) / (scale.maxMagnitude + scale.minMagnitude)) *
      height
  );
}

/** Mantiene tre barre leggibili e contenute nello slot di ogni giorno. */
export function applicationTimelineBarLayout(
  pointCount: number,
  chartWidth: number,
): TimelineBarLayout {
  const slotWidth = chartWidth / Math.max(1, pointCount);
  const groupWidth = Math.min(34, slotWidth * 0.72);
  const gap = Math.min(2, slotWidth * 0.06);
  return {
    slotWidth,
    groupWidth,
    gap,
    barWidth: Math.max(1.5, (groupWidth - gap * 2) / 3),
  };
}
