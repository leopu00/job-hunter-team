"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UNCATEGORIZED_LABEL, colorForFamily } from "@/lib/position-classifier";
import RangeHistogram, { buildBins, type Range } from "./RangeHistogram";

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
type DirectKey = "status" | "remote" | "source";
type Option = { val: string; label: string; color?: string };

// Etichette esplicative (stessa terminologia della pipeline del dashboard):
// chiariscono la fase del workflow invece dello status grezzo. Il `val` resta
// lo status reale (URL + filtro server), cambia solo la label mostrata.
const STATUS_OPTIONS: Option[] = [
  { val: "new", label: "Nuove, da analizzare", color: "var(--color-muted)" },
  { val: "checked", label: "Analizzate, da valutare", color: "var(--color-blue)" },
  { val: "scored", label: "Valutate, da scrivere", color: "var(--color-purple)" },
  { val: "writing", label: "In scrittura", color: "var(--color-yellow)" },
  { val: "review", label: "In revisione", color: "var(--color-orange)" },
  { val: "ready", label: "Pronte, da inviare", color: "#7fffb2" },
  { val: "applied", label: "Candidatura inviata", color: "var(--color-green)" },
  { val: "response", label: "Con risposta", color: "#58a6ff" },
  { val: "excluded", label: "Escluse", color: "var(--color-red)" },
];

const REMOTE_OPTIONS: Option[] = [
  { val: "full_remote", label: "Full remote" },
  { val: "hybrid", label: "Hybrid" },
  { val: "onsite", label: "On-site" },
];

const DIRECT_LABELS: Record<DirectKey, string> = {
  status: "Status",
  remote: "Remote",
  source: "Fonte",
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
  const sp = useSearchParams();
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
    }),
    [sp],
  );

  // Gruppi diretti renderizzati come sezioni a chip (source è dinamico).
  const directGroups = useMemo(
    () => [
      { key: "status" as DirectKey, options: STATUS_OPTIONS },
      { key: "remote" as DirectKey, options: REMOTE_OPTIONS },
      {
        key: "source" as DirectKey,
        options: availableSources.map((s) => ({ val: s, label: s })),
      },
    ],
    [availableSources],
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
      "verdict",
      "tier",
    ].forEach((k) => next.delete(k));
    pushURL(next);
  }

  // ── Cross-filtering (mirror di MapCharts) ──
  const passScore = (score: number | null) => {
    if (!scoreRange && !unscoredSelected) return true;
    if (score == null || score === 0) return unscoredSelected;
    return scoreRange ? score >= scoreRange.lo && score <= scoreRange.hi : false;
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
    return { bins: buildBins(scored, SCORE_STEP), total: pool.length, unscored };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets, selectedCountries, selectedCities, selectedFamilies, criticRange, criticUnscored]);

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
    return { bins: buildBins(voted, CRITIC_STEP), total: pool.length, unscored };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets, selectedCountries, selectedCities, selectedFamilies, scoreRange, unscoredSelected]);

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
              ? "(senza città)"
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
  }, [facets, selectedFamilies, scoreRange, unscoredSelected, criticRange, criticUnscored]);

  const treeTotal = locationTree.reduce((s, c) => s + c.count, 0);

  return (
    <aside className="shrink-0 flex flex-col gap-4 pr-1" style={{ width: 300 }}>
      {/* Header sidebar — altezza fissa per allinearsi alla toolbar a destra,
          così la prima card e la tabella partono allo stesso livello. */}
      <div className="h-8 flex items-center justify-between">
        {/* Tutto il "⚙ Filtri" è cliccabile per chiudere (target ampio). */}
        <button
          type="button"
          onClick={() => onCollapse?.()}
          title="Chiudi filtri"
          aria-label="Chiudi filtri"
          className="text-[10px] font-semibold tracking-[0.16em] uppercase flex items-center gap-2 cursor-pointer transition-colors hover:text-[var(--color-base)]"
          style={{ color: "var(--color-dim)" }}
        >
          <span aria-hidden>⚙</span>
          Filtri{totalActive > 0 ? ` · ${totalActive}` : ""}
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
            title="Rimuovi tutti i filtri"
          >
            ✕ reset
          </button>
        )}
      </div>

      {/* Categoria — elenco con conteggi e percentuali */}
      <Section
        title="Categoria"
        badge={`${familyList.rows.length} · ${familyList.total}`}
      >
        {familyList.rows.length === 0 ? (
          <EmptyRow />
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
        title="Score"
        badge={
          scoreRange ? `${scoreRange.lo}–${scoreRange.hi}` : `${scoreHist.total}`
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
          unscoredLabel="senza score"
        />
      </Section>

      {/* Voto critico (0-10) — istogramma con selezione a range + input */}
      <Section
        title="Voto critico"
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
          unscoredLabel="senza voto"
        />
      </Section>

      {/* Albero Location */}
      <Section title="Location" badge={`${locationTree.length} · ${treeTotal}`}>
        {locationTree.length === 0 ? (
          <div
            className="text-[11px] py-3 text-center"
            style={{ color: "var(--color-dim)" }}
          >
            Nessun dato
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
                        aria-label={isOpen ? "Chiudi" : "Apri"}
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

      {/* Filtri diretti (ex-wizard): Tier / Status / Remote / Fonte / Voto */}
      {directGroups.map((g) => (
        <ChipSection
          key={g.key}
          title={DIRECT_LABELS[g.key]}
          options={g.options}
          selected={directSelections[g.key]}
          onToggle={(val) => toggleInParam(g.key, val)}
          onClear={() => setParam(g.key, [])}
        />
      ))}

      {/* Chiusura anche da fondo: non solo dall'header in cima. */}
      <button
        type="button"
        onClick={() => onCollapse?.()}
        className="h-8 flex items-center justify-center gap-2 rounded-lg border cursor-pointer transition-colors text-[9.5px] font-semibold tracking-[0.16em] uppercase hover:text-[var(--color-base)]"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-card)",
          color: "var(--color-dim)",
        }}
        title="Chiudi filtri"
        aria-label="Chiudi filtri"
      >
        <span aria-hidden>⟨</span> Chiudi filtri
      </button>
    </aside>
  );
}

// Sezione a chip toggle per i filtri diretti. Collassabile; di default
// aperta solo se ha selezioni attive (così la sidebar resta compatta).
function ChipSection({
  title,
  options,
  selected,
  onToggle,
  onClear,
}: {
  title: string;
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
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-baseline gap-1.5 cursor-pointer min-w-0"
        >
          <span
            className="text-[8px]"
            style={{ color: "var(--color-dim)" }}
            aria-hidden
          >
            {open ? "▼" : "▶"}
          </span>
          <span
            className="text-[9.5px] font-semibold tracking-[0.16em] uppercase"
            style={{ color: "var(--color-dim)" }}
          >
            {title}
          </span>
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Pulisci ${title}`}
            title="Pulisci"
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
                        background: o.color ? `${o.color}20` : "var(--color-card)",
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

function EmptyRow() {
  return (
    <div
      className="text-[11px] py-3 text-center"
      style={{ color: "var(--color-dim)" }}
    >
      Nessun dato
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
          <span
            className="text-[8px]"
            style={{ color: "var(--color-dim)" }}
            aria-hidden
          >
            {open ? "▼" : "▶"}
          </span>
          <span
            className="text-[9.5px] font-semibold tracking-[0.16em] uppercase"
            style={{ color: "var(--color-dim)" }}
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
