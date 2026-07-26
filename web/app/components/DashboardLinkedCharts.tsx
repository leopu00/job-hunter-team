"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import {
  aggregateRoleFamilies,
  groupRoleFamilies,
  OTHER_GROUP_LABEL,
  UNCATEGORIZED_LABEL,
} from "@/lib/position-classifier";
import type { DashboardPosition } from "@/lib/queries";
import { DISPLAY_CURRENCY_COOKIE } from "@/lib/display-currency";
import PositionTypesPie from "@/app/components/PositionTypesPie";
import ScoreDistribution from "@/app/components/ScoreDistribution";
import LocationBarList, {
  type LocationBarItem,
} from "@/app/components/LocationBarList";
import RecentPositionsTable, {
  type TableLabels,
} from "@/app/components/RecentPositionsTable";
import SalaryBars from "@/app/components/SalaryBars";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./DashboardLinkedCharts.i18n";
import {
  convertCurrency,
  currencySymbol,
  formatMoneyCompact,
  type Rates,
} from "@/lib/exchange-rates";

// Titoli localizzati passati dal server component.
type Labels = {
  types: string;
  countries: string;
  cities: string;
  score: string;
  salary: string;
  noData: string;
  reset: string;
  table: TableLabels;
};

// Range annuale plausibile, valutato in EUR (così il filtro outlier è
// stabile a prescindere dalla valuta visualizzata).
const SALARY_MIN_EUR = 10000;
const SALARY_MAX_EUR = 300000;

type Props = {
  positions: DashboardPosition[];
  labels: Labels;
  // Tassi di cambio (base EUR) per il convertitore stipendi.
  rates: Rates;
  // Valute selezionabili nel selettore (base + aggiunte in Impostazioni).
  currencies: string[];
  // Quante righe mostrare in tabella (default 15, come prima).
  tableLimit?: number;
};

// Stringhe UI hardcoded localizzate (le altre arrivano già tradotte via
// `labels` dal server component).

const SCORE_BIN = 5;
const SALARY_BIN = 20000;
const UNKNOWN = "(unknown)";
const COUNTRY_ONLY = "(country-only)";

// Chiavi canoniche — identiche a PositionsFilterSidebar / queries.ts, così il
// cross-filter è coerente con la sidebar /positions e la mappa.
const familyKey = (rf: string | null) =>
  (rf ?? "").trim() || UNCATEGORIZED_LABEL;
// Il donut ragiona per MACRO-categoria (la parte prima di "/" nel nome scritto
// dagli agenti), quindi anche il cross-filter deve confrontare i macro: un
// clic su "F&B" seleziona Hostess, Restaurant Service, Wine Service insieme.
const macroKey = (rf: string | null) => {
  const full = familyKey(rf);
  const head = full.split("/")[0]?.trim();
  return head && head.length > 0 ? head : full;
};
const countryKey = (c: string | null) => (c ?? "").trim() || UNKNOWN;
const cityKey = (c: string | null, ci: string | null) =>
  `${countryKey(c)}|${(ci ?? "").trim() || COUNTRY_ONLY}`;

