import type { Metadata } from "next";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";
import { getNonce } from "@/lib/csp";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobhunterteam.ai";

export const metadata: Metadata = {
  title: "Cronache",
  description:
    "Cronache del Team: storie vere — divertenti e istruttive — di un team di agenti AI alle prese con crisi, incidenti e colpi di scena.",
  openGraph: {
    title: "Cronache | Job Hunter Team",
    description:
      "Storie vere di un team di agenti AI alle prese con crisi, incidenti e colpi di scena.",
  },
  twitter: {
    card: "summary",
    title: "Cronache | Job Hunter Team",
    description:
      "Storie vere di un team di agenti AI alle prese con crisi, incidenti e colpi di scena.",
  },
};

async function ChroniclesJsonLd() {
  const nonce = await getNonce();
  const data = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Cronache - Job Hunter Team",
    description:
      "Storie vere di un team di agenti AI alle prese con crisi, incidenti e colpi di scena.",
    url: `${SITE_URL}/chronicles`,
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

export default function ChroniclesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Cronache", path: "/chronicles" }]} />
      <ChroniclesJsonLd />
      {children}
    </>
  );
}
