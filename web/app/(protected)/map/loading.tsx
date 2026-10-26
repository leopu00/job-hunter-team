"use client";

import GlobePlaceholder from "@/app/components/GlobePlaceholder";

/**
 * The map's shape while its data is read: the full-height frame the page fills, the globe's disc, and
 * the four corner cards that sit on it (location, score, types, positions). The cards go on wide windows
 * only: on a narrow one the page stacks them under the globe.
 */
export default function MapLoading() {
  const card = "absolute hidden md:block rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3";
  const line = "rounded bg-[var(--color-border)] animate-pulse";
  return (
    <div
      className="map-shell"
      aria-busy="true"
      style={{
        position: "relative",
        width: "100%",
        height: "calc(100vh / var(--zoom) - 3.5rem)",
        overflow: "hidden",
        animation: "fade-in 0.2s ease both",
      }}
    >
      <GlobePlaceholder />
      <div className={card} style={{ top: 16, left: 16, width: 220 }} aria-hidden="true">
        <div className={`${line} h-3 w-20 mb-3`} />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${line} h-2.5 mb-2`} style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
      <div className={card} style={{ top: 16, right: 16, width: 240 }} aria-hidden="true">
        <div className={`${line} h-3 w-24 mb-3`} />
        <div className={`${line} h-16 w-full`} />
      </div>
      <div className={card} style={{ bottom: 16, left: 16, width: 200 }} aria-hidden="true">
        <div className={`${line} h-3 w-16 mb-3`} />
        <div className={`${line} h-14 w-14 rounded-full`} />
      </div>
      <div className={card} style={{ bottom: 16, right: 16, width: 240 }} aria-hidden="true">
        <div className={`${line} h-3 w-20 mb-3`} />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={`${line} h-2.5 mb-2`} style={{ width: `${95 - i * 10}%` }} />
        ))}
      </div>
    </div>
  );
}
