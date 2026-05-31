"use client";

import { useCallback, useEffect, useState } from "react";

type RecentPosition = {
  id: string;
  legacy_id?: number | null;
  title: string;
  company: string;
  location?: string | null;
  status: string;
  source?: string | null;
  score?: number | null;
  found_at: string;
  found_by?: string | null;
  last_checked?: string | null;
  scored_at?: string | null;
  last_action_at?: string;
  last_action_by?: string;
  last_action_actor?: string;
  voto?: number | null;
  url?: string | null;
  remote_type?: string | null;
  salary_declared_min?: number | null;
  salary_declared_max?: number | null;
};

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

function formatFoundAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const head = sameDay
    ? time
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${head} (${formatRelative(iso)})`;
}

export default function LatestPositionsTable() {
  const [recent, setRecent] = useState<RecentPosition[]>([]);
  const [recentLoaded, setRecentLoaded] = useState(false);

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/positions/recent?limit=15");
      if (!res.ok) {
        setRecentLoaded(true);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data?.positions)) {
        setRecent(data.positions as RecentPosition[]);
      }
      setRecentLoaded(true);
    } catch {
      setRecentLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchRecent();
    const t = setInterval(fetchRecent, 10_000);
    return () => clearInterval(t);
  }, [fetchRecent]);

  return (
    <section className="pt-12 pb-12 w-full">
      <div className="mx-auto w-full max-w-[1280px] px-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[12px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            Latest positions
          </h2>
          <span className="text-[10px] text-[var(--color-dim)]">
            {recent.length > 0
              ? `${recent.length} most recent`
              : recentLoaded
                ? "no data"
                : "loading…"}
          </span>
        </div>

        <div
          className="rounded-md border border-[var(--color-border)] overflow-x-auto"
          style={{ background: "rgba(255,255,255,0.02)" }}
        >
          <table
            className="text-[11px]"
            style={{
              borderCollapse: "collapse",
              minWidth: 1400,
              width: "100%",
            }}
          >
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-[var(--color-dim)]">
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Updated
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Status
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Source
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Actor
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Company
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">
                  Score
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap text-right">
                  Voto
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Title
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Location
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Salary
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Remote
                </th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">
                  Found at
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-6 text-center text-[var(--color-dim)]"
                  >
                    {recentLoaded ? "Nessuna posizione ancora." : "Loading…"}
                  </td>
                </tr>
              ) : (
                recent.map((p) => {
                  const statusColor = STATUS_COLORS[p.status] ?? "#94a3b8";
                  const actor =
                    p.last_action_actor ?? p.last_action_by ?? "scout";
                  const updatedAt = p.last_action_at ?? p.found_at;
                  const salary = (() => {
                    const lo = p.salary_declared_min;
                    const hi = p.salary_declared_max;
                    if (
                      typeof lo === "number" &&
                      typeof hi === "number" &&
                      (lo || hi)
                    ) {
                      return `${lo.toLocaleString()}–${hi.toLocaleString()}`;
                    }
                    return "—";
                  })();
                  return (
                    <tr
                      key={p.id}
                      className="border-t border-[var(--color-border)] hover:bg-[rgba(255,255,255,0.03)]"
                    >
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)] font-mono tabular-nums">
                        {formatFoundAt(updatedAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide"
                          style={{
                            background: `${statusColor}22`,
                            color: statusColor,
                            border: `1px solid ${statusColor}55`,
                          }}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)]">
                        {p.source ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)] font-mono">
                        {actor}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        <div
                          className="truncate max-w-[180px]"
                          title={p.company}
                        >
                          {p.company}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                        {typeof p.score === "number" ? p.score : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right text-[var(--color-bright)] font-mono tabular-nums">
                        {typeof p.voto === "number" ? p.voto.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-bright)]">
                        <div className="truncate max-w-[380px]" title={p.title}>
                          {p.title}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">
                        <div
                          className="truncate max-w-[200px]"
                          title={p.location ?? ""}
                        >
                          {p.location ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-muted)] font-mono tabular-nums">
                        {salary}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)]">
                        {p.remote_type ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--color-dim)] font-mono tabular-nums">
                        {p.found_at ? formatFoundAt(p.found_at) : "—"}
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
