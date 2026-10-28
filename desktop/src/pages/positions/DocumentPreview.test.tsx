import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../../lib/error-catalog";
import type { DocumentPreviewApi, DocumentPreviewRequest } from "../../lib/team-document";
import DocumentPreview from "./DocumentPreview";
import { DOCUMENT_PREVIEW_TEXT } from "./document-preview.i18n";
import DocumentPreviewHost from "./DocumentPreviewHost";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: core.invoke, isTauri: core.isTauri }));

const SUM = "a".repeat(64);
const NAME = "CV_synthetic_Acme.pdf";
const TEXT_NAME = "CV_synthetic_Acme.md";
const request: DocumentPreviewRequest = { name: NAME, textName: TEXT_NAME, kind: "cv" };
const t = DOCUMENT_PREVIEW_TEXT.en;

function fakeApi(over: Partial<DocumentPreviewApi> = {}): DocumentPreviewApi & { [K in keyof DocumentPreviewApi]: ReturnType<typeof vi.fn> } {
  return {
    text: vi.fn(async () => "# Hello\n\nA line of the CV."),
    pages: vi.fn(async () => ({ pages: 2, truncated: false, sha256: SUM })),
    page: vi.fn(async (_name: string, page: number) => `UE5H${page}`),
    save: vi.fn(async () => "saved" as const),
    open: vi.fn(async () => undefined),
    ...over,
  } as never;
}

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en";
});
afterEach(cleanup);

