"use client";

import { useEffect, useState } from "react";

/**
 * True mentre la media query combacia. Parte da false (render server e primo
 * render client coincidono: niente hydration mismatch) e si allinea al mount.
 * Senza matchMedia (jsdom) resta false.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}
