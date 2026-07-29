// Presentazione condivisa dei messaggi agente→utente (pending_user_messages).
// Estratto da PendingMessagesCard quando i messaggi hanno preso una pagina
// dedicata (/messages) + un banner compatto in dashboard: entrambi hanno
// bisogno di meta-agente, colori per kind e tempo relativo identici.
import type { PendingMessageKind } from "@/lib/types";

type LocaleDict = Record<string, string>;

const AGENT_LABELS: Record<string, LocaleDict> = {
  capitano: {
    it: "Capitano",
    en: "Captain",
    hu: "Kapitány",
    es: "Capitán",
    de: "Kapitän",
    fr: "Capitaine",
    pt: "Capitão",
  },
  mentor: {
    it: "Mentor",
    en: "Mentor",
    hu: "Mentor",
    es: "Mentor",
    de: "Mentor",
    fr: "Mentor",
    pt: "Mentor",
  },
  assistente: {
    it: "Assistente",
    en: "Assistant",
    hu: "Asszisztens",
    es: "Asistente",
    de: "Assistent",
    fr: "Assistant",
    pt: "Assistente",
  },
};

// [JHT-CHAT-UNIFY] Le icone della chat non sono più emoji: sono i ritratti
// disegnati degli agenti, gli stessi che l'utente vede nel videogioco,
// ritagliati al busto. I PNG li produce `scripts/gen-chat-avatars.py` dai
// ritratti a layer in `game/assets/characters/gen/portraits/`.
//
// `emoji` resta come fallback per un mittente fuori roster (un agente che
// notifica e che non ha ritratto) e per i contesti solo-testo.
const AGENT_META: Record<
  string,
  { emoji: string; color: string; avatar: string }
> = {
  // Stesso pilota usato ovunque nel resto dell'app (team/capitano,
  // api/team/status): 👨‍✈️, non il bersaglio.
  capitano: {
    emoji: "👨‍✈️",
    color: "var(--color-yellow)",
    avatar: "/agents/capitano.png",
  },
  mentor: {
    emoji: "🧙‍♂️",
    color: "var(--color-purple)",
    avatar: "/agents/mentor.png",
  },
  assistente: {
    emoji: "👩‍💼",
    color: "var(--color-blue)",
    avatar: "/agents/assistente.png",
  },
};

export function agentInfo(
  agent: string,
  locale: string,
): { name: string; emoji: string; color: string; avatar: string | null } {
  const meta = AGENT_META[agent];
  if (!meta)
    return {
      name: agent,
      emoji: "🤖",
      color: "var(--color-muted)",
      avatar: null,
    };
  const labels = AGENT_LABELS[agent];
  return {
    name: labels?.[locale] ?? labels?.en ?? agent,
    ...meta,
  };
}

export const KIND_BORDER: Record<PendingMessageKind, string> = {
  notification: "var(--color-border)",
  question: "var(--color-blue)",
  digest: "var(--color-purple)",
  alert: "var(--color-red)",
};

const KIND_LABELS: Record<PendingMessageKind, LocaleDict> = {
  notification: {
    it: "NOTIFICA",
    en: "NOTIFICATION",
    hu: "ÉRTESÍTÉS",
    es: "NOTIFICACIÓN",
    de: "BENACHRICHTIGUNG",
    fr: "NOTIFICATION",
    pt: "NOTIFICAÇÃO",
  },
  question: {
    it: "DOMANDA",
    en: "QUESTION",
    hu: "KÉRDÉS",
    es: "PREGUNTA",
    de: "FRAGE",
    fr: "QUESTION",
    pt: "PERGUNTA",
  },
  digest: {
    it: "DIGEST",
    en: "DIGEST",
    hu: "ÖSSZEFOGLALÓ",
    es: "RESUMEN",
    de: "ZUSAMMENFASSUNG",
    fr: "RÉSUMÉ",
    pt: "RESUMO",
  },
  alert: {
    it: "ALERT",
    en: "ALERT",
    hu: "RIASZTÁS",
    es: "ALERTA",
    de: "WARNUNG",
    fr: "ALERTE",
    pt: "ALERTA",
  },
};

export function kindLabel(kind: PendingMessageKind, locale: string): string {
  const labels = KIND_LABELS[kind];
  return labels?.[locale] ?? labels?.en ?? kind;
}

const AGO: Record<string, LocaleDict> = {
  s: {
    it: "{n}s fa",
    en: "{n}s ago",
    hu: "{n} mp",
    es: "hace {n}s",
    de: "vor {n}s",
    fr: "il y a {n}s",
    pt: "há {n}s",
  },
  m: {
    it: "{n}m fa",
    en: "{n}m ago",
    hu: "{n} p",
    es: "hace {n}m",
    de: "vor {n}m",
    fr: "il y a {n}m",
    pt: "há {n}m",
  },
  h: {
    it: "{n}h fa",
    en: "{n}h ago",
    hu: "{n} ó",
    es: "hace {n}h",
    de: "vor {n}h",
    fr: "il y a {n}h",
    pt: "há {n}h",
  },
  d: {
    it: "{n}g fa",
    en: "{n}d ago",
    hu: "{n} nap",
    es: "hace {n}d",
    de: "vor {n}T",
    fr: "il y a {n}j",
    pt: "há {n}d",
  },
};

export function formatRelative(iso: string, locale: string): string {
  const ts = new Date(
    iso.includes("T") ? iso : iso.replace(" ", "T") + "Z",
  ).getTime();
  if (!Number.isFinite(ts)) return iso;
  const t = (unit: string, n: number) =>
    (AGO[unit][locale] ?? AGO[unit].en).replace("{n}", String(n));
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return t("s", diffSec);
  if (diffSec < 3600) return t("m", Math.round(diffSec / 60));
  if (diffSec < 86400) return t("h", Math.round(diffSec / 3600));
  return t("d", Math.round(diffSec / 86400));
}

// Alcuni messaggi salvati prima del fix in jht-notify-user contengono le
// escape LETTERALI `\n`/`\t` (l'agente le scrive come separatori di paragrafo
// in una stringa singola). pre-wrap rende solo i newline VERI, quindi senza
// questa normalizzazione si vedrebbe il testo "\n\n". Difensivo e idempotente:
// i newline gia' veri restano invariati.
export function normalizeBody(s: string): string {
  return s.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "\t");
}
