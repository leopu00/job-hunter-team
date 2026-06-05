"use client";

import { useMemo, useState } from "react";
import {
  aggregateRoleFamilies,
  UNCATEGORIZED_LABEL,
} from "@/lib/position-classifier";
import type { DashboardPosition } from "@/lib/queries";
import PositionTypesPie from "@/app/components/PositionTypesPie";
import ScoreDistribution from "@/app/components/ScoreDistribution";
import LocationBarList, {
  type LocationBarItem,
} from "@/app/components/LocationBarList";
import RecentPositionsTable, {
  type TableLabels,
} from "@/app/components/RecentPositionsTable";

// Titoli localizzati passati dal server component.
type Labels = {
  types: string;
  countries: string;
  cities: string;
  score: string;
  noData: string;
  reset: string;
  table: TableLabels;
};

type Props = {
  positions: DashboardPosition[];
  labels: Labels;
  // Quante righe mostrare in tabella (default 15, come prima).
  tableLimit?: number;
};

const SCORE_BIN = 5;
const UNKNOWN = "(unknown)";
const COUNTRY_ONLY = "(country-only)";

// Chiavi canoniche — identiche a PositionsFilterSidebar / queries.ts, così il
// cross-filter è coerente con la sidebar /positions e la mappa.
const familyKey = (rf: string | null) =>
  (rf ?? "").trim() || UNCATEGORIZED_LABEL;
const countryKey = (c: string | null) => (c ?? "").trim() || UNKNOWN;
const cityKey = (c: string | null, ci: string | null) =>
  `${countryKey(c)}|${(ci ?? "").trim() || COUNTRY_ONLY}`;

