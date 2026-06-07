"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UNCATEGORIZED_LABEL, colorForFamily } from "@/lib/position-classifier";
import { useLocale } from "@/lib/use-locale";

const T: Record<string, Record<string, string>> = {
  expand_filters: {
    it: "Espandi filtri", en: "Expand filters", hu: "Szűrők kibontása",
    es: "Expandir filtros", de: "Filter erweitern", fr: "Déployer les filtres", pt: "Expandir filtros",
  },
  filters: {
    it: "Filtri", en: "Filters", hu: "Szűrők",
    es: "Filtros", de: "Filter", fr: "Filtres", pt: "Filtros",
  },
  reset_title: {
    it: "Rimuovi tutti i filtri", en: "Clear all filters", hu: "Összes szűrő törlése",
    es: "Borrar todos los filtros", de: "Alle Filter entfernen", fr: "Effacer tous les filtres", pt: "Limpar todos os filtros",
  },
  reset: {
    it: "reset", en: "reset", hu: "törlés",
    es: "borrar", de: "zurücksetzen", fr: "réinit.", pt: "limpar",
  },
  collapse: {
    it: "Comprimi", en: "Collapse", hu: "Összecsukás",
    es: "Contraer", de: "Einklappen", fr: "Réduire", pt: "Recolher",
  },
  collapse_filters: {
    it: "Comprimi filtri", en: "Collapse filters", hu: "Szűrők összecsukása",
    es: "Contraer filtros", de: "Filter einklappen", fr: "Réduire les filtres", pt: "Recolher filtros",
  },
  category: {
    it: "Categoria", en: "Category", hu: "Kategória",
    es: "Categoría", de: "Kategorie", fr: "Catégorie", pt: "Categoria",
  },
  score: {
    it: "Score", en: "Score", hu: "Pontszám",
    es: "Puntuación", de: "Score", fr: "Score", pt: "Pontuação",
  },
  location: {
    it: "Location", en: "Location", hu: "Helyszín",
    es: "Ubicación", de: "Standort", fr: "Lieu", pt: "Localização",
  },
  select_range_end: {
    it: "Seleziona la fine del range…", en: "Select the end of the range…", hu: "Válaszd ki a tartomány végét…",
    es: "Selecciona el final del rango…", de: "Wähle das Ende des Bereichs…", fr: "Sélectionnez la fin de la plage…", pt: "Selecione o fim do intervalo…",
  },
  no_score: {
    it: "senza score", en: "no score", hu: "pontszám nélkül",
    es: "sin puntuación", de: "ohne Score", fr: "sans score", pt: "sem pontuação",
  },
  no_data: {
    it: "Nessun dato", en: "No data", hu: "Nincs adat",
    es: "Sin datos", de: "Keine Daten", fr: "Aucune donnée", pt: "Sem dados",
  },
  no_city: {
    it: "(senza città)", en: "(no city)", hu: "(város nélkül)",
    es: "(sin ciudad)", de: "(ohne Stadt)", fr: "(sans ville)", pt: "(sem cidade)",
  },
  close: {
    it: "Chiudi", en: "Close", hu: "Bezárás",
    es: "Cerrar", de: "Schließen", fr: "Fermer", pt: "Fechar",
  },
  open: {
    it: "Apri", en: "Open", hu: "Megnyitás",
    es: "Abrir", de: "Öffnen", fr: "Ouvrir", pt: "Abrir",
  },
};

// Sentinella stabile (indipendente dalla lingua) per la chiave city senza città.
const NO_CITY_SENTINEL = "(country-only)";

// Dataset leggero servito da /api/positions/facets.
type Facet = {
  id: string;
  role_family: string | null;
  score: number | null;
  loc_country: string | null;
  loc_city: string | null;
  status: string;
  title: string | null;
  company: string | null;
};

type ScoreRange = { lo: number; hi: number };

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

