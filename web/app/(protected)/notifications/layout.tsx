import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const META: Record<string, { title: string; description: string }> = {
  it: { title: "Notifiche — Job Hunter", description: "Centro notifiche" },
  en: {
    title: "Notifications — Job Hunter",
    description: "Notification center",
  },
  hu: {
    title: "Értesítések — Job Hunter",
    description: "Értesítési központ",
  },
  es: {
    title: "Notificaciones — Job Hunter",
    description: "Centro de notificaciones",
  },
  de: {
    title: "Benachrichtigungen — Job Hunter",
    description: "Benachrichtigungszentrale",
  },
  fr: {
    title: "Notifications — Job Hunter",
    description: "Centre de notifications",
  },
  pt: {
    title: "Notificações — Job Hunter",
    description: "Central de notificações",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const m = META[await getServerLocale()] ?? META.en;
  return { title: m.title, description: m.description };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
