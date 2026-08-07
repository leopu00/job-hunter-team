"use client";

import {
  PUBLIC_VIDEOS,
  validatePublicVideo,
} from "@/lib/public-video-manifest";
import { useLandingI18n } from "../landing/LandingI18n";
import DeferredVideo from "./DeferredVideo";

/**
 * Il video vive direttamente sulla home, senza titolo o cornice editoriale.
 * Se il manifest non è pubblicato o non è completo, l'intera sezione sparisce:
 * un media assente non deve mai lasciare un placeholder nel sito pubblico.
 */
export default function HomeTrailer() {
  const { t } = useLandingI18n();
  const video = PUBLIC_VIDEOS.trailer;

  if (!video.published || validatePublicVideo(video).length > 0) return null;

  return (
    <section id="trailer" data-trailer-inline className="mt-12 w-full px-6">
      <div className="mx-auto max-w-4xl">
        <DeferredVideo video={video} label={t("video_play_label")} />
      </div>
    </section>
  );
}
