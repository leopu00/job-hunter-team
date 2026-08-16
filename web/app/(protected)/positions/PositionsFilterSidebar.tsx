"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UNCATEGORIZED_LABEL, colorForFamily } from "@/lib/position-classifier";
import { useLocale } from "@/lib/use-locale";
import RangeHistogram, { buildBins, type Range } from "./RangeHistogram";
import { IconChevron, IconFilters } from "./icons";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./PositionsFilterSidebar.i18n";
import {
  PUBLIC_POSITION_STATES,
  PUBLIC_STATE_COLORS,
  publicPositionStateLabel,
  type PublicPositionState,
} from "@/lib/position-state";

// Dataset leggero servito da /api/positions/facets.
type Facet = {
  id: string;
  role_family: string | null;
  score: number | null;
  critic_score: number | null;
  loc_country: string | null;
  loc_city: string | null;
  status: string;
  title: string | null;
  company: string | null;
};

type ScoreRange = { lo: number; hi: number };

// Step dei bin degli istogrammi: score 0-100 a passo 5, voto critico 0-10 a 0.5.
const SCORE_STEP = 5;
const CRITIC_STEP = 0.5;

// ── Filtri "diretti" (ex-wizard): toggle semplici, niente cross-filtering ──
type DirectKey = "status" | "remote" | "source" | "fb";
type Option = { val: string; label: string; color?: string };
// Variante interna con chiave di traduzione (risolta a runtime via locale).
type OptionKey = { val: string; labelKey: string; color?: string };

// La sidebar usa gli stessi stati pubblici della tabella. `review` resta uno
// stato tecnico interno e confluisce in `preparing` insieme a `writing`.
const STATUS_OPTIONS = PUBLIC_POSITION_STATES.filter(
  (state): state is Exclude<PublicPositionState, "needs_attention"> =>
    state !== "needs_attention",
);

const REMOTE_OPTIONS: OptionKey[] = [
  { val: "full_remote", labelKey: "rm_full" },
  { val: "hybrid", labelKey: "rm_hybrid" },
  { val: "onsite", labelKey: "rm_onsite" },
];

// Giudizio utente (event-log feedback, stessa scala di /swipe); 'none' =
// nessun giudizio dato.
const FB_OPTIONS: OptionKey[] = [
  // Stella = giallo oro, come i bottoni giudizio (21/07).
  { val: "top", labelKey: "fb_top", color: "var(--color-yellow)" },
  { val: "review_ok", labelKey: "fb_ok", color: "var(--color-blue)" },
  { val: "review_low", labelKey: "fb_low", color: "var(--color-orange)" },
  { val: "no", labelKey: "fb_no", color: "var(--color-red)" },
  { val: "none", labelKey: "fb_none" },
];

// Chiave i18n per il titolo di ogni gruppo diretto.
const DIRECT_LABEL_KEYS: Record<DirectKey, string> = {
  status: "g_status",
  remote: "g_mode",
  source: "g_source",
  fb: "g_feedback",
};

