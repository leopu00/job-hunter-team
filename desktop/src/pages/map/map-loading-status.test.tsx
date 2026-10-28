import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import GlobeLoadingStatus, { SLOW_AFTER_SECONDS } from "@/app/components/GlobeLoadingStatus";
import MapCharts from "@/app/components/MapCharts";
import { T } from "@/app/components/JobsGlobe.i18n";

vi.mock("@/app/components/JobsGlobeLazy", () => ({
  default: (props: { bottomCenterExtra?: ReactNode }) => <div data-testid="globe">{props.bottomCenterExtra}</div>,
}));

const read = (path: string) => readFileSync(resolve(import.meta.dirname, "../../../../", path), "utf8");

beforeEach(() => localStorage.setItem("jht-lang", "en"));
afterEach(() => {
  localStorage.removeItem("jht-lang");
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// The map sat ~10 s on «Loading…» with the positions' counter at 0 and nothing to say it was working.
describe("the map while its positions are read", () => {
  it("says what is being read, counts the seconds, and says from the fifth why it is slow", () => {
    vi.useFakeTimers();
    render(<GlobeLoadingStatus lang="en" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Reading the positions…");
    expect(screen.getByTestId("globe-loading-seconds")).toHaveTextContent("0 s");
    expect(screen.queryByTestId("globe-loading-slow")).toBeNull();
    act(() => void vi.advanceTimersByTime((SLOW_AFTER_SECONDS - 1) * 1000));
    expect(screen.getByTestId("globe-loading-seconds")).toHaveTextContent(`${SLOW_AFTER_SECONDS - 1} s`);
    expect(screen.queryByTestId("globe-loading-slow")).toBeNull();
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("globe-loading-slow")).toHaveTextContent("Still reading");
  });

  it("is in every language, and the seconds are not read out by screen readers", () => {
    for (const lang of locales) {
      render(<GlobeLoadingStatus lang={lang} />);
      expect(screen.getByRole("status"), lang).toHaveTextContent(T.loading_positions[lang]);
      expect(T.loading_positions[lang].length, lang).toBeGreaterThan(8);
      expect(T.loading_slow[lang].length, lang).toBeGreaterThan(30);
      expect(screen.getByTestId("globe-loading-seconds"), lang).toHaveAttribute("aria-hidden", "true");
      cleanup();
    }
  });

  it("never names a VPS on the public page's showcase, in any language", () => {
    for (const lang of locales) {
      expect(T.loading_slow_generic[lang], lang).not.toMatch(/VPS/);
      expect(T.loading_slow_generic[lang].length, lang).toBeGreaterThan(30);
    }
    vi.useFakeTimers();
    render(<GlobeLoadingStatus lang="en" generic />);
    act(() => void vi.advanceTimersByTime(SLOW_AFTER_SECONDS * 1000));
    expect(screen.getByTestId("globe-loading-slow")).toHaveTextContent("Still reading: with many positions this can take around ten seconds.");
    expect(screen.getByTestId("globe-loading-slow")).not.toHaveTextContent(/VPS/);
    expect(read("web/app/components/JobsGlobe.tsx")).toContain("generic={showcase != null}");
  });

  it("stops its timer when the positions arrive", () => {
    vi.useFakeTimers();
    const { unmount } = render(<GlobeLoadingStatus lang="en" />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is what the globe shows until its positions are loaded, and the old one-line text is gone", () => {
    const globe = read("web/app/components/JobsGlobe.tsx");
    expect(globe).toMatch(/\{!loaded && \(?\s*<GlobeLoadingStatus/);
    expect(globe).not.toContain('tr("loading")');
  });

  it("shows «…» and not 0 on the positions card until the three reads have answered", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    const rows = [{ id: "a", title: "A", company: "X", status: "scored", role_family: "Data", score: 80, loc_country: "Italy", loc_city: "Rome", created_at: null }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        await gate;
        return { ok: true, json: async () => (url.endsWith("/coords") ? rows : []) };
      }),
    );
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(<MapCharts typeDist={[]} fallbackScores={[]} labels={{}} emptyLabel="none" scoreTitle="Score distribution" />);
    const card = () => screen.getByRole("button", { name: /positions/i });
    expect(card()).toHaveTextContent("…");
    expect(card()).not.toHaveTextContent(/\b0\b/);
    await act(async () => release());
    await waitFor(() => expect(card()).not.toHaveTextContent("…"));
    expect(card()).toHaveTextContent("1");
  });

  it("settles on 0, not on «…», when a read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(<MapCharts typeDist={[]} fallbackScores={[]} labels={{}} emptyLabel="none" scoreTitle="Score distribution" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /positions/i })).not.toHaveTextContent("…"));
  });
});
