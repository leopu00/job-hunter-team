import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import MainContent from "./components/main-content";
import { ThemeProvider } from "./theme-provider";
import { ToastProvider } from "./components/Toast";
import { KeyboardShortcutsProvider } from "./components/KeyboardShortcuts";
import { DashboardI18nProvider } from "./components/DashboardI18n";
import dynamic from "next/dynamic";
import ConsentedAnalytics from "./components/ConsentedAnalytics";
import { getNonce } from "@/lib/csp";
import { cookies } from "next/headers";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

const LAYOUT_T: Record<Locale, { noscript: string; skip: string }> = {
  it: {
    noscript:
      "Job Hunter Team richiede JavaScript per funzionare. Abilitalo nel tuo browser per continuare.",
    skip: "Vai al contenuto principale",
  },
  en: {
    noscript:
      "Job Hunter Team requires JavaScript to run. Please enable it in your browser to continue.",
    skip: "Skip to main content",
  },
  es: {
    noscript:
      "Job Hunter Team necesita JavaScript para funcionar. Actívalo en tu navegador para continuar.",
    skip: "Saltar al contenido principal",
  },
  fr: {
    noscript:
      "Job Hunter Team nécessite JavaScript pour fonctionner. Activez-le dans votre navigateur pour continuer.",
    skip: "Aller au contenu principal",
  },
  de: {
    noscript:
      "Job Hunter Team benötigt JavaScript. Bitte aktivieren Sie es in Ihrem Browser, um fortzufahren.",
    skip: "Zum Hauptinhalt springen",
  },
  hu: {
    noscript:
      "A Job Hunter Team JavaScriptet igényel a működéshez. A folytatáshoz engedélyezze a böngészőjében.",
    skip: "Ugrás a fő tartalomra",
  },
  pt: {
    noscript:
      "O Job Hunter Team requer JavaScript para funcionar. Ative-o no seu navegador para continuar.",
    skip: "Saltar para o conteúdo principal",
  },
};

const GlobalSearch = dynamic(() =>
  import("./components/GlobalSearch").then((m) => m.GlobalSearch),
);

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060608" },
    { media: "(prefers-color-scheme: light)", color: "#f0f0f7" },
  ],
  colorScheme: "dark light",
};

export const metadata: Metadata = {
  title: {
    default: "Job Hunter Team",
    template: "%s | Job Hunter Team",
  },
  description:
    "A team of AI agents that find jobs for you. Open source, local, private.",
  keywords: [
    "job hunting",
    "AI agents",
    "job search",
    "automatic applications",
    "open source",
  ],
  authors: [{ name: "Job Hunter Team" }],
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Job Hunter Team",
    title: "Job Hunter Team",
    description:
      "A team of AI agents that find jobs for you. Open source, local, private.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Job Hunter Team",
    description:
      "A team of AI agents that find jobs for you. Open source, local, private.",
  },
  alternates: {
    canonical: "/",
    languages: { "en-US": "/", "it-IT": "/" },
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobhunterteam.ai",
  ),
  robots: { index: true, follow: true },
  manifest: "/manifest.json",
  other: {
    "theme-color": "#00e87a",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "format-detection": "telephone=no",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = await getNonce();
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale = (locales as string[]).includes(cookieLocale ?? "")
    ? (cookieLocale as Locale)
    : defaultLocale;
  const t = LAYOUT_T[locale];
  return (
    <html
      lang={locale}
      className={jetbrainsMono.variable}
      suppressHydrationWarning
    >
      <head>
        {/* suppressHydrationWarning: il browser spoglia l'attributo nonce dagli
            script dopo il parse (HTML spec), quindi React legge "" sul client.
            È un mismatch atteso per gli inline script con CSP nonce. */}
        <script
          suppressHydrationWarning
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('jht-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);else if(t==='system'||!t){var d=window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',d)}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <noscript>
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              fontFamily: "monospace",
              background: "#060608",
              color: "#e0e0f0",
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <p>{t.noscript}</p>
          </div>
        </noscript>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded focus:text-sm focus:font-semibold"
          style={{
            background: "var(--color-green)",
            color: "var(--color-void)",
          }}
        >
          {t.skip}
        </a>
        <ThemeProvider>
          <DashboardI18nProvider>
            <ToastProvider>
              <KeyboardShortcutsProvider>
                <GlobalSearch />
                {/*
                  `components/FloatingChat.tsx` esiste ma NON è montato: la
                  feature è ferma, non rimossa. Anche la route che la serve
                  (`api/ai-assistant`) è spenta dietro
                  `JHT_AI_ASSISTANT_ENABLED`. Per riattivarla servono
                  entrambe le cose: il flag sul server e il `dynamic()` +
                  `<FloatingChat />` qui.
                */}
                <MainContent>{children}</MainContent>
              </KeyboardShortcutsProvider>
            </ToastProvider>
          </DashboardI18nProvider>
        </ThemeProvider>
        {/* Misurazione solo dopo consenso esplicito: vedi
            `components/ConsentedAnalytics.tsx`. Prima erano montati qui
            senza condizioni e partivano prima del banner, rendendo
            «Solo necessari» una scelta senza effetto. */}
        <ConsentedAnalytics />
      </body>
    </html>
  );
}
