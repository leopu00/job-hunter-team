import type { MetadataRoute } from "next";
import { DOC_HREFS } from "./docs/docs-nav";
import { CASE_STUDIES } from "@/lib/case-studies";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobhunterteam.ai";

/** Pagine pubbliche indicizzabili — landing, documentazione, info */
const PUBLIC_PAGES = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" as const },
  { path: "/download", priority: 0.9, changeFrequency: "weekly" as const },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/run", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/case-studies", priority: 0.7, changeFrequency: "weekly" as const },
  ...CASE_STUDIES.map((cs) => ({
    path: `/case-studies/${cs.id}`,
    priority: 0.6,
    changeFrequency: "monthly" as const,
  })),
  { path: "/agents", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/project", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/tutorials", priority: 0.6, changeFrequency: "weekly" as const },
  { path: "/docs", priority: 0.6, changeFrequency: "weekly" as const },
  ...DOC_HREFS.map((path) => ({
    path,
    priority: 0.6,
    changeFrequency: "monthly" as const,
  })),
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: `${SITE_URL}${page.path}`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
