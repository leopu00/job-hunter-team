"use client"

import type { CaseStudy, Window, AgentTokens } from "./types"
import { providerColor } from "./types"
import { useChartTheme } from "./chart-theme"

type Props = {
  caseStudy: CaseStudy
  weekly: Window
}

// Stable palette per agente (stesso schema usato in AgentTracksChart).
const AGENT_PALETTE: Record<string, string> = {
  "analista-1": "#facc15",
  "analista-2": "#fbbf24",
  "scout-1": "#f97316",
  "scout-2": "#fb923c",
  "scorer-1": "#22c55e",
  "scorer-2": "#16a34a",
  "scrittore-1": "#3b82f6",
  "scrittore-2": "#3b82f6",
  "scrittore-3": "#3b82f6",
  "critico-s1": "#a78bfa",
  "critico-s2": "#a78bfa",
  "critico-s3": "#a78bfa",
  capitano: "#ef4444",
  mentor: "#ec4899",
  assistente: "#06b6d4",
  sentinella: "#14b8a6",
  dottore: "#0ea5e9",
}

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
}

function emojiFor(agent: string): string {
  if (agent.startsWith("critico")) return ROLE_EMOJI.critico
  const base = agent.split("-")[0]
  return ROLE_EMOJI[base] ?? "🤖"
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return n.toLocaleString("it-IT")
}

type WindowSummary = {
  window_number: number
  totalIn: number
  totalCached: number
  totalOut: number
  agents: AgentTokens[] // sorted desc by input_tokens
}

function buildSummaries(tokens: AgentTokens[]): WindowSummary[] {
  const byW = new Map<number, AgentTokens[]>()
  for (const t of tokens) {
    const arr = byW.get(t.window_number) ?? []
    arr.push(t)
    byW.set(t.window_number, arr)
  }
  return Array.from(byW.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([n, rows]) => {
      const sorted = [...rows].sort((a, b) => b.input_tokens - a.input_tokens)
      return {
        window_number: n,
        totalIn: rows.reduce((s, r) => s + r.input_tokens, 0),
        totalCached: rows.reduce((s, r) => s + r.cached_input_tokens, 0),
        totalOut: rows.reduce((s, r) => s + r.output_tokens, 0),
        agents: sorted,
      }
    })
}