export default function DashboardLinkedCharts({
  positions,
  labels,
  tableLimit = 15,
}: Props) {
  // La dashboard ragiona sull'universo "attivo" (la query già esclude le
  // scartate, ma teniamo il filtro per robustezza anche in demo).
  const rows = useMemo(
    () => positions.filter((f) => f.status !== "excluded"),
    [positions],
  );

  const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedScoreBins, setSelectedScoreBins] = useState<number[]>([]);

  const totalActive =
    selectedFamilies.length +
    selectedCountries.length +
    selectedCities.length +
    selectedScoreBins.length;

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
  ) =>
    setter((cur) =>
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );

  function resetAll() {
    setSelectedFamilies([]);
    setSelectedCountries([]);
    setSelectedCities([]);
    setSelectedScoreBins([]);
  }

  // ── Predicati cross-filter (mirror di MapCharts / sidebar /positions) ──
  const locationActive =
    selectedCountries.length > 0 || selectedCities.length > 0;
  const passFamily = (p: DashboardPosition) =>
    selectedFamilies.length === 0 ||
    selectedFamilies.includes(familyKey(p.role_family));
  const passLocation = (p: DashboardPosition) => {
    if (!locationActive) return true;
    if (selectedCities.includes(cityKey(p.loc_country, p.loc_city))) return true;
    if (selectedCountries.includes(countryKey(p.loc_country))) return true;
    return false;
  };
  const passScore = (score: number | null) => {
    if (selectedScoreBins.length === 0) return true;
    if (score == null || score <= 0) return false;
    return selectedScoreBins.some((lo) => score >= lo && score < lo + SCORE_BIN);
  };

  // Types: scope per location + score (esclude la propria dimensione).
  const typeData = useMemo(() => {
    const pool = rows.filter((p) => passLocation(p) && passScore(p.score));
    return aggregateRoleFamilies(
      pool.map((p) => ({ role_family: p.role_family, score: p.score, critic: null })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedCountries, selectedCities, selectedScoreBins]);

  // Paesi: scope per family + score (esclude la dimensione location).
  const countryItems = useMemo(() => {
    const pool = rows.filter((p) => passFamily(p) && passScore(p.score));
    const byCountry = new Map<string, number>();
    for (const p of pool) {
      const k = countryKey(p.loc_country);
      byCountry.set(k, (byCountry.get(k) ?? 0) + 1);
    }
    const real: LocationBarItem[] = [];
    let unknown = 0;
    for (const [k, count] of byCountry) {
      if (k === UNKNOWN) unknown = count;
      else real.push({ key: k, label: k, count });
    }
    real.sort((a, b) => b.count - a.count);
    if (unknown > 0)
      real.push({
        key: UNKNOWN,
        label: "Senza paese",
        count: unknown,
        muted: true,
      });
    return { items: real, distinct: byCountry.size - (unknown > 0 ? 1 : 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedFamilies, selectedScoreBins]);

  // Città: scope per family + score. Il paese resta come sublabel per
  // disambiguare città omonime; le "country-only" confluiscono in una riga
  // aggregata non filtrabile.
  const cityItems = useMemo(() => {
    const pool = rows.filter((p) => passFamily(p) && passScore(p.score));
    const byCity = new Map<string, { count: number; country: string }>();
    let noCity = 0;
    for (const p of pool) {
      const city = (p.loc_city ?? "").trim();
      if (!city) {
        noCity++;
        continue;
      }
      const k = cityKey(p.loc_country, p.loc_city);
      const cur = byCity.get(k) ?? { count: 0, country: countryKey(p.loc_country) };
      cur.count++;
      byCity.set(k, cur);
    }
    const real: LocationBarItem[] = Array.from(byCity.entries())
      .map(([k, v]) => ({
        key: k,
        label: k.split("|")[1],
        sublabel: v.country === UNKNOWN ? undefined : v.country,
        count: v.count,
      }))
      .sort((a, b) => b.count - a.count);
    const items = [...real];
    if (noCity > 0)
      items.push({
        key: "(no-city)",
        label: "Senza città",
        count: noCity,
        muted: true,
        selectable: false,
      });
    return { items, distinct: real.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedFamilies, selectedScoreBins]);

  // Score: scope per location + family (esclude la propria dimensione).
  const scoreData = useMemo(() => {
    const pool = rows.filter((p) => passLocation(p) && passFamily(p));
    return pool
      .map((p) => p.score)
      .filter((s): s is number => typeof s === "number" && s > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedCountries, selectedCities, selectedFamilies]);

  // Tabella: posizioni che soddisfano TUTTI i filtri attivi, già ordinate
  // per recency (la query restituisce last_action_at desc). Top N.
  const tableMatches = useMemo(
    () =>
      rows.filter((p) => passFamily(p) && passLocation(p) && passScore(p.score)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selectedFamilies, selectedCountries, selectedCities, selectedScoreBins],
  );

  return (
    <div>
      {totalActive > 0 && (
        <div className="flex items-center justify-end mb-2">
          <button
            type="button"
            onClick={resetAll}
            className="text-[9px] font-semibold tracking-[0.12em] uppercase cursor-pointer text-[var(--color-dim)] hover:text-[var(--color-bright)] transition-colors"
            title="Rimuovi tutti i filtri"
          >
            ✕ {labels.reset} · {totalActive}
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start mb-8">
        {/* Colonna sinistra: Types sopra, Score distribution sotto. */}
        <div className="flex flex-col gap-4">
          <PositionTypesPie
            data={typeData}
            title={labels.types}
            emptyLabel={labels.noData}
            size={300}
            selectedTypes={selectedFamilies}
            onToggleType={(f) => toggle(setSelectedFamilies, f)}
          />
          <ScoreDistribution
            scores={scoreData}
            title={labels.score}
            emptyLabel={labels.noData}
            selectedBins={selectedScoreBins}
            onToggleBin={(lo) =>
              setSelectedScoreBins((cur) =>
                cur.includes(lo) ? cur.filter((v) => v !== lo) : [...cur, lo],
              )
            }
          />
        </div>
        {/* Colonna destra: Paesi sopra, Città sotto. */}
        <div className="flex flex-col gap-4">
          <LocationBarList
            items={countryItems.items}
            title={labels.countries}
            emptyLabel={labels.noData}
            headerCount={countryItems.distinct}
            selectedKeys={selectedCountries}
            onToggle={(k) => toggle(setSelectedCountries, k)}
          />
          <LocationBarList
            items={cityItems.items}
            title={labels.cities}
            emptyLabel={labels.noData}
            headerCount={cityItems.distinct}
            selectedKeys={selectedCities}
            onToggle={(k) => toggle(setSelectedCities, k)}
          />
        </div>
      </div>

      {/* Tabella collegata ai filtri: senza filtri = più recenti; con
      filtri = più recenti tra quelle che soddisfano la selezione. */}
      <RecentPositionsTable
        rows={tableMatches.slice(0, tableLimit)}
        labels={labels.table}
        filtered={totalActive > 0}
        totalFiltered={tableMatches.length}
      />
    </div>
  );
}
