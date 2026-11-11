import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import type { HarnessChoice, HarnessOutcome } from "../../lib/harness-choice";
import { apiKeyProviderOf } from "../../lib/key-refused";
import { keyShapeOk, saveProviderKey } from "../../lib/provider-key";
import ProviderKeyCard from "./ProviderKeyCard";

afterEach(cleanup);

// built from pieces: a literal named like a key is what a secret scanner looks for
const SYNTHETIC = ["synthetic", "value", "for", "the", "test", "0000"].join("-");
const team = (over: Partial<HarnessChoice> = {}): HarnessOutcome => ({
  ok: true,
  value: { harness: "pi", provider: "glm", piAllowed: true, login: "not_needed", loginFound: [], ...over },
});

describe("ProviderKeyCard", () => {
  it("is offered only to a team that already works with a glm or kimi key", async () => {
    for (const outcome of [
      team({ harness: "codex", login: "signed_in", provider: "openai" }),
      team({ login: "signed_out", provider: "openai" }),
      team({ provider: "claude" }),
      { ok: false, code: "harness_unavailable" } as HarnessOutcome,
    ]) {
      const read = vi.fn().mockResolvedValue(outcome);
      const { container, unmount } = render(<ProviderKeyCard read={read} save={vi.fn()} />);
      await waitFor(() => expect(read).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
    const { unmount } = render(<ProviderKeyCard read={vi.fn().mockResolvedValue(team())} save={vi.fn()} />);
    expect(await screen.findByTestId("settings-provider-key")).toHaveTextContent("GLM (Z.ai)");
    unmount();
  });

  it("sends the key of the provider the team has, empties the field at once and says to restart the team", async () => {
    let finish: (value: { ok: true; state: "saved" }) => void = () => undefined;
    const save = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<ProviderKeyCard read={vi.fn().mockResolvedValue(team({ provider: "moonshot" }))} save={save} />);
    const input = (await screen.findByTestId("provider-key-input")) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input).toHaveAttribute("autocomplete", "off");
    await userEvent.type(input, SYNTHETIC);
    await userEvent.click(screen.getByTestId("provider-key-save"));
    expect(save).toHaveBeenCalledWith("kimi", SYNTHETIC);
    // while the setup runs the page holds no copy of the key
    expect(input.value).toBe("");
    expect(document.body.innerHTML).not.toContain(SYNTHETIC);
    finish({ ok: true, state: "saved" });
    expect(await screen.findByTestId("provider-key-saved")).toBeInTheDocument();
    expect(input.value).toBe("");
    expect(document.body.innerHTML).not.toContain(SYNTHETIC);
  });

  it("tells a key the provider refused, and a failure with the catalog's sentence, never with the key", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: true, state: "refused" }).mockResolvedValueOnce({ ok: false, code: "provider_key_failed" });
    render(<ProviderKeyCard read={vi.fn().mockResolvedValue(team())} save={save} />);
    const input = await screen.findByTestId("provider-key-input");
    await userEvent.type(input, SYNTHETIC);
    await userEvent.click(screen.getByTestId("provider-key-save"));
    expect(await screen.findByTestId("provider-key-refused")).toHaveTextContent("GLM (Z.ai)");
    await userEvent.type(input, SYNTHETIC);
    await userEvent.click(screen.getByTestId("provider-key-save"));
    const alert = await screen.findByTestId("provider-key-error");
    expect(alert).toHaveTextContent(describeError("provider_key_failed", { locale: "it" }).text);
    expect(alert).not.toHaveTextContent("provider_key_failed");
    expect(screen.queryByTestId("provider-key-refused")).toBeNull();
    expect(document.body.innerHTML).not.toContain(SYNTHETIC);
  });

  it("does not send a key that is not one line of 16 to 512 printable characters", async () => {
    const save = vi.fn();
    render(<ProviderKeyCard read={vi.fn().mockResolvedValue(team())} save={save} />);
    const input = await screen.findByTestId("provider-key-input");
    await userEvent.type(input, "two words in one key 0000");
    await userEvent.click(screen.getByTestId("provider-key-save"));
    expect(await screen.findByTestId("provider-key-shape")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("the key on its way to the native side", () => {
  it("has the shape the setup asks for", () => {
    expect(keyShapeOk(SYNTHETIC)).toBe(true);
    expect(keyShapeOk(`  ${SYNTHETIC}\n`)).toBe(true);
    for (const bad of ["", "short", "k".repeat(513), "with space inside the key 0000", "è".repeat(20)]) expect(keyShapeOk(bad)).toBe(false);
  });

  it("is answered with one of two words or a code, out of the page when there is no app", async () => {
    expect(await saveProviderKey("glm", SYNTHETIC)).toEqual({ ok: false, code: "desktop_only" });
  });

  it("names the provider of a team on a key, and nothing for a team on a login", () => {
    const value = (team() as { ok: true; value: HarnessChoice }).value;
    expect(apiKeyProviderOf(value)).toBe("glm");
    expect(apiKeyProviderOf({ ...value, provider: "moonshot" })).toBe("kimi");
    expect(apiKeyProviderOf({ ...value, login: "signed_out" })).toBeNull();
    expect(apiKeyProviderOf(null)).toBeNull();
  });

  it("has every error of the key in the catalog, in seven languages", () => {
    for (const code of ["provider_key_invalid", "provider_key_provider_invalid", "provider_key_failed"]) {
      for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"]) {
        expect(describeError(code, { locale }).known, `${code}/${locale}`).toBe(true);
      }
    }
  });
});
