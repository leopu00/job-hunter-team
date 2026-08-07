import type { Metadata } from "next";
import CreditsClient from "./CreditsClient";

export const metadata: Metadata = {
  title: "Credits",
  description: "Music attribution for official Job Hunter Team media.",
  alternates: { canonical: "/credits" },
  robots: { index: true, follow: true },
};

export default function CreditsPage() {
  return <CreditsClient />;
}
