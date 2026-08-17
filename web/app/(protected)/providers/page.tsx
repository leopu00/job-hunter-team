"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    confirmUpdate: (count: number, sessions: string) => string;
    updatedTo: (ver: string) => string;
    unknownError: string;
    configured: string;
    notConfigured: string;
    updateBadge: string;
    auth: string;
    activeModel: string;
    models: string;
    apiKeyWarnPre: string;
    apiKeyWarnPost: string;
    checkUpdate: string;
    update: string;
    stopTeamUpdate: string;
    cancel: string;
    activeBadge: string;
    breadcrumb: string;
    title: string;
    subtitle: (avail: number, total: number, active: string) => string;
    loading: string;
    configNotFound: string;
    refresh: string;
    loadingProviders: string;
  }
> = {
  it: {
    confirmUpdate: (count, sessions) =>
      `Il provider è attivo. Update richiede di stoppare ${count} sessioni (${sessions}). Continuare?`,
    updatedTo: (ver) => `aggiornato a ${ver}`,
    unknownError: "errore sconosciuto",
    configured: "configurato",
    notConfigured: "non configurato",
    updateBadge: "update",
    auth: "Autenticazione",
    activeModel: "Modello attivo",
    models: "Modelli",
    apiKeyWarnPre: "Aggiungi la chiave API in",
    apiKeyWarnPost: "o nella variabile d'ambiente corrispondente.",
    checkUpdate: "Check / Update",
    update: "Update",
    stopTeamUpdate: "Stop team + update",
    cancel: "Annulla",
    activeBadge: "attivo",
    breadcrumb: "Provider",
    title: "Provider LLM",
    subtitle: (avail, total, active) =>
      `${avail}/${total} configurati · provider attivo: ${active}`,
    loading: "Caricamento…",
    configNotFound: "jht.config.json non trovato",
    refresh: "aggiorna",
    loadingProviders: "Caricamento provider…",
  },
  en: {
    confirmUpdate: (count, sessions) =>
      `The provider is active. Update requires stopping ${count} sessions (${sessions}). Continue?`,
    updatedTo: (ver) => `updated to ${ver}`,
    unknownError: "unknown error",
    configured: "configured",
    notConfigured: "not configured",
    updateBadge: "update",
    auth: "Authentication",
    activeModel: "Active model",
    models: "Models",
    apiKeyWarnPre: "Add the API Key in",
    apiKeyWarnPost: "or in the matching environment variable.",
    checkUpdate: "Check / Update",
    update: "Update",
    stopTeamUpdate: "Stop team + update",
    cancel: "Cancel",
    activeBadge: "active",
    breadcrumb: "Provider",
    title: "LLM Providers",
    subtitle: (avail, total, active) =>
      `${avail}/${total} configured · active provider: ${active}`,
    loading: "Loading…",
    configNotFound: "jht.config.json not found",
    refresh: "refresh",
    loadingProviders: "Loading providers…",
  },
  es: {
    confirmUpdate: (count, sessions) =>
      `El proveedor está activo. Update requiere detener ${count} sesiones (${sessions}). ¿Continuar?`,
    updatedTo: (ver) => `actualizado a ${ver}`,
    unknownError: "error desconocido",
    configured: "configurado",
    notConfigured: "no configurado",
    updateBadge: "update",
    auth: "Autenticación",
    activeModel: "Modelo activo",
    models: "Modelos",
    apiKeyWarnPre: "Añade la API Key en",
    apiKeyWarnPost: "o en la variable de entorno correspondiente.",
    checkUpdate: "Check / Update",
    update: "Update",
    stopTeamUpdate: "Detener equipo + update",
    cancel: "Cancelar",
    activeBadge: "activo",
    breadcrumb: "Proveedor",
    title: "Proveedores LLM",
    subtitle: (avail, total, active) =>
      `${avail}/${total} configurados · proveedor activo: ${active}`,
    loading: "Cargando…",
    configNotFound: "jht.config.json no encontrado",
    refresh: "actualizar",
    loadingProviders: "Cargando proveedores…",
  },
  fr: {
    confirmUpdate: (count, sessions) =>
      `Le fournisseur est actif. Update nécessite d'arrêter ${count} sessions (${sessions}). Continuer ?`,
    updatedTo: (ver) => `mis à jour vers ${ver}`,
    unknownError: "erreur inconnue",
    configured: "configuré",
    notConfigured: "non configuré",
    updateBadge: "update",
    auth: "Authentification",
    activeModel: "Modèle actif",
    models: "Modèles",
    apiKeyWarnPre: "Ajoutez l'API Key dans",
    apiKeyWarnPost: "ou dans la variable d'environnement correspondante.",
    checkUpdate: "Check / Update",
    update: "Update",
    stopTeamUpdate: "Arrêter l'équipe + update",
    cancel: "Annuler",
    activeBadge: "actif",
    breadcrumb: "Fournisseur",
    title: "Fournisseurs LLM",
    subtitle: (avail, total, active) =>
      `${avail}/${total} configurés · fournisseur actif : ${active}`,
    loading: "Chargement…",
    configNotFound: "jht.config.json introuvable",
    refresh: "actualiser",
    loadingProviders: "Chargement des fournisseurs…",
  },
  de: {
    confirmUpdate: (count, sessions) =>
      `Der Anbieter ist aktiv. Update erfordert das Stoppen von ${count} Sitzungen (${sessions}). Fortfahren?`,
    updatedTo: (ver) => `aktualisiert auf ${ver}`,
    unknownError: "unbekannter Fehler",
    configured: "konfiguriert",
    notConfigured: "nicht konfiguriert",
    updateBadge: "update",
    auth: "Authentifizierung",
    activeModel: "Aktives Modell",
    models: "Modelle",
    apiKeyWarnPre: "Füge den API Key in",
    apiKeyWarnPost: "oder in die entsprechende Umgebungsvariable ein.",
    checkUpdate: "Check / Update",
    update: "Update",
    stopTeamUpdate: "Team stoppen + update",
    cancel: "Abbrechen",
    activeBadge: "aktiv",
    breadcrumb: "Anbieter",
    title: "LLM-Anbieter",
    subtitle: (avail, total, active) =>
      `${avail}/${total} konfiguriert · aktiver Anbieter: ${active}`,
    loading: "Wird geladen…",
    configNotFound: "jht.config.json nicht gefunden",
    refresh: "aktualisieren",
    loadingProviders: "Anbieter werden geladen…",
  },
  hu: {
    confirmUpdate: (count, sessions) =>
      `A szolgáltató aktív. Az Update ${count} munkamenet leállítását igényli (${sessions}). Folytatja?`,
    updatedTo: (ver) => `frissítve erre: ${ver}`,
    unknownError: "ismeretlen hiba",
    configured: "beállítva",
    notConfigured: "nincs beállítva",
    updateBadge: "update",
    auth: "Hitelesítés",
    activeModel: "Aktív modell",
    models: "Modellek",
    apiKeyWarnPre: "Add meg az API Key-t itt:",
    apiKeyWarnPost: "vagy a megfelelő környezeti változóban.",
    checkUpdate: "Check / Update",
    update: "Update",
    stopTeamUpdate: "Csapat leállítása + update",
    cancel: "Mégse",
    activeBadge: "aktív",
    breadcrumb: "Szolgáltató",
    title: "LLM-szolgáltatók",
    subtitle: (avail, total, active) =>
      `${avail}/${total} beállítva · aktív szolgáltató: ${active}`,
    loading: "Betöltés…",
    configNotFound: "jht.config.json nem található",
    refresh: "frissítés",
    loadingProviders: "Szolgáltatók betöltése…",
  },
  pt: {
    confirmUpdate: (count, sessions) =>
      `O provedor está ativo. Update exige parar ${count} sessões (${sessions}). Continuar?`,
    updatedTo: (ver) => `atualizado para ${ver}`,
    unknownError: "erro desconhecido",
    configured: "configurado",
    notConfigured: "não configurado",
    updateBadge: "update",
    auth: "Autenticação",
    activeModel: "Modelo ativo",
    models: "Modelos",
    apiKeyWarnPre: "Adicione a API Key em",
    apiKeyWarnPost: "ou na variável de ambiente correspondente.",
    checkUpdate: "Check / Update",
    update: "Update",
    stopTeamUpdate: "Parar equipe + update",
    cancel: "Cancelar",
    activeBadge: "ativo",
    breadcrumb: "Provedor",
    title: "Provedores LLM",
    subtitle: (avail, total, active) =>
      `${avail}/${total} configurados · provedor ativo: ${active}`,
    loading: "Carregando…",
    configNotFound: "jht.config.json não encontrado",
    refresh: "atualizar",
    loadingProviders: "Carregando provedores…",
  },
};

