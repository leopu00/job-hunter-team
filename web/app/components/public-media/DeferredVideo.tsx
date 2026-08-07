"use client";

import { useEffect, useRef, useState } from "react";
import {
  orientationForViewport,
  playableVariant,
  type PublicVideo,
  type VideoOrientation,
} from "@/lib/public-video-manifest";

type DeferredVideoProps = {
  video: PublicVideo;
  label: string;
};

function currentOrientation(): VideoOrientation {
  if (typeof window === "undefined") return "landscape";
  return orientationForViewport(
    window.matchMedia("(orientation: portrait)").matches,
  );
}

/**
 * Il player è creato solo dopo l'intenzione esplicita dell'utente. Prima c'è
 * al massimo un poster lazy; per i media non pubblicati resta un placeholder
 * visuale senza `src`, iframe o richieste di rete.
 */
export default function DeferredVideo({ video, label }: DeferredVideoProps) {
  const [orientation, setOrientation] = useState<VideoOrientation>("landscape");
  const [activated, setActivated] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const variant = activated ? playableVariant(video, orientation) : null;

  useEffect(() => {
    if (!activated || !variant) return;

    // Questa non è riproduzione automatica: il video esiste solo dopo il click
    // esplicito sul poster. Se il browser nega play(), i controlli restano
    // comunque visibili e permettono all'utente di avviarlo manualmente.
    void videoRef.current?.play().catch(() => undefined);
  }, [activated, variant]);

  if (!video.published) {
    return (
      <div
        aria-hidden="true"
        data-video-pending={video.id}
        className="w-full border border-[var(--color-border)] bg-[var(--color-card)]"
        style={{ aspectRatio: video.variants.landscape.aspectRatio }}
      />
    );
  }

  const poster = playableVariant(video, "landscape")?.poster;

  if (!activated || !variant) {
    return (
      <button
        type="button"
        data-video-launch={video.id}
        aria-label={label}
        onClick={() => {
          setOrientation(currentOrientation());
          setActivated(true);
        }}
        className="block w-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)] p-0"
      >
        {poster ? (
          // Poster deliberatamente lazy: non è il video e non deve pesare sul
          // primo hero, già occupato dal globo MapLibre.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster.src}
            alt=""
            loading="lazy"
            decoding="async"
            className="block h-auto w-full"
            style={{ aspectRatio: video.variants.landscape.aspectRatio }}
          />
        ) : (
          <span
            aria-hidden="true"
            className="block w-full bg-[var(--color-card)]"
            style={{ aspectRatio: video.variants.landscape.aspectRatio }}
          />
        )}
      </button>
    );
  }

  return (
    <video
      ref={videoRef}
      controls
      playsInline
      preload="none"
      poster={variant.poster.src}
      className="block h-auto w-full bg-black object-contain"
      style={{ aspectRatio: variant.aspectRatio }}
      aria-label={label}
    >
      <source src={variant.src} type="video/mp4" />
      {variant.captions.map((caption) => (
        <track key={caption.src} kind="captions" {...caption} />
      ))}
    </video>
  );
}
