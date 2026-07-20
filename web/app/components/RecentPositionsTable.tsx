"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DashboardPosition } from "@/lib/queries";
import UnseenDot from "@/app/components/UnseenDot";

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
};

type Props = {
  // Righe già filtrate e limitate dall'orchestratore.
  rows: DashboardPosition[];
  labels: TableLabels;
  // Filtri cross-chart attivi → titolo + conteggio totale filtrato.
  filtered: boolean;
  totalFiltered: number;
};

export default function RecentPositionsTable({
  rows,
  labels,
  filtered,
  totalFiltered,
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
                labels.colTitle,
                labels.colCompany,
                labels.colCountry,
                labels.colCity,
                labels.colScore,
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={`px-4 py-3 ${centeredHeaders.has(h) ? "text-center" : "text-left"} text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap`}
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
                  <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap">
                    {p.legacy_id
                      ? `JHT-${String(p.legacy_id).padStart(3, "0")}`
                      : p.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/positions/${p.id}`}
                        title={p.title ?? undefined}
                        className="block max-w-[28rem] truncate text-[var(--color-bright)] hover:text-[var(--color-green)] no-underline transition-colors"
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
                  <td className="px-4 py-3 text-[var(--color-base)] whitespace-nowrap">
                    {p.company}
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-center">
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