type ProviderInfo = {
  id: string;
  label: string;
  available: boolean;
  active: boolean;
  authMethod: string;
  models: string[];
  activeModel?: string;
  keySource: "config" | "env" | null;
  installedVersion?: string | null;
  // Versione che il bottone installerà davvero: il pin della release, non
  // l'ultima del registry. Vedi lib/providers/update-target.ts — badge e
  // azione devono nominare la stessa versione.
  targetVersion?: string | null;
  updateAvailable?: boolean;
  updatable?: boolean;
};

type ProvidersData = {
  providers: ProviderInfo[];
  activeProvider: string;
  configLoaded: boolean;
};

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🟠",
  claude: "🟠",
  openai: "🟢",
  kimi: "🌙",
};

function ProviderCard({
  provider,
  onUpdated,
}: {
  provider: ProviderInfo;
  onUpdated: () => void;
}) {
  const t = T[useLocale()];
  const icon = PROVIDER_ICONS[provider.id] ?? "◆";
  const [updating, setUpdating] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err" | "confirm";
    msg: string;
    pendingForce?: boolean;
  } | null>(null);

  const runUpdate = useCallback(
    async (force: boolean) => {
      setUpdating(true);
      setFeedback(null);
      try {
        const res = await fetch("/api/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerId: provider.id, force }),
        });
        const data = await res.json();
        if (res.status === 409 && data.runningSessions?.length) {
          setFeedback({
            kind: "confirm",
            msg: t.confirmUpdate(
              data.runningSessions.length,
              data.runningSessions.join(", "),
            ),
            pendingForce: true,
          });
        } else if (data.ok) {
          setFeedback({
            kind: "ok",
            msg: t.updatedTo(data.installedVersion || "?"),
          });
          onUpdated();
        } else {
          const err = (data.stderr || data.error || t.unknownError)
            .split("\n")
            .slice(-3)
            .join(" ");
          setFeedback({ kind: "err", msg: err });
        }
      } catch (e) {
        setFeedback({
          kind: "err",
          msg: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setUpdating(false);
      }
    },
    [provider.id, onUpdated, t],
  );

  return (
    <div
      className="border rounded-lg overflow-hidden transition-colors"
      style={{
        borderColor: provider.active
          ? "rgba(0,232,122,0.4)"
          : provider.available
            ? "var(--color-border-glow)"
            : "var(--color-border)",
        background: "var(--color-panel)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-[var(--color-white)]">
              {provider.label}
            </span>
            {provider.active && (
              <span
                className="badge text-[9px]"
                style={{
                  color: "var(--color-green)",
                  border: "1px solid rgba(0,232,122,0.3)",
                  background: "rgba(0,232,122,0.08)",
                }}
              >
                ● {t.activeBadge}
              </span>
            )}
            <span
              className="badge text-[9px]"
              style={{
                color: provider.available
                  ? "var(--color-green)"
                  : "var(--color-dim)",
                border: `1px solid ${provider.available ? "rgba(0,232,122,0.2)" : "var(--color-border)"}`,
                background: "transparent",
              }}
            >
              {provider.available ? t.configured : t.notConfigured}
            </span>
            {provider.updateAvailable && (
              <span
                className="badge text-[9px]"
                style={{
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.3)",
                  background: "rgba(245,158,11,0.08)",
                }}
              >
                ⚠ {t.updateBadge} {provider.targetVersion}
              </span>
            )}
          </div>
          <p className="text-[10px] text-[var(--color-dim)] mt-0.5 font-mono">
            {provider.id}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 flex flex-col gap-3">
        {/* Auth */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[var(--color-dim)]">{t.auth}</span>
          <span className="font-mono" style={{ color: "var(--color-muted)" }}>
            {provider.authMethod}
            {provider.keySource && (
              <span className="ml-1 text-[9px] text-[var(--color-dim)]">
                ({provider.keySource})
              </span>
            )}
          </span>
        </div>

        {/* Modello attivo */}
        {provider.activeModel && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--color-dim)]">{t.activeModel}</span>
            <span className="font-mono text-[var(--color-bright)]">
              {provider.activeModel}
            </span>
          </div>
        )}

        {/* Modelli disponibili */}
        <div>
          <p className="text-[10px] text-[var(--color-dim)] mb-1.5">
            {t.models}
          </p>
          <div className="flex flex-wrap gap-1">
            {provider.models.map((m) => (
              <span
                key={m}
                className="px-2 py-0.5 rounded text-[9px] font-mono"
                style={{
                  background:
                    m === provider.activeModel
                      ? "rgba(0,232,122,0.12)"
                      : "var(--color-card)",
                  color:
                    m === provider.activeModel
                      ? "var(--color-green)"
                      : "var(--color-dim)",
                  border: `1px solid ${m === provider.activeModel ? "rgba(0,232,122,0.25)" : "var(--color-border)"}`,
                }}
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Warning se non configurato */}
        {!provider.available && (
          <p
            className="text-[10px] text-[var(--color-dim)] px-3 py-2 rounded border border-[var(--color-border)]"
            style={{ background: "var(--color-card)" }}
          >
            {t.apiKeyWarnPre}{" "}
            <span className="font-mono text-[var(--color-muted)]">
              jht.config.json
            </span>{" "}
            {t.apiKeyWarnPost}
          </p>
        )}

        {/* Version + Update */}
        {provider.updatable && provider.installedVersion && (
          <div
            className="flex items-center justify-between text-[11px] pt-3 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-dim)]">CLI</span>
              <span className="font-mono text-[var(--color-bright)]">
                {provider.installedVersion}
              </span>
              {provider.targetVersion &&
                provider.targetVersion !== provider.installedVersion && (
                  <span className="text-[10px]" style={{ color: "#f59e0b" }}>
                    → {provider.targetVersion}
                  </span>
                )}
            </div>
            <button
              onClick={() => runUpdate(false)}
              disabled={updating}
              className="px-3 py-1 rounded text-[10px] font-semibold transition-all"
              style={{
                background: updating
                  ? "var(--color-border)"
                  : provider.updateAvailable
                    ? "rgba(245,158,11,0.1)"
                    : "transparent",
                color: updating
                  ? "var(--color-dim)"
                  : provider.updateAvailable
                    ? "#f59e0b"
                    : "var(--color-muted)",
                border: `1px solid ${updating ? "var(--color-border)" : provider.updateAvailable ? "rgba(245,158,11,0.3)" : "var(--color-border)"}`,
                cursor: updating ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {updating
                ? "…"
                : provider.updateAvailable
                  ? `↑ ${t.update}`
                  : t.checkUpdate}
            </button>
          </div>
        )}

        {feedback && (
          <div
            className="text-[10px] px-3 py-2 rounded border"
            style={{
              background:
                feedback.kind === "ok"
                  ? "rgba(0,232,122,0.06)"
                  : feedback.kind === "err"
                    ? "rgba(244,67,54,0.06)"
                    : "rgba(245,158,11,0.06)",
              borderColor:
                feedback.kind === "ok"
                  ? "rgba(0,232,122,0.25)"
                  : feedback.kind === "err"
                    ? "rgba(244,67,54,0.25)"
                    : "rgba(245,158,11,0.25)",
              color:
                feedback.kind === "ok"
                  ? "var(--color-green)"
                  : feedback.kind === "err"
                    ? "#f44336"
                    : "#f59e0b",
            }}
          >
            <div>{feedback.msg}</div>
            {feedback.pendingForce && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => runUpdate(true)}
                  disabled={updating}
                  className="px-2 py-1 rounded text-[10px] font-semibold"
                  style={{
                    background: "rgba(244,67,54,0.1)",
                    color: "#f44336",
                    border: "1px solid rgba(244,67,54,0.3)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {t.stopTeamUpdate}
                </button>
                <button
                  onClick={() => setFeedback(null)}
                  className="px-2 py-1 rounded text-[10px] font-semibold"
                  style={{
                    background: "transparent",
                    color: "var(--color-muted)",
                    border: "1px solid var(--color-border)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {t.cancel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProvidersPage() {
  const t = T[useLocale()];
  const [data, setData] = useState<ProvidersData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/providers").catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const available = data?.providers.filter((p) => p.available).length ?? 0;

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
                    available,
                    data.providers.length,
                    data.activeProvider,
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
            {t.loadingProviders}
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
              <ProviderCard provider={p} onUpdated={fetchData} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
