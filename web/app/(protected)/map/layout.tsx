import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Map",
  description: "Overview of your job search progress and agent activities.",
};
export default function MapLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
