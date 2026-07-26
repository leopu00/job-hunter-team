/**
 * Dizionario i18n condiviso per il wizard di setup
 * (app/(protected)/setup/**). Modulo "neutro" (no "use client"): importabile
 * sia dai client component (page.tsx, Step*.tsx, ui.tsx) sia dalle funzioni
 * di validazione in providers.ts.
 *
 * Copre tutte e 7 le lingue supportate (vedi i18n/config). Fallback in t():
 * lingua scelta -> italiano -> chiave grezza.
 *
 * NB: brand e tecnicismi non si traducono (API Key, Bot Token, Telegram,
 * @BotFather, Subscription, ~/.jht/jht.config.json, Chat ID, nomi provider,
 * Next.js).
 */
import type { Locale } from "@/i18n/config";
import type { LocaleDict } from "@/lib/i18n-dict";

// Tutte e sette le lingue obbligatorie. Prima il tipo era
// `Partial<Record<Locale, string>> & { it: string }`, cioè permetteva
// di dimenticarne sei su sette senza che nulla protestasse. Le voci
// erano comunque complete: ora è il compilatore a garantirlo.
type Entry = LocaleDict;

// Esportato per la verifica di completezza in tests/js/i18n.
export const T: Record<string, Entry> = {
  // ── Step labels (page.tsx) ───────────────────────────────────────
  step_prereq: {
    it: "Prerequisiti",
    en: "Prerequisites",
    es: "Requisitos",
    fr: "Prérequis",
    de: "Voraussetzungen",
    hu: "Előfeltételek",
    pt: "Pré-requisitos",
  },
  step_model: {
    it: "Modello",
    en: "Model",
    es: "Modelo",
    fr: "Modèle",
    de: "Modell",
    hu: "Modell",
    pt: "Modelo",
  },
  step_apikey: {
    it: "API Key",
    en: "API Key",
    es: "API Key",
    fr: "API Key",
    de: "API Key",
    hu: "API Key",
    pt: "API Key",
  },
  step_health: {
    it: "Health",
    en: "Health",
    es: "Health",
    fr: "Health",
    de: "Health",
    hu: "Health",
    pt: "Health",
  },

  // ── Step labels (ui.tsx StepBar) ─────────────────────────────────

  // ── Pulsanti navigazione ─────────────────────────────────────────
  nav_continue: {
    it: "Continua",
    en: "Continue",
    es: "Continuar",
    fr: "Continuer",
    de: "Weiter",
    hu: "Folytatás",
    pt: "Continuar",
  },
  nav_back: {
    it: "Indietro",
    en: "Back",
    es: "Atrás",
    fr: "Retour",
    de: "Zurück",
    hu: "Vissza",
    pt: "Voltar",
  },

  // ── Header / footer ──────────────────────────────────────────────
  brand_setup: {
    it: "setup",
    en: "setup",
    es: "setup",
    fr: "setup",
    de: "setup",
    hu: "setup",
    pt: "setup",
  },

  // ── page.tsx: prereq ─────────────────────────────────────────────
  prereq_title: {
    it: "Prerequisiti",
    en: "Prerequisites",
    es: "Requisitos",
    fr: "Prérequis",
    de: "Voraussetzungen",
    hu: "Előfeltételek",
    pt: "Pré-requisitos",
  },
  prereq_sub: {
    it: "Verifica automatica ambiente",
    en: "Automatic environment check",
    es: "Verificación automática del entorno",
    fr: "Vérification automatique de l'environnement",
    de: "Automatische Umgebungsprüfung",
    hu: "Környezet automatikus ellenőrzése",
    pt: "Verificação automática do ambiente",
  },
  prereq_checking: {
    it: "Controllo in corso…",
    en: "Checking…",
    es: "Comprobando…",
    fr: "Vérification en cours…",
    de: "Prüfung läuft…",
    hu: "Ellenőrzés folyamatban…",
    pt: "A verificar…",
  },
  check_browser: {
    it: "Browser moderno",
    en: "Modern browser",
    es: "Navegador moderno",
    fr: "Navigateur moderne",
    de: "Moderner Browser",
    hu: "Modern böngésző",
    pt: "Navegador moderno",
  },
  check_api_reachable: {
    it: "API server raggiungibile",
    en: "API server reachable",
    es: "Servidor API accesible",
    fr: "Serveur API accessible",
    de: "API-Server erreichbar",
    hu: "API-szerver elérhető",
    pt: "Servidor API acessível",
  },
  check_config: {
    it: "Config ~/.jht/jht.config.json",
    en: "Config ~/.jht/jht.config.json",
    es: "Config ~/.jht/jht.config.json",
    fr: "Config ~/.jht/jht.config.json",
    de: "Config ~/.jht/jht.config.json",
    hu: "Config ~/.jht/jht.config.json",
    pt: "Config ~/.jht/jht.config.json",
  },
  check_config_will_create: {
    it: "Verrà creata al completamento",
    en: "Will be created on completion",
    es: "Se creará al finalizar",
    fr: "Sera créé à la fin",
    de: "Wird beim Abschluss erstellt",
    hu: "A befejezéskor jön létre",
    pt: "Será criado ao concluir",
  },
  check_api_fail_hint: {
    it: "Verifica che Next.js sia avviato",
    en: "Make sure Next.js is running",
    es: "Verifica que Next.js esté en ejecución",
    fr: "Vérifiez que Next.js est démarré",
    de: "Stellen Sie sicher, dass Next.js läuft",
    hu: "Ellenőrizd, hogy a Next.js fut-e",
    pt: "Verifica se o Next.js está em execução",
  },

  // ── page.tsx: model step ─────────────────────────────────────────
  model_title: {
    it: "Modello AI",
    en: "AI Model",
    es: "Modelo de IA",
    fr: "Modèle IA",
    de: "KI-Modell",
    hu: "AI-modell",
    pt: "Modelo de IA",
  },
  model_sub: {
    it: "Provider e modello LLM",
    en: "Provider and LLM model",
    es: "Proveedor y modelo LLM",
    fr: "Fournisseur et modèle LLM",
    de: "Anbieter und LLM-Modell",
    hu: "Szolgáltató és LLM-modell",
    pt: "Provedor e modelo LLM",
  },
  lbl_provider: {
    it: "Provider",
    en: "Provider",
    es: "Proveedor",
    fr: "Fournisseur",
    de: "Anbieter",
    hu: "Szolgáltató",
    pt: "Provedor",
  },
  lbl_model: {
    it: "Modello",
    en: "Model",
    es: "Modelo",
    fr: "Modèle",
    de: "Modell",
    hu: "Modell",
    pt: "Modelo",
  },
  aria_provider: {
    it: "Provider AI",
    en: "AI provider",
    es: "Proveedor de IA",
    fr: "Fournisseur IA",
    de: "KI-Anbieter",
    hu: "AI-szolgáltató",
    pt: "Provedor de IA",
  },
  aria_model: {
    it: "Modello AI",
    en: "AI model",
    es: "Modelo de IA",
    fr: "Modèle IA",
    de: "KI-Modell",
    hu: "AI-modell",
    pt: "Modelo de IA",
  },
  auto_option: {
    it: "— automatico —",
    en: "— automatic —",
    es: "— automático —",
    fr: "— automatique —",
    de: "— automatisch —",
    hu: "— automatikus —",
    pt: "— automático —",
  },

  // ── page.tsx: apikey step ────────────────────────────────────────
  apikey_title: {
    it: "API Key",
    en: "API Key",
    es: "API Key",
    fr: "API Key",
    de: "API Key",
    hu: "API Key",
    pt: "API Key",
  },
  lbl_api_key: {
    it: "Chiave API",
    en: "API key",
    es: "Clave API",
    fr: "Clé API",
    de: "API-Schlüssel",
    hu: "API-kulcs",
    pt: "Chave API",
  },
  apikey_for: {
    it: "Chiave per",
    en: "Key for",
    es: "Clave para",
    fr: "Clé pour",
    de: "Schlüssel für",
    hu: "Kulcs ehhez:",
    pt: "Chave para",
  },
  apikey_saved_in: {
    it: "Salvata in ~/.jht/jht.config.json",
    en: "Saved in ~/.jht/jht.config.json",
    es: "Guardada en ~/.jht/jht.config.json",
    fr: "Enregistrée dans ~/.jht/jht.config.json",
    de: "Gespeichert in ~/.jht/jht.config.json",
    hu: "Mentve ide: ~/.jht/jht.config.json",
    pt: "Salva em ~/.jht/jht.config.json",
  },
  nav_save_verify: {
    it: "Salva e verifica",
    en: "Save and verify",
    es: "Guardar y verificar",
    fr: "Enregistrer et vérifier",
    de: "Speichern und prüfen",
    hu: "Mentés és ellenőrzés",
    pt: "Salvar e verificar",
  },

  // ── page.tsx: health step ────────────────────────────────────────
  health_title: {
    it: "Health Check",
    en: "Health Check",
    es: "Health Check",
    fr: "Health Check",
    de: "Health Check",
    hu: "Health Check",
    pt: "Health Check",
  },
  health_sub: {
    it: "Verifica salvataggio configurazione",
    en: "Verify configuration saving",
    es: "Verifica el guardado de la configuración",
    fr: "Vérifie l'enregistrement de la configuration",
    de: "Speichern der Konfiguration prüfen",
    hu: "Konfiguráció mentésének ellenőrzése",
    pt: "Verificar o salvamento da configuração",
  },
  health_saving: {
    it: "Salvataggio in corso…",
    en: "Saving…",
    es: "Guardando…",
    fr: "Enregistrement en cours…",
    de: "Wird gespeichert…",
    hu: "Mentés folyamatban…",
    pt: "A salvar…",
  },
  health_config_saved: {
    it: "Configurazione salvata.",
    en: "Configuration saved.",
    es: "Configuración guardada.",
    fr: "Configuration enregistrée.",
    de: "Konfiguration gespeichert.",
    hu: "Konfiguráció mentve.",
    pt: "Configuração salva.",
  },
  health_needs_local: {
    it: "Questa funzione richiede il server locale",
    en: "This feature requires the local server",
    es: "Esta función requiere el servidor local",
    fr: "Cette fonction nécessite le serveur local",
    de: "Diese Funktion erfordert den lokalen Server",
    hu: "Ehhez a funkcióhoz a helyi szerver szükséges",
    pt: "Esta função requer o servidor local",
  },
  health_not_saved: {
    it: "Configurazione non salvata",
    en: "Configuration not saved",
    es: "Configuración no guardada",
    fr: "Configuration non enregistrée",
    de: "Konfiguration nicht gespeichert",
    hu: "A konfiguráció nincs mentve",
    pt: "Configuração não salva",
  },
  health_local_hint: {
    it: "Il salvataggio su disco richiede l'app in esecuzione sul tuo computer. Puoi comunque proseguire alla dashboard.",
    en: "Saving to disk requires the app running on your computer. You can still continue to the dashboard.",
    es: "Guardar en disco requiere la app en ejecución en tu ordenador. Aun así puedes continuar al panel.",
    fr: "L'enregistrement sur disque nécessite l'application en cours d'exécution sur votre ordinateur. Vous pouvez tout de même continuer vers le tableau de bord.",
    de: "Das Speichern auf der Festplatte erfordert die laufende App auf Ihrem Computer. Sie können trotzdem zum Dashboard fortfahren.",
    hu: "A lemezre mentéshez a számítógépeden futó alkalmazás szükséges. Az irányítópultra így is továbbléphetsz.",
    pt: "Salvar no disco requer o aplicativo em execução no seu computador. Ainda assim, podes continuar para o painel.",
  },
  health_provider_line: {
    it: "Provider",
    en: "Provider",
    es: "Proveedor",
    fr: "Fournisseur",
    de: "Anbieter",
    hu: "Szolgáltató",
    pt: "Provedor",
  },
  nav_retry: {
    it: "Riprova",
    en: "Retry",
    es: "Reintentar",
    fr: "Réessayer",
    de: "Wiederholen",
    hu: "Újra",
    pt: "Tentar novamente",
  },
  nav_go_dashboard: {
    it: "Vai alla dashboard",
    en: "Go to dashboard",
    es: "Ir al panel",
    fr: "Aller au tableau de bord",
    de: "Zum Dashboard",
    hu: "Irány az irányítópult",
    pt: "Ir para o painel",
  },

  // ── page.tsx: save errors ────────────────────────────────────────
  err_save: {
    it: "Errore salvataggio",
    en: "Save error",
    es: "Error al guardar",
    fr: "Erreur d'enregistrement",
    de: "Speicherfehler",
    hu: "Mentési hiba",
    pt: "Erro ao salvar",
  },
  err_network: {
    it: "Errore di rete",
    en: "Network error",
    es: "Error de red",
    fr: "Erreur réseau",
    de: "Netzwerkfehler",
    hu: "Hálózati hiba",
    pt: "Erro de rede",
  },

  // ── StepProvider ─────────────────────────────────────────────────

  // ── StepModel ────────────────────────────────────────────────────

  // ── StepAuth ─────────────────────────────────────────────────────

  // ── StepTelegram ─────────────────────────────────────────────────

  // ── StepSummary ──────────────────────────────────────────────────

  // ── providers.ts: hint ───────────────────────────────────────────

  // ── providers.ts: validation ─────────────────────────────────────
};

/** Risolve una chiave semplice. */
export function t(key: keyof typeof T | string, locale: Locale): string {
  const entry = T[key as string];
  if (!entry) return key as string;
  return entry[locale] ?? entry.it;
}
