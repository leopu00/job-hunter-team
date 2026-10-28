"use client";

import { useLocale } from "@/lib/use-locale";
import { T } from "./JobsGlobe.i18n";

/**
 * The globe's place while it is not there yet: its chunk is loading or the page is. A pale disc that
 * breathes, where the globe will be, so the map never opens as an empty frame. It takes no clicks.
 */
export default function GlobePlaceholder() {
  const locale = useLocale();
  const label = T.loading_map[locale] ?? T.loading_map.en;
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="globe-placeholder"
      className="absolute inset-0 grid place-items-center pointer-events-none"
      style={{ animation: "fade-in 0.2s ease both" }}
    >
      <div
        className="animate-pulse rounded-full border border-[var(--color-border)]"
        style={{
          width: "min(46vmin, 420px)",
          aspectRatio: "1",
          background:
            "radial-gradient(circle at 35% 30%, var(--color-card), var(--color-panel) 72%)",
        }}
      />
      <p
        aria-hidden="true"
        className="absolute bottom-[18%] text-[12px] text-[var(--color-muted)]"
      >
        {label}
      </p>
    </div>
  );
}
