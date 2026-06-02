"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";

export default function MainContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [fade, setFade] = useState(false);
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevPath.current) {
      setFade(true);
      prevPath.current = pathname;
      const t = setTimeout(() => setFade(false), 200);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      style={{
        minHeight: "100vh",
        position: "relative",
        zIndex: 1,
        opacity: fade ? 0 : 1,
        // NB: niente `transform` qui. Un transform (anche translateY(0))
        // crea un containing block che ancora gli elementi `position: fixed`
        // discendenti (la LandingNav) a questo <main> invece che al viewport,
        // facendo scrollare via l'header. Dissolvenza con sola opacity.
        transition: "opacity 0.2s ease",
      }}
    >
      {children}
    </main>
  );
}
