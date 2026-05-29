"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  UNCATEGORIZED_LABEL,
  type RoleFamilyCount,
} from "@/lib/position-classifier";
import PositionTypesDonut from "@/app/components/PositionTypesDonut";
import ScoreDistributionHorizontal from "@/app/components/ScoreDistributionHorizontal";
import JobsGlobeLazy from "@/app/components/JobsGlobeLazy";

type NoCoordItem = {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  role_family: string | null;
  score: number | null;
  is_remote: boolean;
  location: string | null;
  loc_country: string | null;
  loc_city: string | null;
};

// Subset campi PositionCoord che servono per re-derivare donut/histogram
// + tree Location dal filtro location. Fetched in parallelo a
// /api/positions/no-coords.
type CoordItem = {
  id: string;
  title: string | null;
  company: string | null;
  role_family: string | null;
  score: number | null;
  loc_country: string | null;
  loc_city: string | null;
};

// Tree gerarchico restituito da /api/positions/locations
type LocationPositionLite = {
  id: string;
  title: string | null;
  company: string | null;
  score: number | null;
};
type LocationCity = {
  city: string | null;
  count: number;
  positions: LocationPositionLite[];
};
type LocationCountry = {
  country: string;
  count: number;
  cities: LocationCity[];
};

type Props = {
  typeDist: RoleFamilyCount[];
  fallbackScores: number[]; // score totali quando nessun tipo selezionato
  labels: Record<string, string>;
  emptyLabel: string;
  scoreTitle: string;
};

