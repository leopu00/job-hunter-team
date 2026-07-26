"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/use-locale";
import type { SyncCounts } from "@/lib/types";

const T: Record<string, Record<string, string>> = {
  in_future: {
    it: "in futuro",
    en: "in the future",
    hu: "a jövőben",
    es: "en el futuro",
    de: "in der Zukunft",
    fr: "dans le futur",
    pt: "no futuro",
  },
  few_seconds_ago: {
    it: "pochi secondi fa",
    en: "a few seconds ago",
    hu: "néhány másodperce",
    es: "hace unos segundos",
    de: "vor wenigen Sekunden",
    fr: "il y a quelques secondes",
    pt: "há alguns segundos",
  },
  sec_ago: {
    it: "{n} sec fa",
    en: "{n} sec ago",
    hu: "{n} mp-e",
    es: "hace {n} s",
    de: "vor {n} Sek.",
    fr: "il y a {n} s",
    pt: "há {n} s",
  },
  min_ago_one: {
    it: "1 min fa",
    en: "1 min ago",
    hu: "1 perce",
    es: "hace 1 min",
    de: "vor 1 Min.",
    fr: "il y a 1 min",
    pt: "há 1 min",
  },
  min_ago: {
    it: "{n} min fa",
    en: "{n} min ago",
    hu: "{n} perce",
    es: "hace {n} min",
    de: "vor {n} Min.",
    fr: "il y a {n} min",
    pt: "há {n} min",
  },
  hour_ago_one: {
    it: "1 ora fa",
    en: "1 hour ago",
    hu: "1 órája",
    es: "hace 1 hora",
    de: "vor 1 Stunde",
    fr: "il y a 1 heure",
    pt: "há 1 hora",
  },
  hour_ago: {
    it: "{n} ore fa",
    en: "{n} hours ago",
    hu: "{n} órája",
    es: "hace {n} horas",
    de: "vor {n} Stunden",
    fr: "il y a {n} heures",
    pt: "há {n} horas",
  },
  day_ago_one: {
    it: "1 giorno fa",
    en: "1 day ago",
    hu: "1 napja",
    es: "hace 1 día",
    de: "vor 1 Tag",
    fr: "il y a 1 jour",
    pt: "há 1 dia",
  },
  day_ago: {
    it: "{n} giorni fa",
    en: "{n} days ago",
    hu: "{n} napja",
    es: "hace {n} días",
    de: "vor {n} Tagen",
    fr: "il y a {n} jours",
    pt: "há {n} dias",
  },
  net_error: {
    it: "Errore di rete",
    en: "Network error",
    hu: "Hálózati hiba",
    es: "Error de red",
    de: "Netzwerkfehler",
    fr: "Erreur réseau",
    pt: "Erro de rede",
  },
  subtitle: {
    it: "Sincronizza i tuoi dati locali con il cloud (opt-in). I dati restano sul tuo PC finché non clicchi sincronizza.",
    en: "Sync your local data with the cloud (opt-in). Data stays on your PC until you click sync.",
    hu: "Szinkronizáld a helyi adataidat a felhővel (opt-in). Az adatok a gépeden maradnak, amíg nem kattintasz a szinkronizálásra.",
    es: "Sincroniza tus datos locales con la nube (opcional). Los datos permanecen en tu PC hasta que hagas clic en sincronizar.",
    de: "Synchronisiere deine lokalen Daten mit der Cloud (Opt-in). Die Daten bleiben auf deinem PC, bis du auf Synchronisieren klickst.",
    fr: "Synchronisez vos données locales avec le cloud (opt-in). Les données restent sur votre PC jusqu'à ce que vous cliquiez sur synchroniser.",
    pt: "Sincronize seus dados locais com a nuvem (opt-in). Os dados permanecem no seu PC até você clicar em sincronizar.",
  },
  loading: {
    it: "Caricamento…",
    en: "Loading…",
    hu: "Betöltés…",
    es: "Cargando…",
    de: "Laden…",
    fr: "Chargement…",
    pt: "Carregando…",
  },
  no_local_db: {
    it: "Database locale non trovato. Avvia il team almeno una volta per generare",
    en: "Local database not found. Start the team at least once to generate",
    hu: "A helyi adatbázis nem található. Indítsd el a csapatot legalább egyszer a létrehozásához:",
    es: "Base de datos local no encontrada. Inicia el equipo al menos una vez para generar",
    de: "Lokale Datenbank nicht gefunden. Starte das Team mindestens einmal, um zu generieren",
    fr: "Base de données locale introuvable. Démarrez l'équipe au moins une fois pour générer",
    pt: "Banco de dados local não encontrado. Inicie a equipe ao menos uma vez para gerar",
  },
  no_local_db_then: {
    it: ", poi torna qui.",
    en: ", then come back here.",
    hu: ", majd térj vissza ide.",
    es: ", luego vuelve aquí.",
    de: ", dann komm hierher zurück.",
    fr: ", puis revenez ici.",
    pt: ", depois volte aqui.",
  },
  login_to_sync: {
    it: "Accedi per sincronizzare",
    en: "Sign in to sync",
    hu: "Jelentkezz be a szinkronizáláshoz",
    es: "Inicia sesión para sincronizar",
    de: "Anmelden zum Synchronisieren",
    fr: "Connectez-vous pour synchroniser",
    pt: "Entre para sincronizar",
  },
  login_desc: {
    it: "Login con Google per associare il sync al tuo account. I dati vanno solo nel tuo spazio cloud, protetti da Row Level Security.",
    en: "Sign in with Google to link the sync to your account. Data goes only to your own cloud space, protected by Row Level Security.",
    hu: "Jelentkezz be Google-fiókkal, hogy a szinkronizálást a fiókodhoz kösd. Az adatok csak a saját felhőterületedre kerülnek, Row Level Security védelemmel.",
    es: "Inicia sesión con Google para vincular la sincronización a tu cuenta. Los datos van solo a tu propio espacio en la nube, protegidos por Row Level Security.",
    de: "Mit Google anmelden, um die Synchronisierung mit deinem Konto zu verknüpfen. Die Daten gehen nur in deinen eigenen Cloud-Bereich, geschützt durch Row Level Security.",
    fr: "Connectez-vous avec Google pour lier la synchronisation à votre compte. Les données vont uniquement dans votre propre espace cloud, protégé par Row Level Security.",
    pt: "Faça login com o Google para vincular a sincronização à sua conta. Os dados vão apenas para o seu próprio espaço na nuvem, protegidos por Row Level Security.",
  },
  login_google: {
    it: "Login con Google",
    en: "Sign in with Google",
    hu: "Bejelentkezés Google-fiókkal",
    es: "Iniciar sesión con Google",
    de: "Mit Google anmelden",
    fr: "Se connecter avec Google",
    pt: "Entrar com o Google",
  },
  connected: {
    it: "Connesso al cloud",
    en: "Connected to the cloud",
    hu: "Csatlakozva a felhőhöz",
    es: "Conectado a la nube",
    de: "Mit der Cloud verbunden",
    fr: "Connecté au cloud",
    pt: "Conectado à nuvem",
  },
  logout: {
    it: "Logout",
    en: "Log out",
    hu: "Kijelentkezés",
    es: "Cerrar sesión",
    de: "Abmelden",
    fr: "Déconnexion",
    pt: "Sair",
  },
  state: {
    it: "Stato",
    en: "Status",
    hu: "Állapot",
    es: "Estado",
    de: "Status",
    fr: "État",
    pt: "Estado",
  },
  synced_badge: {
    it: "✓ Sincronizzato",
    en: "✓ Synced",
    hu: "✓ Szinkronizálva",
    es: "✓ Sincronizado",
    de: "✓ Synchronisiert",
    fr: "✓ Synchronisé",
    pt: "✓ Sincronizado",
  },
  to_sync_badge: {
    it: "Da sincronizzare",
    en: "Needs sync",
    hu: "Szinkronizálandó",
    es: "Por sincronizar",
    de: "Zu synchronisieren",
    fr: "À synchroniser",
    pt: "A sincronizar",
  },
  last_sync: {
    it: "Ultimo sync:",
    en: "Last sync:",
    hu: "Utolsó szinkron:",
    es: "Última sincronización:",
    de: "Letzte Synchronisierung:",
    fr: "Dernière synchro :",
    pt: "Última sincronização:",
  },
  never_synced: {
    it: "Mai sincronizzato",
    en: "Never synced",
    hu: "Még soha nem szinkronizálva",
    es: "Nunca sincronizado",
    de: "Noch nie synchronisiert",
    fr: "Jamais synchronisé",
    pt: "Nunca sincronizado",
  },
  cloud_suffix: {
    it: "cloud",
    en: "cloud",
    hu: "felhő",
    es: "nube",
    de: "Cloud",
    fr: "cloud",
    pt: "nuvem",
  },
  syncing: {
    it: "Sincronizzando…",
    en: "Syncing…",
    hu: "Szinkronizálás…",
    es: "Sincronizando…",
    de: "Synchronisiere…",
    fr: "Synchronisation…",
    pt: "Sincronizando…",
  },
  sync_now: {
    it: "Sync now",
    en: "Sync now",
    hu: "Szinkronizálás most",
    es: "Sincronizar ahora",
    de: "Jetzt synchronisieren",
    fr: "Synchroniser maintenant",
    pt: "Sincronizar agora",
  },
  nothing_to_sync: {
    it: "Nessun dato locale da sincronizzare.",
    en: "No local data to sync.",
    hu: "Nincs helyi adat a szinkronizáláshoz.",
    es: "No hay datos locales para sincronizar.",
    de: "Keine lokalen Daten zum Synchronisieren.",
    fr: "Aucune donnée locale à synchroniser.",
    pt: "Nenhum dado local para sincronizar.",
  },
  synced_prefix: {
    it: "✓ Sincronizzato —",
    en: "✓ Synced —",
    hu: "✓ Szinkronizálva —",
    es: "✓ Sincronizado —",
    de: "✓ Synchronisiert —",
    fr: "✓ Synchronisé —",
    pt: "✓ Sincronizado —",
  },
};

