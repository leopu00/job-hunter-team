import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { refresh } from "./router";
import ServerPage from "./server-page";

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

  it("says so when the page cannot be read at all", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ServerPage render={() => Promise.reject(new Error("offline"))} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Non riesco a leggere questa pagina");
    spy.mockRestore();
  });
});
