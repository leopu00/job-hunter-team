"use client";

import { useEffect, useRef, useState } from "react";
import {
  LUXURY_POSITIONS,
  type LuxuryPosition,
} from "../_data/luxuryPositions";

type RecentPosition = LuxuryPosition;

const STATUS_COLORS: Record<string, string> = {
  new: "#94a3b8",
  checked: "#38bdf8",
  excluded: "#475569",
  scored: "#a78bfa",
  writing: "#f59e0b",
  review: "#fb923c",
  ready: "#34d399",
  applied: "#22c55e",
  response: "#facc15",
};

// Pipeline di avanzamento status. Ogni "tick" scroll-driven prende una
// riga e la fa avanzare al prossimo stato → simula il team che lavora,
// come la tabella di /team/v2 quando i polling /api/db/recent-writes
// rilevano nuovi timestamp.
const STATUS_PIPELINE = [
  "new",
  "checked",
  "scored",
  "writing",
  "review",
  "ready",
  "applied",
  "response",
] as const;

// Actor associato al transition: per dare credibilità al flash
// mostriamo l'agente che "ha lavorato" la riga.
const STATUS_ACTOR: Record<string, string> = {
  checked: "analista",
  scored: "scorer",
  writing: "scrittore",
  review: "critico",
  ready: "scrittore",
  applied: "scout",
  response: "scout",
};

type RowOverride = {
  status?: string;
  actor?: string;
  voto?: number | null;
  score?: number | null;
};

type FlashState = { color: string; key: number };

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export default function LatestPositionsTable() {
  // Landing page: dataset fittizio coerente con il profilo "luxury
  // hospitality front-of-house". Niente fetch al backend (l'utente non
  // è loggato e non ha un team che produce dati reali) — i dati statici
  // si animano lo stesso via lo scroll-driven tick più in basso.
  const [recent] = useState<RecentPosition[]>(LUXURY_POSITIONS);
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
  const [flashes, setFlashes] = useState<Record<string, FlashState>>({});
  const sectionRef = useRef<HTMLElement | null>(null);
  const flashKeyRef = useRef(0);

  // Scroll-driven simulation: ad ogni soglia di scroll-down attraverso
  // la sezione, una riga avanza di status nel pipeline e flasha. Replica
  // l'esperienza di /team/v2 quando i polling rilevano scritture reali,
  // ma local-only (utenti non loggati non hanno il backend del team).
  useEffect(() => {
    if (recent.length === 0) return;
    let lastY = typeof window !== "undefined" ? window.scrollY : 0;
    let accumScroll = 0;
    const PIXELS_PER_TICK = 140;

    const tick = () => {
      // Considera tutte le righe non ancora "response" (ultimo stato).
      const candidates = recent.filter((p) => {
        const cur = overrides[p.id]?.status ?? p.status;
        const idx = STATUS_PIPELINE.indexOf(
          cur as (typeof STATUS_PIPELINE)[number],
        );
        return idx >= 0 && idx < STATUS_PIPELINE.length - 1;
      });
      if (candidates.length === 0) return;
      const row = candidates[Math.floor(Math.random() * candidates.length)];
      const cur = overrides[row.id]?.status ?? row.status;
      const idx = STATUS_PIPELINE.indexOf(
        cur as (typeof STATUS_PIPELINE)[number],
      );
      const next = STATUS_PIPELINE[idx + 1];
      const nextActor = STATUS_ACTOR[next] ?? row.last_action_actor ?? "scout";
      const color = STATUS_COLORS[next] ?? "#94a3b8";
      flashKeyRef.current += 1;
      const myKey = flashKeyRef.current;

      setOverrides((prev) => {
        const cur = prev[row.id] ?? {};
        const patch: RowOverride = { ...cur, status: next, actor: nextActor };
        // Quando arriva a "scored" assegnamo un voto sintetico
        // (random 6.0–8.8) se non già presente — coerente con la
        // colonna Voto che resterebbe vuota altrimenti.
        if (next === "scored" && row.voto == null && cur.voto == null) {
          patch.voto = Math.round((6 + Math.random() * 2.8) * 10) / 10;
        }
        return { ...prev, [row.id]: patch };
      });
      setFlashes((prev) => ({ ...prev, [row.id]: { color, key: myKey } }));
      window.setTimeout(() => {
        setFlashes((prev) => {
          if (prev[row.id]?.key !== myKey) return prev;
          const rest = { ...prev };
          delete rest[row.id];
          return rest;
        });
      }, 1400);
    };

    const onScroll = () => {
      const dy = window.scrollY - lastY;
      lastY = window.scrollY;
      if (dy <= 0) return; // solo scroll-down
      const sec = sectionRef.current;
      if (sec) {
        const rect = sec.getBoundingClientRect();
        const winH = window.innerHeight;
        // Attiva ticks solo quando la sezione tabella è almeno parzialmente
        // nel viewport (top sotto il fondo e bottom sopra il top).
        if (rect.top > winH || rect.bottom < 0) return;
      }
      accumScroll += dy;
      while (accumScroll >= PIXELS_PER_TICK) {
        accumScroll -= PIXELS_PER_TICK;
        tick();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [recent, overrides]);

  return (
    <section ref={sectionRef} className="pt-2 pb-12 w-full">
      <div className="mx-auto w-full max-w-[1280px] px-4">
        <div
          className="rounded-md border border-[var(--color-border)] overflow-hidden"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <table
            className="text-[11px]"
            style={{
              borderCollapse: "collapse",
              width: "100%",
              tableLayout: "fixed",
            }}
          >
            {/* col widths, ordine: Status | Title | Company | Location | Voto | Salary | Updated */}
            <colgroup>
              <col style={{ width: "9%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "9%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
                <th className="px-3 py-2 font-normal whitespace-nowrap">Status</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Title</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Company</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">Location</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Voto</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Salary</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-[var(--color-dim)]"
                  >
                    Nessuna posizione ancora.
                  </td>
                </tr>
              ) : (
                recent.map((p) => {
                  const ov = overrides[p.id];
                  const flash = flashes[p.id];
                  const status = ov?.status ?? p.status;
                  const statusColor = STATUS_COLORS[status] ?? "#94a3b8";
                  const voto = ov?.voto ?? p.voto;
                  const updatedAt = p.last_action_at ?? p.found_at;
                  const salary = (() => {
                    const lo = p.salary_declared_min;
                    const hi = p.salary_declared_max;
                    if (
                      typeof lo === "number" &&
                      typeof hi === "number" &&
                      (lo || hi)
                    ) {
                      // Formato compatto k€ (es. 58k–72k) — più leggibile
                      // a colpo d'occhio del 58,000–72,000.
                      const k = (n: number) => `${Math.round(n / 1000)}k`;
                      return `${k(lo)}–${k(hi)}`;
                    }
                    return "—";
                  })();
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.03)]"
                      style={{
                        background: flash
                          ? `${flash.color}33`
                          : "transparent",
                        transition: "background 1.4s ease-out",
                      }}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide"
                          style={{
                            background: `${statusColor}22`,
                            color: statusColor,
                            border: `1px solid ${statusColor}55`,
                          }}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-bright)]">
                        <div className="truncate" title={p.title}>
                          {p.title}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        <div className="truncate" title={p.company}>
                          {p.company}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        <div
                          className="truncate"
                          title={p.location ?? ""}
                        >
                          {p.location ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                        {typeof voto === "number" ? voto.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-muted)] font-mono tabular-nums">
                        {salary}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-dim)] font-mono tabular-nums">
                        {formatRelative(updatedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
