"use client";

import { useLocale } from "@/lib/use-locale";
import { PUBLIC_LOADING_COPY } from "./public-loading.i18n";

export default function Loading() {
  const locale = useLocale();
  const copy = PUBLIC_LOADING_COPY[locale] ?? PUBLIC_LOADING_COPY.en;

  return (
    <main
      data-public-loading-shell
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={copy.status}
      className="relative isolate min-h-screen overflow-hidden px-5 py-7 sm:px-8 sm:py-10"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 33%, color-mix(in srgb, var(--color-green) 12%, transparent), transparent 38%)",
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl">
        <header
          aria-hidden="true"
          className="flex items-center justify-between gap-5 border-b pb-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: "var(--color-green)" }}
            />
            <span
              className="h-2 w-28 rounded-full sm:w-36"
              style={{ background: "var(--color-border-glow)" }}
            />
          </div>
          <div
            className="h-2 w-16 rounded-full sm:w-24"
            style={{ background: "var(--color-border)" }}
          />
        </header>

        <section className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-2xl flex-col justify-center py-12 text-center sm:min-h-[calc(100vh-12rem)]">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--color-green)" }}
          >
            {copy.status}
          </p>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-5xl">
            Job Hunter <span style={{ color: "var(--color-green)" }}>Team</span>
          </h1>
          <p
            data-public-loading-promise
            className="mx-auto mt-4 max-w-xl text-sm leading-relaxed sm:text-base"
            style={{ color: "var(--color-bright)" }}
          >
            {copy.promise}
          </p>

          <div
            aria-hidden="true"
            className="mt-9 grid min-h-40 grid-cols-3 gap-3 overflow-hidden rounded-xl border p-4 sm:min-h-52 sm:gap-5 sm:p-6"
            style={{
              borderColor: "var(--color-border)",
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--color-panel) 86%, transparent), var(--color-deep))",
            }}
          >
            <LoadingPlaceholder className="col-span-2 row-span-2" />
            <LoadingPlaceholder />
            <LoadingPlaceholder />
            <LoadingPlaceholder className="col-span-3 h-3 self-end" />
          </div>

          <p
            data-public-loading-recovery
            className="mx-auto mt-5 max-w-lg text-xs leading-relaxed"
            style={{ color: "var(--color-muted)" }}
          >
            {copy.recovery}
          </p>
        </section>
      </div>
    </main>
  );
}

function LoadingPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md motion-reduce:animate-none ${className}`}
      style={{
        background:
          "linear-gradient(110deg, var(--color-card), var(--color-row), var(--color-card))",
      }}
    />
  );
}
