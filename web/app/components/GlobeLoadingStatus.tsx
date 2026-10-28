"use client";

import { useEffect, useState } from "react";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./JobsGlobe.i18n";

/** After this many seconds the line says it is slow, and why: the reads of a large team take a while. */
export const SLOW_AFTER_SECONDS = 5;

/**
 * What the map says while its positions are being read: a sweeping bar (it only says «working», the
 * number of reads is not known here), what is being read, the seconds so far, and from the fifth second
 * why it takes this long (`generic`: without naming a VPS, for the public page, whose person has none). Screen readers get the sentence once (the seconds are not announced).
 */
export default function GlobeLoadingStatus({
  lang,
  generic = false,
}: {
  lang: string;
  generic?: boolean;
}) {
  const tr = makeT(T, lang);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="globe-loading"
      className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-2 px-4 text-center pointer-events-none"
    >
      <style>{`
        @keyframes globe-sweep { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
        @media (prefers-reduced-motion: reduce) { .globe-sweep-bar { animation: none !important; width: 100% !important; opacity: .5; } }
      `}</style>
      <div
        className="h-1 w-48 overflow-hidden rounded-full bg-[var(--color-border)]"
        aria-hidden="true"
      >
        <div
          className="globe-sweep-bar h-full w-2/5 rounded-full bg-[var(--color-blue)]"
          style={{ animation: "globe-sweep 1.4s ease-in-out infinite" }}
        />
      </div>
      <p className="m-0 flex items-center gap-2 text-[13px] text-[var(--color-bright)]">
        {tr("loading_positions")}
        <span
          data-testid="globe-loading-seconds"
          aria-hidden="true"
          className="text-[12px] tabular-nums text-[var(--color-muted)]"
        >
          {seconds} s
        </span>
      </p>
      {seconds >= SLOW_AFTER_SECONDS && (
        <p
          data-testid="globe-loading-slow"
          className="m-0 max-w-sm text-[12px] text-[var(--color-muted)]"
        >
          {tr(generic ? "loading_slow_generic" : "loading_slow")}
        </p>
      )}
    </div>
  );
}