export function TokensTab({ caseStudy, weekly }: Props) {
  const { mode } = useChartTheme()
  const isDark = mode === "dark"
  const accent = providerColor(caseStudy.provider_name)
  const tokens = weekly.agent_tokens ?? []
  if (tokens.length === 0) return null

  const summaries = buildSummaries(tokens)
  const grandIn = summaries.reduce((s, w) => s + w.totalIn, 0)
  const grandCached = summaries.reduce((s, w) => s + w.totalCached, 0)
  const grandOut = summaries.reduce((s, w) => s + w.totalOut, 0)
  const cacheRatio = grandIn > 0 ? (grandCached / grandIn) * 100 : 0

  // Per la barra stacked, prendiamo i top-N agenti per finestra e raggruppiamo
  // il resto come "altri". I top globali sono il subset stabile.
  const TOP_N = 6
  const globalTopAgents = (() => {
    const sumByAg = new Map<string, number>()
    for (const t of tokens) {
      sumByAg.set(t.agent, (sumByAg.get(t.agent) ?? 0) + t.input_tokens)
    }
    return Array.from(sumByAg.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([ag]) => ag)
  })()
  const topSet = new Set(globalTopAgents)
  const maxWindowIn = Math.max(...summaries.map((w) => w.totalIn))

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

        {/* Totali del run */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiBox
            label="Input totale"
            value={fmtTokens(grandIn)}
            sub="tokens (di cui cache hit)"
            isDark={isDark}
            accent={accent}
            primary
          />
          <KpiBox
            label="Cache hit ratio"
            value={`${cacheRatio.toFixed(1)}%`}
            sub={`${fmtTokens(grandCached)} cached`}
            isDark={isDark}
            accent={accent}
          />
          <KpiBox
            label="Output totale"
            value={fmtTokens(grandOut)}
            sub="tokens generati"
            isDark={isDark}
            accent={accent}
          />
          <KpiBox
            label="Sessioni Codex"
            value={String(
              tokens.reduce((s, t) => s + t.sessions, 0),
            )}
            sub={`${summaries.length} finestre 5h`}
            isDark={isDark}
            accent={accent}
          />
        </div>

        {/* Stacked bar per finestra */}
        <figure
          className={`mb-8 rounded-lg border p-4 ${
            isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"
          }`}
        >
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
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
              barra = somma input (cache + fresh); valore in alto = totale finestra
            </p>
          </header>
          <div className="space-y-2">
            {summaries.map((w) => {
              const widthPct = (w.totalIn / maxWindowIn) * 100
              return (
                <div key={w.window_number} className="flex items-center gap-3">
                  <span
                    className="inline-block w-8 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: accent }}
                  >
                    W{w.window_number}
                  </span>
                  <div className="relative h-6 flex-1 overflow-hidden rounded-sm" style={{ backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }}>
                    <div className="absolute inset-y-0 left-0 flex" style={{ width: `${widthPct}%` }}>
                      {(() => {
                        const slices: { agent: string; v: number; color: string }[] = []
                        let othersV = 0
                        for (const a of w.agents) {
                          if (topSet.has(a.agent)) {
                            slices.push({
                              agent: a.agent,
                              v: a.input_tokens,
                              color: AGENT_PALETTE[a.agent] ?? "#64748b",
                            })
                          } else {
                            othersV += a.input_tokens
                          }
                        }
                        if (othersV > 0) {
                          slices.push({ agent: "altri", v: othersV, color: "#94a3b8" })
                        }
                        return slices.map((s, i) => (
                          <div
                            key={i}
                            title={`${s.agent} · ${fmtTokens(s.v)}`}
                            style={{
                              width: `${(s.v / w.totalIn) * 100}%`,
                              backgroundColor: s.color,
                              opacity: 0.85,
                            }}
                          />
                        ))
                      })()}
                    </div>
                  </div>
                  <span
                    className="w-20 shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums"
                    style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}
                  >
                    {fmtTokens(w.totalIn)}
                  </span>
                </div>
              )
            })}
          </div>
          {/* Legenda */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {globalTopAgents.map((ag) => (
              <span key={ag} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: AGENT_PALETTE[ag] ?? "#64748b" }}
                />
                <span style={{ color: isDark ? "#cbd5e1" : "#475569" }}>
                  {emojiFor(ag)} {ag}
                </span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "#94a3b8" }} />
              <span style={{ color: isDark ? "#cbd5e1" : "#475569" }}>altri</span>
            </span>
          </div>
        </figure>

        {/* Dettaglio per finestra */}
        <div className="space-y-4">
          {summaries.map((w) => (
            <details
              key={w.window_number}
              className={`rounded-lg border p-3 ${
                isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"
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
                  <span className="text-sm font-semibold" style={{ color: isDark ? "#f1f5f9" : "#0f172a" }}>
                    Finestra {w.window_number}
                  </span>
                  <span className="text-[11px]" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                    {w.agents.length} agenti attivi
                  </span>
                </span>
                <span className="font-mono text-[12px]" style={{ color: isDark ? "#cbd5e1" : "#475569" }}>
                  in <span className="font-semibold">{fmtTokens(w.totalIn)}</span> · cached{" "}
                  <span className="font-semibold">{fmtTokens(w.totalCached)}</span> · out{" "}
                  <span className="font-semibold">{fmtTokens(w.totalOut)}</span>
                </span>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className={`border-b text-left ${isDark ? "border-slate-700 text-slate-400" : "border-slate-200 text-slate-500"}`}>
                      <th className="py-1.5 pr-2 font-medium uppercase tracking-wide">Agente</th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide">Input</th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide" title="Subset di input servito dalla cache">
                        Cached
                      </th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide">Output</th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide" title="Sessioni Codex distinte attive nella finestra">
                        Sessioni
                      </th>
                      <th className="py-1.5 pr-2 text-right font-medium uppercase tracking-wide">% finestra</th>
                    </tr>
                  </thead>
                  <tbody className={`font-mono ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                    {w.agents.map((a) => {
                      const sharePct = (a.input_tokens / w.totalIn) * 100
                      return (
                        <tr key={a.agent} className={`border-b last:border-0 ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                          <td className="py-1.5 pr-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: AGENT_PALETTE[a.agent] ?? "#64748b" }}
                              />
                              <span>{emojiFor(a.agent)}</span>
                              <span>{a.agent}</span>
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {fmtTokens(a.input_tokens)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                            {fmtTokens(a.cached_input_tokens)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {fmtTokens(a.output_tokens)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                            {a.sessions}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            <div className="flex items-center justify-end gap-2">
                              <div
                                className="relative h-1.5 w-12 overflow-hidden rounded-sm"
                                style={{ backgroundColor: isDark ? "#1e293b" : "#f1f5f9" }}
                              >
                                <div
                                  className="absolute inset-y-0 left-0"
                                  style={{
                                    width: `${Math.min(100, sharePct)}%`,
                                    backgroundColor: AGENT_PALETTE[a.agent] ?? "#64748b",
                                    opacity: 0.7,
                                  }}
                                />
                              </div>
                              <span className="w-8 text-right">{sharePct.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      )
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
          al boot, più i respawn) emette un evento <code>token_count</code> a ogni
          turn con i token consumati. Sommiamo i delta per finestra 5h e per
          agente. <strong>Cached</strong> = parte dell'input riusata dalla
          cache del provider (sconto pagato). <strong>Output</strong> = token
          generati dal modello (i più costosi).
        </p>
      </div>
    </section>
  )
}

function KpiBox({
  label,
  value,
  sub,
  isDark,
  accent,
  primary = false,
}: {
  label: string
  value: string
  sub: string
  isDark: boolean
  accent: string
  primary?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        isDark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"
      }`}
    >
      <div
        className="text-[10px] uppercase tracking-wide"
        style={{ color: isDark ? "#94a3b8" : "#64748b" }}
      >
        {label}
      </div>
      <div
        className="mt-1 font-mono text-2xl font-bold tabular-nums"
        style={{ color: primary ? accent : isDark ? "#f1f5f9" : "#0f172a" }}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px]" style={{ color: isDark ? "#64748b" : "#94a3b8" }}>
        {sub}
      </div>
    </div>
  )
}
