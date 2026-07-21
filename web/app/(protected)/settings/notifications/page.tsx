"use client";

// [JHT-WEB-NOTIFICATIONS] Impostazioni notifiche browser (solo web cloud).
// Master switch + permesso browser, notifiche messaggi agenti, e regole
// configurabili sulle posizioni (trigger valutata/nuova, soglia score,
// location, paesi, keyword, work mode, digest a soglia). Le preferenze
// vengono lette/scritte DIRETTAMENTE su Supabase (RLS, mig 058) + cache
// localStorage per il runtime (useWebNotifications) e le altre tab.

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import {
  cachePrefs,
  normalizePrefs,
  DEFAULT_PREFS,
  type NotificationRule,
  type WebNotificationPrefs,
} from "@/lib/web-notifications";

const T: Record<string, Record<string, string>> = {
  breadcrumb: {
    it: "Impostazioni",
    en: "Settings",
    hu: "Beállítások",
    es: "Ajustes",
    de: "Einstellungen",
    fr: "Paramètres",
    pt: "Configurações",
  },
  title: {
    it: "Notifiche",
    en: "Notifications",
    hu: "Értesítések",
    es: "Notificaciones",
    de: "Benachrichtigungen",
    fr: "Notifications",
    pt: "Notificações",
  },
  subtitle: {
    it: "Notifiche del browser mentre il sito è aperto: messaggi dal team e posizioni che rispettano le tue regole.",
    en: "Browser notifications while the site is open: team messages and positions matching your rules.",
    hu: "Böngészőértesítések, amíg az oldal nyitva van: csapatüzenetek és a szabályaidnak megfelelő pozíciók.",
    es: "Notificaciones del navegador mientras el sitio está abierto: mensajes del equipo y posiciones que cumplen tus reglas.",
    de: "Browser-Benachrichtigungen, solange die Seite offen ist: Team-Nachrichten und Stellen, die deinen Regeln entsprechen.",
    fr: "Notifications du navigateur tant que le site est ouvert : messages de l'équipe et postes correspondant à vos règles.",
    pt: "Notificações do navegador enquanto o site está aberto: mensagens da equipe e vagas que atendem às suas regras.",
  },
  cloud_only: {
    it: "Questa sezione riguarda solo il sito cloud. In locale le notifiche vivono nell'app desktop.",
    en: "This section applies to the cloud site only. Locally, notifications live in the desktop app.",
    hu: "Ez a rész csak a felhős oldalra vonatkozik. Helyben az értesítések az asztali appban élnek.",
    es: "Esta sección solo aplica al sitio cloud. En local, las notificaciones viven en la app de escritorio.",
    de: "Dieser Bereich gilt nur für die Cloud-Seite. Lokal leben Benachrichtigungen in der Desktop-App.",
    fr: "Cette section ne concerne que le site cloud. En local, les notifications vivent dans l'app de bureau.",
    pt: "Esta seção aplica-se apenas ao site na nuvem. Localmente, as notificações vivem no app desktop.",
  },
  master: {
    it: "Abilita le notifiche del browser",
    en: "Enable browser notifications",
    hu: "Böngészőértesítések engedélyezése",
    es: "Activar notificaciones del navegador",
    de: "Browser-Benachrichtigungen aktivieren",
    fr: "Activer les notifications du navigateur",
    pt: "Ativar notificações do navegador",
  },
  perm_granted: {
    it: "Permesso del browser concesso",
    en: "Browser permission granted",
    hu: "Böngészőengedély megadva",
    es: "Permiso del navegador concedido",
    de: "Browser-Berechtigung erteilt",
    fr: "Permission du navigateur accordée",
    pt: "Permissão do navegador concedida",
  },
  perm_needed: {
    it: "Il browser chiederà il permesso all'attivazione",
    en: "The browser will ask for permission when you enable this",
    hu: "A böngésző engedélyt kér bekapcsoláskor",
    es: "El navegador pedirá permiso al activarlo",
    de: "Der Browser fragt beim Aktivieren nach der Berechtigung",
    fr: "Le navigateur demandera la permission à l'activation",
    pt: "O navegador pedirá permissão ao ativar",
  },
  perm_denied: {
    it: "Notifiche bloccate dal browser: sbloccale dalle impostazioni del sito (icona lucchetto nella barra dell'indirizzo).",
    en: "Notifications are blocked by the browser: unblock them in the site settings (padlock icon in the address bar).",
    hu: "A böngésző letiltotta az értesítéseket: engedélyezd az oldal beállításaiban (lakat ikon a címsorban).",
    es: "El navegador bloquea las notificaciones: desbloquéalas en la configuración del sitio (candado en la barra de direcciones).",
    de: "Benachrichtigungen sind im Browser blockiert: In den Website-Einstellungen freigeben (Schloss-Symbol in der Adressleiste).",
    fr: "Les notifications sont bloquées par le navigateur : débloquez-les dans les paramètres du site (cadenas dans la barre d'adresse).",
    pt: "As notificações estão bloqueadas pelo navegador: desbloqueie nas configurações do site (cadeado na barra de endereço).",
  },
  no_support: {
    it: "Questo browser non supporta le notifiche.",
    en: "This browser does not support notifications.",
    hu: "Ez a böngésző nem támogatja az értesítéseket.",
    es: "Este navegador no admite notificaciones.",
    de: "Dieser Browser unterstützt keine Benachrichtigungen.",
    fr: "Ce navigateur ne prend pas en charge les notifications.",
    pt: "Este navegador não suporta notificações.",
  },
  messages: {
    it: "Messaggi dagli agenti",
    en: "Messages from agents",
    hu: "Üzenetek az ügynököktől",
    es: "Mensajes de los agentes",
    de: "Nachrichten von Agenten",
    fr: "Messages des agents",
    pt: "Mensagens dos agentes",
  },
  messages_desc: {
    it: "Una notifica quando un agente ti scrive.",
    en: "A notification when an agent writes to you.",
    hu: "Értesítés, ha egy ügynök ír neked.",
    es: "Una notificación cuando un agente te escribe.",
    de: "Eine Benachrichtigung, wenn dir ein Agent schreibt.",
    fr: "Une notification quand un agent vous écrit.",
    pt: "Uma notificação quando um agente escreve para você.",
  },
  only_hidden: {
    it: "Solo quando la scheda non è attiva",
    en: "Only when the tab is not focused",
    hu: "Csak ha a lap nincs fókuszban",
    es: "Solo cuando la pestaña no está activa",
    de: "Nur wenn der Tab nicht aktiv ist",
    fr: "Seulement quand l'onglet n'est pas actif",
    pt: "Somente quando a aba não está ativa",
  },
  only_hidden_desc: {
    it: "Se stai già guardando il sito, niente notifica.",
    en: "If you're already looking at the site, no notification.",
    hu: "Ha épp az oldalt nézed, nincs értesítés.",
    es: "Si ya estás mirando el sitio, sin notificación.",
    de: "Wenn du die Seite gerade ansiehst, keine Benachrichtigung.",
    fr: "Si vous regardez déjà le site, pas de notification.",
    pt: "Se você já está olhando o site, sem notificação.",
  },
  rules_title: {
    it: "Regole sulle posizioni",
    en: "Position rules",
    hu: "Pozíciószabályok",
    es: "Reglas de posiciones",
    de: "Stellen-Regeln",
    fr: "Règles sur les postes",
    pt: "Regras de vagas",
  },
  rules_desc: {
    it: "Ogni regola è un insieme di condizioni in AND; dentro a ogni campo i valori sono in OR. I campi vuoti non filtrano.",
    en: "Each rule is a set of AND conditions; within a field, values are OR-ed. Empty fields don't filter.",
    hu: "Minden szabály ÉS-feltételek halmaza; egy mezőn belül az értékek VAGY kapcsolatban állnak. Az üres mezők nem szűrnek.",
    es: "Cada regla es un conjunto de condiciones en AND; dentro de un campo, los valores van en OR. Los campos vacíos no filtran.",
    de: "Jede Regel ist ein Satz UND-Bedingungen; innerhalb eines Feldes gelten ODER-Werte. Leere Felder filtern nicht.",
    fr: "Chaque règle est un ensemble de conditions en ET ; dans un champ, les valeurs sont en OU. Les champs vides ne filtrent pas.",
    pt: "Cada regra é um conjunto de condições em AND; dentro de um campo, os valores são OR. Campos vazios não filtram.",
  },
  add_rule: {
    it: "Aggiungi regola",
    en: "Add rule",
    hu: "Szabály hozzáadása",
    es: "Añadir regla",
    de: "Regel hinzufügen",
    fr: "Ajouter une règle",
    pt: "Adicionar regra",
  },
  presets: {
    it: "Esempi rapidi:",
    en: "Quick examples:",
    hu: "Gyors példák:",
    es: "Ejemplos rápidos:",
    de: "Schnelle Beispiele:",
    fr: "Exemples rapides :",
    pt: "Exemplos rápidos:",
  },
  empty_rules: {
    it: "Nessuna regola: aggiungine una o parti da un esempio.",
    en: "No rules yet: add one or start from an example.",
    hu: "Még nincs szabály: adj hozzá egyet, vagy indulj példából.",
    es: "Sin reglas: añade una o parte de un ejemplo.",
    de: "Noch keine Regeln: füge eine hinzu oder starte mit einem Beispiel.",
    fr: "Aucune règle : ajoutez-en une ou partez d'un exemple.",
    pt: "Nenhuma regra: adicione uma ou comece por um exemplo.",
  },
  rule_name: {
    it: "Nome",
    en: "Name",
    hu: "Név",
    es: "Nombre",
    de: "Name",
    fr: "Nom",
    pt: "Nome",
  },
  trigger: {
    it: "Quando",
    en: "When",
    hu: "Mikor",
    es: "Cuándo",
    de: "Wann",
    fr: "Quand",
    pt: "Quando",
  },
  trigger_scored: {
    it: "Posizione valutata (con score)",
    en: "Position scored",
    hu: "Pozíció értékelve (score)",
    es: "Posición evaluada (con score)",
    de: "Stelle bewertet (Score)",
    fr: "Poste évalué (score)",
    pt: "Vaga avaliada (score)",
  },
  trigger_new: {
    it: "Nuova posizione trovata",
    en: "New position found",
    hu: "Új pozíció találva",
    es: "Nueva posición encontrada",
    de: "Neue Stelle gefunden",
    fr: "Nouveau poste trouvé",
    pt: "Nova vaga encontrada",
  },
  min_score: {
    it: "Score minimo",
    en: "Min score",
    hu: "Min. pontszám",
    es: "Score mínimo",
    de: "Mindest-Score",
    fr: "Score minimum",
    pt: "Score mínimo",
  },
  any: {
    it: "Qualsiasi",
    en: "Any",
    hu: "Bármely",
    es: "Cualquiera",
    de: "Beliebig",
    fr: "Indifférent",
    pt: "Qualquer",
  },
  work_mode: {
    it: "Modalità",
    en: "Work mode",
    hu: "Munkamód",
    es: "Modalidad",
    de: "Arbeitsmodus",
    fr: "Mode",
    pt: "Modalidade",
  },
  wm_remote: {
    it: "Remoto",
    en: "Remote",
    hu: "Távoli",
    es: "Remoto",
    de: "Remote",
    fr: "Télétravail",
    pt: "Remoto",
  },
  wm_hybrid: {
    it: "Ibrido",
    en: "Hybrid",
    hu: "Hibrid",
    es: "Híbrido",
    de: "Hybrid",
    fr: "Hybride",
    pt: "Híbrido",
  },
  wm_onsite: {
    it: "In sede",
    en: "On-site",
    hu: "Helyszíni",
    es: "Presencial",
    de: "Vor Ort",
    fr: "Sur site",
    pt: "Presencial",
  },
  locations: {
    it: "Località",
    en: "Locations",
    hu: "Helyszínek",
    es: "Ubicaciones",
    de: "Orte",
    fr: "Lieux",
    pt: "Locais",
  },
  locations_hint: {
    it: "es. Milano, Roma — separate da virgola",
    en: "e.g. Milan, Rome — comma separated",
    hu: "pl. Milánó, Róma — vesszővel",
    es: "p. ej. Milán, Roma — separadas por coma",
    de: "z. B. Mailand, Rom — kommagetrennt",
    fr: "ex. Milan, Rome — séparés par des virgules",
    pt: "ex.: Milão, Roma — separados por vírgula",
  },
  countries: {
    it: "Paesi (codici)",
    en: "Countries (codes)",
    hu: "Országok (kódok)",
    es: "Países (códigos)",
    de: "Länder (Codes)",
    fr: "Pays (codes)",
    pt: "Países (códigos)",
  },
  countries_hint: {
    it: "es. IT, DE, NL",
    en: "e.g. IT, DE, NL",
    hu: "pl. IT, DE, NL",
    es: "p. ej. IT, DE, NL",
    de: "z. B. IT, DE, NL",
    fr: "ex. IT, DE, NL",
    pt: "ex.: IT, DE, NL",
  },
  keywords: {
    it: "Parole chiave",
    en: "Keywords",
    hu: "Kulcsszavak",
    es: "Palabras clave",
    de: "Stichwörter",
    fr: "Mots-clés",
    pt: "Palavras-chave",
  },
  keywords_hint: {
    it: "su titolo e azienda — es. react, data",
    en: "on title and company — e.g. react, data",
    hu: "címre és cégre — pl. react, data",
    es: "en título y empresa — p. ej. react, data",
    de: "auf Titel und Firma — z. B. react, data",
    fr: "sur titre et entreprise — ex. react, data",
    pt: "no título e empresa — ex.: react, data",
  },
  min_count: {
    it: "Raggruppa ogni",
    en: "Group every",
    hu: "Csoportosítás minden",
    es: "Agrupar cada",
    de: "Bündeln je",
    fr: "Grouper toutes les",
    pt: "Agrupar a cada",
  },
  min_count_hint: {
    it: "1 = subito; N = una notifica ogni N posizioni",
    en: "1 = immediately; N = one notification per N positions",
    hu: "1 = azonnal; N = egy értesítés N pozíciónként",
    es: "1 = al momento; N = una notificación cada N posiciones",
    de: "1 = sofort; N = eine Benachrichtigung pro N Stellen",
    fr: "1 = immédiat ; N = une notification toutes les N",
    pt: "1 = imediato; N = uma notificação a cada N vagas",
  },
  rule_enabled: {
    it: "Attiva",
    en: "Enabled",
    hu: "Aktív",
    es: "Activa",
    de: "Aktiv",
    fr: "Active",
    pt: "Ativa",
  },
  delete: {
    it: "Elimina",
    en: "Delete",
    hu: "Törlés",
    es: "Eliminar",
    de: "Löschen",
    fr: "Supprimer",
    pt: "Excluir",
  },
  save: {
    it: "Salva",
    en: "Save",
    hu: "Mentés",
    es: "Guardar",
    de: "Speichern",
    fr: "Enregistrer",
    pt: "Salvar",
  },
  saved: {
    it: "Salvato",
    en: "Saved",
    hu: "Mentve",
    es: "Guardado",
    de: "Gespeichert",
    fr: "Enregistré",
    pt: "Salvo",
  },
  save_error: {
    it: "Salvataggio fallito",
    en: "Save failed",
    hu: "Mentés sikertelen",
    es: "Error al guardar",
    de: "Speichern fehlgeschlagen",
    fr: "Échec de l'enregistrement",
    pt: "Falha ao salvar",
  },
  login_required: {
    it: "Accedi per configurare le notifiche.",
    en: "Sign in to configure notifications.",
    hu: "Jelentkezz be az értesítések beállításához.",
    es: "Inicia sesión para configurar las notificaciones.",
    de: "Melde dich an, um Benachrichtigungen zu konfigurieren.",
    fr: "Connectez-vous pour configurer les notifications.",
    pt: "Entre para configurar as notificações.",
  },
  test: {
    it: "Notifica di prova",
    en: "Test notification",
    hu: "Próbaértesítés",
    es: "Notificación de prueba",
    de: "Test-Benachrichtigung",
    fr: "Notification de test",
    pt: "Notificação de teste",
  },
  test_body: {
    it: "Le notifiche funzionano.",
    en: "Notifications are working.",
    hu: "Az értesítések működnek.",
    es: "Las notificaciones funcionan.",
    de: "Benachrichtigungen funktionieren.",
    fr: "Les notifications fonctionnent.",
    pt: "As notificações estão funcionando.",
  },
  preset_high: {
    it: "Score ≥ 80",
    en: "Score ≥ 80",
    hu: "Score ≥ 80",
    es: "Score ≥ 80",
    de: "Score ≥ 80",
    fr: "Score ≥ 80",
    pt: "Score ≥ 80",
  },
  preset_milano: {
    it: "Score ≥ 75 a Milano",
    en: "Score ≥ 75 in Milan",
    hu: "Score ≥ 75 Milánóban",
    es: "Score ≥ 75 en Milán",
    de: "Score ≥ 75 in Mailand",
    fr: "Score ≥ 75 à Milan",
    pt: "Score ≥ 75 em Milão",
  },
};

