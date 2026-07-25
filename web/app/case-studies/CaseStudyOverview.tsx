"use client";

// Vetrina pubblica del case study: le sezioni "ricche" (match, geografia,
// categorie). Tutto da dati aggregati e anonimi dello snapshot. Tooltip isolato
// condiviso (ChartTooltip) → nessun jitter all'hover.

import { Fragment, useMemo, useRef } from "react";
import type { CaseStudyRun } from "@/lib/case-study";
import {
  TooltipLayer,
  type TipRow,
  type TooltipHandle,
} from "@/app/components/ChartTooltip";
import europeOutline from "@/data/case-studies/europe-outline.json";
import ScoreDistribution from "@/app/components/ScoreDistribution";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import { intlTag } from "@/lib/locale-tag";

const T: Record<
  Locale,
  {
    matchLabel: string;
    matchIntro: string;
    matchMedio: (n: string) => string;
    matchForti: string;
    eccellenti: string;
    scoreDistTitle: string;
    noScore: string;
    matchFortiThreshold: string;
    whereLabel: string;
    whereIntro: (geo: string, np: number, nc: number) => React.ReactNode;
    topCountries: string;
    rolesLabel: string;
    rolesIntro: (n: number) => string;
    positionsFound: string;
    otherCategories: (n: number) => string;
    positions: string;
    colCount: string;
    colShare: string;
    colAvgScore: string;
  }
