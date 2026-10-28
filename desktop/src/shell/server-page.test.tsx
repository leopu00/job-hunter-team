import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetReadsInFlight, PAGE_READ_DEADLINE_MS, READ_IN_FLIGHT_MAX_MS } from "../lib/read-deadline";
import { refresh } from "./router";
import ServerPage from "./server-page";

beforeEach(() => forgetReadsInFlight());

describe("ServerPage", () => {
  it("shows the fallback, then what the async page returns", async () => {
    let resolve!: (node: React.ReactNode) => void;
    render(<ServerPage render={() => new Promise((r) => (resolve = r))} fallback={<p>loading</p>} />);
    expect(screen.getByText("loading")).toBeInTheDocument();
    // The page starts on the next microtask.
    await act(async () => undefined);
    await act(async () => resolve(<h1>page</h1>));
    expect(screen.getByRole("heading", { name: "page" })).toBeInTheDocument();
  });

  it("runs the page again on refresh, and keeps the screen when a refresh fails", async () => {
    const render1 = vi
      .fn()
      .mockResolvedValueOnce(<p>first</p>)
      .mockResolvedValueOnce(<p>second</p>)
      .mockRejectedValueOnce(new Error("offline"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ServerPage render={render1} />);
    expect(await screen.findByText("first")).toBeInTheDocument();
    await act(async () => refresh());
    expect(await screen.findByText("second")).toBeInTheDocument();
    await act(async () => refresh());
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(render1).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it("runs the page again on a new runKey, with the new props, keeping the screen meanwhile", async () => {
    let resolveSecond!: (node: React.ReactNode) => void;
    const page = vi.fn((q: string) =>
      q === "a" ? Promise.resolve(<p>page a</p>) : new Promise<React.ReactNode>((r) => (resolveSecond = r)),
    );
    const { rerender } = render(<ServerPage runKey="a" render={() => page("a")} fallback={<p>loading</p>} />);
    expect(await screen.findByText("page a")).toBeInTheDocument();
    rerender(<ServerPage runKey="b" render={() => page("b")} fallback={<p>loading</p>} />);
    await act(async () => undefined);
    // While the new result is on its way, the old screen stays (no fallback).
    expect(screen.getByText("page a")).toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
    await act(async () => resolveSecond(<p>page b</p>));
    expect(screen.getByText("page b")).toBeInTheDocument();
    expect(page.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });

  it("says so when the page cannot be read at all", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ServerPage render={() => Promise.reject(new Error("offline"))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Non riesco a leggere questa pagina");
    spy.mockRestore();
  });
});

describe("ServerPage, a page that never answers", () => {
  it("says it could not be read after the deadline, with a button that reads it again", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const page = vi
        .fn()
        .mockReturnValueOnce(new Promise<React.ReactNode>(() => undefined))
        .mockResolvedValueOnce(<p>second try</p>);
      render(<ServerPage render={page} fallback={<p>skeleton</p>} />);
      await act(async () => undefined);
      expect(screen.getByText("skeleton")).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(PAGE_READ_DEADLINE_MS); });
      expect(screen.queryByText("skeleton")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere questa pagina");
      // a read that never answered is not waited for beyond the window: the button starts a new one
      await act(async () => { await vi.advanceTimersByTimeAsync(READ_IN_FLIGHT_MAX_MS - PAGE_READ_DEADLINE_MS); });
      await act(async () => { screen.getByRole("button", { name: "Riprova" }).click(); });
      await act(async () => undefined);
      expect(screen.getByText("second try")).toBeInTheDocument();
      expect(page).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not start a second read while the one that passed its deadline is still running, and shows its answer when it comes", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let answer!: (node: React.ReactNode) => void;
      const page = vi.fn().mockReturnValueOnce(new Promise<React.ReactNode>((resolve) => { answer = resolve; }));
      render(<ServerPage render={page} fallback={<p>skeleton</p>} />);
      await act(async () => undefined);
      await act(async () => { await vi.advanceTimersByTimeAsync(PAGE_READ_DEADLINE_MS); });
      expect(screen.getByRole("alert")).toHaveTextContent("Non riesco a leggere questa pagina");

      // «Riprova» and «Aggiorna» of the navbar both ask again: the read that runs is the one waited for
      await act(async () => { screen.getByRole("button", { name: "Riprova" }).click(); });
      await act(async () => { refresh(); });
      expect(page).toHaveBeenCalledTimes(1);

      await act(async () => answer(<p>late answer</p>));
      expect(screen.getByText("late answer")).toBeInTheDocument();
      expect(page).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("reads again once the read that ended is over, so a refresh after an answer is a new read", async () => {
    const page = vi.fn().mockResolvedValueOnce(<p>first</p>).mockResolvedValueOnce(<p>second</p>);
    render(<ServerPage render={page} />);
    await act(async () => undefined);
    expect(screen.getByText("first")).toBeInTheDocument();
    await act(async () => refresh());
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("does not share a read between two pages, or between two filters of one page", async () => {
    let one!: (node: React.ReactNode) => void;
    const first = vi.fn().mockReturnValue(new Promise<React.ReactNode>((resolve) => { one = resolve; }));
    const second = vi.fn().mockResolvedValue(<p>other filter</p>);
    const view = render(<ServerPage render={first} runKey="a=1" />);
    await act(async () => undefined);
    view.rerender(<ServerPage render={second} runKey="a=2" />);
    await act(async () => undefined);
    expect(second).toHaveBeenCalledTimes(1);
    expect(screen.getByText("other filter")).toBeInTheDocument();
    one(<p>stale</p>);
  });
});
