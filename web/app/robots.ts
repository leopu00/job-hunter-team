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
          // O-47 — percorsi tecnici delle campagne (/r Reddit, /t TikTok):
          // redirect verso la home, non contenuti. Indicizzarli darebbe alla
          // landing due URL doppioni e riempirebbe di crawler un contatore
          // che serve a decidere dove spendere. La risposta porta anche
          // `X-Robots-Tag: noindex` — chi non legge robots.txt lo trova lì.
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