> = {
  it: {
    matchLabel: "🎯 Quanto bene ti trova lavoro",
    matchIntro:
      "Ogni posizione viene valutata 0–100 su quanto calza al profilo del candidato. Più alto è il punteggio, più forte è il match.",
    matchMedio: (n) => `match medio · ${n} valutate`,
    matchForti: "match forti · score ≥ 70",
    eccellenti: "eccellenti · score ≥ 80",
    scoreDistTitle: "Distribuzione dei punteggi",
    noScore: "Nessun punteggio disponibile",
    matchFortiThreshold: "match forti ≥70",
    whereLabel: "🗺️ Dove cerca lavoro · Europa",
    whereIntro: (geo, np, nc) => (
      <>
        {geo} posizioni geolocalizzate in{" "}
        <strong className="text-[var(--color-muted)]">{np} paesi</strong> e{" "}
        <strong className="text-[var(--color-muted)]">{nc} città</strong>. La
        dimensione del cerchio = numero di posizioni. Solo posizioni{" "}
        <strong className="text-[var(--color-muted)]">
          verificate e lavorabili
        </strong>{" "}
        per il candidato (escluse quelle non compatibili con i requisiti di
        lavoro, es. cittadinanza/visto).
      </>
    ),
    topCountries: "Top paesi",
    rolesLabel: "🧩 Che tipo di ruoli",
    rolesIntro: (n) =>
      `${n} categorie di ruolo emerse automaticamente dai dati, senza liste predefinite — il team capisce da solo che tipo di lavoro fa per te.`,
    positionsFound: "POSIZIONI TROVATE",
    otherCategories: (n) => `Altre ${n} categorie`,
    positions: "posizioni",
    colCount: "Posizioni",
    colShare: "Quota",
    colAvgScore: "Media score",
  },
  en: {
    matchLabel: "🎯 How well it finds you work",
    matchIntro:
      "Each position is scored 0–100 on how well it fits the candidate's profile. The higher the score, the stronger the match.",
    matchMedio: (n) => `average match · ${n} scored`,
    matchForti: "strong matches · score ≥ 70",
    eccellenti: "excellent · score ≥ 80",
    scoreDistTitle: "Score distribution",
    noScore: "No score available",
    matchFortiThreshold: "strong matches ≥70",
    whereLabel: "🗺️ Where it looks for work · Europe",
    whereIntro: (geo, np, nc) => (
      <>
        {geo} geolocated positions in{" "}
        <strong className="text-[var(--color-muted)]">{np} countries</strong>{" "}
        and <strong className="text-[var(--color-muted)]">{nc} cities</strong>.
        The size of the circle = number of positions. Only{" "}
        <strong className="text-[var(--color-muted)]">
          verified and workable
        </strong>{" "}
        positions for the candidate (excluding those incompatible with the work
        requirements, e.g. citizenship/visa).
      </>
    ),
    topCountries: "Top countries",
    rolesLabel: "🧩 What kind of roles",
    rolesIntro: (n) =>
      `${n} role categories that emerged automatically from the data, with no predefined lists — the team figures out on its own what kind of work it does for you.`,
    positionsFound: "POSITIONS FOUND",
    otherCategories: (n) => `${n} more categories`,
    positions: "positions",
    colCount: "Positions",
    colShare: "Share",
    colAvgScore: "Avg score",
  },
  es: {
    matchLabel: "🎯 Lo bien que te encuentra trabajo",
    matchIntro:
      "Cada posición se valora de 0 a 100 según lo bien que encaja con el perfil del candidato. Cuanto más alta es la puntuación, más fuerte es la coincidencia.",
    matchMedio: (n) => `coincidencia media · ${n} valoradas`,
    matchForti: "coincidencias fuertes · score ≥ 70",
    eccellenti: "excelentes · score ≥ 80",
    scoreDistTitle: "Distribución de puntuaciones",
    noScore: "Sin puntuación disponible",
    matchFortiThreshold: "coincidencias fuertes ≥70",
    whereLabel: "🗺️ Dónde busca trabajo · Europa",
    whereIntro: (geo, np, nc) => (
      <>
        {geo} posiciones geolocalizadas en{" "}
        <strong className="text-[var(--color-muted)]">{np} países</strong> y{" "}
        <strong className="text-[var(--color-muted)]">{nc} ciudades</strong>. El
        tamaño del círculo = número de posiciones. Solo posiciones{" "}
        <strong className="text-[var(--color-muted)]">
          verificadas y trabajables
        </strong>{" "}
        para el candidato (excluidas las no compatibles con los requisitos de
        trabajo, p. ej. ciudadanía/visado).
      </>
    ),
    topCountries: "Países principales",
    rolesLabel: "🧩 Qué tipo de roles",
    rolesIntro: (n) =>
      `${n} categorías de roles surgidas automáticamente de los datos, sin listas predefinidas — el equipo entiende por sí solo qué tipo de trabajo hace para ti.`,
    positionsFound: "POSICIONES ENCONTRADAS",
    otherCategories: (n) => `Otras ${n} categorías`,
    positions: "posiciones",
    colCount: "Posiciones",
    colShare: "Cuota",
    colAvgScore: "Media score",
  },
  fr: {
    matchLabel: "🎯 À quel point il vous trouve du travail",
    matchIntro:
      "Chaque poste est noté de 0 à 100 selon son adéquation avec le profil du candidat. Plus la note est élevée, plus la correspondance est forte.",
    matchMedio: (n) => `correspondance moyenne · ${n} notés`,
    matchForti: "fortes correspondances · score ≥ 70",
    eccellenti: "excellents · score ≥ 80",
    scoreDistTitle: "Distribution des scores",
    noScore: "Aucun score disponible",
    matchFortiThreshold: "fortes correspondances ≥70",
    whereLabel: "🗺️ Où il cherche du travail · Europe",
    whereIntro: (geo, np, nc) => (
      <>
        {geo} postes géolocalisés dans{" "}
        <strong className="text-[var(--color-muted)]">{np} pays</strong> et{" "}
        <strong className="text-[var(--color-muted)]">{nc} villes</strong>. La
        taille du cercle = nombre de postes. Uniquement les postes{" "}
        <strong className="text-[var(--color-muted)]">
          vérifiés et exploitables
        </strong>{" "}
        pour le candidat (hors ceux non compatibles avec les exigences de
        travail, p. ex. citoyenneté/visa).
      </>
    ),
    topCountries: "Principaux pays",
    rolesLabel: "🧩 Quel type de rôles",
    rolesIntro: (n) =>
      `${n} catégories de rôles apparues automatiquement à partir des données, sans listes prédéfinies — l'équipe comprend d'elle-même quel type de travail elle fait pour vous.`,
    positionsFound: "POSTES TROUVÉS",
    otherCategories: (n) => `${n} autres catégories`,
    positions: "postes",
    colCount: "Postes",
    colShare: "Part",
    colAvgScore: "Score moyen",
  },
  de: {
    matchLabel: "🎯 Wie gut es Arbeit für dich findet",
    matchIntro:
      "Jede Stelle wird von 0–100 danach bewertet, wie gut sie zum Profil des Kandidaten passt. Je höher der Punktwert, desto stärker die Übereinstimmung.",
    matchMedio: (n) => `durchschnittliche Übereinstimmung · ${n} bewertet`,
    matchForti: "starke Übereinstimmungen · Score ≥ 70",
    eccellenti: "exzellent · Score ≥ 80",
    scoreDistTitle: "Punkteverteilung",
    noScore: "Kein Score verfügbar",
    matchFortiThreshold: "starke Übereinstimmungen ≥70",
    whereLabel: "🗺️ Wo es nach Arbeit sucht · Europa",
    whereIntro: (geo, np, nc) => (
      <>
        {geo} geolokalisierte Stellen in{" "}
        <strong className="text-[var(--color-muted)]">{np} Ländern</strong> und{" "}
        <strong className="text-[var(--color-muted)]">{nc} Städten</strong>. Die
        Größe des Kreises = Anzahl der Stellen. Nur{" "}
        <strong className="text-[var(--color-muted)]">
          verifizierte und bearbeitbare
        </strong>{" "}
        Stellen für den Kandidaten (ausgenommen jene, die mit den
        Arbeitsanforderungen nicht vereinbar sind, z. B.
        Staatsbürgerschaft/Visum).
      </>
    ),
    topCountries: "Top-Länder",
    rolesLabel: "🧩 Welche Art von Rollen",
    rolesIntro: (n) =>
      `${n} Rollenkategorien, die automatisch aus den Daten entstanden sind, ohne vordefinierte Listen — das Team versteht von selbst, welche Art von Arbeit es für dich erledigt.`,
    positionsFound: "GEFUNDENE STELLEN",
    otherCategories: (n) => `${n} weitere Kategorien`,
    positions: "Stellen",
    colCount: "Stellen",
    colShare: "Anteil",
    colAvgScore: "Ø Score",
  },
  hu: {
    matchLabel: "🎯 Mennyire jól talál neked munkát",
    matchIntro:
      "Minden állást 0–100 között értékelünk aszerint, mennyire illik a jelölt profiljához. Minél magasabb a pontszám, annál erősebb az egyezés.",
    matchMedio: (n) => `átlagos egyezés · ${n} értékelve`,
    matchForti: "erős egyezések · score ≥ 70",
    eccellenti: "kiválóak · score ≥ 80",
    scoreDistTitle: "Pontszámeloszlás",
    noScore: "Nincs elérhető pontszám",
    matchFortiThreshold: "erős egyezések ≥70",
    whereLabel: "🗺️ Hol keres munkát · Európa",
    whereIntro: (geo, np, nc) => (
      <>
        {geo} földrajzilag bemért állás{" "}
        <strong className="text-[var(--color-muted)]">{np} országban</strong> és{" "}
        <strong className="text-[var(--color-muted)]">{nc} városban</strong>. A
        kör mérete = az állások száma. Csak a jelölt számára{" "}
        <strong className="text-[var(--color-muted)]">
          ellenőrzött és vállalható
        </strong>{" "}
        állások (kizárva azokat, amelyek nem felelnek meg a munkavégzési
        követelményeknek, pl. állampolgárság/vízum).
      </>
    ),
    topCountries: "Vezető országok",
    rolesLabel: "🧩 Milyen típusú szerepkörök",
    rolesIntro: (n) =>
      `${n} szerepkör-kategória, amely automatikusan, előre megadott listák nélkül emelkedett ki az adatokból — a csapat magától érti meg, milyen munkát végez érted.`,
    positionsFound: "TALÁLT ÁLLÁSOK",
    otherCategories: (n) => `Még ${n} kategória`,
    positions: "állások",
    colCount: "Állások",
    colShare: "Arány",
    colAvgScore: "Átlag pont",
  },
  pt: {
    matchLabel: "🎯 Quão bem encontra trabalho para si",
    matchIntro:
      "Cada vaga é pontuada de 0 a 100 conforme se encaixa no perfil do candidato. Quanto mais alta a pontuação, mais forte a correspondência.",
    matchMedio: (n) => `correspondência média · ${n} avaliadas`,
    matchForti: "correspondências fortes · score ≥ 70",
    eccellenti: "excelentes · score ≥ 80",
    scoreDistTitle: "Distribuição de pontuações",
    noScore: "Nenhuma pontuação disponível",
    matchFortiThreshold: "correspondências fortes ≥70",
    whereLabel: "🗺️ Onde procura trabalho · Europa",
    whereIntro: (geo, np, nc) => (
      <>
        {geo} vagas geolocalizadas em{" "}
        <strong className="text-[var(--color-muted)]">{np} países</strong> e{" "}
        <strong className="text-[var(--color-muted)]">{nc} cidades</strong>. O
        tamanho do círculo = número de vagas. Apenas vagas{" "}
        <strong className="text-[var(--color-muted)]">
          verificadas e viáveis
        </strong>{" "}
        para o candidato (excluídas as não compatíveis com os requisitos de
        trabalho, ex. cidadania/visto).
      </>
    ),
    topCountries: "Principais países",
    rolesLabel: "🧩 Que tipo de funções",
    rolesIntro: (n) =>
      `${n} categorias de função surgidas automaticamente dos dados, sem listas predefinidas — a equipa percebe sozinha que tipo de trabalho faz por si.`,
    positionsFound: "VAGAS ENCONTRADAS",
    otherCategories: (n) => `Mais ${n} categorias`,
    positions: "vagas",
    colCount: "Vagas",
    colShare: "Quota",
    colAvgScore: "Média score",
  },
};

