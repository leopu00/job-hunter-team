import type {
  ExecutionHost,
  OnboardingRuntimeState,
} from "../lib/onboarding";
import { appLocale } from "../lib/app-locale";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import "./onboarding-artwork.css";

export const ONBOARDING_ARTWORK = {
  identity: {
    src: "/onboarding/identity.webp",
  },
  environmentComputer: {
    src: "/onboarding/environment-computer-v2.webp",
  },
  environmentVps: {
    src: "/onboarding/environment-vps-v2.webp",
  },
  provider: {
    src: "/onboarding/provider-v2.webp",
  },
  providerAuth: {
    src: "/onboarding/provider-auth.webp",
  },
  runtime: {
    src: "/onboarding/runtime.webp",
  },
  teamStart: {
    src: "/onboarding/team-start.webp",
  },
  assistantReady: {
    src: "/onboarding/assistant-ready.webp",
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
        alt={ONBOARDING_TEXT[appLocale()].artwork[name]}
        width={1600}
        height={1200}
        decoding="async"
      />
    </figure>
  );
}
