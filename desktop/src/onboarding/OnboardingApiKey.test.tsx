import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { describeError } from "../lib/error-catalog";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_API_KEY_TEXT } from "./onboarding-api-key.i18n";

afterEach(cleanup);

// built from pieces: a literal named like a key is what a secret scanner looks for
const SYNTHETIC = ["synthetic", "value", "for", "the", "test", "0000"].join("-");

function renderFlow(overrides: Partial<OnboardingFlowProps> = {}) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada" },
    platform: "macos",
    runtime: { status: "collecting", stage: "host" },
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onStageProviderKey: vi.fn().mockResolvedValue(undefined),
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
    ...overrides,
  };
  return { ...render(<OnboardingFlow {...props} />), props };
}

async function reachProvider(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /inizia la configurazione/i }));
  await screen.findByRole("heading", { name: /scegli l’ambiente/i });
  await user.click(screen.getByRole("button", { name: /^continua/i }));
  await screen.findByRole("heading", { name: /scegli il provider/i });
}

const t = ONBOARDING_API_KEY_TEXT.it;

describe("the first setup with an API key (glm or kimi)", () => {
  it("offers the two providers with a key under the subscription, in the first setup only", async () => {
    const user = userEvent.setup();
    renderFlow();
    await reachProvider(user);
    expect(screen.getByTestId("api-key-choice")).toHaveTextContent(t.title);
    expect(screen.getByTestId("api-key-provider-glm")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("api-key-provider-kimi")).toBeInTheDocument();
    expect(screen.queryByTestId("api-key-input")).toBeNull();
    cleanup();
    // the reopened Provider step changes the provider of a team that exists: the subscription's way only
    renderFlow({ account: { displayName: "Ada", identity: "local" }, providerOnly: { onCancel: vi.fn() } });
    await screen.findByRole("radio", { name: /codex/i });
    expect(screen.queryByTestId("api-key-choice")).toBeNull();
  });

  it("stages the key BEFORE the setup, sends the setup without it, and empties the field", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const onStageProviderKey = vi.fn().mockImplementation(async () => { order.push("stage"); });
    const onSubmit = vi.fn().mockImplementation(async () => { order.push("submit"); });
    renderFlow({ onStageProviderKey, onSubmit });
    await reachProvider(user);
    await user.click(screen.getByTestId("api-key-provider-glm"));
    const input = screen.getByTestId("api-key-input") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(screen.getByRole("button", { name: /rivedi il setup/i })).toBeDisabled();
    await user.type(input, SYNTHETIC);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    // the review names the provider and says the key is not shown, and has no trace of the key
    expect(await screen.findByText(t.review)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SYNTHETIC);
    await user.click(screen.getByRole("button", { name: /prepara la squadra/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onStageProviderKey).toHaveBeenCalledWith("glm", SYNTHETIC);
    expect(order).toEqual(["stage", "submit"]);
    expect(onSubmit).toHaveBeenCalledWith({ host: { kind: "local" }, provider: "codex", apiKeyProvider: "glm" });
    expect(JSON.stringify(onSubmit.mock.calls)).not.toContain(SYNTHETIC);
    expect(document.body.innerHTML).not.toContain(SYNTHETIC);
  });

  it("does not go on with a key that is not one line of 16 to 512 characters without spaces", async () => {
    const user = userEvent.setup();
    renderFlow();
    await reachProvider(user);
    await user.click(screen.getByTestId("api-key-provider-kimi"));
    await user.type(screen.getByTestId("api-key-input"), "two words in one key 0000");
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    expect(await screen.findByTestId("api-key-shape")).toHaveTextContent(t.shape);
    expect(screen.getByRole("heading", { name: /scegli il provider/i })).toBeInTheDocument();
  });

  it("does not start the setup when the native side does not keep the key, and says why with the catalog's sentence", async () => {
    const user = userEvent.setup();
    const onStageProviderKey = vi.fn().mockRejectedValue({ code: "provider_key_invalid" });
    const { props } = renderFlow({ onStageProviderKey });
    await reachProvider(user);
    await user.click(screen.getByTestId("api-key-provider-glm"));
    await user.type(screen.getByTestId("api-key-input"), SYNTHETIC);
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(await screen.findByRole("button", { name: /prepara la squadra/i }));
    expect(await screen.findByTestId("api-key-error")).toHaveTextContent(describeError("provider_key_invalid", { locale: "it" }).text);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(SYNTHETIC);
  });

  it("goes back to the subscription: the key is forgotten and the setup is the subscription's", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await reachProvider(user);
    await user.click(screen.getByTestId("api-key-provider-glm"));
    await user.type(screen.getByTestId("api-key-input"), SYNTHETIC);
    await user.click(screen.getByRole("radio", { name: /codex/i }));
    expect(screen.queryByTestId("api-key-input")).toBeNull();
    await user.click(screen.getByRole("button", { name: /rivedi il setup/i }));
    await user.click(await screen.findByRole("button", { name: /prepara la squadra/i }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith({ host: { kind: "local" }, provider: "codex" }));
    expect(props.onStageProviderKey).not.toHaveBeenCalled();
  });

  it("has the words in the seven languages", () => {
    for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"] as const) {
      const words = ONBOARDING_API_KEY_TEXT[locale];
      for (const value of Object.values(words)) expect(value.trim().length, locale).toBeGreaterThan(2);
    }
    for (const code of ["provider_key_missing", "provider_key_refused", "provider_key_invalid"]) {
      for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"]) expect(describeError(code, { locale }).known, `${code}/${locale}`).toBe(true);
    }
  });
});
