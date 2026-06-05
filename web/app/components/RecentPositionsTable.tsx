"use client";

import Link from "next/link";
import type { DashboardPosition } from "@/lib/queries";
import { formatFoundAt } from "@/lib/format-time";

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
  colId: string;
  colTitle: string;
  colCompany: string;
  colLocation: string;
  colRemote: string;
  colScore: string;
  colStatus: string;
  colUpdated: string;
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
      <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
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
                labels.colLocation,
                labels.colRemote,
                labels.colScore,
                labels.colStatus,
                labels.colUpdated,
              ].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-4 py-3 text-left text-[9.5px] font-semibold tracking-[0.15em] uppercase whitespace-nowrap"
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
                  colSpan={8}
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
                  <td className="px-4 py-3 text-[11px] text-[var(--color-muted)] whitespace-nowrap">
                    {p.location ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-[10px]"
                      style={{
                        color:
                          p.remote_type === "full_remote"
                            ? "var(--color-green)"
                            : p.remote_type === "hybrid"
                              ? "var(--color-yellow)"
                              : "var(--color-red)",
                      }}
                    >
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
                  <td className="px-4 py-3 text-[10px] text-[var(--color-dim)] whitespace-nowrap font-mono tabular-nums">
                    {formatFoundAt(p.last_action_at || p.found_at || "")}
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
