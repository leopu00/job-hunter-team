"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";

// ── i18n ───────────────────────────────────────────────────────────────────

const T: Record<string, Record<string, string>> = {
  zoomTitle: {
    it: "Zoom (Z)",
    en: "Zoom (Z)",
    hu: "Nagyítás (Z)",
    es: "Zoom (Z)",
    de: "Zoom (Z)",
    fr: "Zoom (Z)",
    pt: "Zoom (Z)",
  },
  zoomOut: {
    it: "Riduci zoom",
    en: "Zoom out",
    hu: "Kicsinyítés",
    es: "Reducir zoom",
    de: "Verkleinern",
    fr: "Dézoomer",
    pt: "Reduzir zoom",
  },
  zoomIn: {
    it: "Ingrandisci",
    en: "Zoom in",
    hu: "Nagyítás",
    es: "Ampliar",
    de: "Vergrößern",
    fr: "Agrandir",
    pt: "Ampliar",
  },
  closeTitle: {
    it: "Chiudi (Esc)",
    en: "Close (Esc)",
    hu: "Bezárás (Esc)",
    es: "Cerrar (Esc)",
    de: "Schließen (Esc)",
    fr: "Fermer (Échap)",
    pt: "Fechar (Esc)",
  },
  closeLightbox: {
    it: "Chiudi lightbox",
    en: "Close lightbox",
    hu: "Lightbox bezárása",
    es: "Cerrar lightbox",
    de: "Lightbox schließen",
    fr: "Fermer la visionneuse",
    pt: "Fechar lightbox",
  },
  prevImage: {
    it: "Immagine precedente",
    en: "Previous image",
    hu: "Előző kép",
    es: "Imagen anterior",
    de: "Vorheriges Bild",
    fr: "Image précédente",
    pt: "Imagem anterior",
  },
  nextImage: {
    it: "Immagine successiva",
    en: "Next image",
    hu: "Következő kép",
    es: "Imagen siguiente",
    de: "Nächstes Bild",
    fr: "Image suivante",
    pt: "Próxima imagem",
  },
};

// `Immagine N di M` (aria del dialog)
const IMAGE_OF: Record<string, (n: number, m: number) => string> = {
  it: (n, m) => `Immagine ${n} di ${m}`,
  en: (n, m) => `Image ${n} of ${m}`,
  hu: (n, m) => `${n}. kép / ${m}`,
  es: (n, m) => `Imagen ${n} de ${m}`,
  de: (n, m) => `Bild ${n} von ${m}`,
  fr: (n, m) => `Image ${n} sur ${m}`,
  pt: (n, m) => `Imagem ${n} de ${m}`,
};

// `Vai all'immagine N` (aria dei dot)
const GO_TO_IMAGE: Record<string, (n: number) => string> = {
  it: (n) => `Vai all'immagine ${n}`,
  en: (n) => `Go to image ${n}`,
  hu: (n) => `Ugrás a(z) ${n}. képre`,
  es: (n) => `Ir a la imagen ${n}`,
  de: (n) => `Zu Bild ${n} gehen`,
  fr: (n) => `Aller à l'image ${n}`,
  pt: (n) => `Ir para a imagem ${n}`,
};

// ── Types ──────────────────────────────────────────────────────────────────

export type GalleryImage = {
  src: string;
  alt?: string;
  caption?: string;
};

export type ImageGalleryProps = {
  images: GalleryImage[];
  columns?: number; // default 3
  gap?: number; // px, default 8
  className?: string;
};

// ── Lightbox ───────────────────────────────────────────────────────────────

type LightboxProps = {
  images: GalleryImage[];
  index: number;
  onClose: () => void;
  onNav: (i: number) => void;
};

