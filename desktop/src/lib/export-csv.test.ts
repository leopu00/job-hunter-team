import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

import { EXPORT_CSV_EVENT, installCsvExport, saveCsv } from "./export-csv";

beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue("/Users/ada/Downloads/p.csv");
  native.isTauri.mockReset().mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("saving a CSV in the desktop", () => {
  it("asks the native side to save it, with only the name and the content", async () => {
    await expect(saveCsv("p.csv", "a,b")).resolves.toBe("/Users/ada/Downloads/p.csv");
    expect(native.invoke).toHaveBeenCalledWith("export_csv_save", { name: "p.csv", content: "a,b" });
  });

  it("takes the page's event, so the page does not download the file itself", async () => {
    const remove = installCsvExport();
    const detail: { name: string; csv: string; result?: Promise<string> } = { name: "p.csv", csv: "a,b" };
    const event = new CustomEvent(EXPORT_CSV_EVENT, { detail, cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
    await expect(detail.result).resolves.toBe("/Users/ada/Downloads/p.csv");
    remove();
    expect(window.dispatchEvent(new CustomEvent(EXPORT_CSV_EVENT, { detail, cancelable: true }))).toBe(true);
  });

  it("ignores an event that is not a name and a text", () => {
    const remove = installCsvExport();
    const event = new CustomEvent(EXPORT_CSV_EVENT, { detail: { name: 3 }, cancelable: true });
    expect(window.dispatchEvent(event)).toBe(true);
    expect(native.invoke).not.toHaveBeenCalled();
    remove();
  });

  it("listens to nothing outside the desktop", () => {
    native.isTauri.mockReturnValue(false);
    installCsvExport();
    const event = new CustomEvent(EXPORT_CSV_EVENT, { detail: { name: "p.csv", csv: "a" }, cancelable: true });
    expect(window.dispatchEvent(event)).toBe(true);
  });
});
