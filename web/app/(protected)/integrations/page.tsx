"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { Integration, IntegrationStatus } from "@/lib/types";

const T: Record<
  Locale,
  {
    status_connected: string;
    status_configured: string;
    status_disconnected: string;
    last_change: string;
    disconnect: string;
    configure: string;
    breadcrumb: string;
    title: string;
    connected: (n: number) => string;
    configured: (n: number) => string;
    absent: (n: number) => string;
    loading: string;
  }
> = {
  it: {
    status_connected: "Connessa",
    status_configured: "Configurata",
    status_disconnected: "Non configurata",
    last_change: "Ultima modifica:",
    disconnect: "Disconnetti",
    configure: "Configura",
    breadcrumb: "Integrazioni",
    title: "Integrazioni",
    connected: (n) => `${n} connesse`,
    configured: (n) => `${n} configurate`,
    absent: (n) => `${n} assenti`,
    loading: "Caricamento…",
  },
  en: {
    status_connected: "Connected",
    status_configured: "Configured",
    status_disconnected: "Not configured",
    last_change: "Last change:",
    disconnect: "Disconnect",
    configure: "Configure",
    breadcrumb: "Integrations",
    title: "Integrations",
    connected: (n) => `${n} connected`,
    configured: (n) => `${n} configured`,
    absent: (n) => `${n} absent`,
    loading: "Loading…",
  },
  es: {
    status_connected: "Conectada",
    status_configured: "Configurada",
    status_disconnected: "No configurada",
    last_change: "Última modificación:",
    disconnect: "Desconectar",
    configure: "Configurar",
    breadcrumb: "Integraciones",
    title: "Integraciones",
    connected: (n) => `${n} conectadas`,
    configured: (n) => `${n} configuradas`,
    absent: (n) => `${n} ausentes`,
    loading: "Cargando…",
  },
  fr: {
    status_connected: "Connectée",
    status_configured: "Configurée",
    status_disconnected: "Non configurée",
    last_change: "Dernière modification :",
    disconnect: "Déconnecter",
    configure: "Configurer",
    breadcrumb: "Intégrations",
    title: "Intégrations",
    connected: (n) => `${n} connectées`,
    configured: (n) => `${n} configurées`,
    absent: (n) => `${n} absentes`,
    loading: "Chargement…",
  },
  de: {
    status_connected: "Verbunden",
    status_configured: "Konfiguriert",
    status_disconnected: "Nicht konfiguriert",
    last_change: "Letzte Änderung:",
    disconnect: "Trennen",
    configure: "Konfigurieren",
    breadcrumb: "Integrationen",
    title: "Integrationen",
    connected: (n) => `${n} verbunden`,
    configured: (n) => `${n} konfiguriert`,
    absent: (n) => `${n} fehlend`,
    loading: "Wird geladen…",
  },
  hu: {
    status_connected: "Csatlakoztatva",
    status_configured: "Beállítva",
    status_disconnected: "Nincs beállítva",
    last_change: "Utolsó módosítás:",
    disconnect: "Leválasztás",
    configure: "Beállítás",
    breadcrumb: "Integrációk",
    title: "Integrációk",
    connected: (n) => `${n} csatlakoztatva`,
    configured: (n) => `${n} beállítva`,
    absent: (n) => `${n} hiányzik`,
    loading: "Betöltés…",
  },
  pt: {
    status_connected: "Conectada",
    status_configured: "Configurada",
    status_disconnected: "Não configurada",
    last_change: "Última alteração:",
    disconnect: "Desconectar",
    configure: "Configurar",
    breadcrumb: "Integrações",
    title: "Integrações",
    connected: (n) => `${n} conectadas`,
    configured: (n) => `${n} configuradas`,
    absent: (n) => `${n} ausentes`,
    loading: "Carregando…",
  },
};


const ICONS: Record<string, string> = {
  telegram: "✈️",
  github: "🐙",
  linkedin: "💼",
  gmail: "📧",
  vercel: "▲",
};