function Lightbox({ images, index, onClose, onNav }: LightboxProps) {
  const img = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const [zoom, setZoom] = useState(false);
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
      if (e.key === "ArrowLeft" && hasPrev) onNav(index - 1);
      if (e.key === "ArrowRight" && hasNext) onNav(index + 1);
      if (e.key === "z" || e.key === "Z") setZoom((v) => !v);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, hasPrev, hasNext, onClose, onNav]);

  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-label={(IMAGE_OF[locale] ?? IMAGE_OF.en)(index + 1, images.length)}
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{
        zIndex: 9999,
        background: "rgba(0,0,0,0.92)",
        animation: "lb-in 0.18s ease",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
        }}
      >
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--color-dim)" }}
        >
          {index + 1} / {images.length}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setZoom((v) => !v)}
            title={tr("zoomTitle")}
            aria-label={zoom ? tr("zoomOut") : tr("zoomIn")}
            className="text-[11px] px-2 py-1 rounded transition-opacity hover:opacity-70"
            style={{
              background: zoom ? "var(--color-blue)22" : "transparent",
              color: zoom ? "var(--color-blue)" : "var(--color-dim)",
              border: `1px solid ${zoom ? "var(--color-blue)44" : "var(--color-border)"}`,
            }}
          >
            {zoom ? "⊖" : "⊕"}
          </button>
          <button
            onClick={onClose}
            title={tr("closeTitle")}
            aria-label={tr("closeLightbox")}
            className="text-[18px] leading-none hover:opacity-70 transition-opacity"
            style={{
              color: "var(--color-dim)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Prev */}
      {hasPrev && (
        <button
          onClick={() => onNav(index - 1)}
          aria-label={tr("prevImage")}
          className="absolute left-3 text-[24px] w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "var(--color-muted)",
            border: "1px solid var(--color-border)",
          }}
        >
          ‹
        </button>
      )}

      {/* Image */}
      <img
        src={img.src}
        alt={img.alt ?? ""}
        loading="lazy"
        decoding="async"
        onClick={() => setZoom((v) => !v)}
        className="transition-transform duration-200"
        style={{
          maxWidth: zoom ? "95vw" : "80vw",
          maxHeight: zoom ? "90vh" : "75vh",
          objectFit: "contain",
          borderRadius: 8,
          cursor: zoom ? "zoom-out" : "zoom-in",
          transform: zoom ? "scale(1.05)" : "scale(1)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
      />

      {/* Next */}
      {hasNext && (
        <button
          onClick={() => onNav(index + 1)}
          aria-label={tr("nextImage")}
          className="absolute right-3 text-[24px] w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "var(--color-muted)",
            border: "1px solid var(--color-border)",
          }}
        >
          ›
        </button>
      )}

      {/* Caption + dots */}
      <div
        className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-2 px-4 pb-4"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
        }}
      >
        {img.caption && (
          <p
            className="text-[11px] text-center max-w-lg"
            style={{ color: "var(--color-muted)" }}
          >
            {img.caption}
          </p>
        )}
        <div className="flex gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => onNav(i)}
              aria-label={(GO_TO_IMAGE[locale] ?? GO_TO_IMAGE.en)(i + 1)}
              className="rounded-full transition-all"
              style={{
                width: i === index ? 16 : 6,
                height: 6,
                background:
                  i === index ? "var(--color-blue)" : "var(--color-dim)",
                border: "none",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      </div>

      <style>{`@keyframes lb-in { from { opacity:0 } to { opacity:1 } }`}</style>
    </div>
  );
}

// ── ImageGallery ───────────────────────────────────────────────────────────

export function ImageGallery({
  images,
  columns = 3,
  gap = 8,
  className,
}: ImageGalleryProps) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const close = useCallback(() => setLightbox(null), []);
  const nav = useCallback((i: number) => setLightbox(i), []);

  if (!images.length) return null;

  return (
    <>
      <div
        className={`grid ${className ?? ""}`}
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap }}
      >
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setLightbox(i)}
            className="relative overflow-hidden rounded-lg group transition-transform hover:scale-[1.02]"
            style={{
              aspectRatio: "4/3",
              background: "var(--color-deep)",
              border: "1px solid var(--color-border)",
              cursor: "zoom-in",
              padding: 0,
            }}
          >
            <img
              src={img.src}
              alt={img.alt ?? ""}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-opacity group-hover:opacity-80"
            />
            {img.caption && (
              <div
                className="absolute bottom-0 left-0 right-0 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "rgba(0,0,0,0.7)" }}
              >
                <p
                  className="text-[9px] truncate"
                  style={{ color: "var(--color-muted)" }}
                >
                  {img.caption}
                </p>
              </div>
            )}
          </button>
        ))}
      </div>

      {lightbox !== null && (
        <Lightbox
          images={images}
          index={lightbox}
          onClose={close}
          onNav={nav}
        />
      )}
    </>
  );
}