// Chiave city coerente con il server (queries.ts facetCityKey).
function cityKey(country: string | null, city: string | null): string {
  const c = (country ?? "").trim() || "(unknown)";
  const ci = (city ?? "").trim() || "(country-only)";
  return `${c}|${ci}`;
}
function countryKey(country: string | null): string {
  return (country ?? "").trim() || "(unknown)";
}
function familyKey(rf: string | null): string {
  return (rf ?? "").trim() || UNCATEGORIZED_LABEL;
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBands(v: string | null): ScoreRange[] {
  return csv(v)
    .map((tok) => {
      const [lo, hi] = tok.split("-").map((n) => parseInt(n, 10));
      return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
    })
    .filter((r): r is ScoreRange => r != null);
}

// Singolo range "lo-hi" con decimali (voto critico). hi può iniziare con "-"
// solo per valori negativi che qui non esistono, quindi split su "-" è sicuro.
function parseRange(v: string | null): Range | null {
  if (!v) return null;
  const [lo, hi] = v.split("-").map((n) => parseFloat(n.trim()));
  return Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : null;
}

export default function PositionsFilterSidebar({
  availableSources = [],
  onCollapse,
}: {
  availableSources?: string[];
  onCollapse?: () => void;
}) {
  const router = useRouter();
  const sp = useSearchParams() ?? new URLSearchParams();
  // Nelle build con i tipi di compatibilità di Next il router può non essere
  // ancora pronto. Un URL vuoto conserva la semantica dei filtri non impostati.
  const locale = useLocale();
  const tr = makeT(T, locale);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [openCountry, setOpenCountry] = useState<string | null>(null);

  // Stato applicato = URL (source of truth).
  const selectedFamilies = useMemo(() => csv(sp.get("family")), [sp]);
  const selectedCountries = useMemo(() => csv(sp.get("country")), [sp]);
  const selectedCities = useMemo(() => csv(sp.get("city")), [sp]);
  const selectedRanges = useMemo(() => parseBands(sp.get("band")), [sp]);
  const scoreRange = selectedRanges[0] ?? null;
  const unscoredSelected = sp.get("noscore") === "1";
  const criticRange = useMemo(() => parseRange(sp.get("cscore")), [sp]);
  const criticUnscored = sp.get("cnoscore") === "1";

  // Filtri diretti (ex-wizard): un array di valori selezionati per chiave.
  const directSelections = useMemo<Record<DirectKey, string[]>>(
    () => ({
      status: csv(sp.get("status")),
      remote: csv(sp.get("remote")),
      source: csv(sp.get("source")),
      fb: csv(sp.get("fb")),
    }),
    [sp],
  );

  // Gruppi diretti renderizzati come sezioni a chip (source è dinamico).
  // Le label degli option vengono risolte dalla locale corrente.
  const directGroups = useMemo(
    () => [
      {
        key: "fb" as DirectKey,
        options: FB_OPTIONS.map(
          (o): Option => ({
            val: o.val,
            label: tr(o.labelKey),
            color: o.color,
          }),
        ),
      },
      {
        key: "status" as DirectKey,
        options: STATUS_OPTIONS.map(
          (state): Option => ({
            val: state,
            label: publicPositionStateLabel(state, locale),
            color: PUBLIC_STATE_COLORS[state],
          }),
        ),
      },
      {
        key: "remote" as DirectKey,
        options: REMOTE_OPTIONS.map(
          (o): Option => ({
            val: o.val,
            label: tr(o.labelKey),
            color: o.color,
          }),
        ),
      },
      {
        key: "source" as DirectKey,
        options: availableSources.map((s) => ({ val: s, label: s })),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availableSources, locale],
  );

  useEffect(() => {
    let cancel = false;
    fetch("/api/positions/facets")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Facet[]) => {
        if (!cancel) setFacets(Array.isArray(d) ? d : []);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  // ── Push URL preservando gli altri parametri (wizard, sort, expand) ──
  function pushURL(next: URLSearchParams) {
    next.delete("page"); // un nuovo filtro riparte da pagina 1
    const qs = next.toString();
    router.push(qs ? `/positions?${qs}` : "/positions", { scroll: false });
  }
  function setParam(key: string, values: string[]) {
    const next = new URLSearchParams(sp.toString());
    if (values.length) next.set(key, values.join(","));
    else next.delete(key);
    pushURL(next);
  }
  function toggleInParam(key: string, value: string) {
    const cur = csv(sp.get(key));
    setParam(
      key,
      cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
    );
  }
  function toggleFamily(f: string) {
    // Cambiare scope tipo ricalcola i bin di score/voto: pulisco le selezioni.
    const next = new URLSearchParams(sp.toString());
    const cur = csv(sp.get("family"));
    const nf = cur.includes(f) ? cur.filter((v) => v !== f) : [...cur, f];
    if (nf.length) next.set("family", nf.join(","));
    else next.delete("family");
    ["band", "noscore", "cscore", "cnoscore"].forEach((k) => next.delete(k));
    pushURL(next);
  }
  // Range singolo "lo-hi" su un parametro URL (band per lo score, cscore per
  // il voto). null = rimuove il filtro.
  function setRangeParam(key: string, range: Range | null) {
    setParam(key, range ? [`${range.lo}-${range.hi}`] : []);
  }
  function toggleFlag(key: string, on: boolean) {
    const next = new URLSearchParams(sp.toString());
    if (on) next.set(key, "1");
    else next.delete(key);
    pushURL(next);
  }

  const directActive = Object.values(directSelections).reduce(
    (a, v) => a + v.length,
    0,
  );
  const totalActive =
    selectedFamilies.length +
    selectedCountries.length +
    selectedCities.length +
    (scoreRange ? 1 : 0) +
    (unscoredSelected ? 1 : 0) +
    (criticRange ? 1 : 0) +
    (criticUnscored ? 1 : 0) +
    directActive;

  function resetAll() {
    const next = new URLSearchParams(sp.toString());
    [
      "family",
      "country",
      "city",
      "band",
      "noscore",
      "cscore",
      "cnoscore",
      "status",
      "remote",
      "source",
      "fb",
      "verdict",
      "tier",
    ].forEach((k) => next.delete(k));
    pushURL(next);
  }

  // ── Cross-filtering (mirror di MapCharts) ──
  const passScore = (score: number | null) => {
    if (!scoreRange && !unscoredSelected) return true;
    if (score == null || score === 0) return unscoredSelected;
    return scoreRange
      ? score >= scoreRange.lo && score <= scoreRange.hi
      : false;
  };
  const passCritic = (c: number | null) => {
    if (!criticRange && !criticUnscored) return true;
    if (c == null) return criticUnscored;
    return criticRange ? c >= criticRange.lo && c <= criticRange.hi : false;
  };
  const locationActive =
    selectedCountries.length > 0 || selectedCities.length > 0;
  const passLocation = (p: Facet) => {
    if (!locationActive) return true;
    if (selectedCities.includes(cityKey(p.loc_country, p.loc_city)))
      return true;
    if (selectedCountries.includes(countryKey(p.loc_country))) return true;
    return false;
  };
  const passFamily = (p: Facet) =>
    selectedFamilies.length === 0 ||
    selectedFamilies.includes(familyKey(p.role_family));

  // Categoria (family): scope per location (esclude la propria dimensione).
  const familyList = useMemo(() => {
    const pool = facets.filter(passLocation);
    const byFamily = new Map<string, number>();
    for (const p of pool) {
      const f = familyKey(p.role_family);
      byFamily.set(f, (byFamily.get(f) ?? 0) + 1);
    }
    const total = pool.length;
    return {
      total,
      rows: Array.from(byFamily.entries())
        .map(([family, count]) => ({
          family,
          count,
          color: colorForFamily(family),
          pct: total ? Math.round((count / total) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets, selectedCountries, selectedCities]);

  // Score: istogramma, scope per location + family + voto (esclude sé stesso).
  // Bin auto-fittati al range reale dei dati (niente code vuote).
  const scoreHist = useMemo(() => {
    const pool = facets.filter(
      (p) => passLocation(p) && passFamily(p) && passCritic(p.critic_score),
    );
    const scored: number[] = [];
    let unscored = 0;
    for (const p of pool) {
      if (typeof p.score === "number" && p.score > 0) scored.push(p.score);
      else unscored++;
    }
    return {
      bins: buildBins(scored, SCORE_STEP),
      total: pool.length,
      unscored,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    facets,
    selectedCountries,
    selectedCities,
    selectedFamilies,
    criticRange,
    criticUnscored,
  ]);

  // Voto critico (0-10): istogramma, scope per location + family + score.
  const criticHist = useMemo(() => {
    const pool = facets.filter(
      (p) => passLocation(p) && passFamily(p) && passScore(p.score),
    );
    const voted: number[] = [];
    let unscored = 0;
    for (const p of pool) {
      if (typeof p.critic_score === "number") voted.push(p.critic_score);
      else unscored++;
    }
    return {
      bins: buildBins(voted, CRITIC_STEP),
      total: pool.length,
      unscored,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    facets,
    selectedCountries,
    selectedCities,
    selectedFamilies,
    scoreRange,
    unscoredSelected,
  ]);

  // Location tree: scope per family + score + voto (esclude la propria dim.).
  const locationTree = useMemo(() => {
    const pool = facets.filter(
      (p) => passFamily(p) && passScore(p.score) && passCritic(p.critic_score),
    );
    const byCountry = new Map<string, Map<string, number>>();
    const countryTotals = new Map<string, number>();
    for (const p of pool) {
      const c = countryKey(p.loc_country);
      const ck = cityKey(p.loc_country, p.loc_city);
      const cities = byCountry.get(c) ?? new Map<string, number>();
      cities.set(ck, (cities.get(ck) ?? 0) + 1);
      byCountry.set(c, cities);
      countryTotals.set(c, (countryTotals.get(c) ?? 0) + 1);
    }
    const out = Array.from(byCountry.entries()).map(([country, cityMap]) => ({
      country,
      count: countryTotals.get(country) ?? 0,
      cities: Array.from(cityMap.entries())
        .map(([key, count]) => ({
          key,
          label:
            key.split("|")[1] === "(country-only)"
              ? tr("no_city")
              : key.split("|")[1],
          count,
        }))
        .sort((a, b) => b.count - a.count),
    }));
    out.sort((a, b) => {
      if (a.country === "(unknown)") return 1;
      if (b.country === "(unknown)") return -1;
      return b.count - a.count;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    facets,
    selectedFamilies,
    scoreRange,
    unscoredSelected,
    criticRange,
    criticUnscored,
  ]);

  const treeTotal = locationTree.reduce((s, c) => s + c.count, 0);

  return (
    <aside className="shrink-0 flex flex-col gap-4 pr-1 w-full md:w-[300px]">
      {/* Header sidebar — altezza fissa per allinearsi alla toolbar a destra,
          così la prima card e la tabella partono allo stesso livello. */}
      <div className="h-8 flex items-center justify-between">
        {/* Tutto il "⚙ Filtri" è cliccabile per chiudere (target ampio). */}
        <button
          type="button"
          onClick={() => onCollapse?.()}
          title={tr("closeFilters")}
          aria-label={tr("closeFilters")}
          className="text-[10px] font-semibold tracking-[0.16em] uppercase flex items-center gap-2 cursor-pointer transition-colors hover:text-[var(--color-base)]"
          style={{ color: "var(--color-dim)" }}
        >
          <IconFilters />
          {tr("filters")}
          {totalActive > 0 ? ` · ${totalActive}` : ""}
          <span aria-hidden className="text-[12px] leading-none">
            ⟨
          </span>
        </button>
        {totalActive > 0 && (
          <button
            type="button"
            onClick={resetAll}
            className="text-[9px] font-semibold tracking-[0.1em] uppercase cursor-pointer"
            style={{ color: "var(--color-dim)" }}
            title={tr("removeAll")}
          >
            ✕ reset
          </button>
        )}
      </div>

      {/* Categoria — elenco con conteggi e percentuali */}
      <Section
        title={tr("category")}
        badge={`${familyList.rows.length} · ${familyList.total}`}
      >
        {familyList.rows.length === 0 ? (
          <EmptyRow label={tr("noData")} />
        ) : (
          <ul className="flex flex-col">
            {familyList.rows.map((r) => {
              const active = selectedFamilies.includes(r.family);
              return (
                <FacetRow
                  key={r.family}
                  active={active}
                  onClick={() => toggleFamily(r.family)}
                  dot={r.color}
                  label={r.family}
                  count={r.count}
                />
              );
            })}
          </ul>
        )}
      </Section>

      {/* Score — istogramma con selezione a range + input precisi */}
      <Section
        title={tr("score")}
        badge={
          scoreRange
            ? `${scoreRange.lo}–${scoreRange.hi}`
            : `${scoreHist.total}`
        }
      >
        <RangeHistogram
          bins={scoreHist.bins}
          value={scoreRange}
          onChange={(r) => setRangeParam("band", r)}
          decimals={0}
          unscoredCount={scoreHist.unscored}
          unscoredSelected={unscoredSelected}
          onToggleUnscored={() => toggleFlag("noscore", !unscoredSelected)}
          unscoredLabel={tr("noScore")}
        />
      </Section>

      {/* Voto critico (0-10) — istogramma con selezione a range + input */}
      <Section
        title={tr("criticVote")}
        badge={
          criticRange
            ? `${criticRange.lo}–${criticRange.hi}`
            : `${criticHist.total}`
        }
      >
        <RangeHistogram
          bins={criticHist.bins}
          value={criticRange}
          onChange={(r) => setRangeParam("cscore", r)}
          decimals={1}
          unscoredCount={criticHist.unscored}
          unscoredSelected={criticUnscored}
          onToggleUnscored={() => toggleFlag("cnoscore", !criticUnscored)}
          unscoredLabel={tr("noVote")}
        />
      </Section>

      {/* Albero Location */}
      <Section
        title={tr("location")}
        badge={`${locationTree.length} · ${treeTotal}`}
      >
        {locationTree.length === 0 ? (
          <div
            className="text-[11px] py-3 text-center"
            style={{ color: "var(--color-dim)" }}
          >
            {tr("noData")}
          </div>
        ) : (
          <ul
            className="divide-y rounded-md border overflow-y-auto"
            style={{ borderColor: "var(--color-border)", maxHeight: 260 }}
          >
            {locationTree.map((country) => {
              const isOpen = openCountry === country.country;
              const isSelected = selectedCountries.includes(country.country);
              return (
                <li
                  key={country.country}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div
                    onClick={() => {
                      setOpenCountry(isOpen ? null : country.country);
                      toggleInParam("country", country.country);
                    }}
                    className="px-3 py-1.5 text-[11px] flex items-baseline justify-between gap-2 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
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
                        aria-label={isOpen ? tr("collapse") : tr("expand")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenCountry(isOpen ? null : country.country);
                        }}
                        style={{
                          width: 12,
                          color: "var(--color-dim)",
                          fontSize: 8,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          lineHeight: 1,
                        }}
                      >
                        <IconChevron open={isOpen} size={9} />
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
                    <ul style={{ background: "rgba(0,0,0,0.15)" }}>
                      {country.cities.map((city) => {
                        const isCitySel = selectedCities.includes(city.key);
                        return (
                          <li
                            key={city.key}
                            style={{ borderColor: "var(--color-border)" }}
                          >
                            <div
                              onClick={() => toggleInParam("city", city.key)}
                              className="px-3 py-1 pl-7 text-[10.5px] flex items-baseline justify-between gap-2 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                              style={{
                                background: isCitySel
                                  ? "rgba(0,232,122,0.08)"
                                  : "transparent",
                              }}
                            >
                              <span
                                className="truncate"
                                style={{
                                  color: isCitySel
                                    ? "var(--color-bright)"
                                    : "var(--color-muted)",
                                  fontWeight: isCitySel ? 600 : 400,
                                  fontStyle:
                                    city.label === "(senza città)"
                                      ? "italic"
                                      : "normal",
                                }}
                                title={city.label}
                              >
                                {city.label}
                              </span>
                              <span
                                className="tabular-nums flex-shrink-0"
                                style={{
                                  color: isCitySel
                                    ? "var(--color-bright)"
                                    : "var(--color-dim)",
                                }}
                              >
                                {city.count}
                              </span>
                            </div>
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
      </Section>

      {/* Filtri diretti (ex-wizard): Stato / Modalità / Fonte */}
      {directGroups.map((g) => (
        <ChipSection
          key={g.key}
          title={tr(DIRECT_LABEL_KEYS[g.key])}
          clearLabel={tr("clear")}
          options={g.options}
          selected={directSelections[g.key]}
          onToggle={(val) => toggleInParam(g.key, val)}
          onClear={() => setParam(g.key, [])}
        />
      ))}

      {/* Chiusura anche da fondo: link discreto, non un pulsante pieno. */}
      <button
        type="button"
        onClick={() => onCollapse?.()}
        className="self-center mt-1 flex items-center gap-1.5 cursor-pointer transition-colors text-[9px] font-semibold tracking-[0.16em] uppercase hover:text-[var(--color-base)]"
        style={{ color: "var(--color-dim)" }}
        title={tr("closeFilters")}
        aria-label={tr("closeFilters")}
      >
        <span aria-hidden>⟨</span> {tr("closeFilters")}
      </button>
    </aside>
  );
}

// Sezione a chip toggle per i filtri diretti. Collassabile; di default
// aperta solo se ha selezioni attive (così la sidebar resta compatta).
function ChipSection({
  title,
  clearLabel,
  options,
  selected,
  onToggle,
  onClear,
}: {
  title: string;
  clearLabel: string;
  options: Option[];
  selected: string[];
  onToggle: (val: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(selected.length > 0);
  if (options.length === 0) return null;
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div
        className={`flex items-baseline justify-between gap-2 ${open ? "mb-2" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-baseline gap-1.5 cursor-pointer min-w-0"
        >
          <span style={{ color: "var(--color-dim)" }}>
            <IconChevron open={open} size={10} />
          </span>
          <span
            className="text-[9.5px] font-semibold tracking-[0.16em] uppercase"
            style={{ color: "var(--color-white)" }}
          >
            {title}
          </span>
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`${clearLabel} ${title}`}
            title={clearLabel}
            className="text-[9px] tabular-nums cursor-pointer leading-none flex items-center gap-1"
            style={{ color: "var(--color-green)" }}
          >
            {selected.length} ✕
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const active = selected.includes(o.val);
            return (
              <button
                key={o.val}
                type="button"
                onClick={() => onToggle(o.val)}
                aria-pressed={active}
                className="px-2 py-0.5 text-[10px] font-semibold rounded-full border cursor-pointer transition-colors whitespace-nowrap"
                style={
                  active
                    ? {
                        color: o.color ?? "var(--color-bright)",
                        borderColor: o.color ?? "var(--color-green)",
                        background: o.color
                          ? `${o.color}20`
                          : "var(--color-card)",
                      }
                    : {
                        color: "var(--color-dim)",
                        borderColor: "var(--color-border)",
                        background: "transparent",
                      }
                }
                title={o.label}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Riga di un facet: dot opzionale + label + count + percentuale. Click toggle.
function FacetRow({
  active,
  onClick,
  dot,
  label,
  count,
  mono,
  italic,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  label: string;
  count: number;
  mono?: boolean;
  italic?: boolean;
}) {
  return (
    <li
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
      style={{ background: active ? "rgba(0,232,122,0.08)" : "transparent" }}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dot,
            flexShrink: 0,
          }}
        />
      )}
      <span
        className={`truncate flex-1 text-[11px] ${mono ? "font-mono tabular-nums" : ""}`}
        style={{
          color: active ? "var(--color-bright)" : "var(--color-base)",
          fontWeight: active ? 600 : 400,
          fontStyle: italic ? "italic" : "normal",
        }}
        title={label}
      >
        {label}
      </span>
      <span
        className="text-[11px] font-semibold tabular-nums w-7 text-right flex-shrink-0"
        style={{ color: active ? "var(--color-bright)" : "var(--color-muted)" }}
      >
        {count}
      </span>
    </li>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div
      className="text-[11px] py-3 text-center"
      style={{ color: "var(--color-dim)" }}
    >
      {label}
    </div>
  );
}

function Section({
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div
        className={`flex items-baseline justify-between gap-2 ${open ? "mb-2" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-baseline gap-1.5 cursor-pointer min-w-0"
        >
          <span style={{ color: "var(--color-dim)" }}>
            <IconChevron open={open} size={10} />
          </span>
          <span
            className="text-[9.5px] font-semibold tracking-[0.16em] uppercase"
            style={{ color: "var(--color-white)" }}
          >
            {title}
          </span>
        </button>
        {badge && (
          <span
            className="text-[9.5px] tabular-nums flex-shrink-0"
            style={{ color: "var(--color-muted)" }}
          >
            {badge}
          </span>
        )}
      </div>
      {open && children}
    </div>
  );
}
