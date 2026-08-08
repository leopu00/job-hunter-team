"use client";

// [JHT-DASHBOARD-SPLIT] UI gestione token sync-infra — resa SOLO sul deploy
// cloud (vedi page.tsx). Un utente cloud pai­ra il suo VPS/PC generando qui un
// token `jht_sync_…` e incollandolo nel CLI con `jht cloud enable --token`.
// Alternativa al device-flow (/cli-link). Parla solo con /api/cloud-sync/tokens
// (auth via cookie Supabase) — nessun filesystem locale, quindi funziona su
// Vercel dove ~/.jht/jobs.db non esiste (era il bug della vecchia pagina).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// Breadcrumb: senza, dalla pagina token non si tornava alle Impostazioni
// (feedback utente 21/07).
const BC: Record<Locale, { dashboard: string; settings: string }> = {
  it: { dashboard: "Dashboard", settings: "Impostazioni" },
  en: { dashboard: "Dashboard", settings: "Settings" },
  hu: { dashboard: "Vezérlőpult", settings: "Beállítások" },
  es: { dashboard: "Panel", settings: "Ajustes" },
  de: { dashboard: "Dashboard", settings: "Einstellungen" },
  fr: { dashboard: "Tableau de bord", settings: "Paramètres" },
  pt: { dashboard: "Painel", settings: "Definições" },
};

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  created_at: string;
  // Telemetria tecnica dichiarata dal box a ogni chiamata cloud-sync
  // ([CLIENT-VERSION-INVISIBLE]). NULL finché un client abbastanza recente
  // non si fa vivo: i token pairati prima non mandano l'header.
  client_version: string | null;
  client_platform: string | null;
  client_capabilities: string[] | null;
  client_seen_at: string | null;
}

type CreateState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "created"; token: string; name: string }
  | { kind: "error"; message: string };

const T: Record<
  Locale,
  {
    title: string;
    subtitle: string;
    nameLabel: string;
    namePlaceholder: string;
    createBtn: string;
    creating: string;
    createdTitle: string;
    createdHint: string;
    cliBefore: string; // prima del comando
    copyBtn: string;
    copied: string;
    existingTitle: string;
    none: string;
    created: string;
    lastUsed: string;
    never: string;
    revoke: string;
    revoking: string;
    confirmRevoke: string;
    errName: string;
    errHttp: string; // {status}
    errNetwork: string;
    loading: string;
    clientBuild: string;
    clientUnknown: string;
    clientCapabilities: string;
  }
