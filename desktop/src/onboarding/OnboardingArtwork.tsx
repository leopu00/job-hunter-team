import type {
  ExecutionHost,
  OnboardingRuntimeState,
} from "../lib/onboarding";
import "./onboarding-artwork.css";

export const ONBOARDING_ARTWORK = {
  identity: {
    src: "/onboarding/identity.webp",
    alt: "Due percorsi di identità convergono nello stesso ingresso sicuro.",
  },
  environmentComputer: {
    src: "/onboarding/environment-computer-v2.webp",
    alt: "Il computer proietta l’ufficio del team in una box luminosa.",
  },
  environmentVps: {
    src: "/onboarding/environment-vps-v2.webp",
    alt: "La VPS proietta l’ufficio del team in una box luminosa.",
  },
  provider: {
    src: "/onboarding/provider-v2.webp",
    alt: "Una rete neurale collega in modo paritario Claude, Codex e Kimi.",
  },
  providerAuth: {
    src: "/onboarding/provider-auth.webp",
    alt: "Un accesso sicuro collega il dispositivo al provider.",
  },
  runtime: {
    src: "/onboarding/runtime.webp",
    alt: "Il runtime prepara e verifica un container.",
  },
  teamStart: {
    src: "/onboarding/team-start.webp",
    alt: "Gli agenti entrano nell’ufficio mentre il team si avvia.",
  },
  assistantReady: {
    src: "/onboarding/assistant-ready.webp",
    alt: "L’Assistente accoglie l’utente davanti all’ufficio pronto.",
  },
} as const;

export type OnboardingArtworkName = keyof typeof ONBOARDING_ARTWORK;

export function collectionArtwork(
  step: number,
  host: ExecutionHost,
): OnboardingArtworkName {
  if (step === 0) return "identity";
  if (step === 1) return host.kind === "local" ? "environmentComputer" : "environmentVps";
  if (step === 2) return "provider";
  return "runtime";
}

export function runtimeArtwork(runtime: OnboardingRuntimeState): OnboardingArtworkName {
  if (runtime.status === "ready") return "assistantReady";
  if (runtime.status === "collecting") return "identity";
  if (runtime.stage === "ssh-host-key") return "runtime";
  if (runtime.stage === "provider-login") return "providerAuth";
  if (runtime.stage === "team-start") return "teamStart";
  if (runtime.stage === "assistant") return "assistantReady";
  return "runtime";
}

export function OnboardingArtwork({
  name,
  className = "",
}: {
  name: OnboardingArtworkName;
  className?: string;
}) {
  const artwork = ONBOARDING_ARTWORK[name];
  return (
    <figure className={`onboarding-artwork${className ? ` ${className}` : ""}`}>
      <img
        src={artwork.src}
        alt={artwork.alt}
        width={1600}
        height={1200}
        decoding="async"
      />
    </figure>
  );
}
