import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadOnlyActionsProvider } from "@/lib/read-only-actions";
import { CvDownloadButton } from "@/app/(protected)/positions/[id]/CvDownloadButton";
import { describeError } from "../../lib/error-catalog";
import { installDocumentSave, SAVE_DOCUMENT_EVENT } from "../../lib/team-document";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: core.invoke, isTauri: core.isTauri }));

const labels = { idle: "Scarica CV", preparing: "Preparo…", error: "Errore" };
const NAME = "CV_synthetic_1.pdf";

function renderButton(readOnly = false) {
  const button = <CvDownloadButton fileName={NAME} cloudMode color="var(--color-green)" labels={labels} />;
  return render(readOnly ? <ReadOnlyActionsProvider value={{ readOnly: true, reason: "Solo lettura" }}>{button}</ReadOnlyActionsProvider> : button);
}

let remove: () => void = () => {};
const fetchMock = vi.fn();

beforeEach(() => {
  core.invoke.mockReset();
  core.isTauri.mockReturnValue(true);
  fetchMock.mockReset().mockRejectedValue(new Error("no bridge in the test"));
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = "NEXT_LOCALE=en";
});
afterEach(() => {
  remove();
  remove = () => {};
  cleanup();
  vi.unstubAllGlobals();
});

describe("saving a CV or a letter in the desktop", () => {
  it("asks the native side for the file by its plain name, nothing else, and never calls the bridge", async () => {
    remove = installDocumentSave();
    core.invoke.mockResolvedValueOnce({ outcome: "saved", bytes: 1234 });
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: /Scarica CV/ }));
    await waitFor(() => expect(core.invoke).toHaveBeenCalledWith("team_document_save", { name: NAME }));
    expect(core.invoke).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Scarica CV"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes the click of a closed «Save as» window as nothing happened", async () => {
    remove = installDocumentSave();
    core.invoke.mockResolvedValueOnce({ outcome: "cancelled", bytes: null });
    renderButton();
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Scarica CV"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says why it failed with the catalog's sentence and never names the file", async () => {
    remove = installDocumentSave();
    for (const code of ["document_not_found", "document_too_large", "document_not_pdf", "document_changed", "document_save_failed", "operation_in_progress"]) {
      core.invoke.mockRejectedValueOnce({ code });
      const { unmount } = renderButton();
      await userEvent.click(screen.getByRole("button"));
      const alert = await screen.findByRole("alert");
      const copy = describeError(code, { locale: "en" });
      expect(alert).toHaveTextContent(copy.text);
      expect(alert.textContent).not.toContain(NAME);
      expect(alert.textContent).not.toContain("synthetic");
      expect(screen.getByRole("button")).toHaveTextContent("Errore");
      unmount();
    }
  });

  it("treats an unknown failure or an odd answer as «not saved»", async () => {
    remove = installDocumentSave();
    core.invoke.mockRejectedValueOnce(new Error("secret path /Users/someone/file.pdf"));
    renderButton();
    await userEvent.click(screen.getByRole("button"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(describeError("document_save_failed", { locale: "en" }).text);
    expect(alert.textContent).not.toContain("/Users/");
    cleanup();
    core.invoke.mockResolvedValueOnce({ outcome: "whatever" });
    renderButton();
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(describeError("document_save_failed", { locale: "en" }).text);
  });

  it("works on a team that is only read: saving a PDF writes nothing", async () => {
    remove = installDocumentSave();
    core.invoke.mockResolvedValueOnce({ outcome: "saved", bytes: 10 });
    renderButton(true);
    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(core.invoke).toHaveBeenCalledWith("team_document_save", { name: NAME }));
  });

  it("where nobody listens (the web) the bridge goes on as before, and a read-only page writes nothing", async () => {
    renderButton();
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/profile/files/request", expect.objectContaining({ method: "POST" })));
    expect(core.invoke).not.toHaveBeenCalled();
    cleanup();
    fetchMock.mockClear();
    renderButton(true);
    await userEvent.click(screen.getByRole("button"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is installed only inside the desktop app, takes only a named file, and can be removed", () => {
    core.isTauri.mockReturnValue(false);
    const target = new EventTarget() as unknown as Window;
    const off = installDocumentSave(target);
    const outside = new CustomEvent(SAVE_DOCUMENT_EVENT, { detail: { name: NAME }, cancelable: true });
    expect(target.dispatchEvent(outside)).toBe(true);
    off();
    core.isTauri.mockReturnValue(true);
    const detach = installDocumentSave(target);
    for (const detail of [null, {}, { name: 5 }]) {
      const odd = new CustomEvent(SAVE_DOCUMENT_EVENT, { detail, cancelable: true });
      expect(target.dispatchEvent(odd)).toBe(true);
    }
    core.invoke.mockResolvedValue({ outcome: "saved" });
    const mine: { name: string; result?: Promise<string> } = { name: NAME };
    expect(target.dispatchEvent(new CustomEvent(SAVE_DOCUMENT_EVENT, { detail: mine, cancelable: true }))).toBe(false);
    expect(mine.result).toBeInstanceOf(Promise);
    detach();
    expect(target.dispatchEvent(new CustomEvent(SAVE_DOCUMENT_EVENT, { detail: { name: NAME }, cancelable: true }))).toBe(true);
  });
});

describe("the catalog of the saving errors", () => {
  it("has a sentence and an action in each language for every code the native side can say", () => {
    for (const code of ["document_not_found", "document_too_large", "document_not_pdf", "document_changed", "document_save_failed"]) {
      for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"]) {
        const copy = describeError(code, { locale });
        expect(copy.known, `${code} ${locale}`).toBe(true);
        expect(copy.text.length).toBeGreaterThan(10);
        expect(copy.action.length).toBeGreaterThan(5);
      }
    }
  });
});
