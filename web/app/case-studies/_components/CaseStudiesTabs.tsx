"use client"

import { useState } from "react"
import {
  ChartThemeProvider,
  ChartThemeToggle,
  useChartTheme,
} from "./chart-theme"

type Tab = {
  id: string
  label: string
  content: React.ReactNode
}

type Props = {
  tabs: Tab[]
  defaultTab?: string
}

const CHARTS_TABS = new Set(["agents", "windows", "tokens", "actions"])

export function CaseStudiesTabs({ tabs, defaultTab }: Props) {
  return (
    <ChartThemeProvider defaultMode="light">
      <TabsInner tabs={tabs} defaultTab={defaultTab} />
    </ChartThemeProvider>
  )
}

function TabsInner({ tabs, defaultTab }: Props) {
  const { mode } = useChartTheme()
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id)
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  const isChartTab = current && CHARTS_TABS.has(current.id)
  // La navbar segue il tema solo sulle tab grafiche (che rispettano dark/light);
  // sulla tab "Risultati", a sfondo chiaro fisso, resta chiara per coerenza.
  const darkNav = !!isChartTab && mode === "dark"

  return (
    <>
      <nav
        className={`sticky top-14 z-30 border-b backdrop-blur transition-colors ${
          darkNav
            ? "border-slate-800 bg-slate-950/90"
            : "border-slate-200 bg-white/90"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-6">
          {tabs.map((t) => {
            const isActive = t.id === active
            const textCls = isActive
              ? darkNav
                ? "text-slate-100"
                : "text-slate-900"
              : darkNav
                ? "text-slate-400 hover:text-slate-200"
                : "text-slate-500 hover:text-slate-700"
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={`relative px-4 py-3 text-sm font-medium transition ${textCls}`}
              >
                {t.label}
                {isActive && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-500" />
                )}
              </button>
            )
          })}
          {isChartTab && (
            <div className="ml-auto py-2">
              <ChartThemeToggle />
            </div>
          )}
        </div>
      </nav>
      <div>{current?.content}</div>
    </>
  )
}
