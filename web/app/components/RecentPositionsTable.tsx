"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DashboardPosition } from "@/lib/queries";
import { formatFoundAt } from "@/lib/format-time";
import { colorForFamily } from "@/lib/position-classifier";
import {
  convertCurrency,
  currencySymbol,
  formatMoneyCompact,
  type Rates,
} from "@/lib/exchange-rates";

// Duplicato locale (stesso pattern di JobsGlobe/dashboard): la mappa è
// piccola e specifica della UI, non vale un modulo condiviso.
const STATUS_COLORS: Record<string, string> = {
  new: "var(--color-muted)",
  checked: "var(--color-blue)",
  scored: "var(--color-purple)",
  writing: "var(--color-yellow)",
  review: "var(--color-orange)",
  ready: "#7fffb2",
  applied: "var(--color-green)",
  response: "#58a6ff",
  excluded: "var(--color-red)",
};

// Emoji per ruolo dell'ultima azione (colonna "Aggiornato da").
// La chiave è last_action_by (ruolo), non il nome istanza.
const ACTOR_EMOJI: Record<string, string> = {
  scout: "🔍",
  analista: "🔬",
  scorer: "🎯",
  scrittore: "✍️",
  critico: "⚖️",
  user: "👤",
};

// Verdetto critico → colore del voto (qui il colore È semantico: è un
// giudizio di qualità, non come la modalità remote).
const CRITIC_COLORS: Record<string, string> = {
  PASS: "var(--color-green)",
  NEEDS_WORK: "var(--color-yellow)",
  REJECT: "var(--color-red)",
};

function scoreClass(s?: number | null) {
  if (!s) return "text-[var(--color-dim)]";
  if (s >= 75) return "text-[var(--color-green)]";
  if (s >= 55) return "text-[var(--color-yellow)]";
  return "text-[var(--color-red)]";
}
function scoreBg(s?: number | null) {
  if (!s) return "var(--color-border)";
  if (s >= 75) return "var(--color-green)";
  if (s >= 55) return "var(--color-yellow)";
  return "var(--color-red)";
}

// Range stipendio compatto in "k", convertito nella valuta scelta
// (es. "€60–80k", "$≥70k"). null → "—".
function formatSalary(
  min: number | null,
  max: number | null,
  from: string,
  to: string,
  rates: Rates,
): string {
  const sym = currencySymbol(to);
  const f = (n: number) => formatMoneyCompact(convertCurrency(n, from, to, rates));
  if (min != null && max != null)
    return min === max ? `${sym}${f(min)}` : `${sym}${f(min)}–${f(max)}`;
  if (min != null) return `${sym}≥${f(min)}`;
  if (max != null) return `${sym}≤${f(max)}`;
  return "—";
}

// Lordo mensile = lordo annuo / 12, convertito e in "k" con 1 decimale
// (es. "€5.0–6.7k"). È una semplice divisione: NON è il netto.
function formatMonthly(
  min: number | null,
  max: number | null,
  from: string,
  to: string,
  rates: Rates,
): string {
  const sym = currencySymbol(to);
  const m = (n: number) =>
    formatMoneyCompact(convertCurrency(n, from, to, rates) / 12);
  if (min != null && max != null)
    return min === max ? `${sym}${m(min)}` : `${sym}${m(min)}–${m(max)}`;
  if (min != null) return `${sym}≥${m(min)}`;
  if (max != null) return `${sym}≤${m(max)}`;
  return "—";
}

export type TableLabels = {
  title: string;
  titleFiltered: string;
  viewAll: string;
  noPositions: string;
  colId: string;
  colUpdated: string;
  colUpdatedBy: string;
  colTitle: string;
  colCompany: string;
  colCategory: string;
  colCountry: string;
  colCity: string;
  colRemote: string;
  colScore: string;
  colCritic: string;
  colSalary: string;
  colMonthly: string;
  colStatus: string;
};

type Props = {
  // Righe già filtrate e limitate dall'orchestratore.
  rows: DashboardPosition[];
  labels: TableLabels;
  // Filtri cross-chart attivi → titolo + conteggio totale filtrato.
  filtered: boolean;
  totalFiltered: number;
  // Conversione stipendio: tassi + valuta di visualizzazione corrente.
  rates: Rates;
  displayCurrency: string;
};

