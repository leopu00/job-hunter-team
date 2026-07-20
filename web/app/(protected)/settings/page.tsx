"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Tabs, Tab } from "../../components/Tabs";
import { useToast } from "../../components/Toast";
import SettingsProfile from "../../components/SettingsProfile";
import WorkHoursPicker from "../../components/WorkHoursPicker";
import { DarkModeToggle } from "@/app/theme-provider";
import { AVAILABLE_CURRENCIES, BASE_CURRENCIES } from "@/lib/exchange-rates";
import { useLocale } from "@/lib/use-locale";
import { useIsCloud } from "@/app/hooks/useIsCloud";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  saving: {
    it: "Salvataggio…",
    en: "Saving…",
    hu: "Mentés…",
    es: "Guardando…",
    de: "Wird gespeichert…",
    fr: "Enregistrement…",
    pt: "A guardar…",
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
  loading: {
    it: "Caricamento…",
    en: "Loading…",
    hu: "Betöltés…",
    es: "Cargando…",
    de: "Wird geladen…",
    fr: "Chargement…",
    pt: "A carregar…",
  },
  settings_saved: {
    it: "Impostazioni salvate",
    en: "Settings saved",
    hu: "Beállítások mentve",
    es: "Ajustes guardados",
    de: "Einstellungen gespeichert",
    fr: "Paramètres enregistrés",
    pt: "Definições guardadas",
  },
  error: {
    it: "Errore",
    en: "Error",
    hu: "Hiba",
    es: "Error",
    de: "Fehler",
    fr: "Erreur",
    pt: "Erro",
  },
  network_error: {
    it: "Errore di rete",
    en: "Network error",
    hu: "Hálózati hiba",
    es: "Error de red",
    de: "Netzwerkfehler",
    fr: "Erreur réseau",
    pt: "Erro de rede",
  },
  action_done: {
    it: "{label} completato",
    en: "{label} completed",
    hu: "{label} kész",
    es: "{label} completado",
    de: "{label} abgeschlossen",
    fr: "{label} terminé",
    pt: "{label} concluído",
  },
  dashboard: {
    it: "Dashboard",
    en: "Dashboard",
    hu: "Vezérlőpult",
    es: "Panel",
    de: "Dashboard",
    fr: "Tableau de bord",
    pt: "Painel",
  },
  settings: {
    it: "Impostazioni",
    en: "Settings",
    hu: "Beállítások",
    es: "Ajustes",
    de: "Einstellungen",
    fr: "Paramètres",
    pt: "Definições",
  },
  theme: {
    it: "Tema",
    en: "Theme",
    hu: "Téma",
    es: "Tema",
    de: "Design",
    fr: "Thème",
    pt: "Tema",
  },
  tab_profile: {
    it: "Profilo",
    en: "Profile",
    hu: "Profil",
    es: "Perfil",
    de: "Profil",
    fr: "Profil",
    pt: "Perfil",
  },
  tab_general: {
    it: "Generale",
    en: "General",
    hu: "Általános",
    es: "General",
    de: "Allgemein",
    fr: "Général",
    pt: "Geral",
  },
  tab_working_hours: {
    it: "Orari di lavoro",
    en: "Working hours",
    hu: "Munkaidő",
    es: "Horario laboral",
    de: "Arbeitszeiten",
    fr: "Heures de travail",
    pt: "Horário de trabalho",
  },
  tab_currencies: {
    it: "Valute",
    en: "Currencies",
    hu: "Pénznemek",
    es: "Monedas",
    de: "Währungen",
    fr: "Devises",
    pt: "Moedas",
  },
  tab_notifications: {
    it: "Notifiche",
    en: "Notifications",
    hu: "Értesítések",
    es: "Notificaciones",
    de: "Benachrichtigungen",
    fr: "Notifications",
    pt: "Notificações",
  },
  tab_security: {
    it: "Sicurezza",
    en: "Security",
    hu: "Biztonság",
    es: "Seguridad",
    de: "Sicherheit",
    fr: "Sécurité",
    pt: "Segurança",
  },
  tab_danger: {
    it: "Danger Zone",
    en: "Danger Zone",
    hu: "Veszélyzóna",
    es: "Zona de peligro",
    de: "Gefahrenzone",
    fr: "Zone de danger",
    pt: "Zona de perigo",
  },
  app_name: {
    it: "Nome applicazione",
    en: "Application name",
    hu: "Alkalmazás neve",
    es: "Nombre de la aplicación",
    de: "Anwendungsname",
    fr: "Nom de l'application",
    pt: "Nome da aplicação",
  },
  default_language: {
    it: "Lingua default",
    en: "Default language",
    hu: "Alapértelmezett nyelv",
    es: "Idioma predeterminado",
    de: "Standardsprache",
    fr: "Langue par défaut",
    pt: "Idioma padrão",
  },
  language: {
    it: "Lingua",
    en: "Language",
    hu: "Nyelv",
    es: "Idioma",
    de: "Sprache",
    fr: "Langue",
    pt: "Idioma",
  },
  cur_intro_a: {
    it: "Le valute selezionate appariranno nel selettore del grafico",
    en: "The selected currencies will appear in the selector of the",
    hu: "A kiválasztott pénznemek megjelennek a",
    es: "Las monedas seleccionadas aparecerán en el selector del gráfico",
    de: "Die ausgewählten Währungen erscheinen im Auswahlmenü des Diagramms",
    fr: "Les devises sélectionnées apparaîtront dans le sélecteur du graphique",
    pt: "As moedas selecionadas aparecerão no seletor do gráfico",
  },
  cur_intro_chart: {
    it: "Distribuzione Stipendi",
    en: "Salary Distribution",
    hu: "Fizetéseloszlás",
    es: "Distribución salarial",
    de: "Gehaltsverteilung",
    fr: "Répartition des salaires",
    pt: "Distribuição salarial",
  },
  cur_intro_b: {
    it: "chart. EUR, USD e GBP sono sempre disponibili; aggiungine altre (es. il fiorino ungherese) per convertire le stime nella valuta che preferisci.",
    en: "chart. EUR, USD and GBP are always available; add others (e.g. the Hungarian forint) to convert estimates into the currency you prefer.",
    hu: "diagram szelektorában. Az EUR, USD és GBP mindig elérhető; adj hozzá továbbiakat (pl. a magyar forintot), hogy a becsléseket a kívánt pénznemre váltsd át.",
    es: "EUR, USD y GBP están siempre disponibles; añade otras (p. ej. el florín húngaro) para convertir las estimaciones a la moneda que prefieras.",
    de: ". EUR, USD und GBP sind immer verfügbar; füge weitere hinzu (z. B. den ungarischen Forint), um die Schätzungen in die gewünschte Währung umzurechnen.",
    fr: ". L'EUR, l'USD et la GBP sont toujours disponibles ; ajoutez-en d'autres (par ex. le forint hongrois) pour convertir les estimations dans la devise de votre choix.",
    pt: ". EUR, USD e GBP estão sempre disponíveis; adicione outras (ex. o florim húngaro) para converter as estimativas na moeda que preferir.",
  },
  cur_search_ph: {
    it: "Cerca valuta (codice o nome)…",
    en: "Search currency (code or name)…",
    hu: "Pénznem keresése (kód vagy név)…",
    es: "Buscar moneda (código o nombre)…",
    de: "Währung suchen (Code oder Name)…",
    fr: "Rechercher une devise (code ou nom)…",
    pt: "Procurar moeda (código ou nome)…",
  },
  cur_search_aria: {
    it: "Cerca valuta",
    en: "Search currency",
    hu: "Pénznem keresése",
    es: "Buscar moneda",
    de: "Währung suchen",
    fr: "Rechercher une devise",
    pt: "Procurar moeda",
  },
  cur_always_available: {
    it: "Sempre disponibile",
    en: "Always available",
    hu: "Mindig elérhető",
    es: "Siempre disponible",
    de: "Immer verfügbar",
    fr: "Toujours disponible",
    pt: "Sempre disponível",
  },
  cur_base: {
    it: "base",
    en: "base",
    hu: "alap",
    es: "base",
    de: "Basis",
    fr: "base",
    pt: "base",
  },
  channels: {
    it: "Canali",
    en: "Channels",
    hu: "Csatornák",
    es: "Canales",
    de: "Kanäle",
    fr: "Canaux",
    pt: "Canais",
  },
  notif_desktop: {
    it: "Desktop (browser)",
    en: "Desktop (browser)",
    hu: "Asztali (böngésző)",
    es: "Escritorio (navegador)",
    de: "Desktop (Browser)",
    fr: "Bureau (navigateur)",
    pt: "Computador (navegador)",
  },
  new_password: {
    it: "Nuova password",
    en: "New password",
    hu: "Új jelszó",
    es: "Nueva contraseña",
    de: "Neues Passwort",
    fr: "Nouveau mot de passe",
    pt: "Nova palavra-passe",
  },
  next_version: {
    it: "Disponibile in una prossima versione",
    en: "Available in a future version",
    hu: "Egy következő verzióban lesz elérhető",
    es: "Disponible en una próxima versión",
    de: "In einer kommenden Version verfügbar",
    fr: "Disponible dans une prochaine version",
    pt: "Disponível numa versão futura",
  },
  coming_soon: {
    it: "Presto disponibile",
    en: "Coming soon",
    hu: "Hamarosan",
    es: "Próximamente",
    de: "Demnächst verfügbar",
    fr: "Bientôt disponible",
    pt: "Em breve",
  },
  totp_hint: {
    it: "2FA via TOTP (Google Authenticator)",
    en: "2FA via TOTP (Google Authenticator)",
    hu: "Kétlépcsős azonosítás TOTP-vel (Google Authenticator)",
    es: "2FA mediante TOTP (Google Authenticator)",
    de: "2FA über TOTP (Google Authenticator)",
    fr: "2FA via TOTP (Google Authenticator)",
    pt: "2FA via TOTP (Google Authenticator)",
  },
  danger_warning: {
    it: "Attenzione — azioni irreversibili",
    en: "Warning — irreversible actions",
    hu: "Figyelem — visszafordíthatatlan műveletek",
    es: "Atención — acciones irreversibles",
    de: "Achtung — unwiderrufliche Aktionen",
    fr: "Attention — actions irréversibles",
    pt: "Atenção — ações irreversíveis",
  },
  reset_config_label: {
    it: "Reset configurazione",
    en: "Reset configuration",
    hu: "Konfiguráció visszaállítása",
    es: "Restablecer configuración",
    de: "Konfiguration zurücksetzen",
    fr: "Réinitialiser la configuration",
    pt: "Repor configuração",
  },
  reset_config_desc: {
    it: "Ripristina jht.config.json ai valori di default",
    en: "Restore jht.config.json to default values",
    hu: "A jht.config.json visszaállítása alapértékekre",
    es: "Restaura jht.config.json a los valores predeterminados",
    de: "Setzt jht.config.json auf die Standardwerte zurück",
    fr: "Restaure jht.config.json aux valeurs par défaut",
    pt: "Repõe jht.config.json para os valores padrão",
  },
  clear_cache_label: {
    it: "Svuota cache",
    en: "Clear cache",
    hu: "Gyorsítótár ürítése",
    es: "Vaciar caché",
    de: "Cache leeren",
    fr: "Vider le cache",
    pt: "Limpar cache",
  },
  clear_cache_desc: {
    it: "Elimina tutti i file in ~/.jht/cache/",
    en: "Delete all files in ~/.jht/cache/",
    hu: "Az összes fájl törlése a ~/.jht/cache/ mappából",
    es: "Elimina todos los archivos en ~/.jht/cache/",
    de: "Löscht alle Dateien in ~/.jht/cache/",
    fr: "Supprime tous les fichiers dans ~/.jht/cache/",
    pt: "Elimina todos os ficheiros em ~/.jht/cache/",
  },
  cloud_sync: {
    it: "Sincronizzazione cloud",
    en: "Cloud sync",
    hu: "Felhő-szinkron",
    es: "Sincronización en la nube",
    de: "Cloud-Synchronisierung",
    fr: "Synchronisation cloud",
    pt: "Sincronização na nuvem",
  },
  cloud_sync_desc: {
    it: "Gestisci i token di sincronizzazione dei tuoi dispositivi",
    en: "Manage the sync tokens of your devices",
    hu: "Kezeld az eszközeid szinkron-tokenjeit",
    es: "Gestiona los tokens de sincronización de tus dispositivos",
    de: "Verwalte die Sync-Tokens deiner Geräte",
    fr: "Gérez les jetons de synchronisation de vos appareils",
    pt: "Gerencie os tokens de sincronização dos seus dispositivos",
  },
  open: {
    it: "Apri →",
    en: "Open →",
    hu: "Megnyitás →",
    es: "Abrir →",
    de: "Öffnen →",
    fr: "Ouvrir →",
    pt: "Abrir →",
  },
};

