import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { navigate } from "./router";
import { READ_ONLY_ROUTES, ROUTES } from "./routes";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
import Shell from "./Shell";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
// The chat has its own tests: here only where the Shell puts it.
vi.mock("../pages/messages", () => ({ default: () => <h1>Chat</h1> }));

// A person with a small laptop, or a window dragged short, still has the navbar and the list of
// agents: the chat is a column as tall as the window, so nothing above it (a bar, the navbar's own
// border) can push the page past the window, and a page that is scrolled has nothing to scroll back.
let restore: () => void;
beforeEach(() => {
  restore = installApiBridge(shellApi(notInDesktop));
});
afterEach(() => restore());

describe("the chat in a short window", () => {
  it("is a full-bleed page in the app and in the read-only view", () => {
    expect(ROUTES.find((route) => route.path === "/messages")?.fullBleed).toBe(true);
    expect(READ_ONLY_ROUTES.find((route) => route.path === "/messages")?.fullBleed).toBe(true);
  });

  it("sits in a column as tall as the window that never scrolls, the navbar first and the bars between", async () => {
    navigate("/messages", { replace: true });
    render(<Shell />);
    const main = (await screen.findByRole("heading", { name: "Chat" })).closest("main")!;
    expect(main).toHaveAttribute("data-testid", "full-bleed");
    // no MainChrome padding around it
    expect(main.className).not.toMatch(/max-w|px-|py-/);
    expect(main.className).toMatch(/min-h-0/);
    expect(main.className).toMatch(/flex-1/);

    const column = main.parentElement!;
    expect(column.style.height).toBe("calc(100svh / var(--zoom, 1))");
    expect(column.style.overflow).toBe("hidden");

    const [navbar, bars, page] = [...column.children];
    expect(navbar.tagName).toBe("HEADER");
    expect(screen.getByRole("navigation", { name: /./ })).toBeInTheDocument();
    expect(bars).toBe(screen.getByTestId("full-bleed-bars"));
    expect(page).toBe(main);
  });

  it("caps the bars above the chat at a third of the window, so they scroll instead of eating the chat", async () => {
    navigate("/messages", { replace: true });
    render(<Shell />);
    await screen.findByRole("heading", { name: "Chat" });
    const bars = screen.getByTestId("full-bleed-bars");
    expect(bars.className).toMatch(/max-h-\[34%\]/);
    expect(bars.className).toMatch(/overflow-y-auto/);
    expect(bars.className).toMatch(/shrink-0/);
  });

  it("is the same column in the read-only view, the navbar inside it", async () => {
    enterExistingTeamReadOnly(true, null);
    try {
      navigate("/messages", { replace: true });
      render(<Shell />);
      const main = (await screen.findByRole("heading", { name: "Chat" })).closest("main")!;
      expect(main).toHaveAttribute("data-testid", "full-bleed");
      const column = main.parentElement!;
      expect(column.style.height).toBe("calc(100svh / var(--zoom, 1))");
      expect(column.style.overflow).toBe("hidden");
      expect(column.firstElementChild!.tagName).toBe("HEADER");
    } finally {
      leaveExistingTeamReadOnly();
    }
  });
});

describe("the main window's smallest height", () => {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8")) as {
    app: { windows: { label: string; minHeight: number }[] };
  };
  const { minHeight } = config.app.windows.find((window) => window.label === "main")!;
  // body { zoom } of the web's globals
  const ZOOM = 1.15;
  // what the chat needs on screen at once: the navbar (h-14), its header (min-h-14) and the
  // composer (a row of input and buttons with its padding), then the conversation
  const NAVBAR = 56;
  const CHAT_HEADER = 56;
  const COMPOSER = 96;
  const A_FEW_LINES = 120;
  const A_LINE = 60;

  it("leaves room for the chat's header, the composer and a few lines under the navbar", () => {
    expect(minHeight / ZOOM - NAVBAR).toBeGreaterThanOrEqual(CHAT_HEADER + COMPOSER + A_FEW_LINES);
  });

  it("still shows a line of the conversation when the bars above the chat take the third they are capped at", () => {
    const room = minHeight / ZOOM;
    expect(room - NAVBAR - room * 0.34).toBeGreaterThanOrEqual(CHAT_HEADER + COMPOSER + A_LINE);
  });
});
