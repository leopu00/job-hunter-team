import type { Metadata } from "next";
import BreadcrumbJsonLd from "../../components/BreadcrumbJsonLd";
import { getNonce } from "@/lib/csp";
import { getStory } from "../stories";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobhunterteam.ai";
const story = getStory("bipolar-sentinel")!;

export const metadata: Metadata = {
  title: `${story.it.title} — Cronache`,
  description: story.it.hook,
  openGraph: {
    title: `${story.it.title} | Cronache — Job Hunter Team`,
    description: story.it.hook,
  },
  twitter: {
    card: "summary",
    title: `${story.it.title} | Cronache — Job Hunter Team`,
    description: story.it.hook,
  },
};

async function StoryJsonLd() {
  const nonce = await getNonce();
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.it.title,
    description: story.it.hook,
    url: `${SITE_URL}/chronicles/${story.slug}`,
    isPartOf: { "@type": "WebSite", name: "Job Hunter Team", url: SITE_URL },
  };

  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function BipolarSentinelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Cronache", path: "/chronicles" },
          { name: story.it.title, path: `/chronicles/${story.slug}` },
        ]}
      />
      <StoryJsonLd />
      {children}
    </>
  );
}
