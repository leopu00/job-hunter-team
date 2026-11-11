import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HARNESS_CHOICE_TEXT } from "./harness-choice.i18n";
import { parseHarnessChoice, type HarnessChoice as Choice, type HarnessOutcome } from "../../lib/harness-choice";
import { locales } from "@/i18n/config";
import HarnessChoice from "./HarnessChoice";

// «Program of the agents» in the Settings «Provider» card: Codex or Pi, the command of Pi's sign-in, and what is
// shown when there is nothing to choose. Synthetic replies only.
const choice = (over: Partial<Choice> = {}): HarnessOutcome => ({
  ok: true,
  value: { harness: "codex", provider: "openai", piAllowed: true, login: "signed_out", loginFound: [], ...over },
});

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
});
afterEach(cleanup);

describe("HarnessChoice", () => {
  it("shows nothing where Pi cannot be chosen, or where the choice cannot be read", async () => {
    for (const read of [async () => choice({ piAllowed: false }), async () => ({ ok: false, code: "harness_unavailable" }) as HarnessOutcome, async () => Promise.reject(new Error("x"))]) {
      const view = render(<HarnessChoice read={read} set={vi.fn()} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByTestId("harness-choice")).toBeNull();
      view.unmount();
    }
  });

  it("changes nothing until «Applica», then says the team must be restarted", async () => {
    const user = userEvent.setup();
    const set = vi.fn(async () => choice({ harness: "pi" }));
    render(<HarnessChoice read={async () => choice()} set={set} />);
    const apply = await screen.findByTestId("harness-apply");
    expect(apply).toBeDisabled();
    await user.click(screen.getByLabelText(/^Pi/));
    expect(set).not.toHaveBeenCalled();
    await user.click(apply);
    expect(set).toHaveBeenCalledWith("pi");
    expect(await screen.findByTestId("harness-saved")).toHaveTextContent("riavvia la squadra");
  });

  it("with Pi shows its login state and the command to run in a terminal, copyable", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const reads = [choice({ harness: "pi" }), choice({ harness: "pi", login: "signed_in" })];
    render(<HarnessChoice read={async () => reads.shift() ?? choice({ harness: "pi", login: "signed_in" })} set={vi.fn()} />);
    expect(await screen.findByTestId("harness-command")).toHaveTextContent("jht oauth-login");
    expect(screen.getByTestId("harness-login")).toHaveAttribute("data-login", "signed_out");
    await user.click(screen.getByTestId("harness-copy"));
    expect(writeText).toHaveBeenCalledWith("jht oauth-login");
    await user.click(screen.getByTestId("harness-recheck"));
    await waitFor(() => expect(screen.getByTestId("harness-login")).toHaveAttribute("data-login", "signed_in"));
    expect(screen.queryByTestId("harness-command")).toBeNull();
  });

  it("an API key needs no login, and Codex shows no login box", async () => {
    render(<HarnessChoice read={async () => choice({ harness: "pi", provider: "glm", login: "not_needed" })} set={vi.fn()} />);
    await screen.findByTestId("harness-choice");
    expect(screen.queryByTestId("harness-login")).toBeNull();
    cleanup();
    render(<HarnessChoice read={async () => choice()} set={vi.fn()} />);
    await screen.findByTestId("harness-choice");
    expect(screen.queryByTestId("harness-login")).toBeNull();
  });

  it("a refused or failed change is told in the person's words, and the choice stays as it was", async () => {
    const user = userEvent.setup();
    const set = vi.fn(async (): Promise<HarnessOutcome> => ({ ok: false, code: "harness_refused" }));
    render(<HarnessChoice read={async () => choice()} set={set} />);
    await user.click(await screen.findByLabelText(/^Pi/));
    await user.click(screen.getByTestId("harness-apply"));
    expect(await screen.findByTestId("harness-error")).toHaveTextContent("non possono usare Pi");
    expect(screen.queryByTestId("harness-saved")).toBeNull();
    // an answer about the other program than the one asked is no success
    const wrong = vi.fn(async () => choice({ harness: "codex" }));
    cleanup();
    render(<HarnessChoice read={async () => choice()} set={wrong} />);
    await user.click(await screen.findByLabelText(/^Pi/));
    await user.click(screen.getByTestId("harness-apply"));
    expect(await screen.findByTestId("harness-error")).toBeInTheDocument();
  });
});

describe("the closed reply", () => {
  it("accepts the shape of the native command and nothing else", () => {
    expect(parseHarnessChoice({ harness: "pi", provider: "openai", piAllowed: true, login: "signed_in" })).not.toBeNull();
    for (const bad of [null, [], { harness: "opencode", provider: "openai", piAllowed: true, login: "signed_in" }, { harness: "pi", provider: "../x", piAllowed: true, login: "signed_in" }, { harness: "pi", provider: "openai", piAllowed: "yes", login: "signed_in" }, { harness: "pi", provider: "openai", piAllowed: true, login: "/etc/x" }]) {
      expect(parseHarnessChoice(bad)).toBeNull();
    }
  });

  it("has the text in every language of the app", () => {
    for (const locale of locales) {
      expect(Object.keys(HARNESS_CHOICE_TEXT[locale]).sort(), locale).toEqual(Object.keys(HARNESS_CHOICE_TEXT.it).sort());
    }
  });
});
