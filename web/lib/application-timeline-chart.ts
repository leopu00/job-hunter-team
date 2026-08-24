import type { ApplicationTimelinePoint } from "./application-timeline";

export type DivergingTimelineScale = {
  maxMagnitude: number;
  ticks: number[];
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
  return {
    maxMagnitude,
    ticks: [...new Set([-maxMagnitude, -half, 0, half, maxMagnitude])],
  };
}

export function projectTimelineY(
  value: number,
  scale: DivergingTimelineScale,
  top: number,
  height: number,
): number {
  return (
    top + ((scale.maxMagnitude - value) / (2 * scale.maxMagnitude)) * height
  );
}
