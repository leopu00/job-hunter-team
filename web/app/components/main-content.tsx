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
        transform: fade ? "translateY(4px)" : "translateY(0)",
        transition: "opacity 0.2s ease, transform 0.2s ease",
      }}
    >
      {children}
    </main>
  );
}
