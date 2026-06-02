"use client";

import { useState } from "react";
import type { CaseStudy, Window, AgentTokens } from "./types";
import { providerColor } from "./types";
import { useChartTheme } from "./chart-theme";

type Props = {
  caseStudy: CaseStudy;
  weekly: Window;
};

// Stable palette per agente (stesso schema usato in AgentTracksChart).
const AGENT_PALETTE: Record<string, string> = {
  "analista-1": "#facc15",
  "analista-2": "#fbbf24",
  "scout-1": "#f97316",
  "scout-2": "#fb923c",
  "scorer-1": "#22c55e",
  "scorer-2": "#16a34a",
  "scrittore-1": "#1d4ed8",
  "scrittore-2": "#3b82f6",
  "scrittore-3": "#60a5fa",
  "critico-s1": "#a78bfa",
  "critico-s2": "#a78bfa",
  "critico-s3": "#a78bfa",
  capitano: "#ef4444",
  mentor: "#ec4899",
  assistente: "#06b6d4",
  sentinella: "#14b8a6",
  dottore: "#0ea5e9",
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

function emojiFor(agent: string): string {
  if (agent.startsWith("critico")) return ROLE_EMOJI.critico;
  const base = agent.split("-")[0];
  return ROLE_EMOJI[base] ?? "🤖";
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString("it-IT");
}

type WindowSummary = {
  window_number: number;
  totalIn: number;
  totalCached: number;
  totalOut: number;
  agents: AgentTokens[]; // sorted desc by input_tokens
};

function buildSummaries(tokens: AgentTokens[]): WindowSummary[] {
  const byW = new Map<number, AgentTokens[]>();
  for (const t of tokens) {
    const arr = byW.get(t.window_number) ?? [];
    arr.push(t);
    byW.set(t.window_number, arr);
  }
  return Array.from(byW.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([n, rows]) => {
      const sorted = [...rows].sort((a, b) => b.input_tokens - a.input_tokens);
      return {
        window_number: n,
        totalIn: rows.reduce((s, r) => s + r.input_tokens, 0),
        totalCached: rows.reduce((s, r) => s + r.cached_input_tokens, 0),
        totalOut: rows.reduce((s, r) => s + r.output_tokens, 0),
        agents: sorted,
      };
    });
}

export function TokensTab({ caseStudy, weekly }: Props) {
  const { mode } = useChartTheme();
  const isDark = mode === "dark";
  // Agente evidenziato (hover da un donut o dalla legenda) — sincronizzato su
  // tutti i donut così l'highlight è cross-finestra.
  const [hovered, setHovered] = useState<string | null>(null);
  const accent = providerColor(caseStudy.provider_name);
  const tokens = weekly.agent_tokens ?? [];
  if (tokens.length === 0) return null;

  const summaries = buildSummaries(tokens);

  // Per la barra stacked, prendiamo i top-N agenti per finestra e raggruppiamo
  // il resto come "altri". I top globali sono il subset stabile.
  const TOP_N = 8;
  const globalTopAgents = (() => {
    const sumByAg = new Map<string, number>();
    for (const t of tokens) {
      sumByAg.set(t.agent, (sumByAg.get(t.agent) ?? 0) + t.input_tokens);
    }
    return Array.from(sumByAg.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([ag]) => ag);
  })();
  const topSet = new Set(globalTopAgents);
  const maxWindowIn = Math.max(...summaries.map((w) => w.totalIn));
  const minWindowIn = Math.min(...summaries.map((w) => w.totalIn));

  return (
    <section
      className={`py-10 ${isDark ? "bg-slate-950" : "bg-slate-50"}`}
      style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2
              className="text-2xl font-bold sm:text-3xl"
              style={{ color: isDark ? "#ffffff" : "#0f172a" }}
            >
              💰 Token consumati per agente
            </h2>
            <p
              className="mt-1 text-sm"
              style={{ color: isDark ? "#94a3b8" : "#475569" }}
            >
              {caseStudy.title} · breakdown per finestra 5h. I token sono
              estratti dai rollout Codex (ogni sessione tmux di un agente lascia
              un `rollout-*.jsonl` con i token_count event-per-event).
            </p>
          </div>
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              isDark
                ? "border-slate-700 text-slate-300"
                : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
            {caseStudy.provider_name}
          </div>
        </div>

        {/* Bar chart · token input totali per finestra */}
        <figure
          className={`mb-8 rounded-lg border p-4 ${
            isDark
              ? "border-slate-700 bg-slate-900"
              : "border-slate-200 bg-white"
          }`}
        >
          <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3
              className="text-sm font-semibold"
              style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
            >
              Input tokens totali per finestra
            </h3>
            <p
              className="text-[11px]"
              style={{ color: isDark ? "#94a3b8" : "#64748b" }}
            >
              altezza relativa al range {fmtTokens(minWindowIn)}–
              {fmtTokens(maxWindowIn)} (asse non parte da 0)
            </p>
          </header>
          <div className="flex h-48 items-end gap-3 sm:gap-5">
            {summaries.map((w) => {
              // Scala relativa min→max: la finestra più piccola resta visibile
              // (~12%), la più grande tocca il top. Amplifica differenze reali
              // altrimenti schiacciate da un asse 0-based.
              const span = maxWindowIn - minWindowIn;
              const heightPct =
                span > 0 ? 12 + ((w.totalIn - minWindowIn) / span) * 88 : 100;
              const isMax = w.totalIn === maxWindowIn;
              const isMin = w.totalIn === minWindowIn;
              return (
                <div
                  key={w.window_number}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                  title={`Finestra ${w.window_number} · ${fmtTokens(w.totalIn)} input`}
                >
                  <span
                    className="font-mono text-[11px] font-semibold tabular-nums"
                    style={{
                      color: isMax ? accent : isDark ? "#f1f5f9" : "#0f172a",
                    }}
                  >
                    {fmtTokens(w.totalIn)}
                  </span>
                  <div
                    className="w-full max-w-[80px] rounded-t-sm transition-[height] duration-300"
                    style={{
                      height: `${heightPct}%`,
                      minHeight: 4,
                      backgroundColor: accent,
                      opacity: isMin ? 0.55 : isMax ? 1 : 0.8,
                    }}
                  />
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: accent }}
                  >
                    W{w.window_number}
                  </span>
                </div>
              );
            })}
          </div>
        </figure>

        {/* Donut per finestra · top N agenti + altri */}
        <figure
          className={`mb-8 rounded-lg border p-4 ${
            isDark
              ? "border-slate-700 bg-slate-900"
              : "border-slate-200 bg-white"
          }`}
        >
          <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3
              className="text-sm font-semibold"
              style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
            >
              Input tokens per finestra · top {TOP_N} agenti + altri
            </h3>
            <p
              className="text-[11px]"
              style={{ color: isDark ? "#94a3b8" : "#64748b" }}
            >
              ogni anello = mix agenti (cache + fresh); centro = totale finestra
            </p>
          </header>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {summaries.map((w) => (
              <WindowDonut
                key={w.window_number}
                summary={w}
                topSet={topSet}
                isDark={isDark}
                accent={accent}
                hovered={hovered}
                onHover={setHovered}
              />
            ))}
          </div>
          {/* Legenda condivisa · interattiva (hover sincronizzato sui donut) */}
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {[...globalTopAgents, "altri"].map((ag) => {
              const dim = hovered !== null && hovered !== ag;
              return (
                <button
                  key={ag}
                  type="button"
                  onMouseEnter={() => setHovered(ag)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(ag)}
                  onBlur={() => setHovered(null)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 transition-opacity"
                  style={{ opacity: dim ? 0.4 : 1 }}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{
                      backgroundColor:
                        ag === "altri"
                          ? "#94a3b8"
                          : (AGENT_PALETTE[ag] ?? "#64748b"),
                    }}
                  />
                  <span style={{ color: isDark ? "#cbd5e1" : "#475569" }}>
                    {ag === "altri" ? "altri" : `${emojiFor(ag)} ${ag}`}
                  </span>
                </button>
              );
            })}
          </div>
        </figure>

        {/* Dettaglio per finestra */}
        <div className="space-y-4">
          {summaries.map((w) => (
            <details
              key={w.window_number}
              className={`rounded-lg border p-3 ${
                isDark
                  ? "border-slate-700 bg-slate-900"
                  : "border-slate-200 bg-white"
              }`}
            >
              <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2">
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: accent }}
                  >
                    W{w.window_number}
                  </span>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                  >
                    Finestra {w.window_number}
                  </span>
                  <span
                    className="text-[11px]"
                    style={{ color: isDark ? "#94a3b8" : "#64748b" }}
                  >
                    {w.agents.length} agenti attivi
                  </span>
                </span>
                <span
                  className="font-mono text-[12px]"
                  style={{ color: isDark ? "#cbd5e1" : "#475569" }}
                >
                  in{" "}
                  <span className="font-semibold">{fmtTokens(w.totalIn)}</span>{" "}
                  · cached{" "}
                  <span className="font-semibold">
                    {fmtTokens(w.totalCached)}
                  </span>{" "}
                  · out{" "}
                  <span className="font-semibold">{fmtTokens(w.totalOut)}</span>
                </span>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr
                      className={`border-b text-left ${isDark ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}
                    >
                      <th className="py-1.5 pr-2 font-medium uppercase tracking-wide">
                        Agente
                      </th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide">
                        Input
                      </th>
                      <th
                        className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide"
                        title="Subset di input servito dalla cache"
                      >
                        Cached
                      </th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide">
                        Output
                      </th>
                      <th
                        className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide"
                        title="Sessioni Codex distinte attive nella finestra"
                      >
                        Sessioni
                      </th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide">
                        % finestra
                      </th>
                    </tr>
                  </thead>
                  <tbody
                    className={`font-mono ${isDark ? "text-slate-200" : "text-slate-800"}`}
                  >
                    {w.agents.map((a) => {
                      const sharePct = (a.input_tokens / w.totalIn) * 100;
                      return (
                        <tr
                          key={a.agent}
                          className={`border-b last:border-0 ${isDark ? "border-slate-800" : "border-slate-100"}`}
                        >
                          <td className="py-1.5 pr-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor:
                                    AGENT_PALETTE[a.agent] ?? "#64748b",
                                }}
                              />
                              <span>{emojiFor(a.agent)}</span>
                              <span>{a.agent}</span>
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {fmtTokens(a.input_tokens)}
                          </td>
                          <td
                            className="py-1.5 pr-2 text-right tabular-nums"
                            style={{ color: isDark ? "#94a3b8" : "#64748b" }}
                          >
                            {fmtTokens(a.cached_input_tokens)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {fmtTokens(a.output_tokens)}
                          </td>
                          <td
                            className="py-1.5 pr-2 text-right tabular-nums"
                            style={{ color: isDark ? "#94a3b8" : "#64748b" }}
                          >
                            {a.sessions}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            <div className="flex items-center justify-end gap-2">
                              <div
                                className="relative h-1.5 w-12 overflow-hidden rounded-sm"
                                style={{
                                  backgroundColor: isDark
                                    ? "#1e293b"
                                    : "#f1f5f9",
                                }}
                              >
                                <div
                                  className="absolute inset-y-0 left-0"
                                  style={{
                                    width: `${Math.min(100, sharePct)}%`,
                                    backgroundColor:
                                      AGENT_PALETTE[a.agent] ?? "#64748b",
                                    opacity: 0.7,
                                  }}
                                />
                              </div>
                              <span className="w-8 text-right">
                                {sharePct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>

        <p
          className="mt-6 text-[11px] leading-relaxed"
          style={{ color: isDark ? "#94a3b8" : "#64748b" }}
        >
          <strong>Cosa stai vedendo</strong>: ogni sessione Codex (1 per agente
          al boot, più i respawn) emette un evento <code>token_count</code> a
          ogni turn con i token consumati. Sommiamo i delta per finestra 5h e
          per agente. <strong>Cached</strong> = parte dell'input riusata dalla
          cache del provider (sconto pagato). <strong>Output</strong> = token
          generati dal modello (i più costosi).
        </p>
      </div>
    </section>
  );
}

type Member = { agent: string; v: number };
type Slice = { agent: string; v: number; color: string; members?: Member[] };

// Top-N agenti (in palette) come slice singoli, il resto raggruppato in "altri".
// Per "altri" conserviamo la lista dei membri (desc) così l'utente può capire
// chi lo compone passandoci sopra.
function buildSlices(summary: WindowSummary, topSet: Set<string>): Slice[] {
  const slices: Slice[] = [];
  const others: Member[] = [];
  for (const a of summary.agents) {
    if (topSet.has(a.agent)) {
      slices.push({
        agent: a.agent,
        v: a.input_tokens,
        color: AGENT_PALETTE[a.agent] ?? "#64748b",
      });
    } else {
      others.push({ agent: a.agent, v: a.input_tokens });
    }
  }
  const othersV = others.reduce((s, m) => s + m.v, 0);
  if (othersV > 0) {
    others.sort((a, b) => b.v - a.v);
    slices.push({
      agent: "altri",
      v: othersV,
      color: "#94a3b8",
      members: others,
    });
  }
  return slices;
}

// Donut SVG puro e interattivo: un anello per finestra, segmenti via
// stroke-dasharray. Hover su uno spicchio (o dalla legenda) lo evidenzia,
// attenua gli altri e mostra agente/token/% al centro.
function WindowDonut({
  summary,
  topSet,
  isDark,
  accent,
  hovered,
  onHover,
}: {
  summary: WindowSummary;
  topSet: Set<string>;
  isDark: boolean;
  accent: string;
  hovered: string | null;
  onHover: (agent: string | null) => void;
}) {
  const slices = buildSlices(summary, topSet);
  const total = summary.totalIn;
  // Geometria: viewBox 100×100, anello centrato, raggio sulla mezzeria del tratto.
  const baseStroke = 16;
  const r = (100 - baseStroke - 4) / 2;
  const cx = 50;
  const cy = 50;
  const C = 2 * Math.PI * r;
  const track = isDark ? "#1e293b" : "#f1f5f9";

  // Slice attivo in questo donut (se l'agente hovered è presente).
  const active =
    hovered !== null ? slices.find((s) => s.agent === hovered) : undefined;
  const activeFrac = active && total > 0 ? active.v / total : 0;

  let offset = 0;
  const arcs = slices.map((s, i) => {
    const frac = total > 0 ? s.v / total : 0;
    const len = frac * C;
    const isHot = hovered === s.agent;
    const dim = hovered !== null && !isHot;
    const arc = (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={isHot ? baseStroke + 4 : baseStroke}
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-offset}
        opacity={dim ? 0.25 : 0.9}
        style={{
          cursor: "pointer",
          transition: "opacity 120ms, stroke-width 120ms",
        }}
        onMouseEnter={() => onHover(s.agent)}
        onMouseLeave={() => onHover(null)}
      >
        <title>{`${s.agent} · ${fmtTokens(s.v)} · ${(frac * 100).toFixed(1)}%`}</title>
      </circle>
    );
    offset += len;
    return arc;
  });

  // Top-5 consumer della finestra (agents è già ordinato desc per input).
  const top5 = summary.agents.slice(0, 5);

  return (
    <div
      className={`rounded-lg border p-3 ${
        isDark
          ? "border-slate-800 bg-slate-950/40"
          : "border-slate-200 bg-slate-50/60"
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span
          className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
          style={{ backgroundColor: accent }}
        >
          W{summary.window_number}
        </span>
        <span
          className="text-[10px]"
          style={{ color: isDark ? "#94a3b8" : "#64748b" }}
        >
          {summary.agents.length} agenti
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative aspect-square w-[120px] shrink-0 sm:w-[140px]">
          <svg viewBox="0 0 100 100" className="-rotate-90">
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={track}
              strokeWidth={baseStroke}
            />
            {arcs}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2 text-center">
            {active && active.agent === "altri" && active.members ? (
              // "altri" → mostra di chi è composto (top membri + coda).
              <div className="flex w-full flex-col items-center">
                <span
                  className="text-[9px] font-semibold"
                  style={{ color: active.color }}
                >
                  altri · {fmtTokens(active.v)} ·{" "}
                  {(activeFrac * 100).toFixed(1)}%
                </span>
                <div className="mt-0.5 w-full space-y-px px-1">
                  {active.members.slice(0, 4).map((m) => (
                    <div
                      key={m.agent}
                      className="flex items-baseline justify-between gap-1 text-[8px] leading-tight"
                      style={{ color: isDark ? "#cbd5e1" : "#475569" }}
                    >
                      <span className="truncate">{m.agent}</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {fmtTokens(m.v)}
                      </span>
                    </div>
                  ))}
                  {active.members.length > 4 && (
                    <div
                      className="text-[8px] leading-tight"
                      style={{ color: isDark ? "#64748b" : "#94a3b8" }}
                    >
                      +{active.members.length - 4} altri
                    </div>
                  )}
                </div>
              </div>
            ) : active ? (
              <>
                <span
                  className="max-w-full truncate text-[10px] font-semibold"
                  style={{ color: active.color }}
                  title={active.agent}
                >
                  {active.agent}
                </span>
                <span
                  className="font-mono text-sm font-bold tabular-nums"
                  style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                >
                  {fmtTokens(active.v)}
                </span>
                <span
                  className="text-[9px] tabular-nums"
                  style={{ color: isDark ? "#94a3b8" : "#64748b" }}
                >
                  {(activeFrac * 100).toFixed(1)}%
                </span>
              </>
            ) : (
              <>
                <span
                  className="font-mono text-sm font-bold tabular-nums"
                  style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                >
                  {fmtTokens(total)}
                </span>
                <span
                  className="text-[9px] uppercase tracking-wide"
                  style={{ color: isDark ? "#64748b" : "#94a3b8" }}
                >
                  input
                </span>
              </>
            )}
          </div>
        </div>

        {/* Top-5 consumer della finestra */}
        <ol className="flex-1 space-y-1">
          {top5.map((a, i) => {
            const pct = total > 0 ? (a.input_tokens / total) * 100 : 0;
            const color = AGENT_PALETTE[a.agent] ?? "#64748b";
            const isHot = hovered === a.agent;
            const dim = hovered !== null && !isHot;
            return (
              <li
                key={a.agent}
                onMouseEnter={() => onHover(a.agent)}
                onMouseLeave={() => onHover(null)}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] transition-opacity"
                style={{
                  opacity: dim ? 0.4 : 1,
                  backgroundColor: isHot
                    ? isDark
                      ? "#1e293b"
                      : "#e2e8f0"
                    : "transparent",
                }}
              >
                <span
                  className="w-3 shrink-0 text-right tabular-nums"
                  style={{ color: isDark ? "#64748b" : "#94a3b8" }}
                >
                  {i + 1}
                </span>
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <span
                  className="flex-1 truncate"
                  style={{ color: isDark ? "#e2e8f0" : "#334155" }}
                  title={a.agent}
                >
                  {emojiFor(a.agent)} {a.agent}
                </span>
                <span
                  className="shrink-0 font-mono font-semibold tabular-nums"
                  style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                >
                  {fmtTokens(a.input_tokens)}
                </span>
                <span
                  className="w-10 shrink-0 text-right font-mono tabular-nums"
                  style={{ color: isDark ? "#94a3b8" : "#64748b" }}
                >
                  {pct.toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
