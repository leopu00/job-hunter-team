/**
 * Layout dei quattro pannelli della mappa (Location, Score, Tipi, Posizioni).
 *
 * Sopra RAIL_MAX_WIDTH stanno nei quattro angoli (card fisse 420x250). Sotto,
 * fino a RAIL_MIN_WIDTH (una finestra media, ma anche un Mac a tutto schermo:
 * 1280-1500 px), gli angoli si mangiano mezza mappa e i due pannelli in basso
 * coprono i controlli al centro: con la card larga 420 px e lo zoom 1.15 del
 * corpo pagina i due angoli occupano ~510 px per lato, e la barra dei
 * controlli (~480 px) sta centrata solo se la finestra è larga almeno ~1500.
 * Lì i pannelli diventano UNA colonna a sinistra, a un pannello aperto per
 * volta, e il globo inquadra lo spazio che resta. Sotto RAIL_MIN_WIDTH vale il
 * layout mobile di page.tsx.
 *
 * La media query vive qui, una volta sola: la usano il CSS (page.tsx) e il JS
 * (MapCharts) e non possono divergere.
 */
export const RAIL_MIN_WIDTH = 768;
export const RAIL_MAX_WIDTH = 1599;
export const RAIL_QUERY = `(min-width: ${RAIL_MIN_WIDTH}px) and (max-width: ${RAIL_MAX_WIDTH}px)`;

/**
 * L'app desktop tiene i pannelli nei quattro angoli già da questa larghezza (il web, fino a RAIL_MAX_WIDTH):
 * da 1500 px le due card in basso (420 px, zoom 1.15) lasciano libera la barra dei controlli, e un Mac a
 * schermo intero (1512) ha i quattro filtri agli angoli come il web su uno schermo largo. Sotto, la colonna.
 */
export const DESKTOP_RAIL_MAX_WIDTH = 1499;

let railMaxWidth = RAIL_MAX_WIDTH;

/** Chi ospita la mappa (l'app desktop) sposta il limite superiore della colonna; il web non lo chiama. */
export function setMapRailMaxWidth(width: number): void {
  railMaxWidth = width;
}

/** La media query della colonna in vigore: la usano il CSS (page.tsx) e il JS (MapCharts), una sola. */
export function railQuery(): string {
  return `(min-width: ${RAIL_MIN_WIDTH}px) and (max-width: ${railMaxWidth}px)`;
}

/** Card d'angolo (layout largo), e card della colonna con i suoi margini. */
export const CORNER_CARD_W = 420;
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
function panelsCss(query: string): string {
  return `
        .map-panels { display: contents; }
        @media ${query} {
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
}

export const MAP_PANELS_CSS = panelsCss(RAIL_QUERY);

/** Le regole del rail per il limite in vigore (vedi setMapRailMaxWidth). */
export function mapPanelsCss(): string {
  return railMaxWidth === RAIL_MAX_WIDTH ? MAP_PANELS_CSS : panelsCss(railQuery());
}
