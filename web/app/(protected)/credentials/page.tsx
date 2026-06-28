"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  not_configured: {
    it: "Non configurato",
    en: "Not configured",
    hu: "Nincs beállítva",
    es: "No configurado",
    de: "Nicht konfiguriert",
    fr: "Non configuré",
    pt: "Não configurado",
  },
  source_env: {
    it: "Variabile env",
    en: "Env variable",
    hu: "Env változó",
    es: "Variable de entorno",
    de: "Umgebungsvariable",
    fr: "Variable d'env.",
    pt: "Variável de ambiente",
  },
  source_file: {
    it: "File locale",
    en: "Local file",
    hu: "Helyi fájl",
    es: "Archivo local",
    de: "Lokale Datei",
    fr: "Fichier local",
    pt: "Arquivo local",
  },
  add: {
    it: "Aggiungi",
    en: "Add",
    hu: "Hozzáadás",
    es: "Añadir",
    de: "Hinzufügen",
    fr: "Ajouter",
    pt: "Adicionar",
  },
  remove: {
    it: "Rimuovi",
    en: "Remove",
    hu: "Eltávolítás",
    es: "Quitar",
    de: "Entfernen",
    fr: "Retirer",
    pt: "Remover",
  },
  add_title: {
    it: "Aggiungi — {label}",
    en: "Add — {label}",
    hu: "Hozzáadás — {label}",
    es: "Añadir — {label}",
    de: "Hinzufügen — {label}",
    fr: "Ajouter — {label}",
    pt: "Adicionar — {label}",
  },
  cancel: {
    it: "Annulla",
    en: "Cancel",
    hu: "Mégse",
    es: "Cancelar",
    de: "Abbrechen",
    fr: "Annuler",
    pt: "Cancelar",
  },
  save: {
    it: "Salva",
    en: "Save",
    hu: "Mentés",
    es: "Guardar",
    de: "Speichern",
    fr: "Enregistrer",
    pt: "Guardar",
  },
  saving: {
    it: "Salvataggio...",
    en: "Saving...",
    hu: "Mentés...",
    es: "Guardando...",
    de: "Wird gespeichert...",
    fr: "Enregistrement...",
    pt: "Salvando...",
  },
  ph_apikey: {
    it: "API Key...",
    en: "API Key...",
    hu: "API Key...",
    es: "API Key...",
    de: "API Key...",
    fr: "API Key...",
    pt: "API Key...",
  },
  ph_token: {
    it: "Access Token...",
    en: "Access Token...",
    hu: "Access Token...",
    es: "Access Token...",
    de: "Access Token...",
    fr: "Access Token...",
    pt: "Access Token...",
  },
  err_network: {
    it: "Errore di rete",
    en: "Network error",
    hu: "Hálózati hiba",
    es: "Error de red",
    de: "Netzwerkfehler",
    fr: "Erreur réseau",
    pt: "Erro de rede",
  },
  err_unknown: {
    it: "Errore sconosciuto",
    en: "Unknown error",
    hu: "Ismeretlen hiba",
    es: "Error desconocido",
    de: "Unbekannter Fehler",
    fr: "Erreur inconnue",
    pt: "Erro desconhecido",
  },
  title: {
    it: "Credenziali",
    en: "Credentials",
    hu: "Hitelesítő adatok",
    es: "Credenciales",
    de: "Anmeldedaten",
    fr: "Identifiants",
    pt: "Credenciais",
  },
  subtitle: {
    it: "Gestione API key e token OAuth — {n}/{tot} configurati",
    en: "API key and OAuth token management — {n}/{tot} configured",
    hu: "API-kulcsok és OAuth tokenek kezelése — {n}/{tot} beállítva",
    es: "Gestión de API keys y tokens OAuth — {n}/{tot} configurados",
    de: "Verwaltung von API-Keys und OAuth-Tokens — {n}/{tot} konfiguriert",
    fr: "Gestion des clés API et tokens OAuth — {n}/{tot} configurés",
    pt: "Gestão de API keys e tokens OAuth — {n}/{tot} configurados",
  },
  loading: {
    it: "Caricamento...",
    en: "Loading...",
    hu: "Betöltés...",
    es: "Cargando...",
    de: "Wird geladen...",
    fr: "Chargement...",
    pt: "Carregando...",
  },
  empty: {
    it: "Nessun provider disponibile.",
    en: "No providers available.",
    hu: "Nincs elérhető szolgáltató.",
    es: "No hay proveedores disponibles.",
    de: "Keine Provider verfügbar.",
    fr: "Aucun fournisseur disponible.",
    pt: "Nenhum provedor disponível.",
  },
  provider: {
    it: "Provider",
    en: "Provider",
    hu: "Szolgáltató",
    es: "Proveedor",
    de: "Provider",
    fr: "Fournisseur",
    pt: "Provedor",
  },
  active: {
    it: "{n} attivi",
    en: "{n} active",
    hu: "{n} aktív",
    es: "{n} activos",
    de: "{n} aktiv",
    fr: "{n} actifs",
    pt: "{n} ativos",
  },
  footer_note: {
    it: "Le API key non vengono mai esposte nella UI. Le credenziali da variabile ambiente non possono essere rimosse da qui.",
    en: "API keys are never exposed in the UI. Credentials from environment variables cannot be removed here.",
    hu: "Az API-kulcsok soha nem jelennek meg a felületen. A környezeti változókból származó hitelesítő adatok innen nem távolíthatók el.",
    es: "Las API keys nunca se muestran en la interfaz. Las credenciales de variables de entorno no pueden eliminarse desde aquí.",
    de: "API-Keys werden nie in der UI angezeigt. Anmeldedaten aus Umgebungsvariablen können hier nicht entfernt werden.",
    fr: "Les clés API ne sont jamais exposées dans l'interface. Les identifiants issus de variables d'environnement ne peuvent pas être retirés ici.",
    pt: "As API keys nunca são exibidas na interface. As credenciais de variáveis de ambiente não podem ser removidas aqui.",
  },
};

