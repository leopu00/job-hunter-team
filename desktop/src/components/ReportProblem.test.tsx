import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import { SUPPORT_REPORT_COPY } from "../onboarding/SetupSupportReport";
import ReportProblem from "./ReportProblem";
import { REPORT_PROBLEM_TEXT } from "./report-problem.i18n";

const native = vi.hoisted(() => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) => {
    if (command === "onboarding_support_context") return { appVersion: "0.4.0", logTail: "token=log-secret-token-value\nat 203.0.113.9 failed" };
    if (command === "onboarding_support_report_save") return "support-report-20261029T180309Z-000003.md";
    if (command === "onboarding_support_reports_open") return null;
    throw new Error(`unexpected command ${command}`);
  }),
}));
vi.mock("@tauri-apps/api/core", () => native);

beforeEach(() => localStorage.setItem("jht-lang", "en"));
afterEach(() => { cleanup(); localStorage.removeItem("jht-lang"); vi.unstubAllGlobals(); native.invoke.mockClear(); });

async function fillAndPreview(text: string) {
  render(<ReportProblem id="t" />);
  await userEvent.type(screen.getByTestId("report-problem-description"), text);
  await userEvent.click(screen.getByTestId("report-problem-preview-button"));
  return (await screen.findByTestId("report-problem-preview")) as HTMLTextAreaElement;
}

describe("Report a problem (Help and Settings)", () => {
  it("does not offer the preview until something is written, and sends nothing by itself", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<ReportProblem id="t" />);
    expect(screen.getByRole("heading", { name: "Report a problem" })).toBeInTheDocument();
    expect(screen.getByTestId("report-problem-note")).toHaveTextContent("not the names or personal details you type yourself");
    expect(screen.getByTestId("report-problem-preview-button")).toBeDisabled();
    await userEvent.type(screen.getByTestId("report-problem-description"), "abc");
    expect(screen.getByTestId("report-problem-preview-button")).toBeDisabled();
    await userEvent.type(screen.getByTestId("report-problem-description"), "def");
    expect(screen.getByTestId("report-problem-preview-button")).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the redacted text first, and posts it only when the person presses Send", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "JHT-77" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const preview = await fillAndPreview("It stopped. token=story-secret-token-value at 203.0.113.70");
    for (const secret of ["story-secret-token-value", "log-secret-token-value", "203.0.113.70", "203.0.113.9"]) expect(preview.value).not.toContain(secret);
    expect(preview.value).toContain("[secret]");
    expect(preview.value).toContain("It stopped.");
    expect(preview.readOnly).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("report-problem-send"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetch.mock.calls[0][1].body)) as Record<string, string>;
    expect(body.diagnostics).toBe(preview.value);
    expect(body.client).toBe("tauri-desktop");
    expect(JSON.stringify(body)).not.toContain("story-secret-token-value");
    // the ticket, and the copy kept on this computer: the redacted text the person saw
    expect(await screen.findByRole("status")).toHaveTextContent("Report sent: JHT-77");
    expect(screen.getByRole("status")).toHaveTextContent("Copy kept on this computer: support-report-20261029T180309Z-000003.md");
    // no path that does not exist: the file's name, and a button to the real folder
    expect(screen.getByRole("status")).not.toHaveTextContent("Support reports/");
    await userEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(native.invoke).toHaveBeenCalledWith("onboarding_support_reports_open");
    expect(screen.getByRole("status")).not.toHaveTextContent("could not be opened");
    expect(native.invoke).toHaveBeenCalledWith("onboarding_support_report_save", { draft: { markdown: preview.value } });
  });

  it("says when the copy could not be kept, and when the folder could not be opened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "JHT-78" }), { status: 200 })));
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "onboarding_support_context") return { appVersion: "0.4.0", logTail: "" };
      throw "support_report_write_failed";
    });
    await fillAndPreview("it stopped");
    await userEvent.click(screen.getByTestId("report-problem-send"));
    expect(await screen.findByTestId("support-copy-failed")).toHaveTextContent("The copy could not be saved on this computer.");
    expect(screen.queryByRole("button", { name: "Show in folder" })).toBeNull();
  });

  it("goes back from the preview without sending", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await fillAndPreview("something went wrong");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("report-problem-description")).toHaveValue("something went wrong");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers the four categories, «Other» first chosen, and carries the chosen one", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ReportProblem id="t" />);
    const group = screen.getByRole("group", { name: "Category" });
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual(["Installation", "Team and agents", "Account and sign-in", "Other"]);
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Installation" }));
    await userEvent.type(screen.getByTestId("report-problem-description"), "will not install");
    await userEvent.click(screen.getByTestId("report-problem-preview-button"));
    expect(((await screen.findByTestId("report-problem-preview")) as HTMLTextAreaElement).value).toContain("- Category: install");
  });

  it("has every text in the seven languages, and the setup report's status lines", () => {
    expect(Object.keys(REPORT_PROBLEM_TEXT).sort()).toEqual([...locales].sort());
    const keys = Object.keys(REPORT_PROBLEM_TEXT.en).sort();
    for (const locale of locales) {
      expect(Object.keys(REPORT_PROBLEM_TEXT[locale]).sort()).toEqual(keys);
      for (const value of Object.values(REPORT_PROBLEM_TEXT[locale])) expect(value.trim()).not.toBe("");
      for (const line of ["preparing", "sending", "sent", "mail", "saved", "failed", "cancel", "preview"]) expect(SUPPORT_REPORT_COPY[locale][line]).toBeTruthy();
    }
  });
});