> = {
  it: {
    title: "Token dispositivi (Cloud Sync)",
    subtitle:
      "Genera un token per collegare un VPS o PC a questo account. Incollalo nel terminale con il comando qui sotto. Il token è mostrato una sola volta.",
    nameLabel: "Nome del dispositivo",
    namePlaceholder: "vps-leone / casa-pc / …",
    createBtn: "Genera token",
    creating: "Genero…",
    createdTitle: "Token creato",
    createdHint:
      "Copialo ORA: non sarà più mostrato. Se lo perdi, revocalo e generane un altro.",
    cliBefore: "Sul VPS/PC lancia:",
    copyBtn: "Copia",
    copied: "Copiato ✓",
    existingTitle: "Token attivi",
    none: "Nessun token attivo.",
    created: "Creato",
    lastUsed: "Ultimo uso",
    never: "mai",
    revoke: "Revoca",
    revoking: "Revoco…",
    confirmRevoke:
      "Revocare questo token? I dispositivi che lo usano si scollegano.",
    errName: "Nome obbligatorio (1-100 caratteri).",
    errHttp: "Errore HTTP {status}",
    errNetwork: "Errore di rete",
    loading: "Caricamento…",
    clientBuild: "Versione",
    clientUnknown: "non ancora dichiarata",
    clientCapabilities: "Funzioni",
  },
  en: {
    title: "Device tokens (Cloud Sync)",
    subtitle:
      "Generate a token to link a VPS or PC to this account. Paste it into the terminal with the command below. The token is shown only once.",
    nameLabel: "Device name",
    namePlaceholder: "vps-leone / home-pc / …",
    createBtn: "Generate token",
    creating: "Generating…",
    createdTitle: "Token created",
    createdHint:
      "Copy it NOW: it won't be shown again. If you lose it, revoke it and generate a new one.",
    cliBefore: "On the VPS/PC run:",
    copyBtn: "Copy",
    copied: "Copied ✓",
    existingTitle: "Active tokens",
    none: "No active tokens.",
    created: "Created",
    lastUsed: "Last used",
    never: "never",
    revoke: "Revoke",
    revoking: "Revoking…",
    confirmRevoke: "Revoke this token? Devices using it will disconnect.",
    errName: "Name required (1-100 characters).",
    errHttp: "HTTP error {status}",
    errNetwork: "Network error",
    loading: "Loading…",
    clientBuild: "Build",
    clientUnknown: "not declared yet",
    clientCapabilities: "Features",
  },
  es: {
    title: "Tokens de dispositivo (Cloud Sync)",
    subtitle:
      "Genera un token para vincular un VPS o PC a esta cuenta. Pégalo en la terminal con el comando de abajo. El token se muestra una sola vez.",
    nameLabel: "Nombre del dispositivo",
    namePlaceholder: "vps-leone / pc-casa / …",
    createBtn: "Generar token",
    creating: "Generando…",
    createdTitle: "Token creado",
    createdHint:
      "Cópialo AHORA: no se volverá a mostrar. Si lo pierdes, revócalo y genera otro.",
    cliBefore: "En el VPS/PC ejecuta:",
    copyBtn: "Copiar",
    copied: "Copiado ✓",
    existingTitle: "Tokens activos",
    none: "No hay tokens activos.",
    created: "Creado",
    lastUsed: "Último uso",
    never: "nunca",
    revoke: "Revocar",
    revoking: "Revocando…",
    confirmRevoke:
      "¿Revocar este token? Los dispositivos que lo usan se desconectarán.",
    errName: "Nombre obligatorio (1-100 caracteres).",
    errHttp: "Error HTTP {status}",
    errNetwork: "Error de red",
    loading: "Cargando…",
    clientBuild: "Versión",
    clientUnknown: "aún no declarada",
    clientCapabilities: "Funciones",
  },
  fr: {
    title: "Tokens d'appareil (Cloud Sync)",
    subtitle:
      "Générez un token pour relier un VPS ou PC à ce compte. Collez-le dans le terminal avec la commande ci-dessous. Le token n'est affiché qu'une fois.",
    nameLabel: "Nom de l'appareil",
    namePlaceholder: "vps-leone / pc-maison / …",
    createBtn: "Générer un token",
    creating: "Génération…",
    createdTitle: "Token créé",
    createdHint:
      "Copiez-le MAINTENANT : il ne sera plus affiché. En cas de perte, révoquez-le et générez-en un autre.",
    cliBefore: "Sur le VPS/PC, lancez :",
    copyBtn: "Copier",
    copied: "Copié ✓",
    existingTitle: "Tokens actifs",
    none: "Aucun token actif.",
    created: "Créé",
    lastUsed: "Dernière utilisation",
    never: "jamais",
    revoke: "Révoquer",
    revoking: "Révocation…",
    confirmRevoke:
      "Révoquer ce token ? Les appareils qui l'utilisent seront déconnectés.",
    errName: "Nom obligatoire (1-100 caractères).",
    errHttp: "Erreur HTTP {status}",
    errNetwork: "Erreur réseau",
    loading: "Chargement…",
    clientBuild: "Version",
    clientUnknown: "pas encore déclarée",
    clientCapabilities: "Fonctions",
  },
  de: {
    title: "Geräte-Tokens (Cloud Sync)",
    subtitle:
      "Erstelle einen Token, um einen VPS oder PC mit diesem Konto zu verbinden. Füge ihn mit dem Befehl unten ins Terminal ein. Der Token wird nur einmal angezeigt.",
    nameLabel: "Gerätename",
    namePlaceholder: "vps-leone / heim-pc / …",
    createBtn: "Token erstellen",
    creating: "Erstelle…",
    createdTitle: "Token erstellt",
    createdHint:
      "Kopiere ihn JETZT: er wird nicht erneut angezeigt. Bei Verlust widerrufen und einen neuen erstellen.",
    cliBefore: "Auf dem VPS/PC ausführen:",
    copyBtn: "Kopieren",
    copied: "Kopiert ✓",
    existingTitle: "Aktive Tokens",
    none: "Keine aktiven Tokens.",
    created: "Erstellt",
    lastUsed: "Zuletzt verwendet",
    never: "nie",
    revoke: "Widerrufen",
    revoking: "Widerrufe…",
    confirmRevoke:
      "Diesen Token widerrufen? Geräte, die ihn nutzen, werden getrennt.",
    errName: "Name erforderlich (1-100 Zeichen).",
    errHttp: "HTTP-Fehler {status}",
    errNetwork: "Netzwerkfehler",
    loading: "Laden…",
    clientBuild: "Version",
    clientUnknown: "noch nicht angegeben",
    clientCapabilities: "Funktionen",
  },
  hu: {
    title: "Eszköztokenek (Cloud Sync)",
    subtitle:
      "Hozz létre egy tokent egy VPS vagy PC fiókhoz kötéséhez. Illeszd be a terminálba az alábbi paranccsal. A token csak egyszer jelenik meg.",
    nameLabel: "Eszköz neve",
    namePlaceholder: "vps-leone / otthoni-pc / …",
    createBtn: "Token létrehozása",
    creating: "Létrehozás…",
    createdTitle: "Token létrehozva",
    createdHint:
      "Másold ki MOST: többé nem jelenik meg. Ha elveszted, vond vissza és hozz létre újat.",
    cliBefore: "A VPS-en/PC-n futtasd:",
    copyBtn: "Másolás",
    copied: "Másolva ✓",
    existingTitle: "Aktív tokenek",
    none: "Nincs aktív token.",
    created: "Létrehozva",
    lastUsed: "Utolsó használat",
    never: "soha",
    revoke: "Visszavonás",
    revoking: "Visszavonás…",
    confirmRevoke:
      "Visszavonod ezt a tokent? Az azt használó eszközök lecsatlakoznak.",
    errName: "Név kötelező (1-100 karakter).",
    errHttp: "HTTP {status} hiba",
    errNetwork: "Hálózati hiba",
    loading: "Betöltés…",
    clientBuild: "Verzió",
    clientUnknown: "még nincs megadva",
    clientCapabilities: "Funkciók",
  },
  pt: {
    title: "Tokens de dispositivo (Cloud Sync)",
    subtitle:
      "Gera um token para ligar um VPS ou PC a esta conta. Cola-o no terminal com o comando abaixo. O token é mostrado apenas uma vez.",
    nameLabel: "Nome do dispositivo",
    namePlaceholder: "vps-leone / pc-casa / …",
    createBtn: "Gerar token",
    creating: "A gerar…",
    createdTitle: "Token criado",
    createdHint:
      "Copia-o AGORA: não voltará a ser mostrado. Se o perderes, revoga-o e gera outro.",
    cliBefore: "No VPS/PC executa:",
    copyBtn: "Copiar",
    copied: "Copiado ✓",
    existingTitle: "Tokens ativos",
    none: "Nenhum token ativo.",
    created: "Criado",
    lastUsed: "Último uso",
    never: "nunca",
    revoke: "Revogar",
    revoking: "A revogar…",
    confirmRevoke:
      "Revogar este token? Os dispositivos que o usam serão desligados.",
    errName: "Nome obrigatório (1-100 caracteres).",
    errHttp: "Erro HTTP {status}",
    errNetwork: "Erro de rede",
    loading: "A carregar…",
    clientBuild: "Versão",
    clientUnknown: "ainda não declarada",
    clientCapabilities: "Funções",
  },
};