type ProviderInfo = {
  provider: string;
  type: "api_key" | "oauth";
  configured: boolean;
  source: "env" | "file" | "none";
  savedAt: number | null;
  envVar: string | null;
};

const LABELS: Record<string, string> = {
  claude: "Claude (Anthropic)",
  openai: "OpenAI",
  kimi: "Kimi",
  chatgpt_pro: "ChatGPT Pro",
  claude_max: "Claude Max",
};

function Badge({
  ok,
  source,
  tr,
}: {
  ok: boolean;
  source: string;
  tr: (k: string) => string;
}) {
  if (!ok)
    return (
      <span className="text-[10px] px-2 py-0.5 rounded bg-[rgba(255,255,255,0.04)] text-[var(--color-dim)]">
        {tr("not_configured")}
      </span>
    );
  const color = source === "env" ? "var(--color-blue)" : "var(--color-green)";
  const label = source === "env" ? tr("source_env") : tr("source_file");
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded"
      style={{ background: `${color}22`, color }}
    >
      {label}
    </span>
  );
}

function ProviderCard({
  p,
  onDelete,
  onSelect,
  tr,
}: {
  p: ProviderInfo;
  onDelete: (prov: string) => void;
  onSelect: (prov: string) => void;
  tr: (k: string) => string;
}) {
  const label = LABELS[p.provider] ?? p.provider;
  const isEnv = p.source === "env";
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-[var(--color-bright)]">
          {label}
        </p>
        <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
          {p.type === "api_key" ? "API Key" : "OAuth"}
          {p.envVar ? ` · ${p.envVar}` : ""}
        </p>
      </div>
      <Badge ok={p.configured} source={p.source} tr={tr} />
      <div className="flex gap-1.5">
        {!p.configured && (
          <button
            onClick={() => onSelect(p.provider)}
            className="text-[10px] px-2.5 py-1 rounded font-semibold cursor-pointer transition-colors"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            {tr("add")}
          </button>
        )}
        {p.configured && !isEnv && (
          <button
            onClick={() => onDelete(p.provider)}
            className="text-[10px] px-2.5 py-1 rounded font-semibold cursor-pointer transition-colors"
            style={{
              background: "rgba(255,69,96,0.15)",
              color: "var(--color-red)",
            }}
          >
            {tr("remove")}
          </button>
        )}
      </div>
    </div>
  );
}

