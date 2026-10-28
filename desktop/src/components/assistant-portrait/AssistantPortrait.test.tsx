import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssistantPortrait from "./AssistantPortrait";
import { ASSISTANT_EXPRESSIONS, ASSISTANT_PORTRAIT_SRC, expressionFor } from "./expressions";

const faces = () => [...document.querySelectorAll<HTMLImageElement>("[data-face]")];
const current = () => faces().filter((face) => face.dataset.current === "true").map((face) => face.dataset.face);

describe("the Assistant's portrait", () => {
  it("has every expression in the page from the first frame and shows one of them", () => {
    render(<AssistantPortrait expression="caldo" />);
    expect(faces().map((face) => face.dataset.face)).toEqual([...ASSISTANT_EXPRESSIONS]);
    expect(faces().map((face) => face.getAttribute("src"))).toEqual(ASSISTANT_EXPRESSIONS.map((name) => ASSISTANT_PORTRAIT_SRC[name]));
    expect(current()).toEqual(["caldo"]);
    expect(screen.getByTestId("assistant-portrait")).toHaveAttribute("data-expression", "caldo");
  });

  it("changes the face by changing which one is shown, never by loading another image", () => {
    const view = render(<AssistantPortrait expression="neutro" />);
    const before = faces();
    view.rerender(<AssistantPortrait expression="sorpreso" />);
    expect(current()).toEqual(["sorpreso"]);
    // the same nodes: a crossfade of two layers, not a new picture put in place of the old
    expect(faces()).toEqual(before);
  });

  it.each([[null], [undefined], ["unknown"], ["severo"], [""], ["CALDO"]])("shows the neutral face for %s (she has no other for it)", (value) => {
    render(<AssistantPortrait expression={value as string | null | undefined} />);
    expect(current()).toEqual(["neutro"]);
  });

  it("reads an agent's emotion as text, and gives the neutral face to the ones she has no portrait for", () => {
    expect(expressionFor("pensieroso")).toBe("pensieroso");
    expect(expressionFor("severo")).toBe("neutro");
    expect(expressionFor(null)).toBe("neutro");
  });

  it("is decoration: hidden from a screen reader, with no text of its own and no picture that can be dragged", () => {
    render(<AssistantPortrait expression="divertito" />);
    const portrait = screen.getByTestId("assistant-portrait");
    expect(portrait).toHaveAttribute("aria-hidden", "true");
    expect(portrait).toHaveTextContent("");
    for (const face of faces()) {
      expect(face).toHaveAttribute("alt", "");
      expect(face.draggable).toBe(false);
    }
  });

  it("breathes livelier while she speaks, and says so as data, not in the picture", () => {
    const view = render(<AssistantPortrait expression="caldo" />);
    expect(screen.getByTestId("assistant-portrait")).toHaveAttribute("data-speaking", "false");
    view.rerender(<AssistantPortrait expression="caldo" speaking />);
    expect(screen.getByTestId("assistant-portrait")).toHaveAttribute("data-speaking", "true");
    expect(current()).toEqual(["caldo"]);
  });

  it("is a named and a default export of its folder, with the contract's props", async () => {
    const folder = await import("./index");
    expect(folder.AssistantPortrait).toBe(folder.default);
  });

  it("loads the face in view first and leaves the others for later", () => {
    render(<AssistantPortrait expression="caldo" />);
    for (const face of faces()) {
      if (face.dataset.face === "caldo") expect(face).toHaveAttribute("fetchpriority", "high");
      else expect(face).toHaveAttribute("loading", "lazy");
    }
  });
});

describe("the settle at every line", () => {
  let animate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
  });

  it("settles once for each new line, and not for the first one nor for the same one again", () => {
    const view = render(<AssistantPortrait expression="caldo" line={1} />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<AssistantPortrait expression="caldo" line={1} />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<AssistantPortrait expression="sorpreso" line={2} />);
    expect(animate).toHaveBeenCalledTimes(1);
    view.rerender(<AssistantPortrait expression="sorpreso" line={3} />);
    expect(animate).toHaveBeenCalledTimes(2);
    const [, options] = animate.mock.calls[0];
    expect(options.duration).toBeLessThanOrEqual(400);
  });

  it("does not settle for a person who asked for less motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const view = render(<AssistantPortrait line={1} />);
    view.rerender(<AssistantPortrait line={2} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not fail where the browser has no Web Animations", () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const view = render(<AssistantPortrait line={1} />);
    expect(() => act(() => view.rerender(<AssistantPortrait line={2} />))).not.toThrow();
  });
});
