import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/config";
import { describeError } from "../../lib/error-catalog";
import type { BackupProgress } from "../../lib/team-backup";
import BackupPage, { sizeText } from "./index";
import { BACKUP_TEXT } from "./backup.i18n";

// The backup page against a stand-in of the native side. Synthetic data only.
const native = vi.hoisted(() => ({
  backupCreate: vi.fn(),
  backupCancel: vi.fn(),
  backupInspect: vi.fn(),
  onBackupProgress: vi.fn(),
}));
vi.mock("../../lib/team-backup", async (original) => ({ ...(await original<typeof import("../../lib/team-backup")>()), ...native }));

const props = { params: {}, search: new URLSearchParams() };
let emit: (progress: BackupProgress) => void = () => {};

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=en; path=/";
  localStorage.setItem("jht-lang", "en");
  native.backupCreate.mockReset().mockResolvedValue({ ok: true, outcome: "saved", bytes: 2_621_440, files: 3 });
  native.backupCancel.mockReset().mockResolvedValue(undefined);
  native.backupInspect.mockReset().mockResolvedValue({ ok: true, outcome: "cancelled" });
  native.onBackupProgress.mockReset().mockImplementation(async (listener: (progress: BackupProgress) => void) => {
    emit = listener;
    return () => {};
  });
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

const opened = (fields: Record<string, unknown> = {}) => ({
  ok: true,
  outcome: "opened",
  verified: true,
  problems: [],
  manifest: {
    format: 1,
    createdAt: "2026-10-24T10:00:00Z",
    files: [{ path: "jobs.db", bytes: 1_048_576 }, { path: "profile/cv.pdf", bytes: 1_048_576 }],
    excluded: [],
    alwaysExcluded: ["cloud token", "provider sign-ins", "logs"],
  },
  ...fields,
});

