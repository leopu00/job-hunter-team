import type { DownloadArtifact } from "@/lib/download-funnel";
import type { Lang } from "../components/landing/LandingI18n";

const INSTALLER_UNAVAILABLE: Record<Lang, string> = {
  en: "The Windows installer is temporarily unavailable. Please check back later.",
  it: "L’installer per Windows è temporaneamente non disponibile. Riprova più tardi.",
  es: "El instalador para Windows no está disponible temporalmente. Vuelve a intentarlo más tarde.",
  fr: "L’installateur Windows est temporairement indisponible. Réessayez plus tard.",
  de: "Der Windows-Installer ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.",
  pt: "O instalador para Windows está temporariamente indisponível. Tenta novamente mais tarde.",
  hu: "A Windows-telepítő átmenetileg nem érhető el. Kérjük, próbáld újra később.",
};

export function InstallerUnavailable({ lang }: { lang: Lang }) {
  return (
    <p
      role="status"
      className="text-[12px] leading-relaxed text-[var(--color-muted)]"
    >
      {INSTALLER_UNAVAILABLE[lang]}
    </p>
  );
}

/** Version and checksum belong to these bytes, independently of the site version. */
export default function DownloadArtifactDetails({
  artifact,
}: {
  artifact: Pick<
    DownloadArtifact,
    "version" | "filename" | "sha256" | "sizeBytes"
  >;
}) {
  return (
    <details className="min-w-0 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <summary className="cursor-pointer break-words">
        v{artifact.version} · {(artifact.sizeBytes / 1_000_000).toFixed(2)} MB
        <span className="block break-all font-mono">{artifact.filename}</span>
      </summary>
      <code className="mt-1 block break-all">SHA-256: {artifact.sha256}</code>
      <span className="block">{artifact.sizeBytes} B</span>
    </details>
  );
}
