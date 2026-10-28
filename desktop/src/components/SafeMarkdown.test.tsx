import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseMarkdown } from "../lib/safe-markdown";
import SafeMarkdown from "./SafeMarkdown";

afterEach(cleanup);

const HOSTILE = [
  "# Title <script>alert(1)</script>",
  "",
  "<style>body{display:none}</style>",
  "",
  "<img src=x onerror=alert(1)> and <iframe src='https://evil.example'></iframe> and <svg onload=alert(1)></svg>",
  "",
  "[click me](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) ![pic](https://evil.example/track.png) <https://ok.example/path>",
  "",
  "- item <b>one</b>",
  "  - nested item",
  "1. first",
  "",
  "> quote with **strong** and _emphasis_ and `code`",
  "",
  "```",
  "<script>alert(2)</script>",
  "```",
  "",
  "[a](b)[c](d)".repeat(200),
].join("\n");

/** What an element may carry. The document's words are never an attribute. */
const ALLOWED_ATTRIBUTES = new Set(["class", "style", "data-marker"]);
const DANGEROUS = "script,style,iframe,object,embed,form,input,button,textarea,select,svg,math,link,meta,base,video,audio,source,img,picture,a,area,frame,frameset";

describe("a document drawn in the app", () => {
  it("is only text inside plain elements, whatever the document says", () => {
    const { container } = render(<SafeMarkdown parsed={parseMarkdown(HOSTILE)} />);
    expect(container.querySelectorAll(DANGEROUS)).toHaveLength(0);
    for (const element of Array.from(container.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(ALLOWED_ATTRIBUTES.has(attribute.name), `${element.tagName}[${attribute.name}]`).toBe(true);
        expect(attribute.value, `${element.tagName}[${attribute.name}]`).not.toMatch(/javascript:|data:|https?:/i);
      }
    }
    const text = container.textContent ?? "";
    expect(text).toContain("Title");
    expect(text).toContain("click me");
    expect(text).toContain("(javascript:alert(1");
    expect(text).toContain("pic");
    expect(text).not.toContain("<script");
    expect(text).not.toContain("display:none");
  });

  it("shows a code block as text, not as markup", () => {
    const { container } = render(<SafeMarkdown parsed={parseMarkdown("```\n<script>alert(2)</script>\n```")} />);
    expect(container.querySelector("pre code")?.textContent).toBe("<script>alert(2)</script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("keeps the order, the list kinds and the depth of a CV", () => {
    const { container } = render(<SafeMarkdown parsed={parseMarkdown("# Mario\n\n- a\n  - b\n1. first\n2. second\n\n---\n\nend")} />);
    expect(container.querySelector("h3")?.textContent).toBe("Mario");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect((container.querySelectorAll("ul > li")[1] as HTMLElement).style.getPropertyValue("--level")).toBe("1");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("end");
  });
});