interface LocalHealth {
  local: boolean;
  logged_in: boolean;
  user_email: string | null;
  user_id: string | null;
}

interface SyncResult {
  empty: boolean;
  positions: { upserted: number };
  scores: { upserted: number };
  applications: { upserted: number };
  payload?: { positions: number; scores: number; applications: number };
}

type SyncState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "success"; result: SyncResult; at: number }
  | { status: "error"; message: string };

interface SyncStatus {
  local: boolean;
  logged_in: boolean;
  last_sync: {
    at: string;
    summary: {
      positions: { upserted: number; payload: number };
      scores: { upserted: number; payload: number };
      applications: { upserted: number; payload: number };
    };
  } | null;
  local_counts: SyncCounts;
  cloud_counts: SyncCounts;
  in_sync: boolean;
}

function formatRelativeTime(iso: string, tr: (k: string) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return tr("in_future");
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60)
    return sec <= 5
      ? tr("few_seconds_ago")
      : tr("sec_ago").replace("{n}", String(sec));
  const min = Math.floor(sec / 60);
  if (min < 60)
    return min === 1
      ? tr("min_ago_one")
      : tr("min_ago").replace("{n}", String(min));
  const hr = Math.floor(min / 60);
  if (hr < 24)
    return hr === 1
      ? tr("hour_ago_one")
      : tr("hour_ago").replace("{n}", String(hr));
  const days = Math.floor(hr / 24);
  return days === 1
    ? tr("day_ago_one")
    : tr("day_ago").replace("{n}", String(days));
}