function AddForm({
  provider,
  type,
  onDone,
  tr,
}: {
  provider: string;
  type: string;
  onDone: () => void;
  tr: (k: string) => string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isApiKey = type === "api_key";
  const label = LABELS[provider] ?? provider;

  async function handleSave() {
    setError("");
    setSaving(true);
    const body = isApiKey
      ? { provider, apiKey: value }
      : { provider, accessToken: value };
    const res = await fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res) {
      setError(tr("err_network"));
      setSaving(false);
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      setError(data.error ?? tr("err_unknown"));
      setSaving(false);
      return;
    }
    setSaving(false);
    setValue("");
    onDone();
  }

  return (
    <div
      className="p-4 rounded-lg border border-[var(--color-border-glow)] bg-[var(--color-panel)] mb-4"
      style={{ animation: "fade-in 0.2s ease both" }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-[var(--color-bright)]">
          {tr("add_title").replace("{label}", label)}
        </p>
        <button
          onClick={onDone}
          className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] cursor-pointer"
        >
          {tr("cancel")}
        </button>
      </div>
      <input
        type="password"
        placeholder={isApiKey ? tr("ph_apikey") : tr("ph_token")}
        aria-label={isApiKey ? "API Key" : "Access Token"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        required
        className="w-full px-3 py-2 rounded text-[12px] bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-bright)] placeholder:text-[var(--color-dim)] outline-none focus:border-[var(--color-border-glow)] transition-colors"
      />
      {error && (
        <p role="alert" className="text-[10px] text-[var(--color-red)] mt-1.5">
          {error}
        </p>
      )}
      <div className="flex justify-end mt-3">
        <button
          onClick={handleSave}
          disabled={!value.trim() || saving}
          className="text-[10px] px-4 py-1.5 rounded font-semibold cursor-pointer transition-colors disabled:opacity-40"
          style={{ background: "var(--color-green)", color: "#000" }}
        >
          {saving ? tr("saving") : tr("save")}
        </button>
      </div>
    </div>
  );
}

export default function CredentialsPage() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<{
    provider: string;
    type: string;
  } | null>(null);

  const fetchProviders = useCallback(async () => {
    const res = await fetch("/api/credentials").catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setProviders(d.providers ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  async function handleDelete(provider: string) {
    const res = await fetch(`/api/credentials?provider=${provider}`, {
      method: "DELETE",
    }).catch(() => null);
    if (res?.ok) fetchProviders();
  }

  function handleSelect(provider: string) {
    const p = providers.find((x) => x.provider === provider);
    setAdding(p ? { provider, type: p.type } : null);
  }

  const configured = providers.filter((p) => p.configured).length;

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
            {tr("title")}
          </span>
        </nav>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            {tr("title")}
          </h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            {tr("subtitle")
              .replace("{n}", String(configured))
              .replace("{tot}", String(providers.length))}
          </p>
        </div>
      </div>

      {adding && (
        <AddForm
          provider={adding.provider}
          type={adding.type}
          tr={tr}
          onDone={() => {
            setAdding(null);
            fetchProviders();
          }}
        />
      )}

      {loading ? (
        <p
          className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse"
          role="status"
          aria-live="polite"
        >
          {tr("loading")}
        </p>
      ) : providers.length === 0 ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">
          {tr("empty")}
        </p>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)]">
              {tr("provider")}
            </p>
            <p className="text-[10px] text-[var(--color-dim)]">
              {tr("active").replace("{n}", String(configured))}
            </p>
          </div>
          {providers.map((p) => (
            <ProviderCard
              key={p.provider}
              p={p}
              onDelete={handleDelete}
              onSelect={handleSelect}
              tr={tr}
            />
          ))}
        </div>
      )}

      <div className="mt-6 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
        <p className="text-[10px] text-[var(--color-dim)]">
          {tr("footer_note")}
        </p>
      </div>
    </div>
  );
}
