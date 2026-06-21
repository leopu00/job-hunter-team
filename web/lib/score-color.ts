// Scala colore SOLO-VERDE condivisa tra i pin della mappa e la score
// distribution. Score basso = verde tenue/smorto (recede), score alto = verde
// vivo e saturo (spicca). Niente arancio/rosso. Unica fonte di verità così i
// due grafici combaciano sempre.

const STOPS: Array<[number, [number, number, number]]> = [
  [0, [184, 214, 196]], // verde pallido/smorto
  [40, [143, 202, 168]],
  [70, [52, 201, 127]],
  [100, [0, 232, 122]], // --color-green vivo
];

export function scoreToRgb(score: number | null): [number, number, number] {
  if (score == null) return [150, 180, 165]; // verde-grigio neutro
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [s0, c0] = STOPS[i];
    const [s1, c1] = STOPS[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Colore CSS per uno score 0–100 (null = neutro). */
export function scoreGreenCss(score: number | null): string {
  const [r, g, b] = scoreToRgb(score);
  return `rgb(${r}, ${g}, ${b})`;
}