describe("the backup page: before saving", () => {
  it("says, before anything is saved, that the file is not encrypted and holds personal data", () => {
    render(<BackupPage {...props} />);
    const note = screen.getByTestId("backup-personal-data");
    expect(note).toHaveTextContent("not encrypted and contains personal data");
    // it says what stays out and what goes in as it is, so nobody takes a pasted password for protected
    expect(note).toHaveTextContent("Provider keys, sign-ins, cloud tokens and logs are not included.");
    expect(note).toHaveTextContent("Chats and documents are copied as they are: if you wrote a password in them, it is in the file.");
    expect(note).not.toHaveTextContent(/never contains/i);
    expect(note.compareDocumentPosition(screen.getByTestId("backup-create-button")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(screen.getByTestId("backup-inspect-button")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers no restore: it is not in this version, and the page says so", () => {
    render(<BackupPage {...props} />);
    expect(screen.queryByRole("button", { name: /restore|ripristin/i })).toBeNull();
    expect(screen.getByText(/Restoring is not in this version yet/)).toBeInTheDocument();
  });
});

describe("the backup page: making one", () => {
  it("makes the backup and says how many files and how big, with no path", async () => {
    const user = userEvent.setup();
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-create-button"));
    expect(native.backupCreate).toHaveBeenCalledOnce();
    expect(await screen.findByTestId("backup-create-say")).toHaveTextContent("Saved: 3 files, 2.5 MB (compressed archive).");
    expect(screen.queryByTestId("backup-cancel-button")).toBeNull();
  });

  it("says nothing when the «Save as» window is closed", async () => {
    const user = userEvent.setup();
    native.backupCreate.mockResolvedValue({ ok: true, outcome: "cancelled" });
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-create-button"));
    await screen.findByTestId("backup-create-button");
    expect(screen.queryByTestId("backup-create-say")).toBeNull();
    expect(screen.getByTestId("backup-create-button")).toBeEnabled();
  });

  it("says why it failed, with the catalog's sentence", async () => {
    const user = userEvent.setup();
    native.backupCreate.mockResolvedValue({ ok: false, error: "backup_too_large" });
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-create-button"));
    const say = await screen.findByTestId("backup-create-say");
    expect(say).toHaveAttribute("role", "alert");
    expect(say).toHaveTextContent(describeError("backup_too_large", { locale: "en" }).text);
  });

  it("tells a place that does not allow private files apart from a failed save, with the sentence of the catalog", async () => {
    const user = userEvent.setup();
    native.backupCreate.mockResolvedValue({ ok: false, error: "private_unavailable" });
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-create-button"));
    const say = await screen.findByTestId("backup-create-say");
    expect(say).toHaveTextContent("This place does not allow private files.");
    expect(say).toHaveTextContent("Choose another one");
    expect(say).not.toHaveTextContent(describeError("backup_save_failed", { locale: "en" }).text);
    for (const locale of ["it", "de", "es", "fr", "hu", "pt"] as const) {
      const copy = describeError("private_unavailable", { locale });
      expect(copy.known, locale).toBe(true);
      expect(copy.text, locale).not.toBe(describeError("private_unavailable", { locale: "en" }).text);
    }
  });

  it("shows the phase and, when it has a size, how far it is; cancelling asks the native side once", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    native.backupCreate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-create-button"));
    expect(screen.getByTestId("backup-create-button")).toBeDisabled();
    // planning has no size: the phase alone, no bar, no invented percentage
    act(() => emit({ phase: "plan", done: 0, total: 0 }));
    const progress = screen.getByTestId("backup-progress");
    expect(progress).toHaveTextContent("Preparing the copy");
    expect(within(progress).queryByRole("progressbar")).toBeNull();
    // a phase with a total but no count of its own shows no bar and no «0 B»: it would look stuck
    act(() => emit({ phase: "snapshot", done: 0, total: 2_097_152 }));
    expect(progress).toHaveTextContent("Consistent copy of the database");
    expect(progress).not.toHaveTextContent("0 B");
    expect(within(progress).queryByRole("progressbar")).toBeNull();
    act(() => emit({ phase: "verify", done: 0, total: 2_097_152 }));
    expect(within(progress).queryByRole("progressbar")).toBeNull();
    act(() => emit({ phase: "copy", done: 524_288, total: 2_097_152 }));
    expect(progress).toHaveTextContent("Transferring the files · 512 kB / 2 MB");
    expect(within(progress).getByRole("progressbar")).toHaveAttribute("value", "25");
    await user.click(screen.getByTestId("backup-cancel-button"));
    expect(native.backupCancel).toHaveBeenCalledOnce();
    expect(screen.getByTestId("backup-cancel-button")).toBeDisabled();
    await act(async () => finish({ ok: true, outcome: "cancelled" }));
    expect(screen.queryByTestId("backup-progress")).toBeNull();
    expect(screen.queryByTestId("backup-create-say")).toBeNull();
  });
});

describe("the backup page: checking one", () => {
  it("says a verified backup is verified, with its date, files and what never goes in", async () => {
    const user = userEvent.setup();
    native.backupInspect.mockResolvedValue(opened());
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-inspect-button"));
    expect(await screen.findByTestId("backup-verified")).toHaveTextContent("Verified: the contents match");
    expect(screen.getByTestId("backup-opened")).toHaveTextContent("2 files, 2 MB (uncompressed contents)");
    expect(screen.getByTestId("backup-opened")).toHaveTextContent(/Made on /);
    expect(screen.getByTestId("backup-always-excluded")).toHaveTextContent("Never in a backup: cloud token, provider sign-ins, logs");
    expect(screen.queryByTestId("backup-problems")).toBeNull();
  });

  it("does not call a backup verified when it is not, and lists the problems", async () => {
    const user = userEvent.setup();
    native.backupInspect.mockResolvedValue(opened({ verified: false, problems: ["jobs.db"] }));
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-inspect-button"));
    expect(await screen.findByTestId("backup-verified")).toHaveTextContent("Not verified");
    expect(screen.getByTestId("backup-problems")).toHaveTextContent("jobs.db");
  });

  it("says a file that is not a backup is not, and shows nothing when the window is closed", async () => {
    const user = userEvent.setup();
    native.backupInspect.mockResolvedValueOnce({ ok: false, error: "backup_not_a_backup" });
    render(<BackupPage {...props} />);
    await user.click(screen.getByTestId("backup-inspect-button"));
    expect(await screen.findByTestId("backup-inspect-say")).toHaveTextContent(describeError("backup_not_a_backup", { locale: "en" }).text);
    native.backupInspect.mockResolvedValueOnce({ ok: true, outcome: "cancelled" });
    await user.click(screen.getByTestId("backup-inspect-button"));
    expect(screen.queryByTestId("backup-opened")).toBeNull();
  });
});

describe("the backup page's words and sizes", () => {
  it("has every language's, with the plural forms carrying their count and size", () => {
    for (const [locale, text] of Object.entries(BACKUP_TEXT) as [Locale, (typeof BACKUP_TEXT)[Locale]][]) {
      for (const [key, value] of Object.entries(text)) {
        if (typeof value === "string") expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(1);
      }
      for (const forms of [text.saved, text.filesLine]) {
        for (const form of [forms.one, forms.other]) {
          expect(form, locale).toContain("{count}");
          expect(form, locale).toContain("{size}");
        }
      }
      expect(text.excludedLine.one, locale).toContain("{count}");
      expect(text.alwaysExcluded, locale).toContain("{names}");
      expect(text.createdAt, locale).toContain("{date}");
    }
    expect(Object.keys(BACKUP_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });

  it("tells, in every language, that the saved size is the compressed archive and the checked one is the contents", () => {
    const note = (form: string) => form.match(/\(([^)]+)\)/)?.[1];
    for (const [locale, text] of Object.entries(BACKUP_TEXT) as [Locale, (typeof BACKUP_TEXT)[Locale]][]) {
      for (const key of ["one", "other"] as const) {
        const saved = note(text.saved[key]);
        const contents = note(text.filesLine[key]);
        expect(saved, `${locale} saved ${key}`).toBeTruthy();
        expect(contents, `${locale} filesLine ${key}`).toBeTruthy();
        expect(saved, locale).not.toBe(contents);
      }
    }
  });

  it("writes a size with the biggest unit that keeps it above one", () => {
    expect(sizeText(0, "en")).toBe("0 byte");
    expect(sizeText(1536, "en")).toBe("1.5 kB");
    expect(sizeText(2_621_440, "en")).toBe("2.5 MB");
    expect(sizeText(3 * 1024 ** 3, "en")).toBe("3 GB");
  });
});