export default function MapCharts({
  typeDist,
  fallbackScores,
  labels,
  emptyLabel,
  scoreTitle,
}: Props) {
  // Multi-selezione. Vuoto = nessun filtro (mostra tutto).
  // Tra tipologie diverse: AND. Dentro la stessa tipologia: OR.
  // Post-dev2 refactor 2026-05-23: classificazione è data-driven da
  // positions.role_family (popolata dal team analyst). Niente più enum.
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedRanges, setSelectedRanges] = useState<
    Array<{ lo: number; hi: number }>
  >([]);
  const [unscoredSelected, setUnscoredSelected] = useState(false);
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

  const scoreFilterActive = selectedRanges.length > 0 || unscoredSelected;
  // True se p passa il filtro score combinato: nessun filtro attivo
  // OR (range match e ha score) OR (no-score selezionato e score null).
  const passScoreFilter = (score: number | null) => {
    if (!scoreFilterActive) return true;
    if (score == null) return unscoredSelected;
    return selectedRanges.some((r) => score >= r.lo && score <= r.hi);
  };

  // Filtro stesse regole della mappa (tipo + score + location).
  const noCoordsFiltered = useMemo(() => {
    return noCoords.filter((p) => {
      if (
        selectedTypes.length > 0 &&
        !selectedTypes.includes(p.role_family ?? UNCATEGORIZED_LABEL)
      )
        return false;
      if (!passScoreFilter(p.score)) return false;
      if (selectedCountries.length > 0 || selectedCities.length > 0) {
        const country = (p.loc_country ?? "").trim() || "(unknown)";
        const city = (p.loc_city ?? "").trim() || null;
        const cityKey = `${country}|${city ?? "(country-only)"}`;
        const matchCity = selectedCities.includes(cityKey);
        const matchCountry = selectedCountries.includes(country);
        if (!matchCity && !matchCountry) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    noCoords,
    selectedTypes,
    selectedRanges,
    unscoredSelected,
    selectedCountries,
    selectedCities,
  ]);

  // Tutte le posizioni (coords + no-coords) usate per re-derivare
  // donut/histogram/tree Location quando un filtro è attivo. Include
  // title+company per popolare le posizioni del drilldown Location.
  const allItemsLite = useMemo(() => {
    return [
      ...coordItems.map((p) => ({
        id: p.id,
        title: p.title,
        company: p.company,
        role_family: p.role_family,
        score: p.score,
        loc_country: p.loc_country,
        loc_city: p.loc_city,
      })),
      ...noCoords.map((p) => ({
        id: p.id,
        title: p.title,
        company: p.company,
        role_family: p.role_family,
        score: p.score,
        loc_country: p.loc_country,
        loc_city: p.loc_city,
      })),
    ];
  }, [coordItems, noCoords]);

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
  const effectiveTypeDist = useMemo<RoleFamilyCount[]>(() => {
    // Pre-fetch: fallback ai typeDist server-side (no filter applicato).
    if (allItemsLite.length === 0) return typeDist;
    const byFamily = new Map<string, { count: number; scores: number[] }>();
    for (const p of locScopeItems) {
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
  }, [allItemsLite, locScopeItems, typeDist]);

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
  }, [
    allItemsLite,
    locScopeItems,
    selectedTypes,
    typeDist,
    fallbackScores,
  ]);

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
  }, [
    allItemsLite,
    locScopeItems,
    selectedTypes,
    typeDist,
    histogramScores,
  ]);

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
    const byCountry = new Map<string, Map<string | null, LocationPositionLite[]>>();
    for (const p of filtered) {
      const country = (p.loc_country ?? "").trim() || "(unknown)";
      const city = (p.loc_city ?? "").trim() || null;
      const cMap = byCountry.get(country) ?? new Map<string | null, LocationPositionLite[]>();
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
  }, [allItemsLite, locations, selectedTypes, selectedRanges, unscoredSelected]);

  const toggleType = (t: string) =>
    setSelectedTypes((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
    );
  const toggleRange = (r: { lo: number; hi: number }) =>
    setSelectedRanges((cur) =>
      cur.some((x) => x.lo === r.lo && x.hi === r.hi)
        ? cur.filter((x) => !(x.lo === r.lo && x.hi === r.hi))
        : [...cur, r],
    );
  const toggleCountry = (c: string) =>
    setSelectedCountries((cur) =>
      cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c],
    );
  const toggleCity = (key: string) =>
    setSelectedCities((cur) =>
      cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key],
    );

  return (
    <>
      {/* Globo — riceve tutte le selezioni di filtro */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <JobsGlobeLazy
          fullscreen
          selectedTypes={selectedTypes}
          selectedScoreRanges={selectedRanges}
          selectedUnscored={unscoredSelected}
          selectedCountries={selectedCountries}
          selectedCities={selectedCities}
        />
      </div>

      {/* Chart top-right: posizione FISSA, mai si sposta. Eventuali
          chip della riga 1 vanno sopra (z-index più alto). */}
      <div
        className="map-bare-chart"
        style={{
          position: "absolute",
          top: 24,
          right: 24,
          width: 420,
          maxWidth: "calc(100vw - 48px)",
          zIndex: 10,
          pointerEvents: "auto",
        }}
      >
        <ScoreDistributionHorizontal
          scores={histogramScores}
          title={scoreTitle}
          emptyLabel={emptyLabel}
          selectedRanges={selectedRanges}
          onToggleRange={toggleRange}
          unscoredCount={unscoredCount}
          unscoredSelected={unscoredSelected}
          onToggleUnscored={() => setUnscoredSelected((v) => !v)}
        />
      </div>

      <FilterChipsBar
        chips={(() => {
          const arr: FilterChipDesc[] = [];
          for (const t of selectedTypes) {
            arr.push({
              key: `t-${t}`,
              label: labels[t] ?? String(t),
              color: typeDist.find((d) => d.family === t)?.color,
              onRemove: () => toggleType(t),
            });
          }
          for (const r of selectedRanges) {
            arr.push({
              key: `r-${r.lo}-${r.hi}`,
              label: `${r.lo}–${r.hi}`,
              onRemove: () => toggleRange(r),
            });
          }
          if (unscoredSelected) {
            arr.push({
              key: "unscored",
              label: "no score",
              onRemove: () => setUnscoredSelected(false),
            });
          }
          for (const c of selectedCountries) {
            arr.push({
              key: `co-${c}`,
              label: c,
              onRemove: () => toggleCountry(c),
            });
          }
          for (const ck of selectedCities) {
            // Mostra "City" (Country implicito) nel chip per brevità.
            const [country, city] = ck.split("|");
            arr.push({
              key: `ci-${ck}`,
              label: city === "(country-only)" ? country : (city ?? country),
              onRemove: () => toggleCity(ck),
            });
          }
          return arr;
        })()}
        clearAll={() => {
          setSelectedTypes([]);
          setSelectedRanges([]);
          setUnscoredSelected(false);
          setSelectedCountries([]);
          setSelectedCities([]);
        }}
        chartReserveRight={24 + 420 + 12}
      />

      {/* Card "Remote" — overlay bottom-right. Mostra le posizioni
          che non hanno coordinate (quindi non rappresentabili sulla
          mappa): tipicamente remote-only. Filtrata coerentemente
          con donut/histogram. */}
      {noCoordsFiltered.length > 0 && (() => {
        const scored = noCoordsFiltered.filter(
          (p): p is NoCoordItem & { score: number } =>
            typeof p.score === "number",
        );
        const avg =
          scored.length > 0
            ? Math.round(
                scored.reduce((a, s) => a + s.score, 0) / scored.length,
              )
            : null;
        return (
          <div
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg"
            style={{
              position: "absolute",
              bottom: 24,
              right: 24,
              zIndex: 10,
              width: 340,
              // Compatto: 280px max così non copre il chart Score
              // Distribution che sta in alto a dx; la lista scorre
              // internamente se ci sono molte righe.
              maxHeight: 280,
              display: "flex",
              flexDirection: "column",
              pointerEvents: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            <div
              className="px-4 py-3 border-b flex items-baseline justify-between gap-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div>
                <div
                  className="text-[10px] font-semibold tracking-[0.14em] uppercase"
                  style={{ color: "var(--color-dim)" }}
                >
                  Remote
                </div>
                <div
                  className="text-[9px] mt-0.5"
                  style={{ color: "var(--color-dim)" }}
                >
                  non sulla mappa
                </div>
              </div>
              <div className="flex items-baseline gap-3 tabular-nums">
                <span
                  className="text-[18px] font-bold"
                  style={{ color: "var(--color-bright)" }}
                >
                  {noCoordsFiltered.length}
                </span>
                {avg != null && (
                  <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                    <span style={{ color: "var(--color-dim)" }}>avg</span>{" "}
                    <span style={{ color: "var(--color-bright)", fontWeight: 600 }}>{avg}</span>
                  </span>
                )}
              </div>
            </div>
            <ul
              className="divide-y overflow-y-auto"
              style={{ borderColor: "var(--color-border)" }}
            >
              {noCoordsFiltered.map((p) => (
                <li
                  key={p.id}
                  className="px-4 py-2 text-[11px]"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="font-medium truncate"
                      style={{ color: "var(--color-bright)" }}
                      title={p.title ?? ""}
                    >
                      {p.title ?? "(senza titolo)"}
                    </span>
                    {typeof p.score === "number" ? (
                      <span
                        className="tabular-nums font-semibold flex-shrink-0"
                        style={{ color: "var(--color-muted)" }}
                      >
                        {p.score}
                      </span>
                    ) : (
                      <span
                        className="text-[9px] italic flex-shrink-0"
                        style={{ color: "var(--color-dim)" }}
                      >
                        no score
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[10px] truncate flex items-center gap-2"
                    style={{ color: "var(--color-muted)" }}
                  >
                    <span className="truncate">{p.company ?? "—"}</span>
                    {p.is_remote && (
                      <span
                        className="text-[8px] font-semibold tracking-widest uppercase px-1 rounded flex-shrink-0"
                        style={{
                          color: "var(--color-green)",
                          background: "rgba(127,255,178,0.08)",
                        }}
                      >
                        remote
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Tree gerarchico Location: country → city → posizioni.
          Ricalcolato client-side da allItemsLite con i filtri tipi+score
          applicati → count e nodi visibili riflettono le selezioni
          donut/histogram. Click su country/city = filtra la mappa E
          apre/chiude il drilldown. Click position → apre /positions/<id>. */}
      {effectiveLocationTree.length > 0 && (
        <LocationTree
          tree={effectiveLocationTree}
          openCountry={openCountry}
          openCity={openCity}
          selectedCountries={selectedCountries}
          selectedCities={selectedCities}
          onCountryClick={(c) => {
            const isOpen = openCountry === c;
            setOpenCountry(isOpen ? null : c);
            setOpenCity(null);
            toggleCountry(c);
          }}
          onCityClick={(key) => {
            const isOpen = openCity === key;
            setOpenCity(isOpen ? null : key);
            toggleCity(key);
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

      {/* Position Types donut — overlay bottom-left */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 24,
          zIndex: 10,
          pointerEvents: "auto",
        }}
      >
        <PositionTypesDonut
          data={effectiveTypeDist}
          emptyLabel={emptyLabel}
          size={280}
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

    </>
  );
}

type FilterChipDesc = {
  key: string;
  label: string;
  color?: string;
  onRemove: () => void;
};

function FilterChipsBar({
  chips,
  clearAll,
  chartReserveRight,
}: {
  chips: FilterChipDesc[];
  clearAll: () => void;
  chartReserveRight: number;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [row1End, setRow1End] = useState(chips.length);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    if (kids.length === 0) {
      setRow1End(0);
      return;
    }
    const top0 = kids[0].offsetTop;
    let i = 0;
    for (; i < kids.length; i++) {
      if (kids[i].offsetTop !== top0) break;
    }
    setRow1End(i);
  });

  if (chips.length === 0) return null;

  const row1 = chips.slice(0, row1End);
  const extra = chips.slice(row1End);

  return (
    <>
      {/* Container "measure" invisibile: misura quanti chip stanno
          nella riga 1 full-width (= dal bordo destro dello schermo
          fino a left:24). Include uno spacer per il bottone "clear
          all" che sarà aggiunto nella riga 2 se overflow. */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          top: -9999,
          left: 0,
          // larghezza measurement piu' stretta del container reale
          // (-16px buffer) cosi' la conta non eccede mai e i chip
          // restano dentro lo schermo senza essere tagliati a sx.
          width: "calc(100vw - 64px)",
          visibility: "hidden",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 4,
          pointerEvents: "none",
        }}
      >
        {chips.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            color={c.color}
            onRemove={c.onRemove}
          />
        ))}
      </div>

      {/* Riga 1: full screen width, ancorata a right:24. Va SOPRA
          al chart (z-index alto) — chart resta fermo a top:24.
          overflow:hidden + height:30: se la measurement contasse
          un chip in più (precisione pixel sub-pixel), l'eccedenza
          a sx resta tagliata invece di sforare fuori schermo. */}
      <div
        style={{
          position: "absolute",
          top: 24,
          left: 24,
          right: 24,
          height: 30,
          overflow: "hidden",
          zIndex: 20,
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 4,
          pointerEvents: "auto",
        }}
      >
        {row1.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            color={c.color}
            onRemove={c.onRemove}
          />
        ))}
        {extra.length === 0 && <ClearAllButton onClick={clearAll} />}
      </div>

      {/* Riga 2+: limitata a sinistra del chart, sotto la riga 1. */}
      {extra.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 24,
            right: chartReserveRight,
            zIndex: 10,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 4,
            pointerEvents: "auto",
          }}
        >
          {extra.map((c) => (
            <FilterChip
              key={c.key}
              label={c.label}
              color={c.color}
              onRemove={c.onRemove}
            />
          ))}
          <ClearAllButton onClick={clearAll} />
        </div>
      )}
    </>
  );
}

function ClearAllButton({ onClick }: { onClick: () => void }) {
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
      title="Rimuovi tutti i filtri"
    >
      clear all
    </button>
  );
}

function FilterChip({
  label,
  color,
  onRemove,
}: {
  label: string;
  color?: string;
  onRemove: () => void;
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
        aria-label={`Rimuovi ${label}`}
        title={`Rimuovi ${label}`}
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

// ── Sidebar Location: tree gerarchico country → cities → positions ──
// Una sola country aperta alla volta, una sola city aperta dentro di
// essa. Click su una position apre /positions/<id> in nuova tab.
function LocationTree({
  tree,
  openCountry,
  openCity,
  selectedCountries,
  selectedCities,
  onCountryClick,
  onCityClick,
  onCountryCaret,
  onCityCaret,
}: {
  tree: LocationCountry[];
  openCountry: string | null;
  openCity: string | null;
  selectedCountries: string[];
  selectedCities: string[];
  onCountryClick: (c: string) => void;
  onCityClick: (key: string) => void;
  // Click solo sulla freccia ▶/▼: apri/chiudi senza toccare il filtro.
  onCountryCaret: (c: string) => void;
  onCityCaret: (key: string) => void;
}) {
  // Conteggio totale (somma count countries) per il badge header.
  const total = tree.reduce((s, c) => s + c.count, 0);
  return (
    <div
      className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg"
      style={{
        position: "absolute",
        // Top: 60 → la riga "LOCATION header" coincide visualmente
        // con la prima barra del chart Score Distribution dx (che ha
        // un padding-top interno SVG che pushava la prima barra in giù).
        top: 60,
        left: 24,
        bottom: 24 + 280 + 16,
        zIndex: 10,
        // Width: donut (280) + gap (16) + zona label (~160) ≈ 460
        // → la card Location si allinea sotto al donut+labels.
        width: 460,
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div
        className="px-4 py-2 border-b text-[10px] font-semibold tracking-[0.14em] uppercase flex items-baseline justify-between"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-dim)",
        }}
      >
        <span>Location</span>
        <span
          className="tabular-nums"
          style={{ color: "var(--color-muted)" }}
        >
          {tree.length} · {total}
        </span>
      </div>
      <ul
        className="divide-y overflow-y-auto"
        style={{ borderColor: "var(--color-border)" }}
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
                    color: isSelected || isOpen
                      ? "var(--color-bright)"
                      : "var(--color-base)",
                    fontWeight: isSelected || isOpen ? 600 : 400,
                  }}
                  title={country.country}
                >
                  <button
                    aria-label={isOpen ? "Chiudi" : "Apri"}
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
                    color: isSelected || isOpen
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
                    const cityLabel = city.city ?? "(senza città)";
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
                              color: isCitySelected || isCityOpen
                                ? "var(--color-bright)"
                                : "var(--color-muted)",
                              fontWeight: isCitySelected || isCityOpen ? 600 : 400,
                              fontStyle: city.city ? "normal" : "italic",
                            }}
                            title={cityLabel}
                          >
                            <button
                              aria-label={isCityOpen ? "Chiudi" : "Apri"}
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
                              color: isCitySelected || isCityOpen
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
                                <a
                                  href={`/positions/${p.id}`}
                                  target="_blank"
                                  rel="noopener"
                                  className="block px-4 py-1 pl-10 text-[10px] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                                  style={{ textDecoration: "none" }}
                                >
                                  <div
                                    className="flex items-baseline justify-between gap-2"
                                  >
                                    <span
                                      className="truncate"
                                      style={{ color: "var(--color-base)" }}
                                      title={p.title ?? ""}
                                    >
                                      {p.title ?? "(senza titolo)"}
                                    </span>
                                    {typeof p.score === "number" && (
                                      <span
                                        className="tabular-nums font-semibold flex-shrink-0"
                                        style={{
                                          color: "var(--color-muted)",
                                        }}
                                      >
                                        {p.score}
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className="text-[9px] truncate"
                                    style={{ color: "var(--color-dim)" }}
                                  >
                                    {p.company ?? "—"}
                                  </div>
                                </a>
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
    </div>
  );
}
