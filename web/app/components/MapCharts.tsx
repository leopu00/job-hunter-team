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
  const [noCoords, setNoCoords] = useState<NoCoordItem[]>([]);
  const [bucketOpen, setBucketOpen] = useState(false);

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

  const inSelectedRanges = (score: number) =>
    selectedRanges.length === 0 ||
    selectedRanges.some((r) => score >= r.lo && score <= r.hi);

  // Filtro stesse regole della mappa (tipo + range score).
  const noCoordsFiltered = useMemo(() => {
    return noCoords.filter((p) => {
      if (
        selectedTypes.length > 0 &&
        !selectedTypes.includes(classifyTitle(p.title))
      )
        return false;
      if (selectedRanges.length > 0) {
        if (typeof p.score !== "number") return false;
        if (!inSelectedRanges(p.score)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noCoords, selectedTypes, selectedRanges]);

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

  return (
    <>
      {/* Globo — riceve liste tipi + range per filtro AND/OR */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <CompanyGlobeLazy
          fullscreen
          selectedTypes={selectedTypes}
          selectedScoreRanges={selectedRanges}
        />
      </div>

      {/* Colonna destra: Score Distribution + bucket "senza coord"
          sotto, ancorati top-right per restare allineati a vista. */}
      <div
        style={{
          position: "absolute",
          top: 24,
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
          />
        </div>

        {/* Bucket "+ N senza coord" — sotto il chart. Popover si apre
            verso il basso. */}
        {noCoordsFiltered.length > 0 && (
        <div style={{ position: "relative", pointerEvents: "auto" }}>
          <button
            onClick={() => setBucketOpen((v) => !v)}
            className="text-[11px] font-semibold tracking-wide px-3 py-1.5 rounded-full border bg-[var(--color-panel)] hover:bg-[var(--color-card)] transition-colors"
            style={{
              color: "var(--color-bright)",
              borderColor: "var(--color-border)",
              cursor: "pointer",
            }}
            aria-expanded={bucketOpen}
          >
            + {noCoordsFiltered.length} senza coord
          </button>
          {bucketOpen && (
            <div
              role="dialog"
              className="absolute top-full right-0 mt-2 w-80 max-h-[60vh] overflow-y-auto rounded-md border bg-[var(--color-panel)] shadow-2xl"
              style={{
                borderColor: "var(--color-border)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
              }}
            >
              <div
                className="px-3 py-2 text-[9px] font-semibold tracking-[0.14em] uppercase border-b"
                style={{
                  color: "var(--color-dim)",
                  borderColor: "var(--color-border)",
                }}
              >
                Posizioni senza coordinate ufficio
              </div>
              <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {noCoordsFiltered.map((p) => (
                  <li
                    key={p.id}
                    className="px-3 py-2 text-[11px]"
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
                      {typeof p.score === "number" && (
                        <span
                          className="tabular-nums font-semibold"
                          style={{ color: "var(--color-muted)" }}
                        >
                          {p.score}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[10px] truncate flex items-center gap-2"
                      style={{ color: "var(--color-muted)" }}
                    >
                      <span>{p.company ?? "—"}</span>
                      {p.is_remote && (
                        <span
                          className="text-[8px] font-semibold tracking-widest uppercase px-1 rounded"
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
          )}
        </div>
        )}
      </div>

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
            // Pulisci range che non esistono più dopo cambio set tipi.
            setSelectedRanges([]);
          }}
        />
      </div>

    </>
  );
}
