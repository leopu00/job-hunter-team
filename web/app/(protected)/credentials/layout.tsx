import type { Metadata } from "next";
import { getServerLocale } from "@/lib/server-locale";

const TITLES: Record<string, string> = {
  it: "Credenziali",
  en: "Credentials",
  hu: "Hitelesítő adatok",
  es: "Credenciales",
  de: "Anmeldedaten",
  fr: "Identifiants",
  pt: "Credenciais",
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: TITLES[await getServerLocale()] ?? TITLES.en };
}

export default function CredentialsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
