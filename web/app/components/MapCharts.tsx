"use client";

import { scoreSpectrumCss } from "@/lib/score-color";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/use-locale";
import {
  UNCATEGORIZED_LABEL,
  type RoleFamilyCount,
} from "@/lib/position-classifier";

// Stringhe UI hardcoded localizzate (le label dei tipi arrivano via `labels`).

type Tr = (k: string) => string;
import PositionTypesDonut from "@/app/components/PositionTypesDonut";
import ScoreDistributionHorizontal from "@/app/components/ScoreDistributionHorizontal";
import JobsGlobeLazy from "@/app/components/JobsGlobeLazy";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./MapCharts.i18n";
import type {
  LocationCity,
  LocationCountry,
  LocationPositionLite,
} from "@/lib/types";

type NoCoordItem = {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  role_family: string | null;
  score: number | null;
  is_remote: boolean;
  remote_type: string | null;
  location: string | null;
  loc_country: string | null;
  loc_city: string | null;
  created_at: string | null;
};

// Subset campi PositionCoord che servono per re-derivare donut/histogram
// + tree Location dal filtro location. Fetched in parallelo a
// /api/positions/no-coords.
type CoordItem = {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  role_family: string | null;
  score: number | null;
  loc_country: string | null;
  loc_city: string | null;
  created_at: string | null;
};

// Etichetta della "location" sintetica per le posizioni remote (senza
// coordinate): le raggruppiamo sotto questo nodo nella card Location.
const REMOTE_LABEL = "Remote";

// Soglia score con cui la mappa si apre. Sotto questa i pin restano fuori
// finché l'utente non rimuove la chip del filtro.
const DEFAULT_MIN_SCORE = 65;

function scoreColor(s: number | null): string {
  return scoreSpectrumCss(s);
}

// Tree gerarchico restituito da /api/positions/locations

type Props = {
  typeDist: RoleFamilyCount[];
  fallbackScores: number[]; // score totali quando nessun tipo selezionato
  labels: Record<string, string>;
  emptyLabel: string;
  scoreTitle: string;
};

// Dimensione uniforme delle 4 card d'angolo (Location, Score, Donut,
// Remote). Misura tarata sul widget donut (grafico + legenda + labels)
// così tutte e quattro hanno la stessa larghezza/altezza.
const CARD_W = 420;
const CARD_H = 250;
// Altezza header-titolo e padding del corpo (per calcolare l'area utile
// del grafico score in fit-mode con l'header presente).
const HEADER_H = 33;
const BODY_PAD = 16;
// Margini d'angolo: top a 24; bottom a 48 per non coprire l'attribution
// OSM/CARTO (la (i)) nell'angolo basso-destra.
const CARD_TOP = 24;
const CARD_BOTTOM = 48;
const CARD_SIDE = 24;
const CARD_MAXW = "calc(50vw - 32px)";

