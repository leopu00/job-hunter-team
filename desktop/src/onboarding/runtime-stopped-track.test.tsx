import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import type { OnboardingFlowProps, OnboardingRuntimeState } from "../lib/onboarding";
import { beginOnboardingActivityInvocation } from "../lib/onboarding-activity";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

/**
 * The runtime of this computer is stopped (the Podman machine is off after a restart) and the resume
 * offers to start the team. The Runtime and Container steps do not say «Ready» then: they say they are
 * stopped and will be turned on again, and the count of finished steps leaves them out.
 */

function renderTrack(runtime: OnboardingRuntimeState) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada" },
    platform: "windows",
    runtime,
    activity: beginOnboardingActivityInvocation(null, 0),
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onRuntimeAction: vi.fn().mockResolvedValue(undefined),
    providerLogin: null,
    sshHostKey: null,
    onConfirmHostKey: vi.fn().mockResolvedValue(undefined),
    onCancelHostKey: vi.fn(),
    onProviderInput: vi.fn().mockResolvedValue(undefined),
    onProviderClose: vi.fn().mockResolvedValue(undefined),
    onProviderRestart: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    onExitFailure: vi.fn(),
    locale: "it",
  };
  const { container } = render(<OnboardingFlow {...props} />);
  const rows = Array.from(container.querySelectorAll(".onboarding-runtime-track li")).map((row) => ({
    className: row.className,
    state: row.querySelector("em")?.textContent,
    mark: row.querySelector("span")?.textContent,
  }));
  const done = Number(container.querySelector("progress")?.getAttribute("value"));
  return { rows, done };
}

afterEach(() => {
  localStorage.removeItem("jht-lang");
});

describe("the steps of a resume whose runtime is stopped", () => {
  const t = ONBOARDING_TEXT.it;
  const message = "Il team è spento.";

  it("show Runtime and Container as stopped, not ready, and count only the steps really done", () => {
    localStorage.setItem("jht-lang", "it");
    const { rows, done } = renderTrack({ status: "action-required", stage: "team-start", message, runtimeStopped: true });
    // local host: runtime, container, provider, provider-login, team-start, assistant
    expect(rows.map((row) => row.state)).toEqual([
      t.trackStopped, t.trackStopped, t.trackReady, t.trackReady, t.trackWaiting, t.trackQueued,
    ]);
    expect(rows[0].className).toBe("is-stopped");
    expect(rows[1].className).toBe("is-stopped");
    expect(rows[0].mark).toBe("1");
    expect(rows[2].className).toBe("is-complete");
    // four steps come before the team start, two of them are stopped
    expect(done).toBe(2);
  });

  it("show them ready when the runtime is not stopped (the same screen without the mark)", () => {
    localStorage.setItem("jht-lang", "it");
    const { rows, done } = renderTrack({ status: "action-required", stage: "team-start", message });
    expect(rows.slice(0, 4).map((row) => row.state)).toEqual([t.trackReady, t.trackReady, t.trackReady, t.trackReady]);
    expect(rows.every((row) => row.className !== "is-stopped")).toBe(true);
    expect(done).toBe(4);
  });

  it("is said in the 7 languages, and never as the word for ready", () => {
    for (const locale of locales) {
      const copy = ONBOARDING_TEXT[locale];
      expect(copy.trackStopped, locale).toBeTruthy();
      expect(copy.trackStopped, locale).not.toBe(copy.trackReady);
    }
  });
});