function newRule(partial?: Partial<NotificationRule>): NotificationRule {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    trigger: "scored",
    minScore: null,
    locations: [],
    countries: [],
    keywords: [],
    workMode: "any",
    minCount: 1,
    ...partial,
  };
}

function listToText(v: string[]): string {
  return v.join(", ");
}
function textToList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

const inputCls =
  "w-full px-2.5 py-1.5 text-[11.5px] bg-[var(--color-card)] border border-[var(--color-border)] rounded text-[var(--color-base)] focus:outline-none focus:border-[var(--color-border-glow)]";
const labelCls =
  "block text-[9px] font-semibold tracking-[0.12em] uppercase text-[var(--color-dim)] mb-1";

function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 text-left cursor-pointer py-1"
    >
      <span
        className="shrink-0 w-9 h-5 rounded-full relative transition-colors"
        style={{
          background: checked ? "var(--color-green)" : "var(--color-border)",
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-panel)] transition-all"
          style={{ left: checked ? "18px" : "2px" }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] text-[var(--color-bright)]">
          {label}
        </span>
        {desc && (
          <span className="block text-[10.5px] text-[var(--color-muted)] mt-0.5">
            {desc}
          </span>
        )}
      </span>
    </button>
  );
}

export default function NotificationSettingsPage() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const isCloud = useIsCloud();

  const [prefs, setPrefs] = useState<WebNotificationPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "ok" | "error">("idle");
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");

  useEffect(() => {
    setPermission(
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "unsupported",
    );
    const supabase = createClient();
    void (async () => {
      const { data } = (await supabase.auth.getSession()) as {
        data: { session: { user: { id: string } } | null };
      };
      setLoggedIn(!!data.session);
      if (!data.session) {
        setLoaded(true);
        return;
      }
      const res = await supabase
        .from("notification_prefs")
        .select("prefs")
        .maybeSingle();
      if (res.data?.prefs) setPrefs(normalizePrefs(res.data.prefs));
      setLoaded(true);
    })();
  }, []);

  async function handleMasterToggle(next: boolean) {
    if (next && permission === "default" && "Notification" in window) {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== "granted") return; // resta off finché il permesso non c'è
    }
    setPrefs((prev) => ({ ...prev, enabled: next }));
  }

  function updateRule(id: string, patch: Partial<NotificationRule>) {
    setPrefs((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveState("idle");
    try {
      const supabase = createClient();
      const { data } = (await supabase.auth.getSession()) as {
        data: { session: { user: { id: string } } | null };
      };
      if (!data.session) throw new Error("no session");
      const clean = normalizePrefs(prefs);
      const { error } = await supabase
        .from("notification_prefs")
        .upsert(
          { user_id: data.session.user.id, prefs: clean },
          { onConflict: "user_id" },
        );
      if (error) throw new Error(error.message);
      cachePrefs(clean); // il runtime e le altre tab si riallineano da qui
      setPrefs(clean);
      setSaveState("ok");
      window.setTimeout(() => setSaveState("idle"), 3000);
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }

  function handleTest() {
    if (permission !== "granted") return;
    try {
      new Notification("Job Hunter Team", { body: tr("test_body") });
    } catch {
      /* piattaforme senza costruttore Notification */
    }
  }

  const card =
    "border border-[var(--color-border)] bg-[var(--color-panel)] rounded-lg p-4";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/settings"
        className="text-[10px] tracking-[0.14em] uppercase text-[var(--color-dim)] hover:text-[var(--color-bright)] no-underline transition-colors"
      >
        ← {tr("breadcrumb")}
      </Link>
      <h1 className="text-[20px] font-bold tracking-[0.08em] uppercase text-[var(--color-bright)] mt-2 mb-1">
        {tr("title")}
      </h1>
      <p className="text-[11.5px] text-[var(--color-muted)] m-0 mb-6">
        {tr("subtitle")}
      </p>

      {isCloud === false && (
        <div className={`${card} mb-4 text-[11.5px] text-[var(--color-muted)]`}>
          {tr("cloud_only")}
        </div>
      )}

      {loaded && loggedIn === false && (
        <div
          className={`${card} mb-4 text-[11.5px] text-[var(--color-yellow)]`}
        >
          {tr("login_required")}
        </div>
      )}

      {/* ── Interruttori generali ── */}
      <div className={`${card} mb-4 flex flex-col gap-3`}>
        <Toggle
          checked={prefs.enabled}
          onChange={(v) => void handleMasterToggle(v)}
          label={tr("master")}
          desc={
            permission === "granted"
              ? tr("perm_granted")
              : permission === "denied"
                ? undefined
                : permission === "unsupported"
                  ? tr("no_support")
                  : tr("perm_needed")
          }
        />
        {permission === "denied" && (
          <p className="m-0 text-[10.5px] text-[var(--color-yellow)]">
            {tr("perm_denied")}
          </p>
        )}
        <Toggle
          checked={prefs.messages}
          onChange={(v) => setPrefs((p) => ({ ...p, messages: v }))}
          label={tr("messages")}
          desc={tr("messages_desc")}
        />
        <Toggle
          checked={prefs.onlyWhenHidden}
          onChange={(v) => setPrefs((p) => ({ ...p, onlyWhenHidden: v }))}
          label={tr("only_hidden")}
          desc={tr("only_hidden_desc")}
        />
        <div>
          <button
            type="button"
            onClick={handleTest}
            disabled={permission !== "granted"}
            className="px-3 py-1.5 text-[10.5px] rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] hover:border-[var(--color-border-glow)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {tr("test")}
          </button>
        </div>
      </div>

      {/* ── Regole posizioni ── */}
      <div className={`${card} mb-4`}>
        <div className="flex items-baseline gap-3 flex-wrap mb-1">
          <h2 className="text-[12px] font-bold tracking-[0.1em] uppercase text-[var(--color-bright)] m-0">
            {tr("rules_title")}
          </h2>
        </div>
        <p className="text-[10.5px] text-[var(--color-muted)] m-0 mb-3">
          {tr("rules_desc")}
        </p>

        {prefs.rules.length === 0 && (
          <p className="text-[11px] text-[var(--color-dim)] m-0 mb-3">
            {tr("empty_rules")}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {prefs.rules.map((r) => (
            <div
              key={r.id}
              className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-card)]"
              style={{ opacity: r.enabled ? 1 : 0.55 }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end mb-3">
                <div>
                  <label className={labelCls}>{tr("rule_name")}</label>
                  <input
                    className={inputCls}
                    value={r.name}
                    maxLength={60}
                    onChange={(e) => updateRule(r.id, { name: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-[10.5px] text-[var(--color-muted)] cursor-pointer pb-1.5">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) =>
                      updateRule(r.id, { enabled: e.target.checked })
                    }
                  />
                  {tr("rule_enabled")}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setPrefs((p) => ({
                      ...p,
                      rules: p.rules.filter((x) => x.id !== r.id),
                    }))
                  }
                  className="pb-1.5 text-[10.5px] text-[var(--color-red)] hover:underline cursor-pointer bg-transparent border-0"
                >
                  {tr("delete")}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className={labelCls}>{tr("trigger")}</label>
                  <select
                    className={inputCls}
                    value={r.trigger}
                    onChange={(e) =>
                      updateRule(r.id, {
                        trigger: e.target.value === "new" ? "new" : "scored",
                      })
                    }
                  >
                    <option value="scored">{tr("trigger_scored")}</option>
                    <option value="new">{tr("trigger_new")}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{tr("min_score")}</label>
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    max={100}
                    disabled={r.trigger === "new"}
                    placeholder={tr("any")}
                    value={r.minScore ?? ""}
                    onChange={(e) =>
                      updateRule(r.id, {
                        minScore:
                          e.target.value === ""
                            ? null
                            : Math.min(
                                100,
                                Math.max(0, Number(e.target.value)),
                              ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>{tr("work_mode")}</label>
                  <select
                    className={inputCls}
                    value={r.workMode}
                    onChange={(e) =>
                      updateRule(r.id, {
                        workMode: e.target
                          .value as NotificationRule["workMode"],
                      })
                    }
                  >
                    <option value="any">{tr("any")}</option>
                    <option value="remote">{tr("wm_remote")}</option>
                    <option value="hybrid">{tr("wm_hybrid")}</option>
                    <option value="onsite">{tr("wm_onsite")}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{tr("min_count")}</label>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    max={50}
                    value={r.minCount}
                    title={tr("min_count_hint")}
                    onChange={(e) =>
                      updateRule(r.id, {
                        minCount: Math.min(
                          50,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>{tr("locations")}</label>
                  <input
                    className={inputCls}
                    placeholder={tr("locations_hint")}
                    defaultValue={listToText(r.locations)}
                    onBlur={(e) =>
                      updateRule(r.id, {
                        locations: textToList(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>{tr("countries")}</label>
                  <input
                    className={inputCls}
                    placeholder={tr("countries_hint")}
                    defaultValue={listToText(r.countries)}
                    onBlur={(e) =>
                      updateRule(r.id, {
                        countries: textToList(e.target.value).map((c) =>
                          c.toUpperCase(),
                        ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelCls}>{tr("keywords")}</label>
                  <input
                    className={inputCls}
                    placeholder={tr("keywords_hint")}
                    defaultValue={listToText(r.keywords)}
                    onBlur={(e) =>
                      updateRule(r.id, { keywords: textToList(e.target.value) })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap mt-4">
          <button
            type="button"
            onClick={() =>
              setPrefs((p) => ({ ...p, rules: [...p.rules, newRule()] }))
            }
            className="px-3 py-1.5 text-[10.5px] font-semibold rounded border cursor-pointer transition-colors"
            style={{
              color: "var(--color-green)",
              borderColor: "var(--color-green)",
            }}
          >
            + {tr("add_rule")}
          </button>
          <span className="text-[10px] text-[var(--color-dim)]">
            {tr("presets")}
          </span>
          <button
            type="button"
            onClick={() =>
              setPrefs((p) => ({
                ...p,
                rules: [
                  ...p.rules,
                  newRule({ name: tr("preset_high"), minScore: 80 }),
                ],
              }))
            }
            className="px-2.5 py-1 text-[10px] rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] cursor-pointer transition-colors"
          >
            {tr("preset_high")}
          </button>
          <button
            type="button"
            onClick={() =>
              setPrefs((p) => ({
                ...p,
                rules: [
                  ...p.rules,
                  newRule({
                    name: tr("preset_milano"),
                    minScore: 75,
                    locations: ["Milano"],
                  }),
                ],
              }))
            }
            className="px-2.5 py-1 text-[10px] rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] cursor-pointer transition-colors"
          >
            {tr("preset_milano")}
          </button>
        </div>
      </div>

      {/* ── Salva ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || loggedIn === false}
          className="px-4 py-2 text-[11px] font-bold tracking-[0.08em] uppercase rounded cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
          style={{
            background: "var(--color-green)",
            color: "var(--color-void)",
          }}
        >
          {tr("save")}
        </button>
        {saveState === "ok" && (
          <span className="text-[11px] text-[var(--color-green)]">
            {tr("saved")}
          </span>
        )}
        {saveState === "error" && (
          <span className="text-[11px] text-[var(--color-red)]">
            {tr("save_error")}
          </span>
        )}
      </div>
    </div>
  );
}
