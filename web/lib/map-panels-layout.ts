/**
 * Layout dei quattro pannelli della mappa (Location, Score, Tipi, Posizioni).
 *
 * Sopra RAIL_MAX_WIDTH stanno nei quattro angoli (card fisse 420x250). In una
 * finestra media (RAIL_MIN_WIDTH..RAIL_MAX_WIDTH, un Mac con la finestra non
 * a tutto schermo) gli angoli si mangiano mezza mappa e il pannello in basso a
 * sinistra copre i controlli al centro: lì i pannelli diventano UNA colonna a
 * sinistra, a un pannello aperto per volta, e il globo inquadra lo spazio che
 * resta. Sotto RAIL_MIN_WIDTH vale il layout mobile di page.tsx.
 *
 * La media query vive qui, una volta sola: la usano il CSS (page.tsx) e il JS
 * (MapCharts) e non possono divergere.
 */
export const RAIL_MIN_WIDTH = 768;
export const RAIL_MAX_WIDTH = 1279;
export const RAIL_QUERY = `(min-width: ${RAIL_MIN_WIDTH}px) and (max-width: ${RAIL_MAX_WIDTH}px)`;

/** Larghezza massima di una card, e margini della colonna. */
export const RAIL_CARD_W = 360;
export const RAIL_SIDE = 24;
export const RAIL_TOP = 24;
/** Sopra la barra dei controlli in basso (zoom, filtri), alta ~44 + 24. */
export const RAIL_BOTTOM = 80;
/** La colonna prende al massimo questa quota della mappa. */
const RAIL_MAX_SHARE = 0.4;

export function railWidth(containerWidth: number): number {
  return Math.min(RAIL_CARD_W, Math.round(containerWidth * RAIL_MAX_SHARE));
}

/** Spazio a sinistra che la colonna toglie al globo (px), per fitBounds. */
export function railClearance(containerWidth: number): number {
  return railWidth(containerWidth) + RAIL_SIDE + 16;
}

/**
 * Regole CSS del rail. `.map-panels` è `display: contents` (le card restano
 * assolute negli angoli, o in colonna col layout mobile) finché la finestra
 * non entra nella fascia media: lì diventa la colonna. !important perché
 * devono vincere sugli stili inline delle card.
 */
export const MAP_PANELS_CSS = `
        .map-panels { display: contents; }
        @media ${RAIL_QUERY} {
          .map-panels {
            display: flex;
            flex-direction: column;
            gap: 8px;
            position: absolute;
            z-index: 10;
            top: ${RAIL_TOP}px;
            left: ${RAIL_SIDE}px;
            bottom: ${RAIL_BOTTOM}px;
            width: min(${RAIL_CARD_W}px, ${RAIL_MAX_SHARE * 100}%);
            overflow-y: auto;
            overscroll-behavior: contain;
            /* Lo spazio vuoto sotto le card lascia passare i gesti al globo. */
            pointer-events: none;
          }
          .map-panels .map-float-card {
            position: static !important;
            width: auto !important;
            max-width: none !important;
            flex: 0 0 auto;
            pointer-events: auto;
          }
          .map-panels .map-card-location { order: 1; }
          .map-panels .map-card-score { order: 2; }
          .map-panels .map-card-donut { order: 3; }
          .map-panels .map-card-positions { order: 4; }
        }
`;
