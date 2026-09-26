import type { ImgHTMLAttributes } from "react";

/** Stand-in for `next/image`: a plain <img>, without Next's optimiser. */
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
};

export default function Image({
  src,
  fill,
  priority: _priority,
  quality: _quality,
  placeholder: _placeholder,
  blurDataURL: _blur,
  unoptimized: _unoptimized,
  style,
  ...rest
}: Props) {
  const fillStyle = fill
    ? { position: "absolute" as const, inset: 0, width: "100%", height: "100%", objectFit: "cover" as const }
    : undefined;
  return <img src={typeof src === "string" ? src : src.src} style={{ ...fillStyle, ...style }} {...rest} />;
}
