/**
 * Geometria della ciambella e generazione del path SVG di uno spicchio.
 *
 * Condivisa da `PositionTypesDonut` (mappa) e `PositionTypesPie`
 * (dashboard): due grafici con contenuti e props diversi, ma la stessa
 * identica ciambella, che infatti portavano `arc()` e le sue cinque
 * costanti in copia carbone.
 *
 * Le misure sono nello spazio del `viewBox`, non in pixel: i componenti
 * accettano una `size` a piacere e l'SVG scala tutto di conseguenza.
 */
export const SIZE = 130;
export const RADIUS = 52;
export const INNER = 30; // raggio del buco centrale
export const CX = SIZE / 2;
export const CY = SIZE / 2;

/**
 * Path SVG dello spicchio fra due angoli (radianti, 0 = ore 3, orario).
 *
 * Il caso "giro completo" è trattato a parte: un arco di 360° con stesso
 * punto iniziale e finale è degenere e non verrebbe disegnato, quindi lo
 * si compone come due semiarchi, per il bordo esterno e per il buco.
 */
export function arc(startAngle: number, endAngle: number): string {
  const span = endAngle - startAngle;
  if (span >= 2 * Math.PI - 1e-6) {
    const xR = CX + RADIUS;
    const xL = CX - RADIUS;
    const yC = CY;
    const xRi = CX + INNER;
    const xLi = CX - INNER;
    return [
      `M ${xR} ${yC}`,
      `A ${RADIUS} ${RADIUS} 0 1 1 ${xL} ${yC}`,
      `A ${RADIUS} ${RADIUS} 0 1 1 ${xR} ${yC}`,
      `M ${xRi} ${yC}`,
      `A ${INNER} ${INNER} 0 1 0 ${xLi} ${yC}`,
      `A ${INNER} ${INNER} 0 1 0 ${xRi} ${yC}`,
      "Z",
    ].join(" ");
  }
  const x1 = CX + RADIUS * Math.cos(startAngle);
  const y1 = CY + RADIUS * Math.sin(startAngle);
  const x2 = CX + RADIUS * Math.cos(endAngle);
  const y2 = CY + RADIUS * Math.sin(endAngle);
  const xi2 = CX + INNER * Math.cos(endAngle);
  const yi2 = CY + INNER * Math.sin(endAngle);
  const xi1 = CX + INNER * Math.cos(startAngle);
  const yi1 = CY + INNER * Math.sin(startAngle);
  const large = span > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2} ${y2}`,
    `L ${xi2} ${yi2}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${xi1} ${yi1}`,
    "Z",
  ].join(" ");
}
