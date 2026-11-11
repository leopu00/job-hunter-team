import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KeyRefusedNotice from "./KeyRefusedNotice";
import { describeError } from "../lib/error-catalog";
import { forgetKeyRefusedRead, isAccessRefused, keyRefusedCode } from "../lib/key-refused";
import type { HarnessChoice, HarnessOutcome } from "../lib/harness-choice";

const refused = { state: "bloccato", reason: "accesso_scaduto" } as const;
const choice = (over: Partial<HarnessChoice> = {}): HarnessOutcome => ({
  ok: true,
  value: { harness: "pi", provider: "glm", piAllowed: true, login: "not_needed", loginFound: [], ...over },
});

beforeEach(() => forgetKeyRefusedRead());
afterEach(cleanup);

describe("the notice of a blocked agent whose API key was refused", () => {
  it("says the key was refused and the command, for a team on glm with a key", async () => {
    const read = vi.fn().mockResolvedValue(choice());
    render(<KeyRefusedNotice state={refused} read={read} />);
    const note = await screen.findByTestId("key-refused-notice");
    expect(note).toHaveTextContent("GLM (Z.ai)");
    expect(note).toHaveTextContent("jht setup --non-interactive --provider glm --harness pi --api-key-file <file>");
    expect(note).toHaveTextContent("--api-key-stdin");
    expect(note).toHaveTextContent("jht team stop");
    expect(note).toHaveTextContent("jht team start");
  });

  it("names kimi, and Moonshot's own name for it, with the kimi command", async () => {
    for (const provider of ["kimi", "moonshot"]) {
      forgetKeyRefusedRead();
      const { unmount } = render(<KeyRefusedNotice state={refused} read={vi.fn().mockResolvedValue(choice({ provider }))} />);
      const note = await screen.findByTestId("key-refused-notice");
      expect(note).toHaveTextContent("--provider kimi --harness pi");
      unmount();
    }
  });

  it("says nothing for a team that works with a login: the catalog's own line stands", async () => {
    const read = vi.fn().mockResolvedValue(choice({ provider: "openai", login: "signed_out" }));
    render(<KeyRefusedNotice state={refused} read={read} />);
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByTestId("key-refused-notice")).toBeNull();
  });

  it("says nothing on Codex, or when the team cannot be read", async () => {
    render(<KeyRefusedNotice state={refused} read={vi.fn().mockResolvedValue(choice({ harness: "codex" }))} />);
    await act(async () => undefined);
    expect(screen.queryByTestId("key-refused-notice")).toBeNull();
    cleanup();
    forgetKeyRefusedRead();
    render(<KeyRefusedNotice state={refused} read={vi.fn().mockResolvedValue({ ok: false, code: "harness_unavailable" })} />);
    await act(async () => undefined);
    expect(screen.queryByTestId("key-refused-notice")).toBeNull();
  });

  it("does not even read the team for an agent that is not blocked for this reason", async () => {
    const read = vi.fn().mockResolvedValue(choice());
    for (const state of [{ state: "lavora" }, { state: "bloccato", reason: "limite_5h" }, { state: "bloccato", reason: "rete" }, null, undefined] as const) {
      render(<KeyRefusedNotice state={state} read={read} />);
    }
    await act(async () => undefined);
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByTestId("key-refused-notice")).toBeNull();
  });

  it("reads the team once for the several lines of a screen", async () => {
    const read = vi.fn().mockResolvedValue(choice());
    render(<><KeyRefusedNotice state={refused} read={read} /><KeyRefusedNotice state={refused} read={read} /></>);
    await waitFor(() => expect(screen.getAllByTestId("key-refused-notice")).toHaveLength(2));
    render(<KeyRefusedNotice state={refused} read={read} />);
    await waitFor(() => expect(screen.getAllByTestId("key-refused-notice")).toHaveLength(3));
    expect(read.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("the rule", () => {
  it("is the access refusal of a blocked agent", () => {
    expect(isAccessRefused(refused)).toBe(true);
    expect(isAccessRefused({ state: "idle", reason: "accesso_scaduto" })).toBe(false);
  });

  it("is a team on Pi with a provider used with a key", () => {
    expect(keyRefusedCode(null)).toBeNull();
    const value = (choice() as { ok: true; value: HarnessChoice }).value;
    expect(keyRefusedCode(value)).toBe("agent_key_refused_glm");
    expect(keyRefusedCode({ ...value, provider: "openai" })).toBeNull();
    expect(keyRefusedCode({ ...value, login: "signed_in" })).toBeNull();
  });

  it("has the sentence and the command in all seven languages, with the right provider command", () => {
    for (const code of ["agent_key_refused_glm", "agent_key_refused_kimi"]) {
      const name = code.endsWith("glm") ? "glm" : "kimi";
      for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"]) {
        const told = describeError(code, { locale });
        expect(told.known, `${code}/${locale}`).toBe(true);
        expect(told.action, `${code}/${locale}`).toContain(`--provider ${name} --harness pi --api-key-file <file>`);
        expect(told.action, `${code}/${locale}`).toContain("--api-key-stdin");
        expect(told.action, `${code}/${locale}`).toContain("jht team start");
      }
    }
  });
});
