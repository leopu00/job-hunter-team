// Registro centrale delle pagine di documentazione pubblica (/docs/*).
// Fonte unica usata dalla sidebar, dall'indice /docs e dalla sitemap — per
// aggiungere una guida basta una voce qui + la sua page.tsx.
//
// i18n: gli slug/href NON si traducono mai (gli URL restano invariati). I
// titoli/descrizioni/gruppi sono localizzati per slug in `DOCS_I18N` e
// composti da `getDocsNav(locale)`. La sitemap usa `DOC_HREFS` (solo href) e
// `DOCS_NAV` (default EN) — nessun URL cambia con la lingua.

export type DocLocale = "it" | "en" | "es" | "fr" | "de" | "hu" | "pt";

export interface DocItem {
  title: string;
  href: string;
  emoji?: string;
  description?: string;
}

export interface DocSection {
  group: string;
  items: DocItem[];
}

// Struttura canonica: href + emoji (invariati), gli slug raggruppati per
// sezione. I testi visibili vivono in DOCS_I18N, indicizzati per href.
interface NavSkeletonItem {
  href: string;
  emoji?: string;
}
interface NavSkeletonSection {
  groupKey: string;
  items: NavSkeletonItem[];
}

const NAV_SKELETON: NavSkeletonSection[] = [
  {
    groupKey: "getting_started",
    items: [
      { href: "/docs/guides/getting-started", emoji: "🚀" },
      { href: "/docs/guides/connect-ai-provider", emoji: "🧠" },
      { href: "/docs/guides/run-on-a-vps", emoji: "☁️" },
    ],
  },
  {
    groupKey: "using_the_team",
    items: [
      { href: "/docs/guides/email-forwarding", emoji: "📧" },
      { href: "/docs/guides/team-gmail", emoji: "📨" },
      { href: "/docs/guides/dashboard-and-results", emoji: "📊" },
      { href: "/docs/guides/cli", emoji: "⌨️" },
    ],
  },
  {
    groupKey: "good_to_know",
    items: [{ href: "/docs/guides/faq", emoji: "❓" }],
  },
];

// Nomi dei gruppi della sidebar/indice, per lingua.
const GROUP_LABELS: Record<string, Record<DocLocale, string>> = {
  getting_started: {
    it: "Per iniziare",
    en: "Getting started",
    es: "Primeros pasos",
    fr: "Pour commencer",
    de: "Erste Schritte",
    hu: "Első lépések",
    pt: "Primeiros passos",
  },
  using_the_team: {
    it: "Usare il team",
    en: "Using the team",
    es: "Usar el equipo",
    fr: "Utiliser l'équipe",
    de: "Das Team nutzen",
    hu: "A csapat használata",
    pt: "Usar a equipa",
  },
  good_to_know: {
    it: "Buono a sapersi",
    en: "Good to know",
    es: "Bueno saberlo",
    fr: "Bon à savoir",
    de: "Gut zu wissen",
    hu: "Jó tudni",
    pt: "Bom saber",
  },
};

interface DocText {
  title: string;
  description: string;
}

