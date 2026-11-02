import type { ReactNode } from "react";

/** The small pieces the office's panels are made of (the agent's panel and the others share them). */

export function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="mb-3 pr-6">
      <h2 className="m-0 text-[14px] font-bold tracking-widest text-[var(--color-white)]">{title}</h2>
      {sub && <p className="m-0 mt-0.5 text-[11px] text-[var(--color-muted)]">{sub}</p>}
    </header>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-dim)]">{title}</h3>
      {children}
    </section>
  );
}

export function SecondaryLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded text-[11px] text-[var(--color-muted)] underline hover:text-[var(--color-bright)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-bright)]">
      {label}
    </button>
  );
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
