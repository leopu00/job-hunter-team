import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team",
  description:
    "Your AI agent team's activity: who worked, how much and when — charts, per-agent breakdown and full action log.",
  openGraph: {
    title: "Team | Job Hunter Team",
    description:
      "Your AI agent team's activity: who worked, how much and when — charts, per-agent breakdown and full action log.",
  },
};

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
