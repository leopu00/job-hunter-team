"use client";

import { useState } from "react";
import { ChartThemeProvider, ChartThemeToggle } from "./chart-theme";

type Tab = {
  id: string;
  label: string;
  content: React.ReactNode;
};

type Props = {
  tabs: Tab[];
  defaultTab?: string;
};

const CHARTS_TABS = new Set(["agents", "windows", "tokens", "actions"]);

export function CaseStudiesTabs({ tabs, defaultTab }: Props) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const showThemeToggle = current && CHARTS_TABS.has(current.id);

  return (
    <ChartThemeProvider>
      <nav className="sticky top-14 z-30 border-b border-[var(--color-border)] bg-[var(--color-panel)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-1 px-6">
          {tabs.map((t) => {
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={`relative px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? "text-[var(--color-white)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-bright)]"
                }`}
              >
                {t.label}
                {isActive && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
          {showThemeToggle && (
            <div className="ml-auto py-2">
              <ChartThemeToggle />
            </div>
          )}
        </div>
      </nav>
      <div>{current?.content}</div>
    </ChartThemeProvider>
  );
}
