// Scala colore UNICA per gli score (20/07): spettro continuo rosso →
// arancio → ambra → giallo → giallo-verde → verde vivo, interpolato per
// punto. Condivisa da pin del globo, distribuzioni, liste, card e pagine
// team: un 65 e un 73 hanno sfumature visibilmente diverse ovunque.

const SPECTRUM_STOPS: Array<[number, [number, number, number]]> = [
  [0, [225, 55, 70]], // rosso
  [40, [235, 110, 55]], // arancio
  [55, [235, 165, 45]], // ambra
  [65, [210, 195, 50]], // giallo
  [75, [150, 205, 80]], // giallo-verde
  [85, [70, 215, 115]], // verde
  [100, [0, 232, 122]], // verde vivo brand
];

export function scoreToRgb(score: number | null): [number, number, number] {
  if (score == null) return [150, 165, 160]; // grigio-verde neutro
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < SPECTRUM_STOPS.length - 1; i++) {
    const [s0, c0] = SPECTRUM_STOPS[i];
    const [s1, c1] = SPECTRUM_STOPS[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1][1];
}

/** Colore CSS per uno score 0–100 (null = neutro). */
export function scoreGreenCss(score: number | null): string {
  const [r, g, b] = scoreToRgb(score);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Alias esplicito della stessa scala (naming usato dalle liste). */
export function scoreSpectrumCss(score: number | null | undefined): string {
  if (score == null) return "var(--color-dim)";
  return scoreGreenCss(score);
}
