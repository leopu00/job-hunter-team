"use client";

import Link from "next/link";
import type { DashboardPosition } from "@/lib/queries";
import UnseenDot from "@/app/components/UnseenDot";
import { scoreSpectrumCss } from "@/lib/score-color";
import { colorForFamily } from "@/lib/position-classifier";

export type TableLabels = {
  title: string;
  titleFiltered: string;
  viewAll: string;
  noPositions: string;
  unseen: string;
  colId: string;
  colTitle: string;
  colCompany: string;
  colCountry: string;
  colCity: string;
  colScore: string;
  // Etichetta della colonna timestamp (variante firstCol="scored").
  colScored?: string;
};

type Props = {
  // Righe già filtrate e limitate dall'orchestratore.
  rows: DashboardPosition[];
  labels: TableLabels;
  // Filtri cross-chart attivi → titolo + conteggio totale filtrato.
  filtered: boolean;
  totalFiltered: number;
  // Prima colonna: "id" (storico) oppure "scored" = timestamp dello score
  // (tabella "ultime posizioni valutate").
  firstCol?: "id" | "scored";
};

// Larghezze fisse delle 6 colonne (table-fixed): la somma fa 100% così la
// tabella riempie sempre il contenitore SENZA scroll orizzontale — l'utente
// vede tutte e sei le colonne a ogni larghezza. Titolo e azienda hanno la
// fetta più grande; il testo che eccede viene troncato con ellipsis.
const COL_WIDTHS = ["10%", "33%", "27%", "9%", "10%", "11%"] as const;