export default function CloudTokensClient() {
  const locale = useLocale();
  const t = T[locale];
  const bc = BC[locale] ?? BC.en;
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("");
  const [createState, setCreateState] = useState<CreateState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cloud-sync/tokens");
      if (!res.ok) {
        setTokens([]);
        return;
      }
      const data = await res.json();
      setTokens(data.tokens ?? []);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      setCreateState({ kind: "error", message: t.errName });
      return;
    }
    setCreateState({ kind: "creating" });
    setCopied(false);
    try {
      const res = await fetch("/api/cloud-sync/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateState({
          kind: "error",
          message:
            body.error || t.errHttp.replace("{status}", String(res.status)),
        });
        return;
      }
      setCreateState({
        kind: "created",
        token: body.token,
        name: body.name ?? trimmed,
      });
      setName("");
      refresh();
    } catch (err) {
      setCreateState({
        kind: "error",
        message: err instanceof Error ? err.message : t.errNetwork,
      });
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm(t.confirmRevoke)) return;
    setRevokingId(id);
    try {
      await fetch(`/api/cloud-sync/tokens?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refresh();
    } finally {
      setRevokingId(null);
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard non disponibile: l'utente selezioni a mano */
    }
  }

  return (
    <div className="min-h-screen px-5 py-8 max-w-2xl mx-auto">
      <header className="mb-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {bc.dashboard}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/settings"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {bc.settings}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {t.title}
          </span>
        </nav>
        <h1 className="text-xl font-medium tracking-tight text-[var(--color-white)] mb-1">
          {t.title}
        </h1>
        <p className="text-[var(--color-dim)] text-[11px]">{t.subtitle}</p>
      </header>

      {/* Form creazione */}
      <form
        onSubmit={handleCreate}
        className="p-5 border border-[var(--color-border)] bg-[var(--color-card)] mb-6"
      >
        <label
          htmlFor="token_name"
          className="block text-[12px] text-[var(--color-bright)] font-medium mb-1"
        >
          {t.nameLabel}
        </label>
        <div className="flex gap-2">
          <input
            id="token_name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            maxLength={100}
            className="flex-1 px-3 py-2 border border-[var(--color-border)] bg-[rgba(0,0,0,0.2)] text-[12px] text-[var(--color-bright)] focus:border-[var(--color-green)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={createState.kind === "creating"}
            className="px-4 py-2 border border-[var(--color-green)] text-[12px] font-medium text-[var(--color-green)] hover:bg-[var(--color-green)] hover:text-[var(--color-bg)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createState.kind === "creating" ? t.creating : t.createBtn}
          </button>
        </div>

        {createState.kind === "error" && (
          <div
            className="mt-3 text-[11px]"
            style={{ color: "var(--color-red)" }}
          >
            {createState.message}
          </div>
        )}

        {createState.kind === "created" && (
          <div className="mt-4 p-3 border border-[var(--color-green)] bg-[rgba(0,0,0,0.25)]">
            <div className="text-[12px] text-[var(--color-green)] font-medium mb-1">
              {t.createdTitle}
            </div>
            <div className="text-[11px] text-[var(--color-dim)] mb-2">
              {t.createdHint}
            </div>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 break-all px-2 py-1.5 bg-[rgba(0,0,0,0.4)] text-[12px] font-mono text-[var(--color-bright)]">
                {createState.token}
              </code>
              <button
                type="button"
                onClick={() => copyToken(createState.token)}
                className="px-3 py-1.5 border border-[var(--color-border)] text-[10px] text-[var(--color-dim)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors cursor-pointer whitespace-nowrap"
              >
                {copied ? t.copied : t.copyBtn}
              </button>
            </div>
            <div className="text-[10px] text-[var(--color-dim)]">
              {t.cliBefore}
            </div>
            <code className="block break-all mt-1 px-2 py-1.5 bg-[rgba(0,0,0,0.4)] text-[11px] font-mono text-[var(--color-bright)]">
              jht cloud enable --token {createState.token}
            </code>
          </div>
        )}
      </form>

      {/* Lista token attivi */}
      <div>
        <h2 className="text-[10px] uppercase tracking-wider text-[var(--color-dim)] mb-2">
          {t.existingTitle}
        </h2>
        {tokens === null && (
          <div className="text-[11px] text-[var(--color-dim)]">{t.loading}</div>
        )}
        {tokens !== null && tokens.length === 0 && (
          <div className="text-[11px] text-[var(--color-dim)]">{t.none}</div>
        )}
        {tokens !== null && tokens.length > 0 && (
          <ul className="space-y-2">
            {tokens.map((tok) => (
              <li
                key={tok.id}
                className="flex items-center justify-between gap-3 p-3 border border-[var(--color-border)] bg-[var(--color-card)]"
              >
                <div className="min-w-0">
                  <div className="text-[12px] text-[var(--color-bright)] font-medium truncate">
                    {tok.name}
                    <span className="ml-2 font-mono text-[10px] text-[var(--color-dim)]">
                      {tok.token_prefix}…
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--color-dim)] mt-0.5">
                    {t.created} {tok.created_at.slice(0, 10)} · {t.lastUsed}:{" "}
                    {tok.last_used_at ? tok.last_used_at.slice(0, 10) : t.never}
                  </div>
                  <div className="text-[10px] text-[var(--color-dim)] mt-0.5">
                    {t.clientBuild}:{" "}
                    {tok.client_version ? (
                      <span className="font-mono text-[var(--color-muted)]">
                        {tok.client_version}
                        {tok.client_platform ? ` · ${tok.client_platform}` : ""}
                      </span>
                    ) : (
                      t.clientUnknown
                    )}
                    {tok.client_capabilities &&
                      tok.client_capabilities.length > 0 && (
                        <>
                          {" · "}
                          {t.clientCapabilities}:{" "}
                          <span className="font-mono text-[var(--color-muted)]">
                            {tok.client_capabilities.join(", ")}
                          </span>
                        </>
                      )}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(tok.id)}
                  disabled={revokingId === tok.id}
                  className="px-3 py-1.5 border border-[var(--color-border)] text-[10px] text-[var(--color-dim)] hover:border-[var(--color-red)] hover:text-[var(--color-red)] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {revokingId === tok.id ? t.revoking : t.revoke}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
