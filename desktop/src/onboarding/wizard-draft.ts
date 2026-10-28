import type { ExecutionHost, OnboardingDraft, SubscriptionProvider } from "../lib/onboarding";

export interface WizardStart {
  step: number;
  host: ExecutionHost;
  provider: SubscriptionProvider | null;
  /** The wizard opens on a step the person had already reached (not on the welcome). */
  restored: boolean;
}

const sameHost = (a: ExecutionHost, b: ExecutionHost): boolean =>
  a.kind === "local" ? b.kind === "local"
    : b.kind === "vps" && a.address === b.address && a.user === b.user && a.port === b.port && a.keyPath === b.keyPath;

/** Whether the wizard is still as a first visit finds it: nothing worth remembering. */
export function isUntouched(
  state: { step: number; host: ExecutionHost; provider: SubscriptionProvider | null },
  fresh: Pick<WizardStart, "host" | "provider">,
): boolean {
  return state.step === 0 && state.provider === fresh.provider && sameHost(state.host, fresh.host);
}

/**
 * Where the wizard opens. The draft is only a proposal: a step is kept only if what it needs is still there
 * (a valid VPS for the steps after the environment, a provider the app still offers for the review), a computer
 * that can no longer run the team falls back to a VPS, and a setup that stopped half-way opens on the welcome,
 * where its «Resume / Start over» note is.
 */
export function wizardStart(
  draft: OnboardingDraft | undefined,
  fresh: Pick<WizardStart, "host" | "provider">,
  offered: readonly SubscriptionProvider[],
  localRuntimeSupported: boolean,
  interrupted: boolean,
): WizardStart {
  if (!draft) return { step: 0, ...fresh, restored: false };
  let host = draft.host;
  let step = draft.step;
  if (host.kind === "local" && !localRuntimeSupported) {
    host = fresh.host;
    step = Math.min(step, 1);
  }
  const hostReady = host.kind === "local" || Boolean(host.address.trim() && host.user.trim() && host.port > 0 && host.port <= 65535 && host.keyPath.trim());
  if (!hostReady) step = Math.min(step, 1);
  const provider = draft.provider !== null && offered.includes(draft.provider) ? draft.provider : fresh.provider;
  if (step >= 3 && provider === null) step = 2;
  if (interrupted) step = 0;
  return { step, host, provider, restored: step > 0 };
}
