import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

// /messages è la casella dei messaggi agente→utente (pending_user_messages,
// fallback web): prima vivevano solo in dashboard, dove i digest lunghi
// spingevano giù pipeline e grafici. Qui c'è lo storico completo (non letti
// + letti); la dashboard mostra solo un banner compatto col conteggio.
const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Messaggi — Job Hunter",
    description:
      "I messaggi del tuo team di agenti AI: notifiche, domande e digest — non letti in evidenza e storico completo",
  },
  en: {
    title: "Messages — Job Hunter",
    description:
      "Messages from your AI agent team: notifications, questions and digests — unread first plus full history",
  },
  hu: {
    title: "Üzenetek — Job Hunter",
    description:
      "AI-ügynökcsapatod üzenetei: értesítések, kérdések és összefoglalók — olvasatlanok elöl, teljes előzményekkel",
  },
  es: {
    title: "Mensajes — Job Hunter",
    description:
      "Los mensajes de tu equipo de agentes de IA: notificaciones, preguntas y resúmenes — sin leer primero e historial completo",
  },
  de: {
    title: "Nachrichten — Job Hunter",
    description:
      "Nachrichten deines KI-Agenten-Teams: Benachrichtigungen, Fragen und Zusammenfassungen — Ungelesenes zuerst plus vollständiger Verlauf",
  },
  fr: {
    title: "Messages — Job Hunter",
    description:
      "Les messages de votre équipe d'agents IA : notifications, questions et résumés — non lus en premier et historique complet",
  },
  pt: {
    title: "Mensagens — Job Hunter",
    description:
      "As mensagens da sua equipe de agentes de IA: notificações, perguntas e resumos — não lidas primeiro e histórico completo",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
