import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import { EXTERNAL_LINK_COMMAND, EXTERNAL_LINK_TEXT, externalHref, installExternalLinks, openExternalUrl } from "./external-links";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: core.invoke, isTauri: core.isTauri }));

const APP = "tauri://localhost";
const anchor = (href: string | null) => ({ getAttribute: (name: string) => (name === "href" ? href : null) });

let uninstall = () => {};
beforeEach(() => {
  core.invoke.mockReset();
  core.isTauri.mockReturnValue(true);
});
afterEach(() => {
  uninstall();
  uninstall = () => {};
  cleanup();
  document.getElementById("jht-external-link-failed")?.remove();
});

describe("which links leave the app", () => {
  it("takes the links to another origin, with or without a target, and leaves the app's own and the system's alone", () => {
    for (const [href, base, expected] of [
      ["https://www.linkedin.com/jobs/view/1", "tauri://localhost/dashboard.html", "https://www.linkedin.com/jobs/view/1"],
      ["http://example.com", "tauri://localhost/dashboard.html", "http://example.com/"],
      ["//example.com/x", "https://tauri.localhost/dashboard.html", "https://example.com/x"],
      ["https://tauri.localhost.evil.example/", "https://tauri.localhost/dashboard.html", "https://tauri.localhost.evil.example/"],
      ["file:///etc/passwd", "tauri://localhost/dashboard.html", "file:///etc/passwd"],
      ["ftp://example.com/x", "tauri://localhost/dashboard.html", "ftp://example.com/x"],
    ] as const) {
      expect(externalHref(anchor(href), base, base), href).toBe(expected);
    }
    for (const [href, base] of [
      ["/positions/1", "https://tauri.localhost/dashboard.html"],
      ["#top", "https://tauri.localhost/dashboard.html"],
      ["https://tauri.localhost/positions/1", "https://tauri.localhost/dashboard.html"],
      ["mailto:a@example.com", "tauri://localhost/dashboard.html"],
      ["tel:+390000000", "tauri://localhost/dashboard.html"],
      ["blob:tauri://localhost/uuid", "tauri://localhost/dashboard.html"],
      ["javascript:void(0)", "tauri://localhost/dashboard.html"],
      ["", "tauri://localhost/dashboard.html"],
    ] as const) {
      expect(externalHref(anchor(href), base, base), href).toBeNull();
    }
    expect(externalHref(anchor(null), "https://tauri.localhost/", "https://tauri.localhost")).toBeNull();
  });
});

describe("the click on a link to the outside, in the app", () => {
  it("hands the address to the native command and does not let the webview follow it (a position's links)", async () => {
    core.invoke.mockResolvedValue({ ok: true });
    uninstall = installExternalLinks(document);
    render(
      <div>
        <a href="https://www.linkedin.com/jobs/view/42" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        <a href="https://acme.example/" target="_blank"><span>Company website</span></a>
        <a href="https://www.glassdoor.com/Overview/Working-at-Acme-EI_IE1.11,15.htm">Glassdoor</a>
      </div>,
    );
    const clicks: boolean[] = [];
    document.addEventListener("click", (event) => clicks.push(event.defaultPrevented), { once: true });
    await userEvent.click(screen.getByRole("link", { name: "LinkedIn" }));
    expect(clicks).toEqual([true]);
    expect(core.invoke).toHaveBeenCalledWith(EXTERNAL_LINK_COMMAND, { url: "https://www.linkedin.com/jobs/view/42" });
    // The click lands on the span inside the link: the link is found from there.
    await userEvent.click(screen.getByText("Company website"));
    expect(core.invoke).toHaveBeenLastCalledWith(EXTERNAL_LINK_COMMAND, { url: "https://acme.example/" });
    await userEvent.click(screen.getByRole("link", { name: "Glassdoor" }));
    expect(core.invoke).toHaveBeenLastCalledWith(EXTERNAL_LINK_COMMAND, { url: "https://www.glassdoor.com/Overview/Working-at-Acme-EI_IE1.11,15.htm" });
    expect(core.invoke).toHaveBeenCalledTimes(3);
    expect(document.getElementById("jht-external-link-failed")).toBeNull();
  });

  it("calls the command for the middle button too, and for nothing else", async () => {
    core.invoke.mockResolvedValue({ ok: true });
    uninstall = installExternalLinks(document);
    render(<a href="https://example.com/a">x</a>);
    const link = screen.getByRole("link");
    link.addEventListener("click", (event) => event.preventDefault()); // the right button must not make jsdom navigate
    link.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }));
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 2 }));
    expect(core.invoke).not.toHaveBeenCalled();
    const middle = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    link.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(core.invoke).toHaveBeenCalledWith(EXTERNAL_LINK_COMMAND, { url: "https://example.com/a" });
  });

  it("leaves alone a link to the app, a link the page already handled, and a click that is not on a link", async () => {
    core.invoke.mockResolvedValue({ ok: true });
    uninstall = installExternalLinks(document);
    render(
      <div>
        <a href="#inside">inside</a>
        <a href="https://example.com/handled" onClick={(event) => event.preventDefault()}>handled</a>
        <button type="button">not a link</button>
      </div>,
    );
    for (const name of ["inside", "handled"]) await userEvent.click(screen.getByRole("link", { name }));
    await userEvent.click(screen.getByRole("button"));
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("says it, with the address, when the native side refuses or fails, in the seven languages", async () => {
    uninstall = installExternalLinks(document);
    render(<a href="http://localhost:1420/admin" target="_blank">local</a>);
    for (const reply of [() => Promise.resolve({ ok: false, error: "external_url_local" }), () => Promise.reject(new Error("ipc down"))]) {
      core.invoke.mockImplementationOnce(reply);
      await userEvent.click(screen.getByRole("link"));
      const notice = await screen.findByRole("alert");
      expect(notice).toHaveTextContent("http://localhost:1420/admin");
      document.getElementById("jht-external-link-failed")?.remove();
    }
    for (const locale of locales) expect(EXTERNAL_LINK_TEXT[locale].length, locale).toBeGreaterThan(10);
  });

  it("does nothing on the web: the link keeps working as it does today", async () => {
    core.isTauri.mockReturnValue(false);
    uninstall = installExternalLinks(document);
    render(<a href="https://example.com/a" target="_blank" onClick={(event) => event.preventDefault()}>web</a>);
    const seen: boolean[] = [];
    document.addEventListener("click", (event) => seen.push(event.defaultPrevented), { once: true });
    await userEvent.click(screen.getByRole("link"));
    expect(core.invoke).not.toHaveBeenCalled();
    // Only the page's own handler prevented it; the listener installed nothing.
    expect(seen).toEqual([true]);
    await waitFor(() => expect(document.getElementById("jht-external-link-failed")).toBeNull());
  });
});

describe("openExternalUrl", () => {
  it("is true only for an answer {ok: true}", async () => {
    core.invoke.mockResolvedValueOnce({ ok: true });
    expect(await openExternalUrl("https://example.com/")).toBe(true);
    core.invoke.mockResolvedValueOnce({ ok: false, error: "external_url_scheme" });
    expect(await openExternalUrl("file:///x")).toBe(false);
    core.invoke.mockResolvedValueOnce(undefined);
    expect(await openExternalUrl("https://example.com/")).toBe(false);
    core.invoke.mockRejectedValueOnce(new Error("no command"));
    expect(await openExternalUrl("https://example.com/")).toBe(false);
  });
});
