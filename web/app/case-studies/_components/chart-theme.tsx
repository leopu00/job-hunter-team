"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export type ChartMode = "dark" | "light"

type Ctx = {
  mode: ChartMode
  setMode: (m: ChartMode) => void
}

const STORAGE_KEY = "jht-charts-theme"
const ChartThemeContext = createContext<Ctx>({ mode: "light", setMode: () => {} })

const SYSTEM_QUERY = "(prefers-color-scheme: dark)"

export function ChartThemeProvider({
  children,
  defaultMode = "light",
}: {
  children: ReactNode
  defaultMode?: ChartMode
}) {
  // SSR-safe: si parte dal default, poi al mount si risolve dal localStorage
  // (preferenza esplicita dell'utente) o, in sua assenza, dal tema di sistema.
  const [mode, setModeState] = useState<ChartMode>(defaultMode)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved === "dark" || saved === "light") {
        setModeState(saved)
        return
      }
    } catch {}
    // Nessuna preferenza salvata → segui il sistema.
    if (window.matchMedia?.(SYSTEM_QUERY).matches) setModeState("dark")
  }, [])

  // Se l'utente non ha un override salvato, reagisci ai cambi di tema di sistema.
  useEffect(() => {
    const mq = window.matchMedia?.(SYSTEM_QUERY)
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (window.localStorage.getItem(STORAGE_KEY)) return
      } catch {}
      setModeState(e.matches ? "dark" : "light")
    }
    mq.addEventListener?.("change", onChange)
    return () => mq.removeEventListener?.("change", onChange)
  }, [])

  // La scrittura su localStorage avviene SOLO su scelta esplicita (toggle),
  // così l'auto-rilevamento dal sistema resta attivo finché l'utente non decide.
  const setMode = useCallback((m: ChartMode) => {
    setModeState(m)
    try {
      window.localStorage.setItem(STORAGE_KEY, m)
    } catch {}
  }, [])

  return (
    <ChartThemeContext.Provider value={{ mode, setMode }}>
      {children}
    </ChartThemeContext.Provider>
  )
}

export function useChartTheme(): Ctx {
  return useContext(ChartThemeContext)
}

export function ChartThemeToggle({ className = "" }: { className?: string }) {
  const { mode, setMode } = useChartTheme()
  const isDark = mode === "dark"
  return (
    <button
      type="button"
      onClick={() => setMode(isDark ? "light" : "dark")}
      className={
        "inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 " +
        className
      }
      aria-label={`Passa al tema ${isDark ? "light" : "dark"} per i grafici`}
      title={`Tema grafici: ${mode} → click per ${isDark ? "light" : "dark"}`}
    >
      <span aria-hidden="true">{isDark ? "🌙" : "☀️"}</span>
      <span className="font-mono uppercase tracking-wider">{mode}</span>
    </button>
  )
}

export type ChartPalette = {
  // figure container
  figBorder: string
  figBg: string
  figText: string
  // sub-headers & legend strip
  headerBorder: string
  legendBg: string
  legendText: string
  legendLabel: string
  // controls (zoom buttons)
  ctrlBg: string
  ctrlBgHover: string
  ctrlText: string
  // agent column / row
  colBg: string
  colBorder: string
  rowBorder: string
  colHeaderText: string
  agentName: string
  countSent: string
  countRecv: string
  countSep: string
  // chart inner bands
  bandA: string
  bandB: string
  gridLine: string
  baseline: string
  minorTick: string
  majorTick: string
  topAxisText: string
  bottomAxisText: string
  // sleep band
  sleepFill: string
  sleepOpacity: number
  // fused cluster label
  fusedLabelText: string
  // selected event halo
  selectedHalo: string
  // popup
  popupBorder: string
  popupBg: string
  popupText: string
  popupSubText: string
  popupHeaderBorder: string
  popupBodyBg: string
  popupBodyText: string
  popupCloseBg: string
  popupCloseBgHover: string
  popupCloseTop: string
  // FullRunUsageChart specific
  fullChartFigBg: string
  fullChartInnerBg: string
  fullChartCaption: string
  hoverGuide: string
  hoverDot: string
  hoverTooltipBg: string
  hoverTooltipBorder: string
  hoverTooltipText: string
  hoverTooltipMuted: string
  hoverTooltipBadgeBg: string
  // semantic chart series (cap line, weekly line, reset markers)
  capStroke: string
  capText: string
  weeklyStroke: string
  resetMarker: string
}

