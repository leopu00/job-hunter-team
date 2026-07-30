import { headers } from "next/headers";
import {
  getScoreDistribution,
  getPositionTypeDistribution,
} from "@/lib/queries";
import MapCharts from "@/app/components/MapCharts";
import LockBodyScroll from "./LockBodyScroll";
import { getServerLocale } from "@/lib/server-locale";
import { getDashboardT } from "@/lib/dashboard-i18n";
import {
  getDemoDashboardData,
  isDashboardDemoMode,
} from "@/lib/dashboard-demo";
// [JHT-ONBOARDING-IN-GAME 18/07] Niente più redirect a /onboarding: la
// pagina web è stata rimossa, l'onboarding vive nel wizard del videogioco
// (game/scenes/wizard.tscn). Senza profilo la mappa mostra il globo vuoto,
// come la dashboard mostra stat a zero.

export default async function MapPage() {
  const locale = await getServerLocale();
  const t = getDashboardT(locale);

  const hdrs = await headers();
  const demoMode = isDashboardDemoMode(hdrs.get("x-search"));

  const demoData = demoMode ? getDemoDashboardData() : null;
  // Genera score sintetici per ogni tipo nel demo: distribuiti attorno
  // a una media specifica per tipo, cosi' il filtro donut→histogram e'
  // dimostrabile anche senza dati reali.
  const synthScores = (avg: number, n: number, spread = 12) =>
    Array.from({ length: n }, () => {
      const v = avg + (Math.random() - 0.5) * 2 * spread;
      return Math.max(0, Math.min(100, Math.round(v)));
    });
  // Demo data: usa `family` post-dev2 refactor (data-driven, niente più enum).
  const demoTypeDist = demoMode
    ? [
        {
          family: "AI / ML",
          count: 8,
          color: "var(--color-purple)",
          avgScore: 82,
          avgCritic: null,
          scores: synthScores(82, 8),
        },
        {
          family: "Data",
          count: 15,
          color: "var(--color-blue)",
          avgScore: 63,
          avgCritic: null,
          scores: synthScores(63, 15),
        },
        {
          family: "DevOps / Cloud",
          count: 8,
          color: "var(--color-orange)",
          avgScore: 56,
          avgCritic: null,
          scores: synthScores(56, 8),
        },
        {
          family: "Full-stack",
          count: 6,
          color: "#7fffb2",
          avgScore: 70,
          avgCritic: null,
          scores: synthScores(70, 6),
        },
        {
          family: "Backend",
          count: 7,
          color: "var(--color-yellow)",
          avgScore: 64,
          avgCritic: null,
          scores: synthScores(64, 7),
        },
        {
          family: "Frontend",
          count: 5,
          color: "#58a6ff",
          avgScore: 62,
          avgCritic: null,
          scores: synthScores(62, 5),
        },
        {
          family: "Python",
          count: 15,
          color: "#3776ab",
          avgScore: 68,
          avgCritic: null,
          scores: synthScores(68, 15),
        },
        {
          family: "Software Engineer",
          count: 21,
          color: "var(--color-muted)",
          avgScore: 62,
          avgCritic: null,
          scores: synthScores(62, 21),
        },
        {
          family: "Other",
          count: 2,
          color: "var(--color-dim)",
          avgScore: 55,
          avgCritic: null,
          scores: synthScores(55, 2),
        },
      ]
    : null;
  const [scoreDist, typeDist] = demoData
    ? [demoData.scoreDistribution, demoTypeDist ?? []]
    : await Promise.all([
        getScoreDistribution(),
        getPositionTypeDistribution(),
      ]);

  return (
    <div
      className="map-shell"
      style={{
        position: "relative",
        width: "100%",
        // Body ha zoom: var(--zoom) (1.15): per ottenere "viewport
        // visibile meno navbar" come altezza effettiva del container
        // sotto zoom, divido 100vh per --zoom prima di sottrarre la
        // navbar (3.5rem = h-14 in unita' pre-zoom). Senza questo,
        // position:absolute bottom:24 finisce oltre il bottom della
        // viewport reale.
        height: "calc(100vh / var(--zoom) - 3.5rem)",
        overflow: "hidden",
        animation: "fade-in 0.35s ease both",
      }}
    >
      {/* Blocca lo scroll del documento: /map è full-viewport, lo
          scroll su una card finiva sul documento creando la banda nera.
          (Solo desktop: su mobile la pagina scorre, vedi CSS sotto.) */}
      <LockBodyScroll />
      {/* Scoped reset: chart components hanno wrapper card built-in
          (bg-[var(--color-card)] + border + p-5). In /map li vogliamo
          "bare", solo grafico su sfondo trasparente.

          Layout MOBILE (≤767px, scelta utente 21/07): le 4 card d'angolo
          sovrapposte al globo erano inutilizzabili al tocco (larghe 50vw,
          si coprivano a vicenda). Qui diventano una colonna: globo che
          riempie TUTTO lo spazio disponibile (flex:1) e le 4 barre
          collassabili ancorate in fondo, sopra la barra del browser —
          niente spazio vuoto (rifinitura utente 21/07). Aprire una card
          la espande verso l'alto comprimendo il globo (maplibre segue il
          resize del container); se le card aperte eccedono la viewport
          la colonna scorre internamente (min-height del globo = 30dvh).
          L'altezza NON usa vh/dvh: dentro il contesto zoom (--zoom 1.15)
          Safari scala le unità viewport e Chromium no, quindi qualunque
          formula pura-CSS è giusta su un motore e sbagliata sull'altro
          (era il vuoto ~13% sotto le card su iOS; position:fixed
          bottom:0 finiva invece DIETRO la toolbar di Safari). Si usa
          --map-vh: l'altezza visibile misurata in JS da visualViewport
          (px reali, non ambigui, aggiornata al collasso della toolbar) —
          la setta LockBodyScroll. Le regole sono !important perché
          devono vincere sugli stili inline desktop (position:absolute
          ecc.). Ordine: globo → Location → Score → Tipologie →
          Posizioni. Desktop invariato. */}
      <style>{`
        .map-bare-chart > div:first-child {
          background: transparent !important;
          border-color: transparent !important;
          padding: 0 !important;
        }
        @media (max-width: 767px) {
          .map-shell {
            height: calc(var(--map-vh, 700) / var(--zoom) * 1px - 3.5rem) !important;
            display: flex;
            flex-direction: column;
            overflow-y: auto !important;
            overscroll-behavior: contain;
          }
          .map-globe-layer {
            position: relative !important;
            inset: auto !important;
            flex: 1;
            min-height: 30dvh;
            order: 0;
          }
          .map-float-card {
            position: static !important;
            width: auto !important;
            max-width: none !important;
            margin: 8px 12px 0;
            flex-shrink: 0;
            box-shadow: none !important;
          }
          /* Pannelli nascosti dal toggle in mappa: il globo prende tutto. */
          .map-card-offscreen {
            display: none !important;
          }
          .map-card-location { order: 1; }
          .map-card-score { order: 2; }
          .map-card-donut { order: 3; }
          .map-card-positions {
            order: 4;
            margin-bottom: calc(10px + env(safe-area-inset-bottom));
          }
        }
      `}</style>

      <MapCharts
        typeDist={typeDist}
        fallbackScores={scoreDist.scores ?? []}
        scoreTitle={t.score_distribution}
        emptyLabel={t.no_data}
        // Post-dev2: labels mapping enum→i18n rimosso; family stessa è
        // human-readable (popolata dal team analyst con stringhe libere).
        // Empty object = MapCharts userà la family literal come label.
        labels={{}}
      />
    </div>
  );
}
