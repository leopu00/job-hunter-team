import type { Metadata } from "next";
import BreadcrumbJsonLd from "../components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Come si avvia",
  description:
    "Fai girare il team sul tuo PC con Docker, su un computer dedicato o su una VPS sempre accesa. Gestisci tutto dall'app desktop. Requisiti e sistemi supportati.",
  openGraph: {
    title: "Come si avvia | Job Hunter Team",
    description:
      "PC, computer dedicato o VPS: scegli dove far girare la squadra e gestisci tutto dall'app desktop.",
  },
};

export default function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Come si avvia", path: "/run" }]} />
      {children}
    </>
  );
}
