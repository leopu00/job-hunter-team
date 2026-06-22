"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    attempts: string;
    minDelay: string;
    maxDelay: string;
    breadcrumb: string;
    title: string;
    subtitle: (providers: number, max: number, window: string) => string;
    loading: string;
    configNotFound: string;
    refresh: string;
    loadingConfig: string;
  }
> = {
  it: {
    attempts: "Tentativi",
    minDelay: "Min delay",
    maxDelay: "Max delay",
    breadcrumb: "Rate Limiter",
    title: "Rate Limiter",
    subtitle: (p, max, w) =>
      `${p} provider · finestra globale: ${max} req/${w}`,
    loading: "Caricamento…",
    configNotFound: "jht.config.json non trovato",
    refresh: "aggiorna",
    loadingConfig: "Caricamento configurazione…",
  },
  en: {
    attempts: "Attempts",
    minDelay: "Min delay",
    maxDelay: "Max delay",
    breadcrumb: "Rate Limiter",
    title: "Rate Limiter",
    subtitle: (p, max, w) => `${p} provider · global window: ${max} req/${w}`,
    loading: "Loading…",
    configNotFound: "jht.config.json not found",
    refresh: "refresh",
    loadingConfig: "Loading configuration…",
  },
  es: {
    attempts: "Intentos",
    minDelay: "Min delay",
    maxDelay: "Max delay",
    breadcrumb: "Rate Limiter",
    title: "Rate Limiter",
    subtitle: (p, max, w) =>
      `${p} proveedores · ventana global: ${max} req/${w}`,
    loading: "Cargando…",
    configNotFound: "jht.config.json no encontrado",
    refresh: "actualizar",
    loadingConfig: "Cargando configuración…",
  },
  fr: {
    attempts: "Tentatives",
    minDelay: "Min delay",
    maxDelay: "Max delay",
    breadcrumb: "Rate Limiter",
    title: "Rate Limiter",
    subtitle: (p, max, w) =>
      `${p} fournisseurs · fenêtre globale : ${max} req/${w}`,
    loading: "Chargement…",
    configNotFound: "jht.config.json introuvable",
    refresh: "actualiser",
    loadingConfig: "Chargement de la configuration…",
  },
  de: {
    attempts: "Versuche",
    minDelay: "Min delay",
    maxDelay: "Max delay",
    breadcrumb: "Rate Limiter",
    title: "Rate Limiter",
    subtitle: (p, max, w) =>
      `${p} Anbieter · globales Fenster: ${max} req/${w}`,
    loading: "Wird geladen…",
    configNotFound: "jht.config.json nicht gefunden",
    refresh: "aktualisieren",
    loadingConfig: "Konfiguration wird geladen…",
  },
  hu: {
    attempts: "Próbálkozások",
    minDelay: "Min delay",
    maxDelay: "Max delay",
    breadcrumb: "Rate Limiter",
    title: "Rate Limiter",
    subtitle: (p, max, w) =>
      `${p} szolgáltató · globális ablak: ${max} req/${w}`,
    loading: "Betöltés…",
    configNotFound: "jht.config.json nem található",
    refresh: "frissítés",
    loadingConfig: "Konfiguráció betöltése…",
  },
  pt: {
    attempts: "Tentativas",
    minDelay: "Min delay",
    maxDelay: "Max delay",
    breadcrumb: "Rate Limiter",
    title: "Rate Limiter",
    subtitle: (p, max, w) =>
      `${p} provedores · janela global: ${max} req/${w}`,
    loading: "Carregando…",
    configNotFound: "jht.config.json não encontrado",
    refresh: "atualizar",
    loadingConfig: "Carregando configuração…",
  },
};

type RetryConfig = {
  attempts: number;
  minDelayMs: number;
  maxDelayMs: number;
  jitter: number;
};
type WindowConfig = { maxRequests: number; windowMs: number };
type ProviderLimit = {
  id: string;
  label: string;
  window: WindowConfig;
  retry: RetryConfig;
  backoffSteps: number[];
};
type RateLimiterData = {
  globalWindow: WindowConfig;
  providers: ProviderLimit[];
  defaults: { window: WindowConfig; retry: RetryConfig };
  configLoaded: boolean;
  ts: number;
};

