"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  RecentActivityEvent,
  TeamActivityRole,
} from "@/lib/team-activity";
import { ROLE_META, timeAgo, dmhm } from "@/lib/team-activity-meta";

const ROLES: TeamActivityRole[] = [
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "critico",
];
const PAGE_SIZES = [20, 50, 100, 200];

export default function ActivityLogTable({
  events,
}: {
  events: RecentActivityEvent[];
}) {
  const [role, setRole] = useState<TeamActivityRole | "all">("all");
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // Conteggio per ruolo (per i chip)
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: events.length };
    for (const r of ROLES) m[r] = 0;
    for (const e of events) m[e.role] = (m[e.role] ?? 0) + 1;
    return m;
  }, [events]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (role !== "all" && e.role !== role) return false;
      if (!needle) return true;
      return (
        e.actor.toLowerCase().includes(needle) ||
        (e.title ?? "").toLowerCase().includes(needle) ||
        (e.company ?? "").toLowerCase().includes(needle) ||
        (e.legacyId != null && String(e.legacyId).includes(needle)) ||
        (e.pid ?? "").toLowerCase().includes(needle)
      );
    });
  }, [events, role, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize);

  // Cambiando filtro/ricerca/dimensione torno a pagina 1.
  const reset = () => setPage(1);

  return (
    <div>
      {/* ── Filtri ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => {
            setRole("all");
            reset();
          }}
          className="px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide transition-colors"
          style={{
            background: role === "all" ? "var(--color-white)" : "transparent",
            color: role === "all" ? "#0a0a0a" : "var(--color-muted)",
            border: `1px solid ${role === "all" ? "var(--color-white)" : "var(--color-border)"}`,
          }}
        >
          Tutti <span className="opacity-60 tabular-nums">{counts.all}</span>
        </button>
        {ROLES.map((r) => {
          const meta = ROLE_META[r];
          const active = role === r;
          return (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                reset();
              }}
              disabled={!counts[r]}
              className="px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide transition-colors disabled:opacity-30"
              style={{
                background: active ? meta.color : "transparent",
                color: active ? "#0a0a0a" : meta.color,
                border: `1px solid ${active ? meta.color : "var(--color-border)"}`,
              }}
            >
              {meta.emoji} {meta.label}{" "}
              <span className="opacity-60 tabular-nums">{counts[r] ?? 0}</span>
            </button>
          );
        })}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            reset();
          }}
          placeholder="Cerca istanza, titolo, azienda, #id…"
          className="ml-auto bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-3 py-1.5 text-[11px] text-[var(--color-white)] outline-none focus:border-[var(--color-blue)] transition-colors w-64 max-w-full"
          style={{ fontFamily: "inherit" }}
        />
      </div>

      {/* ── Tabella ─────────────────────────────────────────────── */}
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {[
                  "Quando",
                  "Agente",
                  "Azione",
                  "Posizione",
                  "#",
                  "Data/ora",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-[9px] font-semibold tracking-[0.14em] uppercase text-[var(--color-dim)] whitespace-nowrap"
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
                    className="px-4 py-10 text-center text-[11px] text-[var(--color-dim)]"
                  >
                    Nessuna azione per i filtri selezionati.
                  </td>
                </tr>
              ) : (
                rows.map((ev, i) => {
                  const meta = ROLE_META[ev.role];
                  const label = ev.actor === ev.role ? meta.label : ev.actor;
                  return (
                    <tr
                      key={`${ev.role}-${ev.actor}-${ev.ts}-${start + i}`}
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg)] transition-colors"
                    >
                      <td className="px-4 py-2 text-[10px] text-[var(--color-dim)] whitespace-nowrap tabular-nums">
                        {timeAgo(ev.ts)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="text-[12px] mr-1.5">{meta.emoji}</span>
                        <span
                          className="text-[11px] font-bold tabular-nums"
                          style={{ color: meta.color }}
                          title={ev.actor}
                        >
                          {label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                        {meta.action}
                      </td>
                      <td className="px-4 py-2 text-[11px] max-w-[420px] truncate">
                        {ev.title || ev.company ? (
                          <>
                            {ev.title && (
                              <span className="text-[var(--color-white)]">
                                {ev.title}
                              </span>
                            )}
                            {ev.company && (
                              <span className="text-[var(--color-dim)]">
                                {ev.title ? " · " : ""}
                                {ev.company}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[var(--color-dim)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {ev.pid ? (
                          <Link
                            href={`/positions/${ev.pid}`}
                            className="text-[10px] font-semibold tabular-nums no-underline rounded px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] transition-colors"
                            title={`Apri la posizione · ${ev.pid}`}
                          >
                            #{ev.legacyId ?? ev.pid.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-[var(--color-dim)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[10px] text-[var(--color-dim)] whitespace-nowrap tabular-nums">
                        {dmhm(ev.ts)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Footer: rows-per-page + paginazione ─────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <div className="flex items-center gap-2 text-[10px] text-[var(--color-dim)]">
          <span>Righe per pagina</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              reset();
            }}
            className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[10px] text-[var(--color-white)] outline-none"
            style={{ fontFamily: "inherit", colorScheme: "dark" }}
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="ml-2 tabular-nums">
            {total === 0
              ? "0"
              : `${start + 1}–${Math.min(start + pageSize, total)}`}{" "}
            di {total}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage(Math.max(1, safePage - 1))}
            disabled={safePage <= 1}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-white)] hover:border-[var(--color-muted)] transition-colors disabled:opacity-30"
          >
            ← Prec
          </button>
          <span className="text-[10px] text-[var(--color-dim)] tabular-nums px-1">
            {safePage} / {pages}
          </span>
          <button
            onClick={() => setPage(Math.min(pages, safePage + 1))}
            disabled={safePage >= pages}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-white)] hover:border-[var(--color-muted)] transition-colors disabled:opacity-30"
          >
            Succ →
          </button>
        </div>
      </div>
    </div>
  );
}
