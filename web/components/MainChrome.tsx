"use client";

import { usePathname } from "next/navigation";

// Routes che occupano tutta la viewport — senza il wrapper `max-w-6xl`
// del protected layout: dashboard che gestiscono il proprio layout a
// piena larghezza.
const FULLSCREEN_FLOWS = ["/positions"];
// Hero flows: full-width senza padding (il globo del dashboard tocca
// il navbar; il page gestisce il centering dei contenuti sottostanti).
// /messages: la chat a piena altezza gestisce da sé selettore/thread/composer.
const HERO_FLOWS = ["/dashboard", "/map", "/swipe", "/messages"];

export default function MainChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const hero = HERO_FLOWS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const fullscreen = FULLSCREEN_FLOWS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (hero) return <main className="w-full">{children}</main>;
  if (fullscreen) return <main className="w-full px-4 py-4 md:px-12 md:py-8">{children}</main>;
  return <main className="max-w-6xl mx-auto px-5 py-8">{children}</main>;
}
