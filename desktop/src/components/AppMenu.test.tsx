import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppMenu from "./AppMenu";
import { APP_EXIT_TEXT } from "./AppExitDialog.i18n";
import { APP_MENU_TEXT } from "./AppMenu.i18n";
import { EXIT_OPEN_EVENT } from "../lib/app-exit";

const win = vi.hoisted(() => ({ fullscreen: false, setFullscreen: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: win.isTauri, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFullscreen: async () => win.fullscreen, setFullscreen: win.setFullscreen }),
}));

const T = APP_MENU_TEXT.it;
const esc = (target: Element | Window = window) => fireEvent.keyDown(target, { key: "Escape" });

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  localStorage.clear();
  win.fullscreen = false;
  win.setFullscreen.mockReset();
  win.isTauri.mockReturnValue(true);
});
afterEach(cleanup);

describe("ESC opens the app menu", () => {
  it("on a plain page: resume, full screen and leave the app, in the person's language", () => {
    render(<AppMenu />);
    expect(screen.queryByTestId("app-menu")).toBeNull();
    esc();
    expect(screen.getByRole("dialog", { name: T.title })).toBeTruthy();
    expect(screen.getByTestId("app-menu-resume").textContent).toBe(T.resume);
    expect(screen.getByTestId("app-menu-fullscreen").textContent).toContain(T.fullscreen);
    expect(screen.getByTestId("app-menu-leave").textContent).toBe(APP_EXIT_TEXT.it.menu);
  });

  it("ESC again, «Riprendi» and a click outside close it, and focus goes back where it was", () => {
    render(<><button data-testid="before">before</button><AppMenu /></>);
    const before = screen.getByTestId("before");
    before.focus();
    esc(before);
    expect(document.activeElement).toBe(screen.getByTestId("app-menu-resume"));
    esc();
    expect(screen.queryByTestId("app-menu")).toBeNull();
    expect(document.activeElement).toBe(before);
    esc();
    fireEvent.click(screen.getByTestId("app-menu-resume"));
    expect(screen.queryByTestId("app-menu")).toBeNull();
    esc();
    fireEvent.click(screen.getByTestId("app-menu"));
    expect(screen.queryByTestId("app-menu")).toBeNull();
  });

  it("«Esci da Job Hunter Team» asks the exit dialog, the one the close button and ⌘Q ask", () => {
    const asked = vi.fn();
    window.addEventListener(EXIT_OPEN_EVENT, asked);
    render(<AppMenu />);
    esc();
    fireEvent.click(screen.getByTestId("app-menu-leave"));
    window.removeEventListener(EXIT_OPEN_EVENT, asked);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("app-menu")).toBeNull();
  });

  it("does not open while the person types", () => {
    render(<><input data-testid="field" /><textarea data-testid="area" /><div contentEditable suppressContentEditableWarning data-testid="rich" /><AppMenu /></>);
    for (const id of ["field", "area", "rich"]) esc(screen.getByTestId(id));
    expect(screen.queryByTestId("app-menu")).toBeNull();
  });

  it("does not open over what ESC already closes: a dialog, a menu, a popup that is open, a panel that owns ESC", () => {
    for (const markup of [
      <div key="d" role="dialog" />,
      <div key="m" aria-modal="true" />,
      <div key="r" role="menu" />,
      <button key="b" aria-haspopup="menu" aria-expanded="true" />,
      <div key="o" data-esc-owner />,
    ]) {
      const { unmount } = render(<>{markup}<AppMenu /></>);
      esc();
      expect(screen.queryByTestId("app-menu")).toBeNull();
      unmount();
    }
  });

  it("an accordion that is simply expanded does not take ESC away", () => {
    render(<><button aria-expanded="true">section</button><AppMenu /></>);
    esc();
    expect(screen.getByTestId("app-menu")).toBeTruthy();
  });

  it("the ESC that closes a dialog does not open the menu behind it, even when the page has already taken the dialog away", () => {
    // a browser flushes a click or a key at the end of the page's handler, before the event climbs to the window
    function Dialog() {
      const [open, setOpen] = useState(true);
      return open ? <div role="dialog" onKeyDown={(event) => event.key === "Escape" && flushSync(() => setOpen(false))}><button data-testid="inside">ok</button></div> : null;
    }
    render(<><Dialog /><AppMenu /></>);
    esc(screen.getByTestId("inside"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("app-menu")).toBeNull();
    esc();
    expect(screen.getByTestId("app-menu")).toBeTruthy();
  });

  it("ESC with a modifier is left to the page", () => {
    render(<AppMenu />);
    fireEvent.keyDown(window, { key: "Escape", shiftKey: true });
    fireEvent.keyDown(window, { key: "Escape", metaKey: true });
    expect(screen.queryByTestId("app-menu")).toBeNull();
  });
});

describe("F11 and the menu's «Schermo intero»", () => {
  it("F11 puts the window in full screen, and out of it when it already is", async () => {
    render(<AppMenu />);
    expect(fireEvent.keyDown(window, { key: "F11" })).toBe(false); // the page's own F11 is cancelled
    await waitFor(() => expect(win.setFullscreen).toHaveBeenLastCalledWith(true));
    win.fullscreen = true;
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(win.setFullscreen).toHaveBeenLastCalledWith(false));
  });

  it("the menu entry does the same and closes the menu", async () => {
    render(<AppMenu />);
    esc();
    await act(async () => void fireEvent.click(screen.getByTestId("app-menu-fullscreen")));
    expect(win.setFullscreen).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("app-menu")).toBeNull();
  });

  it("F11 works over a dialog too, and a native refusal changes nothing in the page", async () => {
    win.setFullscreen.mockRejectedValue(new Error("refused"));
    render(<><div role="dialog" /><AppMenu /></>);
    fireEvent.keyDown(window, { key: "F11" });
    await waitFor(() => expect(win.setFullscreen).toHaveBeenCalled());
    expect(screen.queryByTestId("app-menu")).toBeNull();
  });
});
