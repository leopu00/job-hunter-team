import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TypewriterText from "./TypewriterText";
import { TYPEWRITER_CHARS_PER_SECOND, useTypewriter } from "./useTypewriter";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("the typewriter", () => {
  it("writes the text a few characters at a time and ends with all of it", async () => {
    const { result } = renderHook(() => useTypewriter("Ciao, sono qui."));
    expect(result.current.shown).toBe("");
    expect(result.current.done).toBe(false);
    await advance(100);
    const part = result.current.shown;
    expect(part.length).toBeGreaterThan(0);
    expect(part.length).toBeLessThan("Ciao, sono qui.".length);
    expect("Ciao, sono qui.".startsWith(part)).toBe(true);
    await advance(1000);
    expect(result.current.shown).toBe("Ciao, sono qui.");
    expect(result.current.done).toBe(true);
  });

  it("goes at the pace it says", async () => {
    const text = "x".repeat(TYPEWRITER_CHARS_PER_SECOND * 2);
    const { result } = renderHook(() => useTypewriter(text));
    await advance(1000);
    expect(result.current.shown.length).toBeGreaterThanOrEqual(TYPEWRITER_CHARS_PER_SECOND - 3);
    expect(result.current.shown.length).toBeLessThanOrEqual(TYPEWRITER_CHARS_PER_SECOND + 3);
  });

  it("starts again from nothing when the line changes, from its very first frame", async () => {
    const { result, rerender } = renderHook(({ text }) => useTypewriter(text), { initialProps: { text: "Prima battuta" } });
    await advance(2000);
    expect(result.current.shown).toBe("Prima battuta");
    rerender({ text: "Seconda" });
    expect(result.current.shown).toBe("");
    expect(result.current.done).toBe(false);
    await advance(2000);
    expect(result.current.shown).toBe("Seconda");
  });

  it("shows the rest at once on skip", async () => {
    const { result } = renderHook(() => useTypewriter("Una battuta abbastanza lunga da non finire subito."));
    await advance(100);
    act(() => result.current.skip());
    expect(result.current.shown).toBe("Una battuta abbastanza lunga da non finire subito.");
    expect(result.current.done).toBe(true);
  });

  it("keeps the rest it showed on skip when the timer ticks again, and stops the timer", async () => {
    const { result } = renderHook(() => useTypewriter("Una battuta abbastanza lunga da non finire subito."));
    await advance(100);
    act(() => result.current.skip());
    await advance(100);
    expect(result.current.shown).toBe("Una battuta abbastanza lunga da non finire subito.");
    expect(result.current.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is all there from the first frame when it is off, or for a person who asked for less motion", () => {
    const off = renderHook(() => useTypewriter("Tutto subito", { enabled: false }));
    expect(off.result.current).toMatchObject({ shown: "Tutto subito", done: true });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const calm = renderHook(() => useTypewriter("Tutto subito"));
    expect(calm.result.current).toMatchObject({ shown: "Tutto subito", done: true });
  });

  it("counts a letter with an accent or an emoji as one character and never cuts it in two", async () => {
    const text = "à👩‍💻è";
    const { result } = renderHook(() => useTypewriter(text, { charsPerSecond: 10 }));
    for (let i = 0; i < 30; i += 1) {
      await advance(35);
      expect(Array.from(text).join("").startsWith(result.current.shown)).toBe(true);
      expect(result.current.shown).not.toMatch(/�/);
    }
    expect(result.current.shown).toBe(text);
  });

  it("has nothing to write for an empty line, and is done", () => {
    const { result } = renderHook(() => useTypewriter(""));
    expect(result.current).toMatchObject({ shown: "", done: true });
  });

  it("stops its timer when it is taken away", async () => {
    const { unmount } = renderHook(() => useTypewriter("Una battuta lunga abbastanza"));
    await advance(100);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("TypewriterText", () => {
  it("has the whole line for a screen reader from the start and writes the visible copy", async () => {
    render(<TypewriterText text="Ciao, mi chiamo Sofia." />);
    const line = screen.getByTestId("typewriter");
    expect(line).toHaveAttribute("data-done", "false");
    // the reader's copy is the full text; the animated one is hidden from it
    expect(line.children[0]).toHaveTextContent("Ciao, mi chiamo Sofia.");
    expect(line.children[1]).toHaveAttribute("aria-hidden", "true");
    expect(line.children[1].textContent).toBe("");
    await advance(2000);
    // written: the text is there once, not twice
    const whole = screen.getByTestId("typewriter");
    expect(whole).toHaveAttribute("data-done", "true");
    expect(whole.children).toHaveLength(0);
    expect(screen.getAllByText("Ciao, mi chiamo Sofia.")).toHaveLength(1);
  });

  it("shows the rest on a click and tells once that the line is whole", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onDone = vi.fn();
    const view = render(<TypewriterText text="Una battuta abbastanza lunga da non finire subito." onDone={onDone} />);
    await user.click(screen.getByTestId("typewriter"));
    expect(screen.getByTestId("typewriter")).toHaveAttribute("data-done", "true");
    expect(onDone).toHaveBeenCalledTimes(1);
    view.rerender(<TypewriterText text="Una battuta abbastanza lunga da non finire subito." onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