export default function RecentPositionsTable({
  rows,
  labels,
  filtered,
  totalFiltered,
  rates,
  displayCurrency,
}: Props) {
  // Doppia scrollbar orizzontale: una barra-proxy in cima sincronizzata con
  // il contenitore della tabella in fondo (utile con tabella larga + tante
  // righe, così non devi scorrere fino in fondo per scrollare a destra).
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [scrollW, setScrollW] = useState(0);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const update = () => setScrollW(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);

  // Sync bidirezionale dello scrollLeft tra le due barre.
  const syncing = useRef(false);
  const mirror = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (syncing.current || !from || !to) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    syncing.current = false;
  };

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">
          {filtered ? `${labels.titleFiltered} · ${totalFiltered}` : labels.title}
        </span>
        <Link
          href="/positions"
          className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
        >
          {labels.viewAll}
        </Link>
      </div>
      {/* Scrollbar orizzontale in cima (proxy sincronizzata con la tabella) */}
      <div
        ref={topRef}
        onScroll={() => mirror(topRef.current, bottomRef.current)}
        className="overflow-x-auto overflow-y-hidden"
        aria-hidden="true"
      >
        <div style={{ width: scrollW, height: 1 }} />
      </div>
      <div
        ref={bottomRef}
        onScroll={() => mirror(bottomRef.current, topRef.current)}
        className="overflow-x-auto border border-[var(--color-border)] rounded-lg"
      >
        <table
          className="w-full text-[12px]"
          style={{ borderCollapse: "collapse" }}
          aria-label={labels.title}
        >
          <thead>
            <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
              {[
                labels.colId,
                labels.colUpdated,
                labels.colTitle,
                labels.colCompany,
                labels.colCategory,
                labels.colCountry,
                labels.colCity,
                labels.colRemote,
                labels.colScore,
                labels.colSalary,
                labels.colMonthly,
                labels.colUpdatedBy,
                labels.colCritic,
                labels.colStatus,
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={`px-4 py-3 ${h === labels.colCritic ? "text-center" : "text-left"} text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap`}
                  style={{ color: "var(--color-dim)" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-4 py-10 text-center text-[var(--color-dim)] text-[11px]"
                >
                  {labels.noPositions}
                </td>
              </tr>
            ) : (
              rows.map((p, i) => (
                <tr
                  key={p.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors"
                  style={{
                    borderBottomColor:
                      i === rows.length - 1 ? "transparent" : undefined,
                    background:
                      i % 2 === 1 ? "rgba(255,255,255,0.008)" : undefined,
                  }}
                >
                  <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap">
                    {p.legacy_id
                      ? `JHT-${String(p.legacy_id).padStart(3, "0")}`
                      : p.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap font-mono tabular-nums">
                    {formatFoundAt(p.last_action_at || p.found_at || "")}
                  </td>
                  <td
                    className="px-4 py-3 font-medium whitespace-nowrap max-w-[200px] truncate"
                    title={p.title ?? undefined}
                  >
                    <Link
                      href={`/positions/${p.id}`}
                      className="text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors"
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-base)] whitespace-nowrap">
                    {p.company}
                  </td>
                  <td className="px-4 py-3 text-[11px] whitespace-nowrap">
                    {p.role_family && p.role_family.trim() ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{
                            background: colorForFamily(p.role_family.trim()),
                          }}
                        />
                        <span className="text-[var(--color-base)]">
                          {p.role_family.trim()}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--color-dim)]">—</span>
                    )}
                  </td>
                  {(() => {
                    const country = (p.loc_country ?? "").trim();
                    const city = (p.loc_city ?? "").trim();
                    const remoteNoCountry =
                      !country && p.remote_type === "full_remote";
                    return (
                      <>
                        <td className="px-4 py-3 text-[11px] whitespace-nowrap">
                          {country ? (
                            <span className="text-[var(--color-base)]">
                              {country}
                            </span>
                          ) : remoteNoCountry ? (
                            <span className="italic text-[var(--color-dim)]">
                              Remote
                            </span>
                          ) : (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                          {city || (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-[10px] text-[var(--color-muted)]">
                      {p.remote_type?.replace("_", " ") ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <span
                        className={`text-[12px] font-semibold w-6 text-right ${scoreClass(p.score)}`}
                      >
                        {p.score ?? "—"}
                      </span>
                      <div
                        className="w-10 h-1 rounded-full overflow-hidden"
                        style={{ background: "var(--color-border)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${p.score ?? 0}%`,
                            background: scoreBg(p.score),
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[var(--color-base)] whitespace-nowrap tabular-nums text-right">
                    {formatSalary(
                      p.salary_min,
                      p.salary_max,
                      p.salary_currency,
                      displayCurrency,
                      rates,
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap tabular-nums text-right">
                    {formatMonthly(
                      p.salary_min,
                      p.salary_max,
                      p.salary_currency,
                      displayCurrency,
                      rates,
                    )}
                  </td>
                  <td className="px-4 py-3 text-[10px] whitespace-nowrap font-mono">
                    {p.last_action_actor ? (
                      <span className="inline-flex items-center gap-1.5 text-[var(--color-muted)]">
                        <span aria-hidden="true">
                          {ACTOR_EMOJI[p.last_action_by] ?? "🤖"}
                        </span>
                        {p.last_action_actor}
                      </span>
                    ) : (
                      <span className="text-[var(--color-dim)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-center">
                    {p.critic_score != null ? (
                      <span
                        className="text-[12px] font-semibold"
                        style={{
                          color:
                            CRITIC_COLORS[p.critic_verdict ?? ""] ??
                            "var(--color-muted)",
                        }}
                      >
                        {p.critic_score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-dim)] text-[11px]">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full border"
                      style={{
                        color: STATUS_COLORS[p.status] ?? "var(--color-dim)",
                        borderColor:
                          STATUS_COLORS[p.status] ?? "var(--color-border)",
                        background: `${STATUS_COLORS[p.status]}18`,
                      }}
                    >
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
