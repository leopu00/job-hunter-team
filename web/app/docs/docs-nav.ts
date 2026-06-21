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
    group: "Guides",
    items: [
      {
        title: "Email Forwarding",
        href: "/docs/guides/email-forwarding",
        emoji: "📧",
        description:
          "Give the team a dedicated inbox and auto-forward your job alerts.",
      },
    ],
  },
];

/** Flat list of every doc href — used by the sitemap. */
export const DOC_HREFS: string[] = DOCS_NAV.flatMap((s) =>
  s.items.map((i) => i.href),
);
