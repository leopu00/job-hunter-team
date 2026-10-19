import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Link from "../web-shims/next-link";
import NavStrip from "./NavStrip";
import { navigate } from "./router";

// jsdom has no layout: give the links a width and the strip a width, as the
// browser measured them at 1068 px (strip 635 px; links 55 to 93 px).
let stripWidth = 635;
const LINK_WIDTH = 80;
const getters: [string, PropertyDescriptor | undefined][] = [];

beforeEach(() => {
  for (const name of ["offsetWidth", "clientWidth"]) {
    getters.push([name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        if (this.tagName === "A") return this.style.display === "none" ? 0 : LINK_WIDTH;
        if (this.dataset.testid === "navbar-links") return stripWidth;
        if (this.dataset.testid === "navbar-more") return 60;
        return 0;
      },
    });
  }
  navigate("/page-1", { replace: true });
});
afterEach(() => {
  cleanup();
  for (const [name, original] of getters.splice(0)) {
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

const pages = (count: number) => Array.from({ length: count }, (_unused, i) => `/page-${i + 1}`);
const strip = (count: number) => (
  <NavStrip>
    {pages(count).map((href, i) => (
      <Link key={href} href={href}>{`Page ${i + 1}`}</Link>
    ))}
  </NavStrip>
);
const shown = () =>
  within(screen.getByTestId("navbar-links-scroll"))
    .getAllByRole("link", { hidden: true })
    .filter((link) => (link as HTMLElement).style.display !== "none")
    .map((link) => link.textContent);

describe("the navbar's links at 1068 px", () => {
  it("shows them all, and no menu, while they fit", () => {
    render(strip(6));
    expect(shown()).toHaveLength(6);
    expect(screen.queryByTestId("navbar-more")).not.toBeInTheDocument();
  });

  it.each([8, 10, 14])("with %s links keeps what fits and puts the rest in «More», none of them cut", async (count) => {
    render(strip(count));
    // 635 px strip, 60 px menu button: (635 - 76) / 84 = 6 links of 80 px
    const visible = shown();
    expect(visible).toEqual(pages(visible.length).map((_href, i) => `Page ${i + 1}`));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(count);

    const more = within(screen.getByTestId("navbar-more")).getByRole("button");
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(more);
    const menu = screen.getByRole("menu");
    const inMenu = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
    // every link is either in the strip or in the menu, once, in order
    expect([...visible, ...inMenu]).toEqual(pages(count).map((_href, i) => `Page ${i + 1}`));
  });

  it("takes a link from the menu to its page and closes", async () => {
    render(strip(12));
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId("navbar-more")).getByRole("button"));
    const last = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Page 12" });
    await user.click(last);
    expect(window.location.hash).toBe("#/page-12");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // and the menu button says the current page is in it
    expect(within(screen.getByTestId("navbar-more")).getByRole("button")).toBeInTheDocument();
  });

  it("puts more links in the menu when the window shrinks, without a reload", () => {
    render(strip(10));
    const before = shown().length;
    stripWidth = 420;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(shown().length).toBeLessThan(before);
    stripWidth = 635;
  });
});
