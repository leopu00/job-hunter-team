"use client";

import { useEffect, useRef, useState } from "react";
import {
  orientationForViewport,
  playableVariant,
  type PublicVideo,
  type VideoOrientation,
  validatePublicVideo,
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
 * al massimo un poster lazy. Un media non pubblicato o incompleto non produce
 * alcun nodo: niente `src`, placeholder, cornice o richiesta di rete.
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

  if (!video.published || validatePublicVideo(video).length > 0) return null;

  const posterVariant = playableVariant(video, "landscape");
  if (!posterVariant) return null;

  if (!activated) {
    return (
      <button
        type="button"
        data-video-launch={video.id}
        aria-label={label}
        onClick={() => {
          setOrientation(currentOrientation());
          setActivated(true);
        }}
        className="group relative block w-full cursor-pointer overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)] p-0"
      >
        {/* Poster deliberatamente lazy: non è il video e non deve pesare sul
            primo hero, già occupato dal globo MapLibre. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterVariant.poster.src}
          alt=""
          loading="lazy"
          decoding="async"
          className="block h-auto w-full"
          style={{ aspectRatio: posterVariant.aspectRatio }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center bg-black/10 transition-colors group-hover:bg-black/20"
        >
          <span className="grid size-14 place-items-center rounded-full bg-black/75 pl-1 text-2xl text-white shadow-lg sm:size-16">
            ▶
          </span>
        </span>
      </button>
    );
  }

  if (!variant) return null;

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
