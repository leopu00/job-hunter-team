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