const dark: ChartPalette = {
  figBorder: "#334155",
  figBg: "#0f172a",
  figText: "#f1f5f9",
  headerBorder: "#1e293b",
  legendBg: "rgba(2,6,23,0.5)",
  legendText: "#cbd5e1",
  legendLabel: "#64748b",
  ctrlBg: "#1e293b",
  ctrlBgHover: "#334155",
  ctrlText: "#94a3b8",
  colBg: "#0f172a",
  colBorder: "#1e293b",
  rowBorder: "rgba(30,41,59,0.4)",
  colHeaderText: "#64748b",
  agentName: "#f1f5f9",
  countSent: "#cbd5e1",
  countRecv: "#475569",
  countSep: "#64748b",
  bandA: "#0f172a",
  bandB: "#0b1220",
  gridLine: "#1e293b",
  baseline: "#334155",
  minorTick: "#475569",
  majorTick: "#94a3b8",
  topAxisText: "#94a3b8",
  bottomAxisText: "#cbd5e1",
  sleepFill: "#475569",
  sleepOpacity: 0.35,
  fusedLabelText: "#0f172a",
  selectedHalo: "#ffffff",
  popupBorder: "#475569",
  popupBg: "#020617",
  popupText: "#f1f5f9",
  popupSubText: "#94a3b8",
  popupHeaderBorder: "#1e293b",
  popupBodyBg: "#0f172a",
  popupBodyText: "#cbd5e1",
  popupCloseBg: "#1e293b",
  popupCloseBgHover: "#334155",
  popupCloseTop: "#0f172a",
  fullChartFigBg: "#0f172a",
  fullChartInnerBg: "#0f172a",
  fullChartCaption: "#64748b",
  hoverGuide: "#e2e8f0",
  hoverDot: "#ffffff",
  hoverTooltipBg: "rgba(2,6,23,0.95)",
  hoverTooltipBorder: "#475569",
  hoverTooltipText: "#f1f5f9",
  hoverTooltipMuted: "#94a3b8",
  hoverTooltipBadgeBg: "rgba(30,41,59,0.8)",
  capStroke: "#ef4444",
  capText: "#fca5a5",
  weeklyStroke: "#60a5fa",
  resetMarker: "#facc15",
}

const light: ChartPalette = {
  figBorder: "#cbd5e1",
  figBg: "#ffffff",
  figText: "#0f172a",
  headerBorder: "#e2e8f0",
  legendBg: "#f8fafc",
  legendText: "#475569",
  legendLabel: "#64748b",
  ctrlBg: "#f1f5f9",
  ctrlBgHover: "#e2e8f0",
  ctrlText: "#475569",
  colBg: "#ffffff",
  colBorder: "#e2e8f0",
  rowBorder: "rgba(226,232,240,0.7)",
  colHeaderText: "#64748b",
  agentName: "#0f172a",
  countSent: "#1e293b",
  countRecv: "#94a3b8",
  countSep: "#64748b",
  bandA: "#ffffff",
  bandB: "#f8fafc",
  gridLine: "#e2e8f0",
  baseline: "#cbd5e1",
  minorTick: "#cbd5e1",
  majorTick: "#64748b",
  topAxisText: "#64748b",
  bottomAxisText: "#475569",
  sleepFill: "#94a3b8",
  sleepOpacity: 0.45,
  fusedLabelText: "#0f172a",
  selectedHalo: "#ffffff",
  popupBorder: "#cbd5e1",
  popupBg: "#ffffff",
  popupText: "#0f172a",
  popupSubText: "#64748b",
  popupHeaderBorder: "#e2e8f0",
  popupBodyBg: "#f8fafc",
  popupBodyText: "#334155",
  popupCloseBg: "#f1f5f9",
  popupCloseBgHover: "#e2e8f0",
  popupCloseTop: "#f8fafc",
  fullChartFigBg: "#ffffff",
  fullChartInnerBg: "#f8fafc",
  fullChartCaption: "#64748b",
  hoverGuide: "#475569",
  hoverDot: "#0f172a",
  hoverTooltipBg: "rgba(255,255,255,0.97)",
  hoverTooltipBorder: "#cbd5e1",
  hoverTooltipText: "#0f172a",
  hoverTooltipMuted: "#64748b",
  hoverTooltipBadgeBg: "#f1f5f9",
  capStroke: "#dc2626",
  capText: "#b91c1c",
  weeklyStroke: "#2563eb",
  resetMarker: "#ca8a04",
}

export function chartPalette(mode: ChartMode): ChartPalette {
  return mode === "dark" ? dark : light
}
