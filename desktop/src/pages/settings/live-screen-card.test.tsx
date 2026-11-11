import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import { parseScreenState, type ScreenOutcome, type ScreenState } from "../../lib/screen-control";
import { LIVE_SCREEN_CARD_TEXT } from "./live-screen-card.i18n";
import LiveScreenCard from "./LiveScreenCard";

afterEach(cleanup);

const state = (value: ScreenState): ScreenOutcome => ({ ok: true, state: value });
const t = LIVE_SCREEN_CARD_TEXT.it;

describe("LiveScreenCard", () => {
  it("offers to turn the screen on when it is off, and shows only the state read after the change", async () => {
    const read = vi.fn().mockResolvedValue(state("not_installed"));
    const set = vi.fn().mockResolvedValue(state("running"));
    render(<LiveScreenCard read={read} set={set} open={vi.fn()} />);
    const on = await screen.findByTestId("live-screen-on");
    expect(screen.getByTestId("live-screen-state")).toHaveAttribute("data-state", "not_installed");
    expect(screen.queryByTestId("live-screen-open")).toBeNull();
    await userEvent.click(on);
    expect(set).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByTestId("live-screen-state")).toHaveAttribute("data-state", "running"));
    expect(screen.getByTestId("live-screen-open")).toBeInTheDocument();
    expect(screen.getByTestId("live-screen-off")).toBeInTheDocument();
    expect(screen.queryByTestId("live-screen-on")).toBeNull();
  });

  it("says that the first time takes minutes while it turns on, and blocks a second click", async () => {
    let finish: (value: ScreenOutcome) => void = () => undefined;
    const set = vi.fn().mockReturnValue(new Promise<ScreenOutcome>((resolve) => { finish = resolve; }));
    render(<LiveScreenCard read={vi.fn().mockResolvedValue(state("ready"))} set={set} open={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("live-screen-on"));
    expect(screen.getByTestId("live-screen-state")).toHaveTextContent(t.turningOn);
    expect(screen.getByTestId("live-screen-on")).toBeDisabled();
    await userEvent.click(screen.getByTestId("live-screen-on"));
    expect(set).toHaveBeenCalledTimes(1);
    finish(state("running"));
    await waitFor(() => expect(screen.getByTestId("live-screen-open")).toBeInTheDocument());
  });

  it("opens the window of the screen, and turns the screen off", async () => {
    const open = vi.fn().mockResolvedValue(true);
    const set = vi.fn().mockResolvedValue(state("ready"));
    render(<LiveScreenCard read={vi.fn().mockResolvedValue(state("running"))} set={set} open={open} />);
    await userEvent.click(await screen.findByTestId("live-screen-open"));
    expect(open).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("live-screen-off"));
    expect(set).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByTestId("live-screen-state")).toHaveAttribute("data-state", "ready"));
    expect(screen.getByTestId("live-screen-on")).toBeInTheDocument();
  });

  it("tells a failed change with the catalog's sentence, never the raw code, and keeps the state it had", async () => {
    const set = vi.fn().mockResolvedValue({ ok: false, code: "screen_unavailable" });
    render(<LiveScreenCard read={vi.fn().mockResolvedValue(state("not_installed"))} set={set} open={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("live-screen-on"));
    const alert = await screen.findByTestId("live-screen-error");
    const told = describeError("screen_unavailable", { locale: "it" });
    expect(told.known).toBe(true);
    expect(alert).toHaveTextContent(told.text);
    expect(alert).not.toHaveTextContent("screen_unavailable");
    expect(screen.getByTestId("live-screen-state")).toHaveAttribute("data-state", "not_installed");
  });

  it("tells a window that did not open", async () => {
    const open = vi.fn().mockRejectedValue({ code: "window_failed" });
    render(<LiveScreenCard read={vi.fn().mockResolvedValue(state("running"))} set={vi.fn()} open={open} />);
    await userEvent.click(await screen.findByTestId("live-screen-open"));
    expect(await screen.findByTestId("live-screen-error")).toHaveTextContent(describeError("window_failed", { locale: "it" }).text);
  });

  it("is not shown where the screen cannot be switched from the app", async () => {
    for (const code of ["desktop_only", "screen_local_only"]) {
      const read = vi.fn().mockResolvedValue({ ok: false, code });
      const { container, unmount } = render(<LiveScreenCard read={read} set={vi.fn()} open={vi.fn()} />);
      await waitFor(() => expect(read).toHaveBeenCalled());
      await waitFor(() => expect(container).toBeEmptyDOMElement());
      unmount();
    }
  });

  it("says it cannot tell and offers to check again when the read fails", async () => {
    const read = vi.fn().mockResolvedValueOnce({ ok: false, code: "timeout" }).mockResolvedValue(state("running"));
    render(<LiveScreenCard read={read} set={vi.fn()} open={vi.fn()} />);
    expect(await screen.findByTestId("live-screen-error")).toBeInTheDocument();
    expect(screen.getByTestId("live-screen-state")).toHaveAttribute("data-state", "unknown");
    await userEvent.click(screen.getByTestId("live-screen-recheck"));
    await waitFor(() => expect(screen.getByTestId("live-screen-state")).toHaveAttribute("data-state", "running"));
    expect(screen.queryByTestId("live-screen-error")).toBeNull();
  });

  it("does not offer to turn on a screen that is downloading", async () => {
    render(<LiveScreenCard read={vi.fn().mockResolvedValue(state("downloading"))} set={vi.fn()} open={vi.fn()} />);
    await screen.findByTestId("live-screen-recheck");
    expect(screen.queryByTestId("live-screen-on")).toBeNull();
  });
});

describe("the state of the screen", () => {
  it("is one of the five words", () => {
    for (const word of ["not_installed", "downloading", "ready", "running", "error"]) expect(parseScreenState({ state: word })).toBe(word);
    for (const bad of [{ state: "on" }, { state: 3 }, {}, null, [], "running"]) expect(parseScreenState(bad)).toBeNull();
  });

  it("has every error of the switch in the catalog, in seven languages", () => {
    for (const code of ["screen_unavailable", "screen_failed", "screen_local_only"]) {
      for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"]) {
        const told = describeError(code, { locale });
        expect(told.known, `${code}/${locale}`).toBe(true);
        expect(told.text.length, `${code}/${locale}`).toBeGreaterThan(10);
      }
    }
  });
});