export default function DashboardLinkedCharts({
  positions,
  labels,
  rates,
  currencies,
  tableLimit = 15,
}: Props) {
  const locale = useLocale();
  const tr = makeT(T, locale);
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
  const [selectedSalaryBins, setSelectedSalaryBins] = useState<number[]>([]);
  const [displayCurrency, setDisplayCurrency] = useState<string>("EUR");
  // Selezione iniziale = valuta preferita (Impostazioni → Valuta stipendi),
  // se tra quelle offerte dal selettore. In useEffect (non nell'initializer)
  // per non creare mismatch di idratazione col render server.
  useEffect(() => {
    const m = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${DISPLAY_CURRENCY_COOKIE}=([^;]+)`),
    );
    const pref = m ? decodeURIComponent(m[1]).toUpperCase() : null;
    if (pref && currencies.includes(pref)) setDisplayCurrency(pref);
  }, [currencies]);

  // Banner "Filtri · N": apre/chiude la lista dei filtri attivi rimovibili.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);

  // Punto medio del range stipendio, SEMPRE normalizzato in EUR. Binning e
  // filtro lavorano in EUR così la forma dell'istogramma non dipende dalla
  // valuta visualizzata: la conversione avviene solo sulle etichette.
  const salaryValueEur = (p: DashboardPosition): number | null => {
    const { salary_min: lo, salary_max: hi } = p;
    let v: number | null = null;
    if (lo != null && hi != null) v = (lo + hi) / 2;
    else if (lo != null) v = lo;
    else if (hi != null) v = hi;
    if (v == null) return null;
    const eur = convertCurrency(v, p.salary_currency, "EUR", rates);
    if (eur < SALARY_MIN_EUR || eur >= SALARY_MAX_EUR) return null;
    return eur;
  };

  const totalActive =
    selectedFamilies.length +
    selectedCountries.length +
    selectedCities.length +
    selectedScoreBins.length +
    selectedSalaryBins.length;

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
    setSelectedSalaryBins([]);
  }

  // Chiudi il banner cliccando fuori, o quando non restano più filtri.
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node))
        setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [filtersOpen]);
  useEffect(() => {
    if (totalActive === 0) setFiltersOpen(false);
  }, [totalActive]);

  // Etichetta compatta di un bin stipendio (bordi in EUR → valuta scelta).
  const salaryBinLabel = (lo: number) => {
    const sym = currencySymbol(displayCurrency);
    const f = (n: number) =>
      formatMoneyCompact(convertCurrency(n, "EUR", displayCurrency, rates));
    return `${sym}${f(lo)}–${f(lo + SALARY_BIN)}`;
  };

  // Lista piatta dei filtri attivi (label + rimozione singola), una voce per
  // ogni valore selezionato in ciascuna dimensione.
  const activeFilters: { id: string; label: string; remove: () => void }[] = [
    ...selectedFamilies.map((v) => ({
      id: `fam:${v}`,
      label: v,
      remove: () => setSelectedFamilies((c) => c.filter((x) => x !== v)),
    })),
    ...selectedCountries.map((v) => ({
      id: `cty:${v}`,
      label: v === UNKNOWN ? tr("no_country") : v,
      remove: () => setSelectedCountries((c) => c.filter((x) => x !== v)),
    })),
    ...selectedCities.map((v) => {
      const [country, city] = v.split("|");
      return {
        id: `cit:${v}`,
        label: city === COUNTRY_ONLY ? `${country} · ${tr("no_city")}` : city,
        remove: () => setSelectedCities((c) => c.filter((x) => x !== v)),
      };
    }),
    ...selectedScoreBins.map((lo) => ({
      id: `sco:${lo}`,
      label: `${tr("score_prefix")} ${lo}–${lo + SCORE_BIN}`,
      remove: () => setSelectedScoreBins((c) => c.filter((x) => x !== lo)),
    })),
    ...selectedSalaryBins.map((lo) => ({
      id: `sal:${lo}`,
      label: salaryBinLabel(lo),
      remove: () => setSelectedSalaryBins((c) => c.filter((x) => x !== lo)),
    })),
  ];

  // ── Predicati cross-filter (mirror di MapCharts / sidebar /positions) ──
  const locationActive =
    selectedCountries.length > 0 || selectedCities.length > 0;
  const passFamily = (p: DashboardPosition) =>
    selectedFamilies.length === 0 ||
    selectedFamilies.includes(macroKey(p.role_family));
  const passLocation = (p: DashboardPosition) => {
    if (!locationActive) return true;
    if (selectedCities.includes(cityKey(p.loc_country, p.loc_city)))
      return true;
    if (selectedCountries.includes(countryKey(p.loc_country))) return true;
    return false;
  };
  // Paese↔città sono gerarchici: la lista Città è ristretta ai paesi
  // selezionati (ma NON alle città già scelte, così puoi sceglierne altre).
  const passSelectedCountry = (p: DashboardPosition) =>
    selectedCountries.length === 0 ||
    selectedCountries.includes(countryKey(p.loc_country));
  const passScore = (score: number | null) => {
    if (selectedScoreBins.length === 0) return true;
    if (score == null || score <= 0) return false;
    return selectedScoreBins.some(
      (lo) => score >= lo && score < lo + SCORE_BIN,
    );
  };
  const passSalary = (p: DashboardPosition) => {
    if (selectedSalaryBins.length === 0) return true;
    const v = salaryValueEur(p);
    if (v == null) return false;
    return selectedSalaryBins.some((lo) => v >= lo && v < lo + SALARY_BIN);
  };

  // Types: scope per location + score (esclude la propria dimensione).
  const typeData = useMemo(() => {
    const pool = rows.filter(
      (p) => passLocation(p) && passScore(p.score) && passSalary(p),
    );
    return groupRoleFamilies(
      aggregateRoleFamilies(
        pool.map((p) => ({
          role_family: p.role_family,
          score: p.score,
          critic: null,
        })),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows,
    selectedCountries,
    selectedCities,
    selectedScoreBins,
    selectedSalaryBins,
  ]);

  // Etichetta localizzata dello spicchio "Altre", con quanti tipi contiene.
  const otherGroupLabel = useMemo(() => {
    const other = typeData.find((d) => d.family === OTHER_GROUP_LABEL);
    if (!other) return undefined;
    return {
      [OTHER_GROUP_LABEL]: tr("other_types").replace(
        "{n}",
        String(other.members.length),
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeData, locale]);

  // Paesi: scope per family + score (esclude la dimensione location).
  const countryItems = useMemo(() => {
    const pool = rows.filter(
      (p) => passFamily(p) && passScore(p.score) && passSalary(p),
    );
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
        label: tr("no_country"),
        count: unknown,
        muted: true,
      });
    return { items: real, distinct: byCountry.size - (unknown > 0 ? 1 : 0) };
    // locale: la label "Senza paese" passa da tr() → va ricalcolata al cambio
    // lingua (useLocale parte da 'it' e flippa dopo il mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedFamilies, selectedScoreBins, selectedSalaryBins, locale]);

  // Città: scope per family + score. Il paese resta come sublabel per
  // disambiguare città omonime; le "country-only" confluiscono in una riga
  // aggregata non filtrabile.
  const cityItems = useMemo(() => {
    const pool = rows.filter(
      (p) =>
        passFamily(p) &&
        passScore(p.score) &&
        passSalary(p) &&
        passSelectedCountry(p),
    );
    const byCity = new Map<string, { count: number; country: string }>();
    let noCity = 0;
    for (const p of pool) {
      const city = (p.loc_city ?? "").trim();
      if (!city) {
        noCity++;
        continue;
      }
      const k = cityKey(p.loc_country, p.loc_city);
      const cur = byCity.get(k) ?? {
        count: 0,
        country: countryKey(p.loc_country),
      };
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
        label: tr("no_city"),
        count: noCity,
        muted: true,
        selectable: false,
      });
    return { items, distinct: real.length };
    // locale: la label "Senza città" passa da tr() → ricalcola al cambio lingua.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows,
    selectedFamilies,
    selectedScoreBins,
    selectedSalaryBins,
    selectedCountries,
    locale,
  ]);

  // Score: scope per location + family (esclude la propria dimensione).
  const scoreData = useMemo(() => {
    const pool = rows.filter(
      (p) => passLocation(p) && passFamily(p) && passSalary(p),
    );
    return pool
      .map((p) => p.score)
      .filter((s): s is number => typeof s === "number" && s > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows,
    selectedCountries,
    selectedCities,
    selectedFamilies,
    selectedSalaryBins,
  ]);

  // Stipendi: scope per family + location + score (esclude la PROPRIA
  // dimensione, come gli altri grafici-filtro, così selezionare una fascia
  // non fa sparire le altre). È a tutti gli effetti una dimensione di filtro.
  const salaryData = useMemo(
    () =>
      rows
        .filter((p) => passFamily(p) && passLocation(p) && passScore(p.score))
        .map(salaryValueEur)
        .filter((v): v is number => v != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rows,
      selectedFamilies,
      selectedCountries,
      selectedCities,
      selectedScoreBins,
    ],
  );

  // Tabella: posizioni che soddisfano TUTTI i filtri attivi, ordinate per
  // score desc (senza score in fondo; a pari score vince la più recente,
  // la query restituisce last_action_at desc e il sort è stabile). Top N.
  const tableMatches = useMemo(
    () =>
      rows
        .filter(
          (p) =>
            passFamily(p) &&
            passLocation(p) &&
            passScore(p.score) &&
            passSalary(p),
        )
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rows,
      selectedFamilies,
      selectedCountries,
      selectedCities,
      selectedScoreBins,
      selectedSalaryBins,
    ],
  );

  return (
    <div>
      {/* Riga filtri ad altezza FISSA: pill "Filtri · N" centrata che apre un
      banner coi filtri attivi (ognuno rimovibile). Spazio sempre riservato,
      così i grafici non si spostano. */}
      <div
        ref={filtersRef}
        className="relative flex items-center justify-center mb-2 h-[26px]"
      >
        {totalActive > 0 && (
          <>
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-semibold tracking-[0.12em] uppercase cursor-pointer transition-colors"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-base)",
                background: filtersOpen ? "var(--color-card)" : "transparent",
              }}
            >
              {tr("filters_label")} · {totalActive}
              <svg
                width="9"
                height="9"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden="true"
                style={{
                  opacity: 0.6,
                  transform: filtersOpen ? "rotate(180deg)" : "",
                  transition: "transform 0.15s",
                }}
              >
                <path
                  d="M2 4L5 7L8 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {filtersOpen && (
              <div
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-[min(92vw,460px)] rounded-lg border p-3"
                style={{
                  background: "var(--color-panel)",
                  borderColor: "var(--color-border)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                }}
              >
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {activeFilters.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={f.remove}
                      title={f.label}
                      className="group inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-full border text-[10px] cursor-pointer transition-colors hover:border-[var(--color-red)]"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-base)",
                      }}
                    >
                      <span className="truncate max-w-[200px] normal-case">
                        {f.label}
                      </span>
                      <span className="text-[var(--color-dim)] group-hover:text-[var(--color-red)]">
                        ✕
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetAll();
                    setFiltersOpen(false);
                  }}
                  className="w-full text-[10px] font-semibold tracking-[0.12em] uppercase py-1.5 rounded border cursor-pointer text-[var(--color-muted)] hover:text-[var(--color-bright)] hover:border-[var(--color-border-glow)] transition-colors"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  ✕ {tr("reset_all")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {/* Riga 1: donut Tipologie a tutta larghezza, ma con la stessa altezza
      delle card sottostanti: donut compatto e legenda scrollabile. */}
      <div className="mb-4 lg:h-[280px]">
        <PositionTypesPie
          data={typeData}
          title={labels.types}
          emptyLabel={labels.noData}
          size={190}
          labels={otherGroupLabel}
          selectedTypes={selectedFamilies}
          // "Altre" non è una categoria: selezionarlo equivale a selezionare
          // tutti i macro-tipi che ha inghiottito.
          onToggleType={(f) => {
            if (f !== OTHER_GROUP_LABEL) {
              toggle(setSelectedFamilies, f);
              return;
            }
            const macros = Array.from(
              new Set(
                (
                  typeData.find((d) => d.family === OTHER_GROUP_LABEL)
                    ?.members ?? []
                ).map((m) => macroKey(m)),
              ),
            );
            setSelectedFamilies((cur) =>
              macros.every((m) => cur.includes(m))
                ? cur.filter((m) => !macros.includes(m))
                : Array.from(new Set([...cur, ...macros])),
            );
          }}
        />
      </div>

      {/* Riga 2: Paesi (sx) + Distribuzione Score (dx), stessa altezza. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:auto-rows-[260px] gap-4 mb-4 items-stretch">
        <LocationBarList
          items={countryItems.items}
          title={labels.countries}
          emptyLabel={labels.noData}
          headerCount={countryItems.distinct}
          maxRows={100}
          selectedKeys={selectedCountries}
          onToggle={(k) => toggle(setSelectedCountries, k)}
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

      {/* Riga 3: Distribuzione Stipendi (sx) + Città (dx), stessa altezza. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:auto-rows-[260px] gap-4 mb-8 items-stretch">
        <SalaryBars
          data={salaryData}
          title={labels.salary}
          emptyLabel={labels.noData}
          bandStep={SALARY_BIN}
          convert={(eur) => convertCurrency(eur, "EUR", displayCurrency, rates)}
          symbol={currencySymbol(displayCurrency)}
          selectedBands={selectedSalaryBins}
          onToggleBand={(lo) =>
            setSelectedSalaryBins((cur) =>
              cur.includes(lo) ? cur.filter((v) => v !== lo) : [...cur, lo],
            )
          }
          headerExtra={
            <span className="flex items-center gap-0.5">
              {currencies.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDisplayCurrency(c)}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded cursor-pointer transition-colors tracking-wide"
                  style={{
                    color:
                      displayCurrency === c
                        ? "var(--color-bright)"
                        : "var(--color-dim)",
                    background:
                      displayCurrency === c
                        ? "rgba(255,255,255,0.08)"
                        : "transparent",
                  }}
                >
                  {c}
                </button>
              ))}
            </span>
          }
        />
        <LocationBarList
          items={cityItems.items}
          title={labels.cities}
          emptyLabel={labels.noData}
          headerCount={cityItems.distinct}
          maxRows={100}
          selectedKeys={selectedCities}
          onToggle={(k) => toggle(setSelectedCities, k)}
        />
      </div>

      {/* Tabella collegata ai filtri: senza filtri = top per score; con
      filtri = top per score tra quelle che soddisfano la selezione. */}
      <RecentPositionsTable
        rows={tableMatches.slice(0, tableLimit)}
        labels={labels.table}
        filtered={totalActive > 0}
        totalFiltered={tableMatches.length}
      />
    </div>
  );
}
