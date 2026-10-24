import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DirectChatScreen from "./DirectChatScreen";
import { renderChatMarkdown, renderChatText } from "./chat-text";
import { fullStamp, timeLabel } from "./chat-kinds";
import type { DirectChatClient, DirectChatPage } from "./direct-chat-contract";

/** The chat has to be read: size of the text, marks of the agent's text, and the time of every message. */

function clientWith(page: DirectChatPage): DirectChatClient {
  return {
    subscribe: vi.fn(async () => ({ state: "ready" as const })),
    status: vi.fn(async () => ({ state: "ready" as const })),
    reconnect: vi.fn(async () => ({ state: "ready" as const })),
    read: vi.fn(async () => page),
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as DirectChatClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const AT = 1_761_300_000; // seconds

describe("the marks of the agent's text", () => {
  it("bold, italic and code become elements, a text without marks is unchanged", () => {
    const { container } = render(<p>{renderChatText("a **forte** e *dolce* con `codice`")}</p>);
    expect(container.querySelector("strong")).toHaveTextContent("forte");
    expect(container.querySelector("em")).toHaveTextContent("dolce");
    expect(container.querySelector("code")).toHaveTextContent("codice");
    expect(container.textContent).toBe("a forte e dolce con codice");
    const plain = render(<p>{renderChatText("2 * 3 * 4 e snake_case_name")}</p>);
    expect(plain.container.textContent).toBe("2 * 3 * 4 e snake_case_name");
    expect(plain.container.querySelector("em")).toBeNull();
  });

  it("never puts HTML in the page: every tag but the old emphasis is dropped, a link is only its words", () => {
    const { container } = render(
      <div>
        {renderChatMarkdown(
          'Vedi <script>alert(1)</script><img src=x onerror=alert(1)> e [la pagina](https://example.test/a) <i>ok</i>',
        )}
      </div>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("em")).toHaveTextContent("ok");
    expect(container.textContent).toContain("la pagina (https://example.test/a)");
    expect(container.textContent).not.toContain("<");
  });

  it("lists, headings and code fences keep their shape; a text of lines keeps its breaks", () => {
    const { container } = render(
      <div>
        {renderChatMarkdown(
          ["# Titolo", "", "Prima riga", "seconda riga", "", "- uno", "- due **b**", "", "1. primo", "2) secondo", "", "```", "a <b> & c", "```", "fine"].join("\n"),
        )}
      </div>,
    );
    expect(container.querySelector("p.font-bold")).toHaveTextContent("Titolo");
    expect(container.querySelector("ul")?.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("ul li:nth-child(2) strong")).toHaveTextContent("b");
    expect(container.querySelector("ol")?.querySelectorAll("li")).toHaveLength(2);
    // the code is text, shown as it is
    expect(container.querySelector("pre code")?.textContent).toBe("a <b> & c");
    expect(container.querySelector("pre b")).toBeNull();
    const paragraph = [...container.querySelectorAll("p")].find((p) => p.textContent?.startsWith("Prima riga"));
    expect(paragraph?.textContent).toBe("Prima riga\nseconda riga");
    expect(paragraph?.className).toMatch(/whitespace-pre-wrap/);
    expect(container.textContent).toContain("fine");
  });

  it("an unclosed fence reads to the end and an empty text renders nothing", () => {
    const { container } = render(<div>{renderChatMarkdown("```\nsolo codice")}</div>);
    expect(container.querySelector("pre code")?.textContent).toBe("solo codice");
    expect(render(<div>{renderChatMarkdown("")}</div>).container.textContent).toBe("");
  });
});

describe("the time of a message", () => {
  it("is to the minute in the locale, with the whole date in the tooltip", () => {
    expect(timeLabel(AT, "it-IT")).toMatch(/^\d{2}:\d{2}$/);
    expect(fullStamp(AT, "it-IT")).toMatch(/2025/);
  });

  it("every message and every question carries it, as a <time> with its ISO value", async () => {
    const page: DirectChatPage = {
      messages: [
        { id: "u1", role: "user", text: "ciao", at: AT },
        { id: "a1", role: "agent", text: "Ecco **fatto**\n- uno\n- due", at: AT + 60, kind: "info" },
      ],
      questions: [
        {
          id: "q1",
          at: AT + 120,
          kind: "question",
          text: "Quale strada?",
          options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
          multiple: false,
          free: false,
          expiresAt: null,
          state: "open",
        },
      ],
    };
    render(<DirectChatScreen client={clientWith(page)} />);
    await screen.findByText("Quale strada?");
    const times = screen.getAllByTestId("direct-chat-time");
    expect(times).toHaveLength(3);
    for (const node of times) {
      expect(node.tagName).toBe("TIME");
      expect(node.textContent).toMatch(/\d{1,2}[:.]\d{2}/);
      expect(node.getAttribute("title")).toMatch(/2025/);
      expect(Number.isNaN(Date.parse(node.getAttribute("datetime") ?? ""))).toBe(false);
    }
    // and the agent's text is read as marks, not as asterisks
    expect(screen.getByText("fatto").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("the size of the text", () => {
  const FILES = ["DirectChatScreen.tsx", "ChatQuestion.tsx", "stick-to-bottom.tsx", "chat-text.tsx"];
  const source = (name: string) => readFileSync(`src/pages/messages/${name}`, "utf8");

  it("no text in the chat is smaller than 11 px, and the words people read are 14 px", () => {
    for (const name of FILES) {
      for (const match of source(name).matchAll(/text-\[(\d+)px\]/g)) {
        expect(Number(match[1]), `${name}: ${match[0]}`).toBeGreaterThanOrEqual(11);
      }
    }
    const screenSource = source("DirectChatScreen.tsx");
    // the bubble, the box people type in, the suggested replies
    expect(screenSource).toMatch(/rounded-lg px-4 py-3 text-\[14px\] leading-relaxed/);
    expect(screenSource).toMatch(/resize-none border-0 bg-transparent px-1 py-1\.5 text-\[14px\]/);
    expect(screenSource).toMatch(/px-2\.5 py-0\.5 text-left text-\[14px\]/);
    expect(source("ChatQuestion.tsx")).toMatch(/rounded-lg rounded-bl-sm px-4 py-3 text-\[14px\]/);
  });
});