const BLUE = "#2196f3";
const GREEN = "#00e676";
const DIM = "#3a4a5a";
const CAT_COLORS = [
  "#2196f3",
  "#00e676",
  "#b388ff",
  "#ffd600",
  "#ff6ac1",
  "#26c6da",
  "#ff9800",
  "#9ccc65",
  "#7e57c2",
  "#4dd0e1",
];

// Griglia UNICA condivisa da header e tutte le righe della tabella categorie:
// nome · quantità · quota% · media score. Le colonne auto si dimensionano sul
// contenuto più largo di TUTTA la colonna (un solo grid → numeri incolonnati e
// barre score con la stessa baseline a sinistra). Lo score prende lo spazio
// residuo (1fr) così le barre sono lunghe e confrontabili.
const CAT_GRID = "auto auto auto minmax(8rem,1fr)";

// ISO2 → emoji bandiera.
function flag(cc: string): string {
  const c = (cc || "").toUpperCase();
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return "🏳️";
  return String.fromCodePoint(
    ...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

function nf(n: number, tag: string): string {
  return n.toLocaleString(tag);
}

/* ── Proiezione Europa (bounding box, equirettangolare) ───────────── */
const EU = { lonMin: -11, lonMax: 31, latMin: 34, latMax: 63 };
function projectEU(lat: number, lon: number, w: number, h: number) {
  const x = ((lon - EU.lonMin) / (EU.lonMax - EU.lonMin)) * w;
  const y = ((EU.latMax - lat) / (EU.latMax - EU.latMin)) * h;
  return { x, y };
}

export default function CaseStudyOverview({ run }: { run: CaseStudyRun }) {
  const locale = useLocale();
  const t = T[locale] ?? T.it;
  const tag = intlTag(locale);
  const tipRef = useRef<TooltipHandle>(null);
  const showTip = (e: React.MouseEvent, title: string, rows: TipRow[]) =>
    tipRef.current?.show(e.clientX, e.clientY, title, rows);
  const moveTip = (e: React.MouseEvent) =>
    tipRef.current?.move(e.clientX, e.clientY);
  const hideTip = () => tipRef.current?.hide();

  const { match, cities, countries, categories } = run;

  // ── Categorie: top 8 + "Altre" ──
  // avg = media score della famiglia; per "Altre" è la media PESATA sulle
  // scorate (Σ avg·scored / Σ scored), così l'aggregato non distorce.
  const catView = useMemo(() => {
    const sorted = [...categories].sort((a, b) => b.count - a.count);
    const top = sorted.slice(0, 8);
    const rest = sorted.slice(8);
    const items: {
      name: string;
      count: number;
      color: string;
      avg: number | null;
    }[] = top.map((c, i) => ({
      name: c.name,
      count: c.count,
      color: CAT_COLORS[i % CAT_COLORS.length],
      avg: c.avg ?? null,
    }));
    if (rest.length) {
      const restN = rest.reduce((s, c) => s + c.count, 0);
      const wSum = rest.reduce((s, c) => s + (c.avg ?? 0) * (c.scored ?? 0), 0);
      const sSum = rest.reduce((s, c) => s + (c.scored ?? 0), 0);
      items.push({
        name: t.otherCategories(rest.length),
        count: restN,
        color: DIM,
        avg: sSum > 0 ? Math.round((wSum / sSum) * 10) / 10 : null,
      });
    }
    const total = items.reduce((s, c) => s + c.count, 0) || 1;
    return { items, total };
  }, [categories, t]);

  // ── Distribuzione score: max per scalare le barre ──
  const maxCity = Math.max(1, ...cities.map((c) => c.count));
  const maxCountry = Math.max(1, ...countries.map((c) => c.count));
  const topCountries = countries.slice(0, 8);
  const mapW = 520;
  const mapH = 540;

  // Coste europee (outline pre-semplificato) proiettate sullo stesso box.
  const landPaths = useMemo(
    () =>
      (europeOutline.rings as number[][][]).map(
        (ring) =>
          ring
            .map(([lon, lat], i) => {
              const { x, y } = projectEU(lat, lon, mapW, mapH);
              return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ") + " Z",
      ),
    [mapW, mapH],
  );

  // Etichette città (solo le grandi) con anti-collisione verticale: se due
  // cadono vicine (es. Zurigo/Ginevra), la seconda va sotto la bolla.
  const cityLabels = useMemo(() => {
    // Etichetta le città più grandi (top N), non con una soglia assoluta: i
    // profili a coda lunga (full-remote, molte città da poche posizioni — es.
    // beta-2 con la città top a 11) non supererebbero una soglia fissa e la
    // mappa resterebbe senza nomi. Floor a 2 per non etichettare i singoli;
    // l'anti-collisione qui sotto gestisce le sovrapposizioni.
    const MAX_LABELS = 7;
    const labeled = [...cities]
      .filter((c) => c.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_LABELS);
    const placed: { x: number; y: number }[] = [];
    const collide = (x: number, y: number) =>
      placed.some((p) => Math.abs(p.x - x) < 56 && Math.abs(p.y - y) < 13);
    return labeled.map((c) => {
      const { x, y } = projectEU(c.lat, c.lon, mapW, mapH);
      const r = 4 + 22 * Math.sqrt(c.count / maxCity);
      let ly = y - r - 4;
      if (collide(x, ly)) ly = y + r + 12;
      if (collide(x, ly)) ly = y - r - 17;
      placed.push({ x, y: ly });
      return { city: c.city, x, y: ly };
    });
  }, [cities, maxCity, mapW, mapH]);

  // Donut categorie (archi)
  const R = 62;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = catView.items.map((it) => {
    const frac = it.count / catView.total;
    const a = { ...it, frac, start: acc, pct: Math.round(frac * 100) };
    acc += frac;
    return a;
  });

  return (
    <div className="flex flex-col gap-12">
      {/* ════════ IL MATCH ═══════════════════════════ (order-2) ═══ */}
      <section id="cs-match" data-cs-anchor="match" className="order-2">
        <div className="section-label mb-1">{t.matchLabel}</div>
        <p className="text-[11px] text-[var(--color-dim)] mb-4">
          {t.matchIntro}
        </p>

        {/* Callout sintetici */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <div className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none">
              {Math.round(match.avg)}
              <span className="text-[var(--color-dim)] text-base font-bold">
                /100
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mt-1">
              {t.matchMedio(nf(match.scored, tag))}
            </div>
          </div>
          <div className="border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <div
              className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none"
              style={{ color: GREEN }}
            >
              {nf(match.strong70, tag)}
              <span className="text-[var(--color-dim)] text-base font-bold">
                {" "}
                ·{" "}
                {Math.round((match.strong70 / Math.max(1, match.scored)) * 100)}
                %
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mt-1">
              {t.matchForti}
            </div>
          </div>
          <div className="border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <div
              className="text-2xl sm:text-3xl font-extrabold tabular-nums leading-none"
              style={{ color: GREEN }}
            >
              {nf(match.strong80, tag)}
              <span className="text-[var(--color-dim)] text-base font-bold">
                {" "}
                ·{" "}
                {Math.round((match.strong80 / Math.max(1, match.scored)) * 100)}
                %
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mt-1">
              {t.eccellenti}
            </div>
          </div>
        </div>

        {/* Istogramma punteggi (stesso grafico della dashboard) */}
        <ScoreDistribution
          scores={match.scores}
          title={t.scoreDistTitle}
          emptyLabel={t.noScore}
          thresholdReady={70}
          thresholdLabel={t.matchFortiThreshold}
        />
      </section>

      {/* ════════ DOVE — MAPPA EUROPA ════════════════ (order-1) ═══ */}
      {/* Solo con città geocodificate: su run brevi la geocodifica
          (office_lat/lon) può non essere ancora passata → niente mappa vuota. */}
      {cities.length > 0 && (
        <section id="cs-where" data-cs-anchor="where" className="order-1">
          <div className="section-label mb-1">{t.whereLabel}</div>
          <p className="text-[11px] text-[var(--color-dim)] mb-4">
            {t.whereIntro(
              nf(
                cities.reduce((s, c) => s + c.count, 0),
                tag,
              ),
              countries.length,
              cities.length,
            )}
          </p>

          <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-5 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-center">
            {/* Mappa a bolle */}
            <div className="overflow-hidden">
              <svg
                viewBox={`0 0 ${mapW} ${mapH}`}
                width="100%"
                style={{ maxHeight: 520 }}
                preserveAspectRatio="xMidYMid meet"
              >
                {/* terra · coste Europa (outline reale semplificato) */}
                {landPaths.map((d, i) => (
                  <path
                    key={`land${i}`}
                    d={d}
                    fill="color-mix(in srgb, var(--color-muted) 8%, transparent)"
                    stroke="color-mix(in srgb, var(--color-muted) 42%, transparent)"
                    strokeWidth={0.7}
                    strokeLinejoin="round"
                  />
                ))}
                {/* graticola (tenue) */}
                {[-10, 0, 10, 20, 30].map((lon) => {
                  const { x } = projectEU(50, lon, mapW, mapH);
                  return (
                    <line
                      key={`v${lon}`}
                      x1={x}
                      x2={x}
                      y1={0}
                      y2={mapH}
                      stroke="var(--color-border)"
                      strokeWidth={0.5}
                      opacity={0.18}
                    />
                  );
                })}
                {[40, 45, 50, 55, 60].map((lat) => {
                  const { y } = projectEU(lat, 0, mapW, mapH);
                  return (
                    <line
                      key={`h${lat}`}
                      x1={0}
                      x2={mapW}
                      y1={y}
                      y2={y}
                      stroke="var(--color-border)"
                      strokeWidth={0.5}
                      opacity={0.18}
                    />
                  );
                })}
                {/* bolle (grandi sotto, così le etichette restano leggibili) */}
                {[...cities]
                  .sort((a, b) => b.count - a.count)
                  .map((c) => {
                    const { x, y } = projectEU(c.lat, c.lon, mapW, mapH);
                    const r = 4 + 22 * Math.sqrt(c.count / maxCity);
                    return (
                      <circle
                        key={`${c.city}-${c.lat}`}
                        cx={x}
                        cy={y}
                        r={r}
                        fill={BLUE}
                        fillOpacity={0.4}
                        stroke={BLUE}
                        strokeOpacity={0.95}
                        strokeWidth={1.2}
                        className="cursor-default"
                        onMouseEnter={(e) =>
                          showTip(
                            e,
                            `${c.city}${c.country ? " · " + c.country : ""}`,
                            [
                              {
                                color: BLUE,
                                label: t.positions,
                                value: nf(c.count, tag),
                              },
                            ],
                          )
                        }
                        onMouseMove={moveTip}
                        onMouseLeave={hideTip}
                      />
                    );
                  })}
                {/* etichette: solo le città grandi, con alone scuro per leggibilità */}
                {cityLabels.map((l) => (
                  <text
                    key={`l${l.city}`}
                    x={l.x}
                    y={l.y}
                    textAnchor="middle"
                    className="fill-[var(--color-white)] pointer-events-none"
                    style={
                      {
                        fontSize: 10,
                        fontWeight: 700,
                        paintOrder: "stroke",
                        stroke: "var(--color-panel)",
                        strokeWidth: 3,
                      } as React.CSSProperties
                    }
                  >
                    {l.city}
                  </text>
                ))}
              </svg>
            </div>

            {/* Top paesi */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-dim)] mb-3">
                {t.topCountries}
              </div>
              <div className="space-y-2">
                {topCountries.map((c) => (
                  <div
                    key={c.name}
                    className="flex items-center gap-2.5"
                    onMouseEnter={(e) =>
                      showTip(e, `${flag(c.code)} ${c.name}`, [
                        {
                          color: BLUE,
                          label: t.positions,
                          value: nf(c.count, tag),
                        },
                      ])
                    }
                    onMouseMove={moveTip}
                    onMouseLeave={hideTip}
                  >
                    <span className="text-[13px] w-5 shrink-0 text-center">
                      {flag(c.code)}
                    </span>
                    <span className="text-[11px] text-[var(--color-muted)] w-24 shrink-0 truncate">
                      {c.name}
                    </span>
                    <div
                      className="flex-1 h-1.5 rounded-full overflow-hidden"
                      style={{ background: "var(--color-border)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(c.count / maxCountry) * 100}%`,
                          background: BLUE,
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <span
                      className="text-[11px] font-bold tabular-nums w-7 text-right"
                      style={{ color: BLUE }}
                    >
                      {c.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ════════ CATEGORIE — DONUT ══════════════════ (order-3) ═══ */}
      <section id="cs-roles" data-cs-anchor="roles" className="order-3">
        <div className="section-label mb-1">{t.rolesLabel}</div>
        <p className="text-[11px] text-[var(--color-dim)] mb-4">
          {t.rolesIntro(categories.length)}
        </p>

        <div className="bg-[var(--color-card)] border border-[var(--color-border)] p-6 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-8 items-center">
          {/* Donut */}
          <div
            className="relative shrink-0 mx-auto"
            style={{ width: 210, height: 210 }}
          >
            <svg viewBox="0 0 180 180" width={210} height={210}>
              <g transform="rotate(-90 90 90)">
                {arcs.map((s) => (
                  <circle
                    key={s.name}
                    cx={90}
                    cy={90}
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={24}
                    strokeDasharray={`${s.frac * C} ${C - s.frac * C}`}
                    strokeDashoffset={-s.start * C}
                    className="cursor-default"
                    onMouseEnter={(e) =>
                      showTip(e, s.name, [
                        {
                          color: s.color,
                          label: `${s.pct}% · ${t.positions}`,
                          value: nf(s.count, tag),
                        },
                      ])
                    }
                    onMouseMove={moveTip}
                    onMouseLeave={hideTip}
                  />
                ))}
              </g>
              <text
                x={90}
                y={90}
                textAnchor="middle"
                style={{ fontSize: 38, fontWeight: 800, fill: BLUE }}
              >
                {nf(run.totals.positions, tag)}
              </text>
              <text
                x={90}
                y={108}
                textAnchor="middle"
                className="fill-[var(--color-dim)]"
                style={{ fontSize: 8, letterSpacing: 0.5 }}
              >
                {t.positionsFound}
              </text>
            </svg>
          </div>
          {/* Tabella categorie — UN SOLO grid: colonne incolonnate e barre score
              con la STESSA baseline a sinistra (lunghezza = score, scala 0–100). */}
          <div
            className="w-full grid items-center gap-x-4 gap-y-2"
            style={{ gridTemplateColumns: CAT_GRID }}
          >
            {/* header colonne (4 celle + separatore full-width) */}
            <span />
            <span className="text-[8.5px] uppercase tracking-wide text-[var(--color-dim)] text-right">
              {t.colCount}
            </span>
            <span className="text-[8.5px] uppercase tracking-wide text-[var(--color-dim)] text-right">
              {t.colShare}
            </span>
            <span className="text-[8.5px] uppercase tracking-wide text-[var(--color-dim)]">
              {t.colAvgScore}
            </span>
            <span
              className="border-b border-[var(--color-border)] -mt-1"
              style={{ gridColumn: "1 / -1" }}
            />

            {/* righe categorie */}
            {arcs.map((s) => (
              <Fragment key={s.name}>
                {/* nome + pallino colore */}
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ background: s.color }}
                  />
                  <span
                    className="text-[11px] text-[var(--color-muted)] truncate"
                    title={s.name}
                  >
                    {s.name}
                  </span>
                </span>
                {/* quantità */}
                <span className="text-[11px] font-bold tabular-nums text-right">
                  {nf(s.count, tag)}
                </span>
                {/* quota % */}
                <span className="text-[11px] text-[var(--color-dim)] tabular-nums text-right">
                  {s.pct}%
                </span>
                {/* barra media score (baseline comune a sinistra) + numero */}
                <span className="flex items-center gap-2">
                  <span
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: "var(--color-border)" }}
                  >
                    {s.avg != null && (
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${s.avg}%`,
                          background: s.color,
                          opacity: 0.85,
                        }}
                      />
                    )}
                  </span>
                  <span
                    className={`text-[11px] font-bold tabular-nums w-6 text-right shrink-0 ${
                      s.avg == null ? "text-[var(--color-dim)]" : ""
                    }`}
                  >
                    {s.avg != null ? Math.round(s.avg) : "—"}
                  </span>
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      <TooltipLayer ref={tipRef} />
    </div>
  );
}