const PROVIDER_ICONS: Record<string, string> = {
  claude: "🟠",
  openai: "🟢",
  kimi: "🔵",
};

function fmt(ms: number) {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(0)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function BackoffBar({ steps, max }: { steps: number[]; max: number }) {
  return (
    <div className="flex items-end gap-1 h-10">
      {steps.map((ms, i) => {
        const pct = Math.min((ms / max) * 100, 100);
        return (
          <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
            <span className="text-[8px] font-mono text-[var(--color-dim)]">
              {fmt(ms)}
            </span>
            <div
              className="w-full rounded-sm"
              style={{
                height: `${Math.max(pct * 0.24, 4)}px`,
                background: `rgba(0,232,122,${0.3 + i * 0.15})`,
              }}
            />
            <span className="text-[8px] font-mono text-[var(--color-dim)]">
              #{i + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProviderCard({ p }: { p: ProviderLimit }) {
  const t = T[useLocale()];
  const icon = PROVIDER_ICONS[p.id] ?? "◆";
  const maxStep = Math.max(...p.backoffSteps, 1);
  return (
    <div
      className="border rounded-lg overflow-hidden transition-colors duration-200 hover:border-[var(--color-border-glow)]"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-panel)",
      }}
    >
      <div
        className="flex items-center gap-3 px-5 py-4 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="text-xl">{icon}</span>
        <div>
          <p className="text-[13px] font-bold text-[var(--color-white)]">
            {p.label}
          </p>
          <p className="text-[9px] font-mono text-[var(--color-dim)]">{p.id}</p>
        </div>
      </div>
      <div className="px-5 py-4 flex flex-col gap-4">
        {/* Token window */}
        <div>
          <p className="text-[9px] text-[var(--color-dim)] uppercase tracking-widest mb-2">
            Token Bucket
          </p>
          <div className="flex items-center gap-3">
            <div
              className="flex-1 h-2 rounded-full overflow-hidden"
              style={{ background: "var(--color-card)" }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: "100%", background: "rgba(0,232,122,0.5)" }}
              />
            </div>
            <span className="text-[10px] font-mono text-[var(--color-bright)] flex-shrink-0">
              {p.window.maxRequests} req / {fmt(p.window.windowMs)}
            </span>
          </div>
        </div>
        {/* Retry config */}
        <div>
          <p className="text-[9px] text-[var(--color-dim)] uppercase tracking-widest mb-2">
            Retry Backoff
          </p>
          <BackoffBar steps={p.backoffSteps} max={maxStep} />
        </div>
        {/* Retry details */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: t.attempts, value: p.retry.attempts },
            {
              label: "Jitter",
              value: `±${(p.retry.jitter * 100).toFixed(0)}%`,
            },
            { label: t.minDelay, value: fmt(p.retry.minDelayMs) },
            { label: t.maxDelay, value: fmt(p.retry.maxDelayMs) },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="px-3 py-2 rounded border"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-card)",
              }}
            >
              <p className="text-[8px] text-[var(--color-dim)]">{label}</p>
              <p className="text-[11px] font-mono font-semibold text-[var(--color-bright)]">
                {value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RateLimiterPage() {
  const t = T[useLocale()];
  const [data, setData] = useState<RateLimiterData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/rate-limiter").catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {t.breadcrumb}
          </span>
        </nav>
        <div className="mt-3 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              {t.title}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {data
                ? t.subtitle(
                    data.providers.length,
                    data.globalWindow.maxRequests,
                    fmt(data.globalWindow.windowMs),
                  )
                : t.loading}
              {data && !data.configLoaded && (
                <span className="ml-2 text-[var(--color-yellow)]">
                  <span aria-hidden="true">⚠</span> {t.configNotFound}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-all"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-muted)",
              background: "transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--color-green)";
              e.currentTarget.style.color = "var(--color-green)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--color-border)";
              e.currentTarget.style.color = "var(--color-muted)";
            }}
          >
            ↻ {t.refresh}
          </button>
        </div>
      </div>

      {loading && (
        <div
          className="flex justify-center py-16"
          role="status"
          aria-live="polite"
        >
          <span className="text-[var(--color-dim)] text-[12px]">
            {t.loadingConfig}
          </span>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.providers.map((p, i) => (
            <div
              key={p.id}
              style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}
            >
              <ProviderCard p={p} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
