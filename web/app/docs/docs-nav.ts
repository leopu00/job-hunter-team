// Registro centrale delle pagine di documentazione pubblica (/docs/*).
// Fonte unica usata dalla sidebar, dall'indice /docs e dalla sitemap — per
// aggiungere una guida basta una voce qui + la sua page.tsx.

export interface DocItem {
  title: string;
  href: string;
  emoji?: string;
  description?: string;
}

export interface DocSection {
  group: string;
  items: DocItem[];
}

export const DOCS_NAV: DocSection[] = [
  {
    group: "Getting started",
    items: [
      {
        title: "Getting Started",
        href: "/docs/guides/getting-started",
        emoji: "🚀",
        description:
          "Three ways to install, your first run, and the team in 10 minutes.",
      },
      {
        title: "Connect your AI provider",
        href: "/docs/guides/connect-ai-provider",
        emoji: "🧠",
        description:
          "Choose and sign into Kimi, Codex or Claude — the team's brain.",
      },
      {
        title: "Run 24/7 on a VPS",
        href: "/docs/guides/run-on-a-vps",
        emoji: "☁️",
        description:
          "Keep the team hunting around the clock on a small cloud server.",
      },
    ],
  },
  {
    group: "Using the team",
    items: [
      {
        title: "Email Forwarding",
        href: "/docs/guides/email-forwarding",
        emoji: "📧",
        description:
          "Give the team a dedicated inbox and auto-forward your job alerts.",
      },
      {
        title: "Your dashboard & results",
        href: "/docs/guides/dashboard-and-results",
        emoji: "📊",
        description:
          "Read positions, scores and applications — login optional, local-only possible.",
      },
      {
        title: "CLI — the jht command",
        href: "/docs/guides/cli",
        emoji: "⌨️",
        description:
          "The essential jht commands to drive the team from a terminal.",
      },
    ],
  },
];

/** Flat list of every doc href — used by the sitemap. */
export const DOC_HREFS: string[] = DOCS_NAV.flatMap((s) =>
  s.items.map((i) => i.href),
);
