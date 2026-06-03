"use client";

import { useMemo, useState } from "react";
import type { AgentActivity, FiveHourWindow } from "./types";

type Props = {
  fiveHourWindow: FiveHourWindow;
  activity: AgentActivity[];
};

const ROLE_EMOJI: Record<string, string> = {
  analista: "👨‍🔬",
  scout: "🕵️",
  scorer: "👨‍💻",
  scrittore: "👨‍🏫",
  critico: "👨‍⚖️",
  capitano: "👨‍✈️",
  sentinella: "💂",
  assistente: "👨‍💼",
  mentor: "🧙",
  dottore: "👨‍⚕️",
};

const AGENT_TEXT: Record<string, string> = {
  "analista-1": "text-yellow-300",
  "analista-2": "text-yellow-300",
  "scout-1": "text-orange-300",
  "scout-2": "text-orange-300",
  "scorer-1": "text-emerald-300",
  "scorer-2": "text-emerald-300",
  "scrittore-1": "text-blue-300",
  "scrittore-2": "text-blue-300",
  "scrittore-3": "text-blue-300",
  "critico-s1": "text-violet-300",
  "critico-s2": "text-violet-300",
  "critico-s3": "text-violet-300",
  capitano: "text-red-300",
  mentor: "text-pink-300",
  assistente: "text-cyan-300",
  sentinella: "text-teal-300",
  dottore: "text-sky-300",
};

function baseRole(agent: string): string {
  return agent.replace(/-(?:s)?\d+$/, "");
}

function emojiFor(agent: string): string {
  return ROLE_EMOJI[baseRole(agent)] ?? "🤖";
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

type Filter = "all" | "pipeline" | "comm";

const PIPELINE_AGENTS = new Set([
  "scout-1",
  "scout-2",
  "analista-1",
  "analista-2",
  "scorer-1",
  "scorer-2",
  "scrittore-1",
  "scrittore-2",
  "scrittore-3",
]);
const HIDDEN_AGENTS = new Set(["assistente"]);

export function WindowEventsList({ fiveHourWindow: fhw, activity }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const sorted = useMemo(
    () =>
      activity
        .filter((a) => !HIDDEN_AGENTS.has(baseRole(a.agent)))
        .slice()
        .sort((a, b) => a.ts_start.localeCompare(b.ts_start)),
    [activity],
  );

  const filtered = useMemo(() => {
    let out = sorted;
    if (filter === "pipeline")
      out = out.filter((e) => PIPELINE_AGENTS.has(e.agent));
    if (filter === "comm")
      out = out.filter((e) => !PIPELINE_AGENTS.has(e.agent));
    if (search.trim()) {
      const s = search.toLowerCase();
      out = out.filter(
        (e) =>
          e.agent.toLowerCase().includes(s) ||
          (e.reason ?? "").toLowerCase().includes(s),
      );
    }
    return out;
  }, [sorted, filter, search]);

  return (
    <div className="flex h-full flex-col rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h6 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
          Eventi W{fhw.window_number} ({filtered.length}/{sorted.length})
        </h6>
        <div className="flex gap-1 text-[10px]">
          {(["all", "pipeline", "comm"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 transition ${
                filter === f
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-slate-800/60 text-[var(--color-dim)] hover:bg-slate-800"
              }`}
            >
              {f === "all" ? "tutti" : f === "pipeline" ? "pipeline" : "comm"}
            </button>
          ))}
        </div>
      </header>
      <input
        type="text"
        placeholder="filtra per agente / testo…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 placeholder:text-[var(--color-muted)] focus:border-emerald-500 focus:outline-none"
      />
      <ul className="min-h-[300px] flex-1 space-y-1 overflow-y-auto pr-1 font-mono text-[11px] leading-tight">
        {filtered.length === 0 && (
          <li className="italic text-[var(--color-muted)]">— nessun evento</li>
        )}
        {filtered.map((e, i) => (
          <li
            key={i}
            className="flex items-baseline gap-2 border-b border-slate-800/60 pb-1 last:border-0"
          >
            <span className="w-16 shrink-0 text-[var(--color-muted)]">
              {fmtClock(new Date(e.ts_start).getTime())}
            </span>
            <span className="w-4 shrink-0">{emojiFor(e.agent)}</span>
            <span
              className={`w-[88px] shrink-0 ${AGENT_TEXT[e.agent] ?? "text-slate-300"}`}
            >
              {e.agent}
            </span>
            <span className="break-words text-slate-200">{e.reason ?? ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
