import type { Metadata } from "next";

import SetupGuideClient from "./SetupGuideClient";

export const metadata: Metadata = {
  title: "Setup guide",
  description:
    "Set up Job Hunter Team step by step on macOS, Windows, or Linux.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/setup-guide" },
};

export default function SetupGuidePage() {
  return <SetupGuideClient />;
}
