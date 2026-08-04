import type { Metadata } from "next";
import TrailerClient from "./TrailerClient";

export const metadata: Metadata = {
  title: "Trailer",
  alternates: { canonical: "/trailer" },
};

export default function TrailerPage() {
  return <TrailerClient />;
}
