import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobhunterteam.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth",
          // O-47: porte d'ingresso degli annunci a pagamento. Sono percorsi
          // tecnici che rimandano alla home, non contenuti: indicizzarli
          // creerebbe due doppioni della home e sporcherebbe il conteggio dei
          // clic con le visite dei crawler.
          "/r",
          "/t",
          // Setup
          "/setup",
          // Top nav
          "/dashboard",
          "/profile",
          "/positions",
          "/team",
          "/team/scout",
          "/team/analista",
          "/team/scorer",
          "/team/scrittore",
          "/team/critico",
          // Config (SettingsMenu)
          "/settings",
          "/providers",
          "/credentials",
          "/rate-limiter",
          "/secrets",
          "/notifications",
          "/channels",
          "/integrations",
          "/cron",
          "/cli-link",
          // Account (UserMenu)
          "/export",
          "/backup",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
