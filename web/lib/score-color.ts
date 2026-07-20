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

// Scala SPETTRO continua per gli score in lista (scelta utente 20/07):
// rosso → arancio → ambra → giallo-verde → verde vivo, interpolata per
// punto. Un 65 e un 73 hanno sfumature visibilmente diverse — i tre
// scalini fissi verde/giallo/rosso non bastavano.
const SPECTRUM_STOPS: Array<[number, [number, number, number]]> = [
  [0, [225, 55, 70]], // rosso
  [40, [235, 110, 55]], // arancio
  [55, [235, 165, 45]], // ambra
  [65, [210, 195, 50]], // giallo
  [75, [150, 205, 80]], // giallo-verde
  [85, [70, 215, 115]], // verde
  [100, [0, 232, 122]], // verde vivo brand
];

export function scoreSpectrumCss(score: number | null | undefined): string {
  if (score == null) return "var(--color-dim)";
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < SPECTRUM_STOPS.length - 1; i++) {
    const [s0, c0] = SPECTRUM_STOPS[i];
    const [s1, c1] = SPECTRUM_STOPS[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return "rgb(0, 232, 122)";
}