type NotifKey = "telegram" | "email" | "desktop";
type Settings = {
  app_name: string;
  language: string;
  notifications: Record<NotifKey, boolean>;
  // Valute extra (oltre alle base EUR/USD/GBP) per il grafico stipendi.
  currencies: string[];
};

const DEFAULTS: Settings = {
  app_name: "Job Hunter Team",
  language: "it",
  notifications: { telegram: true, email: false, desktop: false },
  currencies: [],
};

const BASE = BASE_CURRENCIES as readonly string[];

const inp: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  background: "var(--color-card)",
  color: "var(--color-bright)",
  borderRadius: 6,
  fontSize: 11,
  padding: "6px 10px",
  fontFamily: "var(--font-mono)",
  width: "100%",
  transition: "border-color 0.15s",
};

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        className="text-[11px] font-semibold"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </label>
      {hint && (
        <p className="text-[9px]" style={{ color: "var(--color-dim)" }}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex items-center gap-3 cursor-pointer select-none"
      onClick={() => onChange(!checked)}
    >
      <div
        className="relative w-9 h-5 rounded-full transition-colors"
        style={{
          background: checked ? "var(--color-green)" : "var(--color-border)",
        }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{
            background: "white",
            transform: checked ? "translateX(18px)" : "translateX(2px)",
          }}
        />
      </div>
      <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
    </label>
  );
}