// Timestamp compatto "20/07 09:57" per la colonna della variante "scored".
function formatScoredAt(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RecentPositionsTable({
  rows,
  labels,
  filtered,
  totalFiltered,
  firstCol = "id",
}: Props) {
  // Colonne "dati" allineate al centro (header + valore): le altre (testo:
  // titolo/azienda/paese…) restano a sinistra, che si legge meglio.
  const centeredHeaders = new Set([labels.colScore]);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <span className="section-label">
          {filtered
            ? `${labels.titleFiltered} · ${totalFiltered}`
            : labels.title}
        </span>
        <Link
          href="/positions"
          className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
        >
          {labels.viewAll}
        </Link>
      </div>
      {/* ── Card list (solo mobile) ─────────────────────────────────
          Sotto md le sei colonne non ci stanno: comprimerle riduce
          titolo/azienda a due lettere + ellipsis (illeggibile). Stessa
          scelta già fatta su /positions: una card compatta per posizione
          con gli stessi dati della riga — titolo+score, azienda+località,
          categoria + prima colonna (timestamp score o ID). */}
      <div className="md:hidden flex flex-col gap-2">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] px-4 py-12 text-center text-[var(--color-dim)] text-[11px]">
            {labels.noPositions}
          </div>
        ) : (
          rows.map((p) => {
            const country = (p.loc_country ?? "").trim();
            const city = (p.loc_city ?? "").trim();
            const place =
              city ||
              country ||
              (p.remote_type === "full_remote" ? "Remote" : "");
            return (
              <div
                key={p.id}
                className="rounded-lg border p-3"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* SOLO il titolo è link (come su /positions): la card
                      intera cliccabile sottolinea ogni riga su touch. */}
                  <Link
                    href={`/positions/${p.id}`}
                    className="min-w-0 text-[13px] font-semibold leading-snug no-underline"
                    style={{
                      color: "var(--color-green)",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {p.title}{" "}
                    <UnseenDot
                      id={p.id}
                      label={labels.unseen}
                      initialSeen={p.seen}
                    />
                  </Link>
                  <span
                    className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full border-2 text-[12px] font-bold tabular-nums"
                    style={{
                      color: scoreSpectrumCss(p.score),
                      borderColor: scoreSpectrumCss(p.score),
                    }}
                  >
                    {p.score ?? "—"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[var(--color-muted)] truncate">
                  {p.company}
                  {place ? ` · ${place}` : ""}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                  <span className="flex items-center gap-2 min-w-0">
                    {p.role_family?.trim() && (
                      <span className="inline-flex items-center gap-1 truncate text-[var(--color-muted)]">
                        <span
                          aria-hidden
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: colorForFamily(p.role_family.trim()),
                            flexShrink: 0,
                          }}
                        />
                        <span className="truncate">{p.role_family.trim()}</span>
                      </span>
                    )}
                  </span>
                  {/* Stessa informazione della prima colonna della tabella:
                      timestamp dello score, oppure ID nella variante "id". */}
                  <span
                    className="shrink-0 font-mono tabular-nums text-[var(--color-dim)]"
                    suppressHydrationWarning={firstCol === "scored"}
                  >
                    {firstCol === "scored"
                      ? formatScoredAt(p.scored_at)
                      : p.legacy_id
                        ? `JHT-${String(p.legacy_id).padStart(3, "0")}`
                        : p.id.slice(0, 8)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Tabella (da md in su) ──────────────────────────────────── */}
      <div className="hidden md:block border border-[var(--color-border)] rounded-lg overflow-hidden">
        <table
          className="w-full table-fixed text-[12px]"
          style={{ borderCollapse: "collapse" }}
          aria-label={labels.title}
        >
          <colgroup>
            {COL_WIDTHS.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-[var(--color-panel)] border-b border-[var(--color-border)]">
              {[
                firstCol === "scored"
                  ? (labels.colScored ?? labels.colId)
                  : labels.colId,
                labels.colTitle,
                labels.colCompany,
                labels.colCountry,
                labels.colCity,
                labels.colScore,
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={`px-4 py-3 ${centeredHeaders.has(h) ? "text-center" : "text-left"} text-[9.5px] font-semibold tracking-[0.15em] uppercase truncate`}
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
                  colSpan={6}
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
                  {firstCol === "scored" ? (
                    // suppressHydrationWarning: il timestamp è formattato in
                    // timezone locale — server e browser possono divergere.
                    <td
                      className="px-4 py-3 text-[10px] tabular-nums text-[var(--color-muted)] truncate"
                      title={p.scored_at ?? undefined}
                      suppressHydrationWarning
                    >
                      {formatScoredAt(p.scored_at)}
                    </td>
                  ) : (
                    <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] truncate">
                      {p.legacy_id
                        ? `JHT-${String(p.legacy_id).padStart(3, "0")}`
                        : p.id.slice(0, 8)}
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-2 min-w-0">
                      <Link
                        href={`/positions/${p.id}`}
                        title={p.title ?? undefined}
                        className="min-w-0 flex-1 truncate text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors"
                      >
                        {p.title}
                      </Link>
                      <UnseenDot
                        id={p.id}
                        label={labels.unseen}
                        initialSeen={p.seen}
                      />
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--color-base)] truncate"
                    title={p.company ?? undefined}
                  >
                    {p.company}
                  </td>
                  {(() => {
                    const country = (p.loc_country ?? "").trim();
                    const city = (p.loc_city ?? "").trim();
                    const remoteNoCountry =
                      !country && p.remote_type === "full_remote";
                    return (
                      <>
                        <td
                          className="px-4 py-3 text-[11px] truncate"
                          title={country || undefined}
                        >
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
                        <td
                          className="px-4 py-3 text-[11px] text-[var(--color-muted)] truncate"
                          title={city || undefined}
                        >
                          {city || (
                            <span className="text-[var(--color-dim)]">—</span>
                          )}
                        </td>
                      </>
                    );
                  })()}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-center">
                      <span
                        className="text-[12px] font-semibold w-6 text-right tabular-nums"
                        style={{ color: scoreSpectrumCss(p.score) }}
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
                            background: scoreSpectrumCss(p.score),
                          }}
                        />
                      </div>
                    </div>
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