export default function MapCharts({
  typeDist,
  fallbackScores,
  labels,
  emptyLabel,
  scoreTitle,
}: Props) {
  const locale = useLocale();
  const tr = makeT(T, locale);
  // Collapse per ciascuna delle 4 card: cliccando il titolo si
  // nasconde il corpo (grafico/lista) e resta solo l'header.
  const [collapsed, setCollapsed] = useState<{
    location: boolean;
    score: boolean;
    donut: boolean;
    remote: boolean;
  }>({ location: true, score: true, donut: true, remote: true });
  const toggleCollapse = (k: "location" | "score" | "donut" | "remote") =>
    setCollapsed((c) => ({ ...c, [k]: !c[k] }));
  // MOBILE: nasconde in blocco la colonna delle 4 card (classe
  // map-card-offscreen, attiva solo nella media query di page.tsx) —
  // stesso pulsante per mostrare/nascondere, così il globo può prendersi
  // tutto lo schermo (scelta utente 21/07). Su desktop non ha effetto.
  const [panelsHidden, setPanelsHidden] = useState(false);
  const offscreen = panelsHidden ? " map-card-offscreen" : "";
  // Richiesta di "focus" su un pin: cliccando una posizione (con
  // coordinate) nella card Posizioni, la mappa ci zooma sopra e la
  // seleziona. `tick` permette di ri-triggerare lo stesso id.
  const [focusReq, setFocusReq] = useState<{ id: string; tick: number } | null>(
    null,
  );
  const focusPin = (id: string) =>
    setFocusReq((cur) => ({ id, tick: (cur?.tick ?? 0) + 1 }));
  // Multi-selezione. Vuoto = nessun filtro (mostra tutto).
  // Tra tipologie diverse: AND. Dentro la stessa tipologia: OR.
  // Post-dev2 refactor 2026-05-23: classificazione è data-driven da
  // positions.role_family (popolata dal team analyst). Niente più enum.
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedRanges, setSelectedRanges] = useState<
    Array<{ lo: number; hi: number }>
  >([]);
  const [unscoredSelected, setUnscoredSelected] = useState(false);
  // Filtro di DEFAULT sullo score: la mappa si apre mostrando solo le
  // posizioni da 65 in su, il resto è rumore su un globo già affollato.
  // Non è un range dell'istogramma (quelli sono bin esatti e si
  // toglierebbero a vicenda): è una soglia a sé, con la sua chip
  // rimovibile. Appena l'utente sceglie un bin a mano la soglia decade,
  // altrimenti resterebbe in AND e nasconderebbe la sua stessa selezione.
  const [minScore, setMinScore] = useState<number | null>(DEFAULT_MIN_SCORE);
  // Filtro location: array di nomi country (es. "Italy") e di city
  // formato "Country|City" (es. "Italy|Milan"). Country e city
  // OR-uniti (selezioni multiple).
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [noCoords, setNoCoords] = useState<NoCoordItem[]>([]);
  // Posizioni con coordinate ufficio — fetched per ricomputare
  // donut/histogram in base al filtro location.
  const [coordItems, setCoordItems] = useState<CoordItem[]>([]);
  const [locations, setLocations] = useState<LocationCountry[]>([]);
  // Country e city aperti nel drilldown della sidebar Location.
  const [openCountry, setOpenCountry] = useState<string | null>(null);
  const [openCity, setOpenCity] = useState<string | null>(null);

  // Fetch lista posizioni senza coords una volta al mount.
  useEffect(() => {
    let cancel = false;
    fetch("/api/positions/no-coords")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: NoCoordItem[]) => {
        if (!cancel) setNoCoords(Array.isArray(d) ? d : []);
      })
      .catch(() => undefined);
    // Fetch in parallelo positions con coords (subset di campi
    // necessari a ricomputare donut+histogram sotto filtro location).
    fetch("/api/positions/coords")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: CoordItem[]) => {
        if (!cancel) setCoordItems(Array.isArray(d) ? d : []);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  // Fetch tree gerarchico location (country → cities → positions).
  useEffect(() => {
    let cancel = false;
    fetch("/api/positions/locations")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: LocationCountry[]) => {
        if (!cancel) setLocations(Array.isArray(d) ? d : []);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  const scoreFilterActive =
    selectedRanges.length > 0 || unscoredSelected || minScore != null;
  // True se p passa il filtro score combinato: nessun filtro attivo
  // OR (range match e ha score) OR (no-score selezionato e score null).
  const passScoreFilter = (score: number | null) => {
    if (!scoreFilterActive) return true;
    // Soglia di default: le non ancora valutate non sono "buone", restano
    // fuori con le sotto-soglia finché la chip è attiva.
    if (minScore != null) return score != null && score >= minScore;
    if (score == null) return unscoredSelected;
    return selectedRanges.some((r) => score >= r.lo && score <= r.hi);
  };

  // Tutte le posizioni (coords + no-coords) usate per re-derivare
  // donut/histogram/tree Location quando un filtro è attivo. Include
  // title+company per popolare le posizioni del drilldown Location.
  const allItemsLite = useMemo(() => {
    return [
      ...coordItems.map((p) => ({
        id: p.id,
        title: p.title,
        company: p.company,
        status: p.status,
        role_family: p.role_family,
        score: p.score,
        loc_country: p.loc_country,
        loc_city: p.loc_city,
        created_at: p.created_at,
        remote: false,
        hasCoords: true,
      })),
      // Posizioni senza coordinate: NON sono per forza remote (spesso sono
      // onsite/hybrid solo non geocodificate). Le raggruppiamo sotto "Remote"
      // SOLO se sono davvero full-remote; altrimenti sotto il loro paese/città
      // reale (niente pin in mappa, ma categorizzazione corretta).
      ...noCoords.map((p) => {
        const isRemote = p.remote_type
          ? p.remote_type === "full_remote"
          : p.is_remote;
        return {
          id: p.id,
          title: p.title,
          company: p.company,
          status: p.status,
          role_family: p.role_family,
          score: p.score,
          loc_country: isRemote ? REMOTE_LABEL : p.loc_country,
          loc_city: isRemote ? null : p.loc_city,
          created_at: p.created_at,
          remote: isRemote,
          hasCoords: false,
        };
      }),
    ];
  }, [coordItems, noCoords]);

  // Click su una posizione (card Posizioni o drill-down Location):
  // se ha coordinate → zoom sul pin + vignetta; se remote (no pin) →
  // apre il dettaglio in nuova scheda.
  const openPosition = (id: string) => {
    const it = allItemsLite.find((x) => x.id === id);
    // Senza pin in mappa (posizione non geocodificata) → apri il dettaglio;
    // con pin → zoom sul pin.
    if (it && !it.hasCoords) {
      window.open(`/positions/${id}`, "_blank", "noopener,noreferrer");
    } else {
      focusPin(id);
    }
  };

  // Elenco di TUTTE le posizioni che passano i filtri correnti
  // (tipo + score + location), ordinate per più recenti. Alimenta la
  // card in basso a destra (ex "Remote") come tabella posizioni.
  const filteredPositions = useMemo(() => {
    const passLoc = (country: string, cityKey: string) => {
      if (selectedCountries.length === 0 && selectedCities.length === 0)
        return true;
      return (
        selectedCities.includes(cityKey) || selectedCountries.includes(country)
      );
    };
    return allItemsLite
      .filter((p) => {
        if (
          selectedTypes.length > 0 &&
          !selectedTypes.includes(p.role_family ?? UNCATEGORIZED_LABEL)
        )
          return false;
        if (!passScoreFilter(p.score)) return false;
        const country = (p.loc_country ?? "").trim() || "(unknown)";
        const city = (p.loc_city ?? "").trim() || null;
        const cityKey = `${country}|${city ?? "(country-only)"}`;
        if (!passLoc(country, cityKey)) return false;
        return true;
      })
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allItemsLite,
    selectedTypes,
    selectedRanges,
    unscoredSelected,
    selectedCountries,
    selectedCities,
  ]);

  const locationFilterActive =
    selectedCountries.length > 0 || selectedCities.length > 0;

  // Subset filtrato per location (donut+histogram scope).
  const locScopeItems = useMemo(() => {
    if (!locationFilterActive) return allItemsLite;
    return allItemsLite.filter((p) => {
      const country = (p.loc_country ?? "").trim() || "(unknown)";
      const city = (p.loc_city ?? "").trim() || null;
      if (selectedCities.length > 0) {
        const key = `${country}|${city ?? "(country-only)"}`;
        if (selectedCities.includes(key)) return true;
      }
      if (selectedCountries.length > 0 && selectedCountries.includes(country)) {
        return true;
      }
      return false;
    });
  }, [allItemsLite, locationFilterActive, selectedCountries, selectedCities]);

  // typeDist effective derivato dal subset filtered (preserva color
  // dai typeDist prop, che è il source-of-truth per palette/labels).
  // Cross-filtering: applica location E score (ma NON il filtro tipo,
  // perché la donut È il selettore di tipo e deve mostrarli tutti).
  const effectiveTypeDist = useMemo<RoleFamilyCount[]>(() => {
    // Pre-fetch: fallback ai typeDist server-side (no filter applicato).
    if (allItemsLite.length === 0) return typeDist;
    const byFamily = new Map<string, { count: number; scores: number[] }>();
    for (const p of locScopeItems) {
      if (!passScoreFilter(p.score)) continue;
      const f = p.role_family ?? UNCATEGORIZED_LABEL;
      const e = byFamily.get(f) ?? { count: 0, scores: [] };
      e.count++;
      if (typeof p.score === "number") e.scores.push(p.score);
      byFamily.set(f, e);
    }
    return Array.from(byFamily.entries())
      .map(([family, d]) => {
        const proto = typeDist.find((x) => x.family === family);
        return {
          family,
          count: d.count,
          color: proto?.color,
          avgScore: proto?.avgScore ?? null,
          avgCritic: proto?.avgCritic ?? null,
          scores: d.scores,
        } as RoleFamilyCount;
      })
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItemsLite, locScopeItems, typeDist, selectedRanges, unscoredSelected]);

  // Score grezzi mostrati nel histogram (subset filtered location +
  // tipi selezionati).
  const histogramScores = useMemo(() => {
    let pool = locScopeItems;
    if (selectedTypes.length > 0) {
      pool = pool.filter((p) =>
        selectedTypes.includes(p.role_family ?? UNCATEGORIZED_LABEL),
      );
    }
    const scores = pool
      .map((p) => p.score)
      .filter((s): s is number => typeof s === "number");
    // Pre-fetch fallback: usa fallbackScores server-side.
    if (allItemsLite.length === 0) {
      if (selectedTypes.length === 0) return fallbackScores;
      const out: number[] = [];
      for (const t of selectedTypes) {
        const entry = typeDist.find((d) => d.family === t);
        if (entry?.scores) out.push(...entry.scores);
      }
      return out;
    }
    return scores;
  }, [allItemsLite, locScopeItems, selectedTypes, typeDist, fallbackScores]);

  // Unscored count nel scope.
  const unscoredCount = useMemo(() => {
    if (allItemsLite.length === 0) {
      // Fallback server-side: count su typeDist con filtro tipo.
      const totalInScope =
        selectedTypes.length === 0
          ? typeDist.reduce((a, d) => a + d.count, 0)
          : typeDist
              .filter((d) => selectedTypes.includes(d.family))
              .reduce((a, d) => a + d.count, 0);
      return Math.max(0, totalInScope - histogramScores.length);
    }
    let pool = locScopeItems;
    if (selectedTypes.length > 0) {
      pool = pool.filter((p) =>
        selectedTypes.includes(p.role_family ?? UNCATEGORIZED_LABEL),
      );
    }
    return pool.filter((p) => typeof p.score !== "number").length;
  }, [allItemsLite, locScopeItems, selectedTypes, typeDist, histogramScores]);

  // Tree Location ricalcolato dal subset filtrato per tipi+score.
  // NOTA: NON applico il filtro location qui — i nodi visibili devono
  // restare nella sidebar anche quando l'utente clicca un filtro
  // country/city (altrimenti si auto-eliminano e non c'è modo di
  // togliere il filtro dall'albero). Fallback al fetch server-side
  // (`locations` state) finché allItemsLite è vuoto al primo render.
  const effectiveLocationTree = useMemo<LocationCountry[]>(() => {
    if (allItemsLite.length === 0) return locations;
    // Filtra per tipi e score.
    const filtered = allItemsLite.filter((p) => {
      if (
        selectedTypes.length > 0 &&
        !selectedTypes.includes(p.role_family ?? UNCATEGORIZED_LABEL)
      )
        return false;
      if (!passScoreFilter(p.score)) return false;
      return true;
    });
    // Aggrego come fa il server (vedi queries.ts buildLocationTree).
    const byCountry = new Map<
      string,
      Map<string | null, LocationPositionLite[]>
    >();
    for (const p of filtered) {
      const country = (p.loc_country ?? "").trim() || "(unknown)";
      const city = (p.loc_city ?? "").trim() || null;
      const cMap =
        byCountry.get(country) ??
        new Map<string | null, LocationPositionLite[]>();
      const arr = cMap.get(city) ?? [];
      arr.push({
        id: p.id,
        title: p.title,
        company: p.company,
        score: p.score,
      });
      cMap.set(city, arr);
      byCountry.set(country, cMap);
    }
    const out: LocationCountry[] = [];
    for (const [country, cMap] of byCountry) {
      const cities: LocationCity[] = [];
      let total = 0;
      for (const [city, positions] of cMap) {
        positions.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        cities.push({ city, count: positions.length, positions });
        total += positions.length;
      }
      cities.sort((a, b) => {
        if (a.city == null) return 1;
        if (b.city == null) return -1;
        return b.count - a.count;
      });
      out.push({ country, count: total, cities });
    }
    out.sort((a, b) => {
      if (a.country === "(unknown)") return 1;
      if (b.country === "(unknown)") return -1;
      return b.count - a.count;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allItemsLite,
    locations,
    selectedTypes,
    selectedRanges,
    unscoredSelected,
  ]);

  const toggleType = (t: string) =>
    setSelectedTypes((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
    );
  const toggleRange = (r: { lo: number; hi: number }) => {
    // Selezione esplicita sull'istogramma → la soglia di default esce di
    // scena, altrimenti resterebbe in AND e un bin sotto 65 mostrerebbe zero.
    setMinScore(null);
    setSelectedRanges((cur) =>
      cur.some((x) => x.lo === r.lo && x.hi === r.hi)
        ? cur.filter((x) => !(x.lo === r.lo && x.hi === r.hi))
        : [...cur, r],
    );
  };
  const toggleCountry = (c: string) =>
    setSelectedCountries((cur) =>
      cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c],
    );
  const toggleCity = (key: string) =>
    setSelectedCities((cur) =>
      cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key],
    );

  // Chips dei filtri attivi (banner rimozione rapida) — condivise dalla
  // pill desktop (FilterButton) e dalla pill mobile a due zone.
  const filterChips: FilterChipDesc[] = [];
  for (const t of selectedTypes) {
    filterChips.push({
      key: `t-${t}`,
      label: labels[t] ?? String(t),
      color: typeDist.find((d) => d.family === t)?.color,
      onRemove: () => toggleType(t),
    });
  }
  if (minScore != null) {
    filterChips.push({
      key: "min-score",
      label: tr("min_score").replace("{n}", String(minScore)),
      onRemove: () => setMinScore(null),
    });
  }
  for (const r of selectedRanges) {
    filterChips.push({
      key: `r-${r.lo}-${r.hi}`,
      label: `${r.lo}–${r.hi}`,
      onRemove: () => toggleRange(r),
    });
  }
  if (unscoredSelected) {
    filterChips.push({
      key: "unscored",
      label: tr("no_score"),
      onRemove: () => setUnscoredSelected(false),
    });
  }
  for (const c of selectedCountries) {
    filterChips.push({
      key: `co-${c}`,
      label: c,
      onRemove: () => toggleCountry(c),
    });
  }
  for (const ck of selectedCities) {
    // Mostra "City" (Country implicito) nel chip per brevità.
    const [country, city] = ck.split("|");
    filterChips.push({
      key: `ci-${ck}`,
      label: city === "(country-only)" ? country : (city ?? country),
      onRemove: () => toggleCity(ck),
    });
  }
  const clearAllFilters = () => {
    setSelectedTypes([]);
    setSelectedRanges([]);
    setMinScore(null);
    setUnscoredSelected(false);
    setSelectedCountries([]);
    setSelectedCities([]);
  };

  return (
    <>
      {/* Globo — riceve tutte le selezioni di filtro. La pill "Filtri"
          è passata come bottomCenterExtra così sta nella STESSA riga
          flex dei controlli mappa (Vista generale + zoom) in basso-
          centro → l'insieme si ricentra da solo quando compare. */}
      <div
        className="map-globe-layer"
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      >
        <JobsGlobeLazy
          fullscreen
          selectedTypes={selectedTypes}
          // Il globo filtra i pin per range: la soglia di default gli arriva
          // tradotta in un range aperto verso l'alto, altrimenti resterebbero
          // pinnate anche le posizioni sotto 65 (i pannelli laterali le
          // escludevano già, i pin no). hi=Infinity e non 100: se un giorno
          // uno score sforasse la scala non lo perdiamo per strada.
          selectedScoreRanges={
            minScore != null
              ? [{ lo: minScore, hi: Number.POSITIVE_INFINITY }]
              : selectedRanges
          }
          selectedUnscored={unscoredSelected}
          selectedCountries={selectedCountries}
          selectedCities={selectedCities}
          focusPosition={focusReq}
          familyColors={Object.fromEntries(
            typeDist.map((d) => [d.family, d.color ?? "var(--color-muted)"]),
          )}
          bottomCenterExtra={
            <>
              <MobileFilterPill
                chips={filterChips}
                clearAll={clearAllFilters}
                panelsHidden={panelsHidden}
                onTogglePanels={() => setPanelsHidden((v) => !v)}
                tr={tr}
              />
              <FilterButton
                chips={filterChips}
                clearAll={clearAllFilters}
                tr={tr}
              />
            </>
          }
        />
      </div>

      {/* Card Score top-right: header collassabile + grafico. */}
      <div
        className={
          "map-float-card map-card-score bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg" +
          offscreen
        }
        style={{
          position: "absolute",
          top: CARD_TOP,
          right: CARD_SIDE,
          width: CARD_W,
          height: collapsed.score ? "auto" : CARD_H,
          maxWidth: CARD_MAXW,
          zIndex: 10,
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <CardHeader
          title={scoreTitle}
          collapsed={collapsed.score}
          onToggle={() => toggleCollapse("score")}
          tr={tr}
        />
        {!collapsed.score && (
          <div
            className="map-bare-chart"
            style={{ flex: 1, minHeight: 0, padding: BODY_PAD }}
          >
            <ScoreDistributionHorizontal
              scores={histogramScores}
              title={scoreTitle}
              emptyLabel={emptyLabel}
              selectedRanges={selectedRanges}
              onToggleRange={toggleRange}
              unscoredCount={unscoredCount}
              unscoredSelected={unscoredSelected}
              onToggleUnscored={() => {
                // Come per i bin: chiedere le non valutate mentre la soglia
                // di default è attiva darebbe zero risultati.
                setMinScore(null);
                setUnscoredSelected((v) => !v);
              }}
              fit
              // Area utile = box meno header e padding → riempie esatto.
              fitAspect={
                (CARD_W - 2 * BODY_PAD) / (CARD_H - HEADER_H - 2 * BODY_PAD)
              }
            />
          </div>
        )}
      </div>

      {/* Card "Posizioni" — overlay bottom-right. Elenco di TUTTE le
          posizioni che passano i filtri correnti (tipo+score+location),
          più recenti in cima. Mostra titolo, azienda, location, score e
          stato (come la tabella della pagina Posizioni). Click su una
          posizione con coordinate → zoom sul pin in mappa; remote →
          apre il dettaglio. */}
      <div
        className={
          "map-float-card map-card-positions bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg" +
          offscreen
        }
        style={{
          position: "absolute",
          bottom: CARD_BOTTOM,
          right: CARD_SIDE,
          zIndex: 10,
          width: CARD_W,
          maxWidth: CARD_MAXW,
          height: collapsed.remote ? "auto" : CARD_H,
          display: "flex",
          flexDirection: "column",
          pointerEvents: "auto",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        <CardHeader
          title={tr("positions_title")}
          meta={filteredPositions.length}
          collapsed={collapsed.remote}
          onToggle={() => toggleCollapse("remote")}
          tr={tr}
        />
        {!collapsed.remote && (
          <ul
            className="divide-y overflow-y-auto"
            style={{
              borderColor: "var(--color-border)",
              flex: 1,
              minHeight: 0,
              // Niente scroll-chaining alla pagina (mappa) a fine lista.
              overscrollBehavior: "contain",
            }}
          >
            {filteredPositions.length === 0 && (
              <li
                className="px-4 py-6 text-[11px] text-center"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("no_positions")}
              </li>
            )}
            {filteredPositions.map((p) => {
              const loc = p.remote
                ? REMOTE_LABEL
                : [p.loc_city, p.loc_country].filter(Boolean).join(", ") || "—";
              const family = p.role_family ?? UNCATEGORIZED_LABEL;
              const famColor =
                typeDist.find((d) => d.family === family)?.color ??
                "var(--color-muted)";
              return (
                <li key={p.id} style={{ borderColor: "var(--color-border)" }}>
                  <button
                    onClick={() => openPosition(p.id)}
                    className="block w-full text-left px-4 py-2 hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="text-[11px] font-medium truncate"
                        style={{ color: "var(--color-bright)" }}
                        title={p.title ?? ""}
                      >
                        {p.title ?? tr("no_title")}
                      </span>
                      {typeof p.score === "number" ? (
                        <span
                          className="tabular-nums font-semibold flex-shrink-0 text-[11px]"
                          style={{ color: scoreColor(p.score) }}
                        >
                          {p.score}
                        </span>
                      ) : (
                        <span
                          className="text-[9px] italic flex-shrink-0"
                          style={{ color: "var(--color-dim)" }}
                        >
                          {tr("no_score")}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[10px] truncate"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {p.company ?? "—"}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span
                        className="text-[9px] truncate"
                        style={{ color: "var(--color-dim)" }}
                        title={loc}
                      >
                        {loc}
                      </span>
                      {/* Tipologia (role_family) col colore della donut. */}
                      <span
                        className="text-[9px] truncate flex items-center gap-1 flex-shrink-0"
                        style={{ color: "var(--color-muted)", maxWidth: "55%" }}
                        title={family}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: famColor,
                            flexShrink: 0,
                          }}
                        />
                        <span className="truncate">{family}</span>
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Tree gerarchico Location: country → city → posizioni.
          Ricalcolato client-side da allItemsLite con i filtri tipi+score
          applicati → count e nodi visibili riflettono le selezioni
          donut/histogram. Click su country/city = filtra la mappa E
          apre/chiude il drilldown. Click position → apre /positions/<id>. */}
      {effectiveLocationTree.length > 0 && (
        <LocationTree
          tree={effectiveLocationTree}
          tr={tr}
          collapsed={collapsed.location}
          extraClass={offscreen}
          onToggleCollapse={() => toggleCollapse("location")}
          onPositionClick={openPosition}
          openCountry={openCountry}
          openCity={openCity}
          selectedCountries={selectedCountries}
          selectedCities={selectedCities}
          onCountryClick={(c) => {
            const isOpen = openCountry === c;
            setOpenCountry(isOpen ? null : c);
            setOpenCity(null);
            const willSelect = !selectedCountries.includes(c);
            toggleCountry(c);
            // Selezionare un paese intero azzera eventuali sue città già
            // filtrate (paese e città dello stesso paese sono mutuamente
            // esclusivi: o tutto il paese, o città specifiche).
            if (willSelect) {
              setSelectedCities((cur) =>
                cur.filter((k) => k.split("|")[0] !== c),
              );
            }
          }}
          onCityClick={(key) => {
            const isOpen = openCity === key;
            setOpenCity(isOpen ? null : key);
            const willSelect = !selectedCities.includes(key);
            toggleCity(key);
            // Selezionare una città restringe a quella: rimuovi il filtro
            // del paese genitore (altrimenti l'OR mostrerebbe tutto il
            // paese invece della sola città).
            if (willSelect) {
              const country = key.split("|")[0];
              setSelectedCountries((cur) => cur.filter((c) => c !== country));
            }
          }}
          onCountryCaret={(c) => {
            setOpenCountry((cur) => (cur === c ? null : c));
            setOpenCity(null);
          }}
          onCityCaret={(key) =>
            setOpenCity((cur) => (cur === key ? null : key))
          }
        />
      )}

      {/* Position Types donut — overlay bottom-left. Header collassabile
          + donut/legenda. È il riferimento dimensionale delle 4 card. */}
      <div
        className={
          "map-float-card map-card-donut bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg" +
          offscreen
        }
        style={{
          position: "absolute",
          bottom: CARD_BOTTOM,
          left: CARD_SIDE,
          width: CARD_W,
          maxWidth: CARD_MAXW,
          height: collapsed.donut ? "auto" : CARD_H,
          zIndex: 10,
          pointerEvents: "auto",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <CardHeader
          title={tr("types_title")}
          meta={effectiveTypeDist.reduce((a, d) => a + d.count, 0) || null}
          collapsed={collapsed.donut}
          onToggle={() => toggleCollapse("donut")}
          tr={tr}
        />
        {!collapsed.donut && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              // Padding ridotto: con l'header la legenda (fino a ~9 voci)
              // deve starci senza essere tagliata.
              padding: 12,
            }}
          >
            <PositionTypesDonut
              data={effectiveTypeDist}
              emptyLabel={emptyLabel}
              size={150}
              labels={labels}
              selectedTypes={selectedTypes}
              onToggleType={(t) => {
                toggleType(t);
                // Pulisci selezioni score: i bin si ricalcolano, e anche
                // unscored cambia conteggio col nuovo scope.
                setSelectedRanges([]);
                setUnscoredSelected(false);
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

type FilterChipDesc = {
  key: string;
  label: string;
  color?: string;
  onRemove: () => void;
};

// Bottone-filtro compatto: una sola icona a imbuto con il numero di
// filtri attivi, ancorata in basso-centro (zona della mappa sempre
// libera). Cliccando si apre un banner sopra il bottone con tutti i
// filtri selezionati, ognuno rimovibile via "×", più "rimuovi tutto".
// Se non c'è nessun filtro attivo, il bottone non viene mostrato.
// Pill mobile a DUE ZONE (scelta utente 21/07, dopo il pasticcio della
// pill unica che aveva perso il banner): imbuto+badge = apre il banner
// dei filtri attivi con rimozione rapida (come su desktop); freccetta =
// alza/nasconde la colonna dei 4 pannelli. Senza filtri attivi la zona
// sinistra non ha nulla da mostrare e l'intera pill fa da toggle.
function MobileFilterPill({
  chips,
  clearAll,
  panelsHidden,
  onTogglePanels,
  tr,
}: {
  chips: FilterChipDesc[];
  clearAll: () => void;
  panelsHidden: boolean;
  onTogglePanels: () => void;
  tr: Tr;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (chips.length === 0 && open) setOpen(false);
  }, [chips.length, open]);

  const toggleLabel = tr(panelsHidden ? "panels_show" : "panels_hide");

  return (
    // NB: wrapper NON-positioned, a differenza del FilterButton desktop:
    // il banner assoluto risale al contenitore della riga controlli
    // (bottom-center, già centrato nel viewport) → "centrato" = centrato
    // nello SCHERMO. Ancorato alla pill sbordava sempre da un lato
    // (la pill sta a destra della riga).
    <div
      className="md:hidden flex"
      style={{
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "auto",
      }}
    >
      {open && chips.length > 0 && (
        <ChipsBanner chips={chips} clearAll={clearAll} tr={tr} align="mobile" />
      )}

      <div
        className="flex items-stretch rounded-full border"
        style={{
          background: "var(--color-panel)",
          borderColor: open
            ? "var(--color-border-glow)"
            : "var(--color-border)",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        {chips.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={`${tr("filters_active")} · ${chips.length}`}
              title={tr("filters_active")}
              className="flex items-center gap-1.5"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-bright)",
                padding: "8px 10px 8px 12px",
                cursor: "pointer",
              }}
            >
              <FunnelIcon />
              <span
                className="rounded-full text-[9px] font-bold tabular-nums"
                style={{
                  background: "var(--color-green)",
                  color: "var(--color-void)",
                  minWidth: 15,
                  height: 15,
                  lineHeight: "15px",
                  textAlign: "center",
                  padding: "0 3px",
                }}
              >
                {chips.length}
              </span>
            </button>
            <span
              aria-hidden
              style={{ width: 1, background: "var(--color-border)" }}
            />
          </>
        )}
        <button
          type="button"
          onClick={onTogglePanels}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="flex items-center gap-1.5"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-bright)",
            padding: chips.length > 0 ? "8px 12px 8px 10px" : "8px 12px",
            cursor: "pointer",
          }}
        >
          {chips.length === 0 && <FunnelIcon />}
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            style={{
              transition: "transform 0.2s",
              transform: panelsHidden ? "rotate(180deg)" : "none",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function FunnelIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

// Banner dei filtri attivi (chips rimovibili + "rimuovi tutto"), ancorato
// sopra la pill che lo apre. Condiviso tra FilterButton (desktop) e
// MobileFilterPill.
function ChipsBanner({
  chips,
  clearAll,
  tr,
  align = "center",
}: {
  chips: FilterChipDesc[];
  clearAll: () => void;
  tr: Tr;
  // "center" = centrato sul wrapper della pill (desktop). "mobile" =
  // stesso centraggio ma sul contenitore riga-controlli (il wrapper
  // mobile non è positioned) e con cap larghezza fisso: niente unità
  // viewport, ambigue sotto lo zoom globale.
  align?: "center" | "mobile";
}) {
  return (
    <div
      className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg"
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        padding: 10,
        width: 360,
        // NB niente unità viewport (ambigue sotto zoom, vedi page.tsx):
        // su mobile il cap fisso tiene il banner dentro lo schermo.
        maxWidth: align === "mobile" ? 296 : "calc(100vw - 48px)",
        maxHeight: 240,
        overflowY: "auto",
        overscrollBehavior: "contain",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <span
          className="text-[10px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: "var(--color-dim)" }}
        >
          {tr("filters_active")} · {chips.length}
        </span>
        <ClearAllButton onClick={clearAll} tr={tr} />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 4,
        }}
      >
        {chips.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            color={c.color}
            onRemove={c.onRemove}
            tr={tr}
          />
        ))}
      </div>
    </div>
  );
}

function FilterButton({
  chips,
  clearAll,
  tr,
}: {
  chips: FilterChipDesc[];
  clearAll: () => void;
  tr: Tr;
}) {
  const [open, setOpen] = useState(false);

  // Niente filtri → niente icona (e chiudi un eventuale banner aperto).
  useEffect(() => {
    if (chips.length === 0 && open) setOpen(false);
  }, [chips.length, open]);

  if (chips.length === 0) return null;

  return (
    // hidden md:flex — su mobile questa pill NON esiste: il ruolo
    // "filtri" ce l'ha il toggle pannelli (che mostra anche il
    // conteggio); due pill imbuto affiancate confondevano (21/07).
    <div
      className="hidden md:flex"
      style={{
        position: "relative",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "auto",
      }}
    >
      {/* Banner filtri: ancorato in posizione assoluta SOPRA il bottone
          (così non altera il layout della riga controlli). */}
      {open && <ChipsBanner chips={chips} clearAll={clearAll} tr={tr} />}

      <button
        onClick={() => setOpen((v) => !v)}
        title={tr("filters_active")}
        aria-label={`${tr("filters_active")} · ${chips.length}`}
        className="flex items-center gap-2 rounded-full border transition-colors hover:border-[var(--color-border-glow)]"
        style={{
          background: "var(--color-panel)",
          borderColor: open
            ? "var(--color-border-glow)"
            : "var(--color-border)",
          color: "var(--color-bright)",
          padding: "8px 12px",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        {/* Icona imbuto (filtro) */}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        <span className="text-[11px] font-semibold tracking-wide">
          {tr("filters")}
        </span>
        <span
          className="text-[10px] font-bold tabular-nums rounded-full"
          style={{
            background: "var(--color-green)",
            color: "var(--color-deep)",
            minWidth: 16,
            textAlign: "center",
            padding: "0 5px",
            lineHeight: "16px",
          }}
        >
          {chips.length}
        </span>
      </button>
    </div>
  );
}

function ClearAllButton({ onClick, tr }: { onClick: () => void; tr: Tr }) {
  return (
    <button
      onClick={onClick}
      className="text-[9px] font-semibold tracking-widest uppercase px-2 py-1 rounded-full hover:bg-[var(--color-card)] transition-colors"
      style={{
        color: "var(--color-dim)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
      }}
      title={tr("clear_all_title")}
    >
      {tr("clear_all")}
    </button>
  );
}

function FilterChip({
  label,
  color,
  onRemove,
  tr,
}: {
  label: string;
  color?: string;
  onRemove: () => void;
  tr: Tr;
}) {
  const c = color ?? "var(--color-bright)";
  return (
    <span
      className="text-[9px] font-semibold tracking-wide rounded-full border whitespace-nowrap"
      style={{
        display: "inline-block",
        marginLeft: 4,
        marginBottom: 4,
        padding: "1px 4px 1px 8px",
        color: c,
        borderColor: c,
        background: `${c}1a`,
        verticalAlign: "middle",
      }}
    >
      <span title={label}>{label}</span>
      <button
        onClick={onRemove}
        aria-label={`${tr("remove")} ${label}`}
        title={`${tr("remove")} ${label}`}
        className="hover:opacity-70 transition-opacity"
        style={{
          display: "inline-block",
          marginLeft: 4,
          background: "transparent",
          border: "none",
          color: c,
          cursor: "pointer",
          fontSize: 11,
          lineHeight: 1,
          padding: 0,
          verticalAlign: "middle",
        }}
      >
        ×
      </button>
    </span>
  );
}

// Header cliccabile condiviso dalle 4 card d'angolo: titolo + caret
// (▶/▼) a sinistra, meta opzionale a destra. Click → collapse/expand.
function CardHeader({
  title,
  meta,
  collapsed,
  onToggle,
  tr,
}: {
  title: string;
  meta?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  tr: Tr;
}) {
  return (
    <div
      onClick={onToggle}
      role="button"
      aria-expanded={!collapsed}
      title={collapsed ? tr("expand") : tr("collapse")}
      className="px-4 py-2 text-[10px] font-semibold tracking-[0.14em] uppercase flex items-baseline justify-between gap-2 cursor-pointer select-none hover:bg-[rgba(255,255,255,0.04)] transition-colors"
      style={{
        borderBottom: collapsed ? "none" : "1px solid var(--color-border)",
        color: "var(--color-dim)",
        flexShrink: 0,
      }}
    >
      <span className="flex items-baseline gap-1.5">
        <span style={{ fontSize: 9, color: "var(--color-dim)" }}>
          {collapsed ? "▶" : "▼"}
        </span>
        {title}
      </span>
      {meta != null && (
        <span className="tabular-nums" style={{ color: "var(--color-muted)" }}>
          {meta}
        </span>
      )}
    </div>
  );
}

// ── Sidebar Location: tree gerarchico country → cities → positions ──
// Una sola country aperta alla volta, una sola city aperta dentro di
// essa. Click su una position apre /positions/<id> in nuova tab.
function LocationTree({
  tree,
  tr,
  collapsed,
  extraClass,
  onToggleCollapse,
  openCountry,
  openCity,
  selectedCountries,
  selectedCities,
  onCountryClick,
  onCityClick,
  onCountryCaret,
  onCityCaret,
  onPositionClick,
}: {
  tree: LocationCountry[];
  tr: Tr;
  collapsed: boolean;
  // Classe extra dal parent (es. map-card-offscreen quando i pannelli
  // sono nascosti su mobile).
  extraClass: string;
  onToggleCollapse: () => void;
  openCountry: string | null;
  openCity: string | null;
  selectedCountries: string[];
  selectedCities: string[];
  onCountryClick: (c: string) => void;
  onCityClick: (key: string) => void;
  // Click solo sulla freccia ▶/▼: apri/chiudi senza toccare il filtro.
  onCountryCaret: (c: string) => void;
  onCityCaret: (key: string) => void;
  // Click su una posizione: localizza il pin sulla mappa (o apre il
  // dettaglio se remote).
  onPositionClick: (id: string) => void;
}) {
  // Conteggio totale (somma count countries) per il badge header.
  const total = tree.reduce((s, c) => s + c.count, 0);
  return (
    <div
      className={
        "map-float-card map-card-location bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg" +
        extraClass
      }
      style={{
        position: "absolute",
        // Angolo in alto a sinistra, stessa dimensione fissa delle altre
        // card; la lista paesi scorre internamente (auto se collassata).
        top: CARD_TOP,
        left: CARD_SIDE,
        height: collapsed ? "auto" : CARD_H,
        zIndex: 10,
        width: CARD_W,
        maxWidth: CARD_MAXW,
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <CardHeader
        title={tr("location")}
        meta={`${tree.length} · ${total}`}
        collapsed={collapsed}
        onToggle={onToggleCollapse}
        tr={tr}
      />
      {!collapsed && (
        <ul
          className="divide-y overflow-y-auto"
          style={{
            borderColor: "var(--color-border)",
            flex: 1,
            minHeight: 0,
            // Niente scroll-chaining alla pagina (mappa) a fine lista.
            overscrollBehavior: "contain",
          }}
        >
          {tree.map((country) => {
            const isOpen = openCountry === country.country;
            const isSelected = selectedCountries.includes(country.country);
            return (
              <li
                key={country.country}
                style={{ borderColor: "var(--color-border)" }}
              >
                <div
                  onClick={() => onCountryClick(country.country)}
                  className="px-4 py-1.5 text-[11px] flex items-baseline justify-between gap-2 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                  style={{
                    background: isSelected
                      ? "rgba(0,232,122,0.08)"
                      : isOpen
                        ? "rgba(255,255,255,0.04)"
                        : "transparent",
                  }}
                >
                  <span
                    className="truncate flex items-baseline gap-1.5"
                    style={{
                      color:
                        isSelected || isOpen
                          ? "var(--color-bright)"
                          : "var(--color-base)",
                      fontWeight: isSelected || isOpen ? 600 : 400,
                    }}
                    title={country.country}
                  >
                    <button
                      aria-label={isOpen ? tr("close") : tr("open")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCountryCaret(country.country);
                      }}
                      style={{
                        display: "inline-block",
                        width: 14,
                        color: "var(--color-dim)",
                        fontSize: 9,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        lineHeight: 1,
                      }}
                    >
                      {isOpen ? "▼" : "▶"}
                    </button>
                    {country.country}
                  </span>
                  <span
                    className="tabular-nums font-semibold flex-shrink-0"
                    style={{
                      color:
                        isSelected || isOpen
                          ? "var(--color-bright)"
                          : "var(--color-muted)",
                    }}
                  >
                    {country.count}
                  </span>
                </div>
                {isOpen && (
                  <ul>
                    {country.cities.map((city) => {
                      const cityKey = `${country.country}|${city.city ?? "(country-only)"}`;
                      const isCityOpen = openCity === cityKey;
                      const isCitySelected = selectedCities.includes(cityKey);
                      const cityLabel = city.city ?? tr("no_city");
                      return (
                        <li
                          key={cityKey}
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          <div
                            onClick={() => onCityClick(cityKey)}
                            className="px-4 py-1 pl-7 text-[10.5px] flex items-baseline justify-between gap-2 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                            style={{
                              background: isCitySelected
                                ? "rgba(0,232,122,0.08)"
                                : isCityOpen
                                  ? "rgba(255,255,255,0.04)"
                                  : "transparent",
                            }}
                          >
                            <span
                              className="truncate flex items-baseline gap-1.5"
                              style={{
                                color:
                                  isCitySelected || isCityOpen
                                    ? "var(--color-bright)"
                                    : "var(--color-muted)",
                                fontWeight:
                                  isCitySelected || isCityOpen ? 600 : 400,
                                fontStyle: city.city ? "normal" : "italic",
                              }}
                              title={cityLabel}
                            >
                              <button
                                aria-label={
                                  isCityOpen ? tr("close") : tr("open")
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCityCaret(cityKey);
                                }}
                                style={{
                                  display: "inline-block",
                                  width: 14,
                                  color: "var(--color-dim)",
                                  fontSize: 9,
                                  background: "transparent",
                                  border: "none",
                                  padding: 0,
                                  cursor: "pointer",
                                  lineHeight: 1,
                                }}
                              >
                                {isCityOpen ? "▼" : "▶"}
                              </button>
                              {cityLabel}
                            </span>
                            <span
                              className="tabular-nums flex-shrink-0"
                              style={{
                                color:
                                  isCitySelected || isCityOpen
                                    ? "var(--color-bright)"
                                    : "var(--color-dim)",
                              }}
                            >
                              {city.count}
                            </span>
                          </div>
                          {isCityOpen && (
                            <ul
                              className="border-t"
                              style={{ borderColor: "var(--color-border)" }}
                            >
                              {city.positions.map((p) => (
                                <li
                                  key={p.id}
                                  style={{ borderColor: "var(--color-border)" }}
                                >
                                  <button
                                    onClick={() => onPositionClick(p.id)}
                                    className="block w-full text-left px-4 py-1 pl-10 text-[10px] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                                    style={{
                                      background: "transparent",
                                      border: "none",
                                      cursor: "pointer",
                                    }}
                                  >
                                    {/* Solo titolo + azienda (niente score). */}
                                    <div
                                      className="truncate"
                                      style={{ color: "var(--color-base)" }}
                                      title={p.title ?? ""}
                                    >
                                      {p.title ?? tr("no_title")}
                                    </div>
                                    <div
                                      className="text-[9px] truncate"
                                      style={{ color: "var(--color-dim)" }}
                                    >
                                      {p.company ?? "—"}
                                    </div>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
