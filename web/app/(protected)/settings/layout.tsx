import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: {
    title: "Impostazioni — Job Hunter",
    description: "Impostazioni generali, notifiche e sicurezza",
  },
  en: {
    title: "Settings — Job Hunter",
    description: "General, notification and security settings",
  },
  hu: {
    title: "Beállítások — Job Hunter",
    description: "Általános, értesítési és biztonsági beállítások",
  },
  es: {
    title: "Ajustes — Job Hunter",
    description: "Ajustes generales, de notificaciones y de seguridad",
  },
  de: {
    title: "Einstellungen — Job Hunter",
    description: "Allgemeine, Benachrichtigungs- und Sicherheitseinstellungen",
  },
  fr: {
    title: "Paramètres — Job Hunter",
    description: "Paramètres généraux, notifications et sécurité",
  },
  pt: {
    title: "Configurações — Job Hunter",
    description: "Configurações gerais, de notificações e de segurança",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