describe("the window that shows a CV or a letter", () => {
  it("shows the kind of document, never its file name, with the sheets in order", async () => {
    const api = fakeApi();
    const { container } = render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    expect(screen.getByRole("dialog", { name: "CV" })).toHaveAttribute("aria-modal", "true");
    const images = await screen.findAllByRole("img");
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual([
      "Sheet 1 of 2 of the document",
      "Sheet 2 of 2 of the document",
    ]);
    expect(images[0].getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(api.pages).toHaveBeenCalledTimes(1);
    expect(api.pages).toHaveBeenCalledWith(NAME);
    expect(api.page.mock.calls).toEqual([[NAME, 1, SUM], [NAME, 2, SUM]]);
    expect(container.textContent).not.toContain("synthetic");
    expect(container.innerHTML).not.toContain("synthetic");
  });

  it("is a letter when it is a letter", () => {
    render(<DocumentPreview request={{ ...request, kind: "letter" }} onClose={() => {}} api={fakeApi()} />);
    expect(screen.getByRole("dialog", { name: "Cover letter" })).toBeInTheDocument();
  });

  it("shows the text on its own tab, as text, outside any live region", async () => {
    const api = fakeApi();
    render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    await userEvent.click(screen.getByRole("tab", { name: t.tabText }));
    const heading = await screen.findByRole("heading", { name: "Hello" });
    expect(api.text).toHaveBeenCalledWith(TEXT_NAME);
    expect(screen.getByText("A line of the CV.")).toBeInTheDocument();
    for (let node: HTMLElement | null = heading; node; node = node.parentElement) {
      expect(node.getAttribute("aria-live"), node.tagName).toBeNull();
      expect(node.getAttribute("role")).not.toBe("status");
      expect(node.getAttribute("role")).not.toBe("alert");
    }
    for (const live of [...screen.queryAllByRole("status"), ...screen.queryAllByRole("alert")]) {
      expect(live.textContent).not.toContain("A line of the CV.");
    }
  });

  it("says there is no text version when the application has none", async () => {
    const api = fakeApi();
    render(<DocumentPreview request={{ ...request, textName: null }} onClose={() => {}} api={api} />);
    await userEvent.click(screen.getByRole("tab", { name: t.tabText }));
    expect(screen.getByText(t.noText)).toBeInTheDocument();
    expect(api.text).not.toHaveBeenCalled();
  });

  it("tells a hostile document from nothing: no element but text, no script", async () => {
    const api = fakeApi({ text: vi.fn(async () => "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[a](javascript:alert(1)) ![b](https://evil.example/p.png)\n\nbody") });
    const { container } = render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    await userEvent.click(screen.getByRole("tab", { name: t.tabText }));
    await screen.findByText(/body/);
    expect(container.querySelector("script,iframe,object,embed,a")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/onerror|javascript:\w/);
  });

  it("closes with Escape and gives the focus back to what opened it", async () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<DocumentPreview request={request} onClose={onClose} api={fakeApi()} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("keeps the focus inside while it is open", async () => {
    render(<DocumentPreview request={request} onClose={() => {}} api={fakeApi()} />);
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    const enabled = buttons.filter((button) => !(button as HTMLButtonElement).disabled);
    enabled[enabled.length - 1].focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled)[0]);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    const items = within(dialog).getAllByRole("button").filter((b) => !(b as HTMLButtonElement).disabled);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("says why a preview failed in the catalog's words and offers to try again, never the file's name", async () => {
    const pages = vi.fn().mockRejectedValueOnce({ code: "document_preview_unavailable" }).mockResolvedValue({ pages: 1, truncated: false, sha256: SUM });
    const api = fakeApi({ pages });
    const { container } = render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    const alert = await screen.findByRole("alert");
    const copy = describeError("document_preview_unavailable", { locale: "en" });
    expect(alert).toHaveTextContent(copy.text);
    expect(alert).toHaveTextContent(copy.action);
    expect(container.textContent).not.toContain("synthetic");
    await userEvent.click(within(alert).getByRole("button", { name: t.retry }));
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    expect(pages).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to a closed sentence when the native side says something it does not know", async () => {
    const api = fakeApi({ pages: vi.fn().mockRejectedValue(new Error("boom with synthetic name CV_synthetic_Acme.pdf")) });
    const { container } = render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("boom");
    expect(container.textContent).not.toContain("synthetic");
  });

  it("says the document has more sheets than it shows", async () => {
    const api = fakeApi({ pages: vi.fn(async () => ({ pages: 6, truncated: true, sha256: SUM })) });
    render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    expect(await screen.findByText("These are the first 6 sheets: save the document to have all of it.")).toBeInTheDocument();
  });

  it("saves and opens in the reader only on a click, by the plain name", async () => {
    const api = fakeApi();
    render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(api.save).not.toHaveBeenCalled();
    expect(api.open).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: t.save }));
    expect(api.save).toHaveBeenCalledWith(NAME);
    expect(await screen.findByText(t.saved)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t.openInReader }));
    expect(api.open).toHaveBeenCalledWith(NAME);
    expect(await screen.findByText(t.opened)).toBeInTheDocument();
  });

  it("takes a closed «Save as» window as nothing happened, and a failed open as an error line", async () => {
    const api = fakeApi({ save: vi.fn(async () => "cancelled" as const), open: vi.fn().mockRejectedValue({ code: "operation_in_progress" }) });
    render(<DocumentPreview request={request} onClose={() => {}} api={api} />);
    await userEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(screen.queryByText(t.saved)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t.openInReader }));
    expect(await screen.findByRole("alert")).toHaveTextContent(describeError("operation_in_progress", { locale: "en" }).text);
  });

  it("has no frame, embed, object, link or form in it", async () => {
    const { container } = render(<DocumentPreview request={request} onClose={() => {}} api={fakeApi()} />);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(container.querySelectorAll("iframe,embed,object,a,form,script,link")).toHaveLength(0);
  });
});

describe("where the window lives", () => {
  it("opens only for a request and closes with its button", async () => {
    const { installDocumentPreview, PREVIEW_DOCUMENT_EVENT } = await import("../../lib/team-document");
    const remove = installDocumentPreview();
    try {
      render(<DocumentPreviewHost api={fakeApi()} />);
      expect(screen.queryByRole("dialog")).toBeNull();
      const detail = { name: NAME, textName: TEXT_NAME, kind: "cv" };
      let handled = false;
      act(() => {
        handled = !window.dispatchEvent(new CustomEvent(PREVIEW_DOCUMENT_EVENT, { detail, cancelable: true }));
      });
      expect(handled).toBe(true);
      expect(await screen.findByRole("dialog", { name: "CV" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: t.close }));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      remove();
    }
  });
});