export default function CloudSyncClient() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [health, setHealth] = useState<LocalHealth | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ status: "idle" });
  const [authError, setAuthError] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  async function refreshHealth() {
    try {
      const res = await fetch("/api/local/health");
      const data: LocalHealth = await res.json();
      setHealth(data);
    } catch {
      setHealth({
        local: false,
        logged_in: false,
        user_email: null,
        user_id: null,
      });
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch("/api/local/sync/status");
      if (!res.ok) return;
      const data: SyncStatus = await res.json();
      setStatus(data);
    } catch {
      /* offline o errore: lascia ultimo stato */
    }
  }

  useEffect(() => {
    refreshHealth();
    refreshStatus();
    // [JHT-NO-CLIENT-POLLING] Pagina di stato: refresh al rientro del tab +
    // interval lento (60s) solo mentre è visibile. È l'unica pagina cloud
    // con un interval e serve a vedere il "last sync" muoversi da soli.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refreshStatus();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, []);

  async function handleLogin() {
    setAuthError(null);
    const supabase = createClient();
    const redirectBase = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${redirectBase}/auth/callback?next=/settings/cloud-sync`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) setAuthError(error.message);
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setSyncState({ status: "idle" });
    await refreshHealth();
  }

  async function handleSync() {
    setSyncState({ status: "syncing" });
    try {
      const res = await fetch("/api/local/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSyncState({
          status: "error",
          message: data.error || `HTTP ${res.status}`,
        });
        return;
      }
      setSyncState({
        status: "success",
        result: data as SyncResult,
        at: Date.now(),
      });
      // Aggiorna stato dopo successo per riflettere "ultimo sync = ora".
      await refreshStatus();
    } catch (err) {
      setSyncState({
        status: "error",
        message: err instanceof Error ? err.message : tr("net_error"),
      });
    }
  }

  return (
    <div className="min-h-screen px-5 py-8 max-w-2xl mx-auto">
      <header className="mb-8">
        <h1 className="text-xl font-medium tracking-tight text-[var(--color-white)] mb-1">
          Cloud Sync
        </h1>
        <p className="text-[var(--color-dim)] text-[11px]">{tr("subtitle")}</p>
      </header>

      {!health && (
        <div className="text-[11px] text-[var(--color-dim)]">
          {tr("loading")}
        </div>
      )}

      {health && !health.local && (
        <div className="p-4 border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-[11px] text-[var(--color-dim)]">
            {tr("no_local_db")}
            <code className="text-[var(--color-bright)]"> ~/.jht/jobs.db</code>
            {tr("no_local_db_then")}
          </div>
        </div>
      )}

      {health && health.local && !health.logged_in && (
        <div className="p-5 border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-[12px] text-[var(--color-bright)] font-medium mb-1">
            {tr("login_to_sync")}
          </div>
          <div className="text-[11px] text-[var(--color-dim)] mb-4">
            {tr("login_desc")}
          </div>
          <button
            onClick={handleLogin}
            className="px-4 py-2 border border-[var(--color-border)] text-[12px] font-medium text-[var(--color-bright)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
          >
            {tr("login_google")}
          </button>
          {authError && (
            <div
              className="mt-3 text-[11px]"
              style={{ color: "var(--color-red)" }}
            >
              {authError}
            </div>
          )}
        </div>
      )}

      {health && health.local && health.logged_in && (
        <div className="p-5 border border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="text-[12px] text-[var(--color-bright)] font-medium truncate">
                {health.user_email}
              </div>
              <div className="text-[10px] text-[var(--color-dim)] mt-0.5">
                {tr("connected")}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 border border-[var(--color-border)] text-[10px] text-[var(--color-dim)] hover:border-[var(--color-red)] hover:text-[var(--color-red)] transition-colors cursor-pointer"
            >
              {tr("logout")}
            </button>
          </div>

          {/* Stato sync — ultimo sync, count locale vs cloud, badge in/out of sync */}
          {status && (
            <div className="mb-4 p-3 border border-[var(--color-border)] bg-[rgba(0,0,0,0.2)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-dim)]">
                  {tr("state")}
                </span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{
                    color: status.in_sync
                      ? "var(--color-green)"
                      : "var(--color-yellow, #d4a85a)",
                    border: `1px solid ${status.in_sync ? "var(--color-green)" : "var(--color-yellow, #d4a85a)"}`,
                  }}
                >
                  {status.in_sync ? tr("synced_badge") : tr("to_sync_badge")}
                </span>
              </div>
              <div className="text-[11px] text-[var(--color-bright)] mb-1">
                {status.last_sync ? (
                  <>
                    {tr("last_sync")}{" "}
                    <span className="text-[var(--color-dim)]">
                      {formatRelativeTime(status.last_sync.at, tr)}
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--color-dim)]">
                    {tr("never_synced")}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] mt-2">
                {(["positions", "scores", "applications"] as const).map((t) => {
                  const local = status.local_counts[t];
                  const cloud = status.cloud_counts[t];
                  const eq = local === cloud;
                  return (
                    <div key={t} className="flex flex-col">
                      <span className="text-[var(--color-dim)] uppercase tracking-wider">
                        {t}
                      </span>
                      <span
                        style={{
                          color: eq
                            ? "var(--color-bright)"
                            : "var(--color-yellow, #d4a85a)",
                        }}
                      >
                        {local} / {cloud} {tr("cloud_suffix")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={handleSync}
            disabled={syncState.status === "syncing"}
            className="w-full px-4 py-3 border border-[var(--color-green)] text-[12px] font-medium text-[var(--color-green)] hover:bg-[var(--color-green)] hover:text-[var(--color-bg)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncState.status === "syncing" ? tr("syncing") : tr("sync_now")}
          </button>

          {syncState.status === "success" && (
            <div className="mt-3 text-[11px] text-[var(--color-green)]">
              {syncState.result.empty ? (
                <>{tr("nothing_to_sync")}</>
              ) : (
                <>
                  {tr("synced_prefix")} positions{" "}
                  {syncState.result.positions.upserted}
                  {syncState.result.payload
                    ? `/${syncState.result.payload.positions}`
                    : ""}
                  {" · "}scores {syncState.result.scores.upserted}
                  {syncState.result.payload
                    ? `/${syncState.result.payload.scores}`
                    : ""}
                  {" · "}applications {syncState.result.applications.upserted}
                  {syncState.result.payload
                    ? `/${syncState.result.payload.applications}`
                    : ""}
                </>
              )}
            </div>
          )}

          {syncState.status === "error" && (
            <div
              className="mt-3 text-[11px]"
              style={{ color: "var(--color-red)" }}
            >
              {syncState.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