function SaveBtn({
  busy,
  onClick,
  savingLabel,
  saveLabel,
}: {
  busy: boolean;
  onClick: () => void;
  savingLabel: string;
  saveLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="self-start px-5 py-2 rounded text-[11px] font-bold cursor-pointer transition-all"
      style={{
        background: busy ? "var(--color-border)" : "var(--color-green)",
        color: busy ? "var(--color-dim)" : "var(--color-void)",
        border: "none",
      }}
    >
      {busy ? savingLabel : saveLabel}
    </button>
  );
}

type TabId =
  | "profile"
  | "general"
  | "working-hours"
  | "currencies"
  | "notifications"
  | "security"
  | "danger";

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loading, setL] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>("profile");
  const [curQuery, setCurQuery] = useState("");
  const { toast } = useToast();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  // [JHT-DASHBOARD-SPLIT rivisto 20/07] La pagina non è più desktop-only:
  // sul cloud si riduce alle sole sezioni che lì funzionano davvero (tema,
  // client-side, + link a cloud-sync). Le tab di config locale (jht.config,
  // orari, valute, notifiche, danger) restano solo su desktop/locale.
  const isCloud = useIsCloud();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ config }) => {
        if (config)
          setS({
            app_name: config.app?.name ?? DEFAULTS.app_name,
            language: config.app?.language ?? DEFAULTS.language,
            notifications: {
              ...DEFAULTS.notifications,
              ...config.notifications,
            },
            currencies: Array.isArray(config.dashboard?.currencies)
              ? config.dashboard.currencies.filter(
                  (c: string) => !BASE.includes(c),
                )
              : [],
          });
        setL(false);
      })
      .catch(() => setL(false));
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app: { name: s.app_name, language: s.language },
          notifications: s.notifications,
          dashboard: { currencies: s.currencies },
        }),
      });
      const d = await r.json();
      d.ok
        ? toast(tr("settings_saved"), "success")
        : toast(d.error ?? tr("error"), "error");
    } catch {
      toast(tr("network_error"), "error");
    } finally {
      setBusy(false);
    }
  }, [s, toast]);

  const dangerAction = useCallback(
    async (act: string, label: string) => {
      setBusy(true);
      try {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ _action: act }),
        });
        const d = await r.json();
        d.ok
          ? toast(tr("action_done").replace("{label}", label), "success")
          : toast(d.error ?? tr("error"), "error");
      } catch {
        toast(tr("network_error"), "error");
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  // Variante CLOUD: solo ciò che sul cloud funziona ed è utile — tema
  // (preferenza client) e gestione token di sincronizzazione.
  if (isCloud === true)
    return (
      <main
        className="min-h-screen px-6 py-10"
        style={{ animation: "fade-in 0.35s ease both" }}
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          <div>
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-2 mb-3"
            >
              <Link
                href="/dashboard"
                className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
              >
                {tr("dashboard")}
              </Link>
              <span className="text-[var(--color-border)]" aria-hidden="true">
                /
              </span>
              <span
                className="text-[10px] text-[var(--color-muted)]"
                aria-current="page"
              >
                {tr("settings")}
              </span>
            </nav>
            <h1
              className="text-xl font-bold"
              style={{ color: "var(--color-white)" }}
            >
              {tr("settings")}
            </h1>
          </div>

          <div
            className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            <p
              className="m-0 text-[11px] font-semibold"
              style={{ color: "var(--color-muted)" }}
            >
              {tr("theme")}
            </p>
            <DarkModeToggle />
          </div>

          <Link
            href="/settings/cloud-sync"
            className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg no-underline transition-colors hover:border-[var(--color-border-glow)]"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            <div>
              <p
                className="m-0 text-[11px] font-semibold"
                style={{ color: "var(--color-muted)" }}
              >
                {tr("cloud_sync")}
              </p>
              <p
                className="m-0 text-[10px]"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("cloud_sync_desc")}
              </p>
            </div>
            <span className="text-[10px] font-semibold tracking-widest uppercase shrink-0 text-[var(--color-green)]">
              {tr("open")}
            </span>
          </Link>
        </div>
      </main>
    );

  if (loading)
    return (
      <main className="p-10" role="status" aria-live="polite">
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          {tr("loading")}
        </p>
      </main>
    );

  const TABS: Tab<TabId>[] = [
    { id: "profile", label: tr("tab_profile") },
    { id: "general", label: tr("tab_general") },
    { id: "working-hours", label: tr("tab_working_hours") },
    { id: "currencies", label: tr("tab_currencies") },
    { id: "notifications", label: tr("tab_notifications") },
    { id: "security", label: tr("tab_security") },
    { id: "danger", label: tr("tab_danger") },
  ];

  return (
    <main
      className="min-h-screen px-6 py-10"
      style={{ animation: "fade-in 0.35s ease both" }}
    >
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
            <Link
              href="/dashboard"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              {tr("dashboard")}
            </Link>
            <span className="text-[var(--color-border)]" aria-hidden="true">
              /
            </span>
            <span
              className="text-[10px] text-[var(--color-muted)]"
              aria-current="page"
            >
              {tr("settings")}
            </span>
          </nav>
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--color-white)" }}
          >
            {tr("settings")}
          </h1>
        </div>

        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        <div className="flex flex-col gap-5 pt-1">
          {tab === "profile" && <SettingsProfile />}

          {tab === "general" && (
            <>
              <Row label={tr("app_name")}>
                <input
                  style={inp}
                  value={s.app_name}
                  onChange={(e) =>
                    setS((p) => ({ ...p, app_name: e.target.value }))
                  }
                  aria-label={tr("app_name")}
                />
              </Row>
              <Row label={tr("default_language")}>
                <select
                  style={inp}
                  value={s.language}
                  onChange={(e) =>
                    setS((p) => ({ ...p, language: e.target.value }))
                  }
                  aria-label={tr("language")}
                >
                  <option value="it">Italiano</option>
                  <option value="en">English</option>
                </select>
              </Row>
              <Row label={tr("theme")}>
                <DarkModeToggle />
              </Row>
              <SaveBtn
                busy={busy}
                onClick={save}
                savingLabel={tr("saving")}
                saveLabel={tr("save")}
              />
            </>
          )}

          {tab === "working-hours" && <WorkHoursPicker />}

          {tab === "currencies" && (
            <>
              <p
                className="text-[11px]"
                style={{ color: "var(--color-muted)" }}
              >
                {tr("cur_intro_a")}
                <strong> {tr("cur_intro_chart")}</strong>
                {tr("cur_intro_b")}
              </p>
              <input
                style={{ ...inp, maxWidth: 320 }}
                value={curQuery}
                onChange={(e) => setCurQuery(e.target.value)}
                placeholder={tr("cur_search_ph")}
                aria-label={tr("cur_search_aria")}
              />
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_CURRENCIES.filter((c) => {
                  const q = curQuery.trim().toLowerCase();
                  return (
                    !q ||
                    c.code.toLowerCase().includes(q) ||
                    c.name.toLowerCase().includes(q)
                  );
                }).map((c) => {
                  const isBase = BASE.includes(c.code);
                  const active = isBase || s.currencies.includes(c.code);
                  return (
                    <button
                      key={c.code}
                      type="button"
                      disabled={isBase}
                      onClick={() =>
                        setS((p) => ({
                          ...p,
                          currencies: p.currencies.includes(c.code)
                            ? p.currencies.filter((x) => x !== c.code)
                            : [...p.currencies, c.code],
                        }))
                      }
                      title={isBase ? tr("cur_always_available") : c.name}
                      className="flex items-center gap-2 px-3 py-2 rounded text-[11px] transition-colors"
                      style={{
                        border: `1px solid ${active ? "var(--color-green)" : "var(--color-border)"}`,
                        background: active
                          ? "rgba(0,232,122,0.08)"
                          : "var(--color-card)",
                        color: active
                          ? "var(--color-bright)"
                          : "var(--color-muted)",
                        cursor: isBase ? "default" : "pointer",
                        opacity: isBase ? 0.85 : 1,
                      }}
                    >
                      <span className="font-semibold tabular-nums">
                        {c.code}
                      </span>
                      <span style={{ color: "var(--color-dim)" }}>
                        {c.name}
                      </span>
                      {isBase && (
                        <span
                          className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded"
                          style={{
                            background: "var(--color-border)",
                            color: "var(--color-dim)",
                          }}
                        >
                          {tr("cur_base")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <SaveBtn
                busy={busy}
                onClick={save}
                savingLabel={tr("saving")}
                saveLabel={tr("save")}
              />
            </>
          )}
          {tab === "notifications" && (
            <>
              <p
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("channels")}
              </p>
              {(["telegram", "email", "desktop"] as NotifKey[]).map((k) => (
                <Toggle
                  key={k}
                  checked={s.notifications[k]}
                  label={
                    k === "telegram"
                      ? "Telegram"
                      : k === "email"
                        ? "Email"
                        : tr("notif_desktop")
                  }
                  onChange={(v) =>
                    setS((p) => ({
                      ...p,
                      notifications: { ...p.notifications, [k]: v },
                    }))
                  }
                />
              ))}
              <SaveBtn
                busy={busy}
                onClick={save}
                savingLabel={tr("saving")}
                saveLabel={tr("save")}
              />
            </>
          )}

          {tab === "security" && (
            <>
              <Row label={tr("new_password")} hint={tr("next_version")}>
                <input
                  type="password"
                  style={{ ...inp, opacity: 0.4, cursor: "not-allowed" }}
                  disabled
                  placeholder="••••••••"
                />
              </Row>
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <span
                  className="text-[9px] px-2 py-0.5 rounded"
                  style={{
                    background: "rgba(255,196,0,0.1)",
                    color: "var(--color-yellow)",
                    border: "1px solid rgba(255,196,0,0.2)",
                  }}
                >
                  {tr("coming_soon")}
                </span>
                <p
                  className="text-[10px]"
                  style={{ color: "var(--color-dim)" }}
                >
                  {tr("totp_hint")}
                </p>
              </div>
            </>
          )}

          {tab === "danger" && (
            <>
              <div
                className="px-4 py-3 rounded"
                style={{
                  background: "rgba(255,69,96,0.06)",
                  border: "1px solid rgba(255,69,96,0.2)",
                }}
              >
                <p
                  className="text-[10px] font-bold"
                  style={{ color: "var(--color-red)" }}
                >
                  {tr("danger_warning")}
                </p>
              </div>
              {[
                {
                  act: "reset_config",
                  label: tr("reset_config_label"),
                  desc: tr("reset_config_desc"),
                },
                {
                  act: "clear_cache",
                  label: tr("clear_cache_label"),
                  desc: tr("clear_cache_desc"),
                },
              ].map(({ act, label, desc }) => (
                <div
                  key={act}
                  className="flex items-center justify-between gap-4 px-4 py-3 rounded"
                  style={{
                    border: "1px solid var(--color-border)",
                    background: "var(--color-card)",
                  }}
                >
                  <div>
                    <p
                      className="text-[11px] font-semibold"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {label}
                    </p>
                    <p
                      className="text-[10px]"
                      style={{ color: "var(--color-dim)" }}
                    >
                      {desc}
                    </p>
                  </div>
                  <button
                    onClick={() => dangerAction(act, label)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer flex-shrink-0 transition-all"
                    style={{
                      border: "1px solid rgba(255,69,96,0.4)",
                      color: "var(--color-red)",
                      background: "transparent",
                    }}
                  >
                    {label}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
