"use client";

import { useEffect, useMemo, useState } from "react";
import {
  classifyTitle,
  type PositionType,
  type PositionTypeCount,
} from "@/lib/position-classifier";
import PositionTypesDonut from "@/app/components/PositionTypesDonut";
import ScoreDistributionHorizontal from "@/app/components/ScoreDistributionHorizontal";
import CompanyGlobeLazy from "@/app/components/CompanyGlobeLazy";

type NoCoordItem = {
  id: string;
  title: string | null;
  company: string | null;
  status: string;
  score: number | null;
  is_remote: boolean;
  location: string | null;
};

type LocationCount = {
  location: string;
  count: number;
};

type Props = {
  typeDist: PositionTypeCount[];
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
  const [selectedTypes, setSelectedTypes] = useState<PositionType[]>([]);
  const [selectedRanges, setSelectedRanges] = useState<
    Array<{ lo: number; hi: number }>
  >([]);
  const [unscoredSelected, setUnscoredSelected] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [noCoords, setNoCoords] = useState<NoCoordItem[]>([]);
  const [locations, setLocations] = useState<LocationCount[]>([]);

  // Fetch lista posizioni senza coords una volta al mount.
  useEffect(() => {
    let cancel = false;
    fetch("/api/positions/no-coords")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: NoCoordItem[]) => {
        if (!cancel) setNoCoords(Array.isArray(d) ? d : []);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  // Fetch conteggio per location.
  useEffect(() => {
    let cancel = false;
    fetch("/api/positions/locations")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: LocationCount[]) => {
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
        !selectedTypes.includes(classifyTitle(p.title))
      )
        return false;
      if (!passScoreFilter(p.score)) return false;
      if (
        selectedLocations.length > 0 &&
        !selectedLocations.includes(p.location ?? "—")
      )
        return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noCoords, selectedTypes, selectedRanges, unscoredSelected, selectedLocations]);

  // Score grezzi mostrati nel histogram:
  //   - se nessun tipo selezionato → fallbackScores (tutti)
  //   - altrimenti → concat degli scores dei tipi selezionati.
  const histogramScores = useMemo(() => {
    if (selectedTypes.length === 0) return fallbackScores;
    const out: number[] = [];
    for (const t of selectedTypes) {
      const entry = typeDist.find((d) => d.type === t);
      if (entry?.scores) out.push(...entry.scores);
    }
    return out;
  }, [selectedTypes, typeDist, fallbackScores]);

  // Posizioni nel dataset corrente SENZA score numerico:
  // totale (filtrato per tipi se selezionati) - quante hanno score.
  // Coerente col donut: count include unscored, histogram.scores no.
  const unscoredCount = useMemo(() => {
    const totalInScope =
      selectedTypes.length === 0
        ? typeDist.reduce((a, d) => a + d.count, 0)
        : typeDist
            .filter((d) => selectedTypes.includes(d.type))
            .reduce((a, d) => a + d.count, 0);
    return Math.max(0, totalInScope - histogramScores.length);
  }, [selectedTypes, typeDist, histogramScores]);

  const accentLabel =
    selectedTypes.length === 0
      ? undefined
      : selectedTypes.length === 1
        ? labels[selectedTypes[0]] ?? String(selectedTypes[0])
        : `${selectedTypes.length} tipi`;
  const accentColor =
    selectedTypes.length === 1
      ? typeDist.find((t) => t.type === selectedTypes[0])?.color
      : undefined;

  const toggleType = (t: PositionType) =>
    setSelectedTypes((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
    );
  const toggleRange = (r: { lo: number; hi: number }) =>
    setSelectedRanges((cur) =>
      cur.some((x) => x.lo === r.lo && x.hi === r.hi)
        ? cur.filter((x) => !(x.lo === r.lo && x.hi === r.hi))
        : [...cur, r],
    );
  const toggleLocation = (loc: string) =>
    setSelectedLocations((cur) =>
      cur.includes(loc) ? cur.filter((x) => x !== loc) : [...cur, loc],
    );

  return (
    <>
      {/* Globo — riceve tutte le selezioni di filtro */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <CompanyGlobeLazy
          fullscreen
          selectedTypes={selectedTypes}
          selectedScoreRanges={selectedRanges}
          selectedUnscored={unscoredSelected}
          selectedLocations={selectedLocations}
        />
      </div>

      {/* Colonna destra: Score Distribution + bucket "senza coord"
          sotto, ancorati top-right per restare allineati a vista. */}
      <div
        style={{
          position: "absolute",
          top: 24,
          // I controlli zoom MapLibre ora stanno in top-left sotto
          // "Vista generale", quindi il chart torna al bordo destro.
          right: 24,
          zIndex: 10,
          width: 420,
          maxWidth: "calc(100vw - 48px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 12,
          pointerEvents: "none",
        }}
      >
        <div
          className="map-bare-chart"
          style={{ width: "100%", pointerEvents: "auto" }}
        >
          <ScoreDistributionHorizontal
            scores={histogramScores}
            title={scoreTitle}
            emptyLabel={emptyLabel}
            accentLabel={accentLabel}
            accentColor={accentColor}
            selectedRanges={selectedRanges}
            onToggleRange={toggleRange}
            unscoredCount={unscoredCount}
            unscoredSelected={unscoredSelected}
            onToggleUnscored={() => setUnscoredSelected((v) => !v)}
          />
        </div>

      </div>

      {/* Card "Company" — overlay bottom-right. Mostra le posizioni
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
                  Company
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

      {/* Lista paesi/location — overlay sopra il donut, bottom-left.
          Dati grezzi non normalizzati (location come è nel DB). */}
      {locations.length > 0 && (
        <div
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg"
          style={{
            position: "absolute",
            // Donut: bottom 24, height ~280 (size 280) + padding.
            // Lascio 16px gap.
            bottom: 24 + 280 + 16,
            left: 24,
            zIndex: 10,
            width: 240,
            maxHeight: 240,
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
              {locations.length}
            </span>
          </div>
          <ul
            className="divide-y overflow-y-auto"
            style={{ borderColor: "var(--color-border)" }}
          >
            {locations.map((loc) => {
              const isSelected = selectedLocations.includes(loc.location);
              const hasSel = selectedLocations.length > 0;
              return (
                <li
                  key={loc.location}
                  onClick={() => toggleLocation(loc.location)}
                  className="px-4 py-1.5 text-[11px] flex items-baseline justify-between gap-2 transition-colors"
                  style={{
                    borderColor: "var(--color-border)",
                    cursor: "pointer",
                    background: isSelected
                      ? "rgba(255,255,255,0.06)"
                      : "transparent",
                    opacity: hasSel && !isSelected ? 0.45 : 1,
                  }}
                >
                  <span
                    className="truncate"
                    style={{
                      color: isSelected
                        ? "var(--color-bright)"
                        : "var(--color-base)",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    title={loc.location}
                  >
                    {loc.location}
                  </span>
                  <span
                    className="tabular-nums font-semibold flex-shrink-0"
                    style={{
                      color: isSelected
                        ? "var(--color-bright)"
                        : "var(--color-muted)",
                    }}
                  >
                    {loc.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
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
          data={typeDist}
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
