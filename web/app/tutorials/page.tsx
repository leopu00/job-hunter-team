import type { Metadata } from "next";
import TutorialsClient from "./TutorialsClient";

export const metadata: Metadata = {
  title: "Tutorials",
  alternates: { canonical: "/tutorials" },
};

export default function TutorialsPage() {
  return <TutorialsClient />;
}