// Titoli + descrizioni per href, per lingua. Slug/href, comandi (jht),
// brand (Kimi, Codex, Claude, VPS, GitHub, CLI, AI) restano invariati.
const DOCS_I18N: Record<string, Record<DocLocale, DocText>> = {
  "/docs/guides/getting-started": {
    it: {
      title: "Per iniziare",
      description:
        "Tre modi per installare, la prima esecuzione e il team in 10 minuti.",
    },
    en: {
      title: "Getting Started",
      description:
        "Three ways to install, your first run, and the team in 10 minutes.",
    },
    es: {
      title: "Primeros pasos",
      description:
        "Tres formas de instalar, tu primera ejecución y el equipo en 10 minutos.",
    },
    fr: {
      title: "Pour commencer",
      description:
        "Trois façons d'installer, votre première exécution et l'équipe en 10 minutes.",
    },
    de: {
      title: "Erste Schritte",
      description:
        "Drei Installationswege, dein erster Lauf und das Team in 10 Minuten.",
    },
    hu: {
      title: "Első lépések",
      description:
        "Három telepítési mód, az első futtatás és a csapat 10 perc alatt.",
    },
    pt: {
      title: "Primeiros passos",
      description:
        "Três formas de instalar, a tua primeira execução e a equipa em 10 minutos.",
    },
  },
  "/docs/guides/connect-ai-provider": {
    it: {
      title: "Collega il tuo provider AI",
      description:
        "Scegli e accedi a Kimi, Codex o Claude — il cervello del team.",
    },
    en: {
      title: "Connect your AI provider",
      description:
        "Choose and sign into Kimi, Codex or Claude — the team's brain.",
    },
    es: {
      title: "Conecta tu proveedor de AI",
      description:
        "Elige e inicia sesión en Kimi, Codex o Claude — el cerebro del equipo.",
    },
    fr: {
      title: "Connectez votre fournisseur AI",
      description:
        "Choisissez et connectez-vous à Kimi, Codex ou Claude — le cerveau de l'équipe.",
    },
    de: {
      title: "Verbinde deinen AI-Anbieter",
      description:
        "Wähle Kimi, Codex oder Claude und melde dich an — das Gehirn des Teams.",
    },
    hu: {
      title: "Csatlakoztasd az AI-szolgáltatód",
      description:
        "Válaszd ki és jelentkezz be a Kimi, Codex vagy Claude szolgáltatásba — a csapat agya.",
    },
    pt: {
      title: "Liga o teu provedor de AI",
      description:
        "Escolhe e inicia sessão no Kimi, Codex ou Claude — o cérebro da equipa.",
    },
  },
  "/docs/guides/run-on-a-vps": {
    it: {
      title: "Esegui 24/7 su un VPS",
      description:
        "Tieni il team a caccia tutto il giorno su un piccolo server cloud.",
    },
    en: {
      title: "Run 24/7 on a VPS",
      description:
        "Keep the team hunting around the clock on a small cloud server.",
    },
    es: {
      title: "Ejecuta 24/7 en un VPS",
      description:
        "Mantén al equipo a la caza las 24 horas en un pequeño servidor en la nube.",
    },
    fr: {
      title: "Exécutez 24/7 sur un VPS",
      description:
        "Gardez l'équipe à la chasse en continu sur un petit serveur cloud.",
    },
    de: {
      title: "24/7 auf einem VPS laufen lassen",
      description:
        "Lass das Team rund um die Uhr auf einem kleinen Cloud-Server jagen.",
    },
    hu: {
      title: "Futtasd 24/7-ben egy VPS-en",
      description:
        "Tartsd a csapatot egész nap vadászaton egy kis felhőszerveren.",
    },
    pt: {
      title: "Executa 24/7 num VPS",
      description:
        "Mantém a equipa à caça o dia inteiro num pequeno servidor na nuvem.",
    },
  },
  "/docs/guides/email-forwarding": {
    it: {
      title: "Inoltro email",
      description:
        "Dai al team una casella dedicata e inoltra in automatico i tuoi avvisi di lavoro.",
    },
    en: {
      title: "Email Forwarding",
      description:
        "Give the team a dedicated inbox and auto-forward your job alerts.",
    },
    es: {
      title: "Reenvío de correo",
      description:
        "Dale al equipo un buzón dedicado y reenvía automáticamente tus alertas de empleo.",
    },
    fr: {
      title: "Transfert d'e-mails",
      description:
        "Donnez à l'équipe une boîte dédiée et transférez automatiquement vos alertes d'emploi.",
    },
    de: {
      title: "E-Mail-Weiterleitung",
      description:
        "Gib dem Team ein eigenes Postfach und leite deine Job-Benachrichtigungen automatisch weiter.",
    },
    hu: {
      title: "E-mail-továbbítás",
      description:
        "Adj a csapatnak egy dedikált postafiókot, és továbbítsd automatikusan az állásértesítőket.",
    },
    pt: {
      title: "Reencaminhamento de e-mail",
      description:
        "Dá à equipa uma caixa dedicada e reencaminha automaticamente os teus alertas de emprego.",
    },
  },
  "/docs/guides/team-gmail": {
    it: {
      title: "Configura la Gmail del team",
      description:
        "Crea una Gmail dedicata + app-password così il team può leggere i tuoi job alert.",
    },
    en: {
      title: "Set up the team's Gmail",
      description:
        "Create a dedicated Gmail + app password so the team can read your job alerts.",
    },
    es: {
      title: "Configura el Gmail del equipo",
      description:
        "Crea un Gmail dedicado + contraseña de aplicación para que el equipo lea tus alertas de empleo.",
    },
    fr: {
      title: "Configurez le Gmail de l'équipe",
      description:
        "Créez un Gmail dédié + un mot de passe d'application pour que l'équipe lise vos alertes d'emploi.",
    },
    de: {
      title: "Das Gmail des Teams einrichten",
      description:
        "Erstelle ein dediziertes Gmail + App-Passwort, damit das Team deine Job-Benachrichtigungen lesen kann.",
    },
    hu: {
      title: "A csapat Gmail-fiókjának beállítása",
      description:
        "Hozz létre egy dedikált Gmailt + app-jelszót, hogy a csapat olvashassa az állásértesítőket.",
    },
    pt: {
      title: "Configura o Gmail da equipa",
      description:
        "Cria um Gmail dedicado + palavra-passe de aplicação para a equipa ler os teus alertas de emprego.",
    },
  },
  "/docs/guides/dashboard-and-results": {
    it: {
      title: "La tua dashboard e i risultati",
      description:
        "Leggi posizioni, punteggi e candidature — login opzionale, possibile solo in locale.",
    },
    en: {
      title: "Your dashboard & results",
      description:
        "Read positions, scores and applications — login optional, local-only possible.",
    },
    es: {
      title: "Tu panel y resultados",
      description:
        "Lee posiciones, puntuaciones y candidaturas — inicio de sesión opcional, posible solo en local.",
    },
    fr: {
      title: "Votre tableau de bord et vos résultats",
      description:
        "Consultez postes, scores et candidatures — connexion facultative, possible en local uniquement.",
    },
    de: {
      title: "Dein Dashboard & deine Ergebnisse",
      description:
        "Lies Stellen, Bewertungen und Bewerbungen — Login optional, auch rein lokal möglich.",
    },
    hu: {
      title: "Az irányítópultod és az eredmények",
      description:
        "Olvasd a pozíciókat, pontszámokat és jelentkezéseket — a bejelentkezés opcionális, helyben is működik.",
    },
    pt: {
      title: "O teu painel e resultados",
      description:
        "Lê posições, pontuações e candidaturas — início de sessão opcional, possível só localmente.",
    },
  },
  "/docs/guides/faq": {
    it: {
      title: "Domande frequenti",
      description:
        "Risposte veloci prima di iniziare: costi, dati, provider e come funziona.",
    },
    en: {
      title: "FAQ",
      description:
        "Quick answers before you start: costs, data, providers and how it works.",
    },
    es: {
      title: "Preguntas frecuentes",
      description:
        "Respuestas rápidas antes de empezar: costes, datos, proveedores y cómo funciona.",
    },
    fr: {
      title: "FAQ",
      description:
        "Réponses rapides avant de commencer : coûts, données, fournisseurs et fonctionnement.",
    },
    de: {
      title: "FAQ",
      description:
        "Schnelle Antworten vor dem Start: Kosten, Daten, Anbieter und Funktionsweise.",
    },
    hu: {
      title: "GYIK",
      description:
        "Gyors válaszok, mielőtt belekezdesz: költségek, adatok, szolgáltatók és működés.",
    },
    pt: {
      title: "Perguntas frequentes",
      description:
        "Respostas rápidas antes de começar: custos, dados, provedores e como funciona.",
    },
  },
  "/docs/guides/cli": {
    it: {
      title: "CLI — il comando jht",
      description: "I comandi jht essenziali per guidare il team da terminale.",
    },
    en: {
      title: "CLI — the jht command",
      description:
        "The essential jht commands to drive the team from a terminal.",
    },
    es: {
      title: "CLI — el comando jht",
      description:
        "Los comandos jht esenciales para dirigir al equipo desde un terminal.",
    },
    fr: {
      title: "CLI — la commande jht",
      description:
        "Les commandes jht essentielles pour piloter l'équipe depuis un terminal.",
    },
    de: {
      title: "CLI — der jht-Befehl",
      description:
        "Die wichtigsten jht-Befehle, um das Team vom Terminal aus zu steuern.",
    },
    hu: {
      title: "CLI — a jht parancs",
      description:
        "A lényeges jht parancsok a csapat terminálból való irányításához.",
    },
    pt: {
      title: "CLI — o comando jht",
      description:
        "Os comandos jht essenciais para dirigir a equipa a partir de um terminal.",
    },
  },
};

const DEFAULT_LOCALE: DocLocale = "en";

/** Restituisce le sezioni dei docs con titoli/descrizioni/gruppi localizzati.
 *  Gli href/slug/emoji restano invariati a prescindere dalla lingua. */
export function getDocsNav(locale: DocLocale = DEFAULT_LOCALE): DocSection[] {
  const loc: DocLocale = (
    DOCS_I18N["/docs/guides/cli"][locale] ? locale : DEFAULT_LOCALE
  ) as DocLocale;
  return NAV_SKELETON.map((section) => ({
    group: GROUP_LABELS[section.groupKey][loc],
    items: section.items.map((item) => {
      const text = DOCS_I18N[item.href][loc];
      return {
        href: item.href,
        emoji: item.emoji,
        title: text.title,
        description: text.description,
      };
    }),
  }));
}

/** Sezioni in lingua di default (EN) — retro-compatibile, usata dalla sitemap. */
export const DOCS_NAV: DocSection[] = getDocsNav(DEFAULT_LOCALE);

/** Flat list of every doc href — used by the sitemap. URLs never localized. */
export const DOC_HREFS: string[] = NAV_SKELETON.flatMap((s) =>
  s.items.map((i) => i.href),
);