const STATUS_CFG: Record<IntegrationStatus, { color: string; bg: string }> = {
  connected: {
    color: "var(--color-green)",
    bg: "rgba(0,232,122,0.08)",
  },
  configured: {
    color: "var(--color-yellow)",
    bg: "rgba(255,196,0,0.08)",
  },
  disconnected: {
    color: "var(--color-dim)",
    bg: "transparent",
  },
};

function IntCard({ i }: { i: Integration }) {
  const t = T[useLocale()];
  const { color, bg } = STATUS_CFG[i.status];
  const label =
    i.status === "connected"
      ? t.status_connected
      : i.status === "configured"
        ? t.status_configured
        : t.status_disconnected;
  return (
    <div
      className="flex flex-col gap-4 p-5 rounded-xl transition-all"
      style={{
        border: `1px solid ${i.status === "connected" ? color + "33" : "var(--color-border)"}`,
        background: "var(--color-panel)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            {ICONS[i.id] ?? "🔌"}
          </span>
          <div>
            <p
              className="text-[13px] font-bold"
              style={{ color: "var(--color-white)" }}
            >
              {i.name}
            </p>
            <p className="text-[10px]" style={{ color: "var(--color-dim)" }}>
              {i.description}
            </p>
          </div>
        </div>
        <span
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-semibold"
          style={{ border: `1px solid ${color}44`, background: bg, color }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "currentColor",
              display: "inline-block",
              animation:
                i.status === "connected"
                  ? "pulse-dot 2.5s ease-in-out infinite"
                  : "none",
            }}
          />
          {label}
        </span>
      </div>

      {(i.detail || i.last_sync) && (
        <div className="flex flex-col gap-0.5">
          {i.detail && (
            <p
              className="text-[10px] font-mono"
              style={{ color: "var(--color-muted)" }}
            >
              {i.detail}
            </p>
          )}
          {i.last_sync && (
            <p className="text-[9px]" style={{ color: "var(--color-dim)" }}>
              {t.last_change} {i.last_sync}
            </p>
          )}
        </div>
      )}

      <Link
        href="/settings"
        className="self-start px-3 py-1.5 rounded text-[10px] font-semibold no-underline transition-all"
        style={{
          border: `1px solid ${i.status === "connected" ? "rgba(255,69,96,0.3)" : color + "44"}`,
          color: i.status === "connected" ? "var(--color-red)" : color,
          background: "transparent",
        }}
      >
        {i.status === "connected" ? t.disconnect : t.configure} →
      </Link>
    </div>
  );
}

export default function IntegrationsPage() {
  const t = T[useLocale()];
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [summary, setSummary] = useState({
    connected: 0,
    configured: 0,
    disconnected: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((d) => {
        setIntegrations(d.integrations ?? []);
        setSummary(
          d.summary ?? { connected: 0, configured: 0, disconnected: 0 },
        );
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main
      className="min-h-screen px-6 py-10"
      style={{ animation: "fade-in 0.35s ease both" }}
    >
      <div className="max-w-4xl flex flex-col gap-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
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
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1
              className="text-xl font-bold"
              style={{ color: "var(--color-white)" }}
            >
              {t.title}
            </h1>
          </div>
          {!loading && (
            <div className="flex gap-3 text-[10px] font-mono">
              <span style={{ color: "var(--color-green)" }}>
                {t.connected(summary.connected)}
              </span>
              <span style={{ color: "var(--color-yellow)" }}>
                {t.configured(summary.configured)}
              </span>
              <span style={{ color: "var(--color-dim)" }}>
                {t.absent(summary.disconnected)}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <p
            className="text-[11px]"
            style={{ color: "var(--color-muted)" }}
            role="status"
            aria-live="polite"
          >
            {t.loading}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {integrations.map((intg, i) => (
              <div
                key={intg.id}
                style={{ animation: `fade-in 0.4s ease ${i * 0.08}s both` }}
              >
                <IntCard i={intg} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