export default function PositionsFilterSidebar() {
  const router = useRouter();
  const sp = useSearchParams();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [facets, setFacets] = useState<Facet[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [openCountry, setOpenCountry] = useState<string | null>(null);
  // Inizio range score in attesa del secondo clic (lo del bin ancora).
  const [scoreAnchor, setScoreAnchor] = useState<number | null>(null);

  // Stato applicato = URL (source of truth).
  const selectedFamilies = useMemo(() => csv(sp.get("family")), [sp]);
  const selectedCountries = useMemo(() => csv(sp.get("country")), [sp]);
  const selectedCities = useMemo(() => csv(sp.get("city")), [sp]);
  const selectedRanges = useMemo(() => parseBands(sp.get("band")), [sp]);
  const unscoredSelected = sp.get("noscore") === "1";

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
    // Cambiare scope tipo ricalcola i bin score: pulisco selezione score.
    const next = new URLSearchParams(sp.toString());
    const cur = csv(sp.get("family"));
    const nf = cur.includes(f) ? cur.filter((v) => v !== f) : [...cur, f];
    if (nf.length) next.set("family", nf.join(","));
    else next.delete("family");
    next.delete("band");
    next.delete("noscore");
    pushURL(next);
  }
  // Selezione a range: primo clic = inizio (anchor), secondo clic = fine.
  // Lo score filter è un singolo range contiguo {lo,hi}. Terzo clic = nuovo
  // inizio. Clic sullo stesso bin singolo = deseleziona.
  function clickScoreBand(r: ScoreRange) {
    if (scoreAnchor != null) {
      if (scoreAnchor === r.lo) {
        setScoreAnchor(null);
        setParam("band", []);
        return;
      }
      const lo = Math.min(scoreAnchor, r.lo);
      const hi = Math.max(scoreAnchor + 4, r.hi);
      setScoreAnchor(null);
      setParam("band", [`${lo}-${hi}`]);
      return;
    }
    const isSingleSame =
      selectedRanges.length === 1 &&
      selectedRanges[0].lo === r.lo &&
      selectedRanges[0].hi === r.hi;
    if (isSingleSame) {
      setParam("band", []);
      return;
    }
    setScoreAnchor(r.lo);
    setParam("band", [`${r.lo}-${r.hi}`]);
  }
  function toggleUnscored() {
    const next = new URLSearchParams(sp.toString());
    if (unscoredSelected) next.delete("noscore");
    else next.set("noscore", "1");
    pushURL(next);
  }

  const totalActive =
    selectedFamilies.length +
    selectedCountries.length +
    selectedCities.length +
    selectedRanges.length +
    (unscoredSelected ? 1 : 0);

  function resetAll() {
    setScoreAnchor(null);
    const next = new URLSearchParams(sp.toString());
    ["family", "country", "city", "band", "noscore"].forEach((k) =>
      next.delete(k),
    );
    pushURL(next);
  }

  // ── Cross-filtering (mirror di MapCharts) ──
  const passScore = (score: number | null) => {
    if (selectedRanges.length === 0 && !unscoredSelected) return true;
    if (score == null || score === 0) return unscoredSelected;
    return selectedRanges.some((r) => score >= r.lo && score <= r.hi);
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

  // Score: scope per location + family (esclude la propria dimensione).
  // Bin fissi da 5 punti (90-94, 85-89, ...), solo quelli non vuoti.
  const scoreList = useMemo(() => {
    const pool = facets.filter((p) => passLocation(p) && passFamily(p));
    const total = pool.length;
    const bins = new Map<number, number>(); // idx (score/5) → count
    let unscored = 0;
    for (const p of pool) {
      if (typeof p.score === "number" && p.score > 0) {
        const idx = Math.min(19, Math.floor(p.score / 5));
        bins.set(idx, (bins.get(idx) ?? 0) + 1);
      } else {
        unscored++;
      }
    }
    const rows = Array.from(bins.entries())
      .map(([idx, count]) => {
        const lo = idx * 5;
        const hi = lo + 4;
        return {
          lo,
          hi,
          label: `${lo}-${hi}`,
          count,
          pct: total ? Math.round((count / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.lo - a.lo);
    return {
      total,
      rows,
      unscored,
      unscoredPct: total ? Math.round((unscored / total) * 100) : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets, selectedCountries, selectedCities, selectedFamilies]);

  // Location tree: scope per family + score (esclude la propria dimensione).
  const locationTree = useMemo(() => {
    const pool = facets.filter((p) => passFamily(p) && passScore(p.score));
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
        .map(([key, count]) => {
          const noCity = key.split("|")[1] === NO_CITY_SENTINEL;
          return {
            key,
            label: noCity ? tr("no_city") : key.split("|")[1],
            noCity,
            count,
          };
        })
        .sort((a, b) => b.count - a.count),
    }));
    out.sort((a, b) => {
      if (a.country === "(unknown)") return 1;
      if (b.country === "(unknown)") return -1;
      return b.count - a.count;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets, selectedFamilies, selectedRanges, unscoredSelected]);

  const treeTotal = locationTree.reduce((s, c) => s + c.count, 0);

  if (collapsed) {
    return (
      <aside
        className="shrink-0 flex flex-col items-center pt-1"
        style={{ width: 40 }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title={tr("expand_filters")}
          aria-label={tr("expand_filters")}
          className="w-9 h-9 rounded-lg border flex items-center justify-center cursor-pointer transition-colors"
          style={{
            borderColor:
              totalActive > 0 ? "var(--color-green)" : "var(--color-border)",
            color: totalActive > 0 ? "var(--color-bright)" : "var(--color-dim)",
            background: "var(--color-card)",
          }}
        >
          ⚙
        </button>
        {totalActive > 0 && (
          <span
            className="mt-1 text-[9px] font-bold tabular-nums"
            style={{ color: "var(--color-green)" }}
          >
            {totalActive}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside className="shrink-0 flex flex-col gap-4 pr-1" style={{ width: 300 }}>
      {/* Header sidebar */}
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-semibold tracking-[0.16em] uppercase flex items-center gap-2"
          style={{ color: "var(--color-dim)" }}
        >
          ⚙ {tr("filters")}{totalActive > 0 ? ` · ${totalActive}` : ""}
        </span>
        <div className="flex items-center gap-2">
          {totalActive > 0 && (
            <button
              type="button"
              onClick={resetAll}
              className="text-[9px] font-semibold tracking-[0.1em] uppercase cursor-pointer"
              style={{ color: "var(--color-dim)" }}
              title={tr("reset_title")}
            >
              ✕ {tr("reset")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title={tr("collapse")}
            aria-label={tr("collapse_filters")}
            className="text-[12px] leading-none cursor-pointer"
            style={{ color: "var(--color-dim)" }}
          >
            ⟨
          </button>
        </div>
      </div>

      {/* Categoria — elenco con conteggi e percentuali */}
      <Section
        title={tr("category")}
        badge={`${familyList.rows.length} · ${familyList.total}`}
      >
        {familyList.rows.length === 0 ? (
          <EmptyRow label={tr("no_data")} />
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
                  pct={r.pct}
                />
              );
            })}
          </ul>
        )}
      </Section>

      {/* Score — elenco fasce con conteggi e percentuali, selezione a range */}
      <Section
        title={tr("score")}
        badge={
          selectedRanges[0]
            ? `${selectedRanges[0].lo}–${selectedRanges[0].hi}`
            : `${scoreList.total}`
        }
      >
        {scoreAnchor != null && (
          <div
            className="text-[9px] mb-1 px-2"
            style={{ color: "var(--color-green)" }}
          >
            {tr("select_range_end")}
          </div>
        )}
        {scoreList.rows.length === 0 && scoreList.unscored === 0 ? (
          <EmptyRow label={tr("no_data")} />
        ) : (
          <ul className="flex flex-col">
            {scoreList.rows.map((r) => {
              const range = selectedRanges[0];
              const inRange = range
                ? r.lo >= range.lo && r.hi <= range.hi
                : false;
              const isAnchor = scoreAnchor === r.lo;
              return (
                <FacetRow
                  key={r.label}
                  active={inRange || isAnchor}
                  onClick={() => clickScoreBand({ lo: r.lo, hi: r.hi })}
                  label={r.label}
                  mono
                  count={r.count}
                  pct={r.pct}
                />
              );
            })}
            {scoreList.unscored > 0 && (
              <FacetRow
                active={unscoredSelected}
                onClick={toggleUnscored}
                label={tr("no_score")}
                italic
                count={scoreList.unscored}
                pct={scoreList.unscoredPct}
              />
            )}
          </ul>
        )}
      </Section>

      {/* Albero Location */}
      <Section title={tr("location")} badge={`${locationTree.length} · ${treeTotal}`}>
        {locationTree.length === 0 ? (
          <div
            className="text-[11px] py-3 text-center"
            style={{ color: "var(--color-dim)" }}
          >
            {tr("no_data")}
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
                        aria-label={isOpen ? tr("close") : tr("open")}
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
                                  fontStyle: city.noCity ? "italic" : "normal",
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
    </aside>
  );
}

// Riga di un facet: dot opzionale + label + count + percentuale. Click toggle.
function FacetRow({
  active,
  onClick,
  dot,
  label,
  count,
  pct,
  mono,
  italic,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  label: string;
  count: number;
  pct: number;
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
      <span
        className="text-[9.5px] tabular-nums w-8 text-right flex-shrink-0"
        style={{ color: "var(--color-dim)" }}
      >
        {pct}%
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
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div className="flex items-baseline justify-between mb-2">
        <span
          className="text-[9.5px] font-semibold tracking-[0.16em] uppercase"
          style={{ color: "var(--color-dim)" }}
        >
          {title}
        </span>
        {badge && (
          <span
            className="text-[9.5px] tabular-nums"
            style={{ color: "var(--color-muted)" }}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
