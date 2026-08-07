/**
 * Catalogo dei media del sito pubblico.
 *
 * Gli URL e i file non entrano qui finché il materiale non ha superato i gate
 * editoriali e tecnici. In particolare, una voce `published: false` non può
 * produrre un tag video, un poster, né una richiesta di rete.
 */

export type VideoOrientation = "landscape" | "portrait";

export type PendingVideoVariant = {
  aspectRatio: "16 / 9" | "9 / 16";
};

export type ReadyVideoVariant = PendingVideoVariant & {
  /** URL CDN deciso dall'operatore al momento della pubblicazione. */
  src: string;
  /** Poster leggero, richiesto per non scaricare il video prima del click. */
  poster: { src: string; bytes: number };
  /** Tracce sottotitoli/caption pubblicate insieme al video. */
  captions: readonly {
    src: string;
    srcLang: string;
    label: string;
    default?: boolean;
  }[];
};

type PendingVideo = {
  published: false;
  variants: Record<VideoOrientation, PendingVideoVariant>;
};

type ReadyVideo = {
  published: true;
  variants: Record<VideoOrientation, ReadyVideoVariant>;
};

export type PublicVideo = {
  id: "trailer" | "tutorial-game" | "tutorial-web";
  /** Fatti di montaggio, non copy destinato alla pagina. */
  durationSeconds?: number;
  /** Catena di derivazione verificabile; il credito musicale resta centralizzato in media-credits.ts. */
  provenance?: {
    approvedMaster: string;
    approvedMasterSha256: string;
    derivativeSha256: string;
    derivativeBytes: number;
    posterSha256: string;
  };
} & (PendingVideo | ReadyVideo);

export const PUBLIC_VIDEO_BUDGET = {
  /** Il player non è un costo del primo paint né del poster. */
  initialVideoBytes: 0,
  /** Il poster viene lazy-loadato quando la card entra nel viewport. */
  maxLazyPosterBytes: 160 * 1024,
} as const;

const landscape: PendingVideoVariant = { aspectRatio: "16 / 9" };
const portrait: PendingVideoVariant = { aspectRatio: "9 / 16" };

const homeVideoVariant = {
  aspectRatio: "16 / 9",
  src: "/media/home-video-r4-web.mp4",
  poster: {
    src: "/media/home-video-r4-poster.jpg",
    bytes: 11_031,
  },
  // Il montaggio è music-only: `zxx` indica correttamente assenza di
  // contenuto linguistico, evitando una falsa preferenza fra le sette lingue.
  captions: [
    {
      src: "/media/home-video-r4-music.vtt",
      srcLang: "zxx",
      label: "♪",
      default: true,
    },
  ],
} as const satisfies ReadyVideoVariant;

/**
 * Una voce passa a `published: true` soltanto dopo il GO editoriale e tecnico.
 * Le altre restano prive di URL, poster e caption fino alla pubblicazione.
 */
export const PUBLIC_VIDEOS = {
  trailer: {
    id: "trailer",
    durationSeconds: 57,
    published: true,
    provenance: {
      approvedMaster: "home-trailer-16x9-r4-six-fixes.mp4",
      approvedMasterSha256:
        "9f24ca9dfc0918d7f7a35b672f58300a2d6deb3722215409f4f0e93c542e3cf1",
      derivativeSha256:
        "2cf3eb15729ee0ad4fc0fe405626e3b166910a482d168ac6f76f6d00eba97e26",
      derivativeBytes: 5_702_863,
      posterSha256:
        "e52dd24b7387ee89eb8525600d942a6601954310f4326d37bfc1ea0ee6efe45c",
    },
    // Non esiste un montaggio 9:16 approvato per la home: su viewport
    // verticale usiamo lo stesso master 16:9, senza crop o contenuti diversi.
    variants: {
      landscape: homeVideoVariant,
      portrait: homeVideoVariant,
    },
  },
  game: {
    id: "tutorial-game",
    durationSeconds: 88,
    published: false,
    variants: { landscape, portrait },
  },
  web: {
    id: "tutorial-web",
    durationSeconds: 74,
    published: false,
    variants: { landscape, portrait },
  },
} as const satisfies Record<string, PublicVideo>;

export type PublicVideoKey = keyof typeof PUBLIC_VIDEOS;

export function orientationForViewport(isPortrait: boolean): VideoOrientation {
  return isPortrait ? "portrait" : "landscape";
}

/**
 * Il componente chiama questa funzione soltanto dopo un gesto esplicito.
 * Se la pubblicazione non è stata autorizzata torna `null`: nessun URL può
 * arrivare al DOM.
 */
export function playableVariant(
  video: PublicVideo,
  orientation: VideoOrientation,
): ReadyVideoVariant | null {
  if (!video.published) return null;

  const variant = video.variants[orientation];
  if (!variant.src || !variant.poster.src || variant.captions.length === 0)
    return null;

  return variant;
}

export function validatePublicVideo(video: PublicVideo): string[] {
  if (!video.published) return [];

  return (Object.keys(video.variants) as VideoOrientation[]).flatMap(
    (orientation) => {
      const variant = playableVariant(video, orientation);
      if (!variant) return [`${video.id}:${orientation} non è riproducibile`];
      if (variant.poster.bytes > PUBLIC_VIDEO_BUDGET.maxLazyPosterBytes) {
        return [`${video.id}:${orientation} poster oltre il budget`];
      }
      if (!variant.captions.some((caption) => caption.default)) {
        return [`${video.id}:${orientation} manca una caption predefinita`];
      }
      return [];
    },
  );
}

export function initialVideoBytes(video: PublicVideo): number {
  void video;
  // Il src del video viene inserito soltanto dopo il click: sempre zero al
  // primo paint, anche una volta pubblicato.
  return PUBLIC_VIDEO_BUDGET.initialVideoBytes;
}
