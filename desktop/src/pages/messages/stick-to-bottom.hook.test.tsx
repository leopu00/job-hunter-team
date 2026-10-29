import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JumpToLatest, useStickToBottom } from "./stick-to-bottom";

/**
 * The chat goes down to every new line or card unless the person scrolled away by hand. jsdom has no layout: the
 * scroller's measures are set here, and a "layout" that grows the content moves scrollHeight.
 */

function Harness({ keys }: { keys: string[] }) {
  const bottom = useStickToBottom({ conversation: "assistente", last: keys.length ? keys[keys.length - 1] : null, count: keys.length });
  return (
    <div ref={bottom.ref} onScroll={bottom.onScroll} data-testid="scroller">
      {keys.map((key) => (
        <p key={key}>{key}</p>
      ))}
      <JumpToLatest atBottom={bottom.atBottom} unseen={bottom.unseen} label="down" onClick={bottom.jump} />
    </div>
  );
}

let content = 1000;
const CLIENT = 400;

function scroller(): HTMLElement {
  const node = screen.getByTestId("scroller");
  Object.defineProperty(node, "scrollHeight", { configurable: true, get: () => content });
  Object.defineProperty(node, "clientHeight", { configurable: true, get: () => CLIENT });
  return node;
}

function scrollTo(node: HTMLElement, top: number) {
  node.scrollTop = top;
  fireEvent.scroll(node);
}

afterEach(() => {
  cleanup();
  content = 1000;
});

describe("the chat goes down to what is new", () => {
  it("a new card goes into view when the person never scrolled, even if the page moved the list by itself", () => {
    const { rerender } = render(<Harness keys={["a", "b"]} />);
    const node = scroller();
    // the page's own scroll (a clamp when the window grew): no wheel, no key, no touch
    scrollTo(node, 600);
    scrollTo(node, 200);
    expect(screen.queryByTestId("direct-chat-jump")).toBeNull();
    content = 1400;
    rerender(<Harness keys={["a", "b", "card"]} />);
    expect(node.scrollTop).toBe(1400);
  });

  it("a card that lands before the last line (by its time) also goes into view", () => {
    const { rerender } = render(<Harness keys={["a", "z"]} />);
    const node = scroller();
    content = 1400;
    rerender(<Harness keys={["a", "card", "z"]} />);
    expect(node.scrollTop).toBe(1400);
  });

  it("the person who scrolled up by hand is left where they are, and the new line is counted", () => {
    const { rerender } = render(<Harness keys={["a", "b"]} />);
    const node = scroller();
    scrollTo(node, 600);
    fireEvent.wheel(node, { deltaY: -120 });
    scrollTo(node, 100);
    expect(screen.getByTestId("direct-chat-jump")).toBeInTheDocument();
    content = 1400;
    rerender(<Harness keys={["a", "b", "card"]} />);
    expect(node.scrollTop).toBe(100);
    expect(screen.getByTestId("direct-chat-jump-count")).toHaveTextContent("1");
  });

  it("the button brings the person back, and from then on every new line follows", () => {
    const { rerender } = render(<Harness keys={["a"]} />);
    const node = scroller();
    scrollTo(node, 600);
    fireEvent.wheel(node, { deltaY: -120 });
    scrollTo(node, 50);
    act(() => screen.getByTestId("direct-chat-jump").click());
    expect(screen.queryByTestId("direct-chat-jump")).toBeNull();
    content = 1600;
    rerender(<Harness keys={["a", "b"]} />);
    expect(node.scrollTop).toBe(1600);
  });
});
