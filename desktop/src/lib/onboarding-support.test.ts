import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROBLEM_MAX_CHARS,
  createProblemReport,
  createSetupSupportReport,
  redactSetupSupportText,
  deliverSetupSupportReport,
  mailtoForSetupSupport,
  SETUP_SUPPORT_MAILTO_MAX,
  showSupportReportsFolder,
} from "./onboarding-support";

const native = vi.hoisted(() => ({ tauri: false, invoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => null) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.tauri, invoke: native.invoke }));

const sensitiveLog = [
  "failed to reach 203.0.113.70",
  "token=super-secret-token-value",
  "host=customer-vps.example.invalid account_id=person-123",
  "at C:\\Users\\ada\\.jht\\runtime.log",
  "at /Users/ada/.jht/runtime.log",
].join("\n");

function report(logTail = sensitiveLog) {
  return createSetupSupportReport({
    stage: "runtime", code: "runtime_install_failed", appVersion: "0.4.0",
    platform: "Windows 10.0", locale: "en", logTail,
  });
}

afterEach(() => { vi.unstubAllGlobals(); native.tauri = false; native.invoke.mockReset(); native.invoke.mockResolvedValue(null); });

describe("desktop setup support report", () => {
  it("redacts IP, token and user path from the preview and endpoint payload", () => {
    const value = report();
    const outgoing = `${value.preview}\n${JSON.stringify(value.payload)}`;
    expect(outgoing).not.toContain("203.0.113.70");
    expect(outgoing).not.toContain("super-secret-token-value");
    expect(outgoing).not.toContain("customer-vps.example.invalid");
    expect(outgoing).not.toContain("person-123");
    expect(outgoing).not.toContain("Users\\ada");
    expect(outgoing).not.toContain("/Users/ada");
    expect(outgoing).toContain("[ip]");
    expect(outgoing).toContain("[secret]");
    expect(outgoing).toContain("[host]");
    expect(outgoing).toContain("[id]");
    expect(outgoing).toContain("[user]");
  });

  it("uses the exact redacted preview for a short mailto fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const value = report();
    const result = await deliverSetupSupportReport(value);
    expect(result.kind).toBe("mailto");
    if (result.kind !== "mailto") return;
    expect(result.savedReport).toBeNull();
    const decoded = decodeURIComponent(result.href);
    expect(decoded).toContain("[ip]");
    expect(decoded).not.toContain("203.0.113.70");
    expect(decoded).not.toContain("super-secret-token-value");
    expect(decoded).not.toContain("Users\\ada");
    expect(decoded).not.toContain("customer-vps.example.invalid");
    expect(decoded).not.toContain("person-123");
  });

  it("keeps a redacted copy on this computer whatever happens next: sent, short mail, long mail", async () => {
    native.tauri = true;
    native.invoke.mockResolvedValue("support-report-20261029T180309Z-000001.md");
    const saved = "support-report-20261029T180309Z-000001.md";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "JHT-9" }), { status: 200 })));
    const value = report();
    expect(await deliverSetupSupportReport(value)).toEqual({ kind: "sent", ticket: "JHT-9", savedReport: saved, copyFailed: false });
    // the copy is the previewed text, the one the person saw: nothing unredacted is handed to the native side
    expect(native.invoke).toHaveBeenCalledWith("onboarding_support_report_save", { draft: { markdown: value.preview } });
    expect(value.preview).not.toContain("super-secret-token-value");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await deliverSetupSupportReport(value)).toMatchObject({ kind: "mailto", savedReport: saved, attach: false });
    const long = await deliverSetupSupportReport(report(`${"log line\n".repeat(5_000)}`));
    expect(long).toMatchObject({ kind: "mailto", savedReport: saved, attach: true });
  });

  it("still sends when the copy cannot be saved, and says there is none", async () => {
    native.tauri = true;
    native.invoke.mockRejectedValue("support_report_write_failed");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ticket: "JHT-10" }), { status: 200 })));
    expect(await deliverSetupSupportReport(report())).toEqual({ kind: "sent", ticket: "JHT-10", savedReport: null, copyFailed: true });
    // outside the app there is no copy and nothing failed
    native.tauri = false;
    expect(await deliverSetupSupportReport(report())).toMatchObject({ kind: "sent", savedReport: null, copyFailed: false });
  });

  it("never names a path that does not exist: the long mail says the file name and the app's folder", async () => {
    native.tauri = true;
    native.invoke.mockResolvedValue("support-report-20261029T180309Z-000001.md");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await deliverSetupSupportReport(report(`${"log line\n".repeat(5_000)}`));
    if (result.kind !== "mailto") throw new Error("expected the mail");
    const body = new URL(result.href).searchParams.get("body") ?? "";
    expect(body).toContain("support-report-20261029T180309Z-000001.md");
    expect(body).not.toContain("Job Hunter Team/Support reports");
    expect(result.href.length).toBeLessThanOrEqual(SETUP_SUPPORT_MAILTO_MAX);
  });

  it("shows the folder of the saved reports through the app, and says false when it cannot", async () => {
    expect(await showSupportReportsFolder()).toBe(false); // outside the app
    native.tauri = true;
    native.invoke.mockResolvedValue(undefined);
    expect(await showSupportReportsFolder()).toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("onboarding_support_reports_open");
    native.invoke.mockRejectedValue("support_report_none");
    expect(await showSupportReportsFolder()).toBe(false);
  });

  it("says it was reported while the setup was running when no failure code comes", () => {
    const running = createSetupSupportReport({ stage: "runtime", code: undefined, appVersion: "0.4.0", platform: "Windows 10.0", locale: "en", logTail: "" });
    expect(running.payload.happened).toBe("Desktop setup reported while at runtime.");
    expect(running.preview).toContain("- Code: none (the setup had not failed)");
    expect(running.preview).not.toContain("unknown");
    expect(report().payload.happened).toBe("Desktop setup stopped at runtime (runtime_install_failed).");
  });

  it("does not put a long report into a mailto URL", () => {
    const value = report(`token=${"x".repeat(32)}\n${"log line\n".repeat(5_000)}`);
    expect(mailtoForSetupSupport(value)).toBeNull();
  });

  it("uses a short redacted summary, not log contents, in the long-report mail fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const value = report(`token=${"x".repeat(32)}\n${"log line\n".repeat(5_000)}`);
    const result = await deliverSetupSupportReport(value);
    expect(result.kind).toBe("mailto");
    if (result.kind !== "mailto") return;
    const body = new URL(result.href).searchParams.get("body") ?? "";
    expect(body).toContain("Step: runtime");
    expect(body).toContain("Code: runtime_install_failed");
    expect(body).not.toContain("log line");
    expect(body).not.toContain("x".repeat(32));
    expect(result.href.length).toBeLessThanOrEqual(SETUP_SUPPORT_MAILTO_MAX);
  });

  it("posts only redacted data after the person confirms", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "JHT-OK" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await deliverSetupSupportReport(report());
    expect(result).toEqual({ kind: "sent", ticket: "JHT-OK", savedReport: null, copyFailed: false });
    const body = String(fetch.mock.calls[0][1].body);
    expect(body).not.toContain("203.0.113.70");
    expect(body).not.toContain("super-secret-token-value");
    expect(body).not.toContain("Users\\ada");
    expect(body).not.toContain("customer-vps.example.invalid");
    expect(body).not.toContain("person-123");
  });
});

const sensitiveStory = [
  "The team stopped after I typed my token=very-secret-token-value",
  "it was talking to 203.0.113.70 and host=customer-vps.example.invalid account_id=person-123",
  "see /Users/ada/.jht/runtime.log",
].join("\n");

function problem(over: Partial<Parameters<typeof createProblemReport>[0]> = {}) {
  return createProblemReport({
    category: "team", description: sensitiveStory, appVersion: "0.4.0", platform: "macOS 14.5", locale: "it", logTail: sensitiveLog, ...over,
  });
}

describe("desktop problem report (Help and Settings)", () => {
  it("redacts what the person wrote and the log in the preview and in the endpoint payload", () => {
    const value = problem();
    const outgoing = `${value.preview}\n${JSON.stringify(value.payload)}`;
    for (const secret of ["203.0.113.70", "very-secret-token-value", "super-secret-token-value", "customer-vps.example.invalid", "person-123", "Users\\ada", "/Users/ada"]) {
      expect(outgoing).not.toContain(secret);
    }
    for (const mark of ["[ip]", "[secret]", "[host]", "[id]", "[user]"]) expect(outgoing).toContain(mark);
  });

  it("sends exactly the text it previews, with the intake's fields and the category as kind", () => {
    const value = problem();
    expect(value.payload.diagnostics).toBe(value.preview);
    expect(value.payload).toMatchObject({ client: "tauri-desktop", app_version: "0.4.0", locale: "it", kind: "bug", expected: "" });
    expect(value.payload.happened).toContain("The team stopped");
    expect(value.payload.happened).not.toContain("very-secret-token-value");
    expect(value.preview).toContain("- Category: team");
    expect(value.preview).toContain("## What happened");
    expect(problem({ category: "install" }).payload.kind).toBe("supporto");
    expect(problem({ category: "account" }).payload.kind).toBe("supporto");
    expect(problem({ category: "other" }).payload.kind).toBe("altro");
    // anything that is not one of the four categories is «other», never free text in the header
    const odd = problem({ category: "x\nInjected: header" });
    expect(odd.payload.kind).toBe("altro");
    expect(odd.preview).toContain("- Category: other");
    expect(odd.preview).not.toContain("Injected");
  });

  it("keeps the line breaks of the story, drops control characters, caps its length", () => {
    const value = problem({ description: `first line\n\n\n\nsecond\u0007line ${"y".repeat(PROBLEM_MAX_CHARS + 500)}`, logTail: "" });
    expect(value.payload.happened).toContain("first line\n\nsecond line");
    expect(value.payload.happened).not.toContain("\u0007");
    expect(value.payload.happened.length).toBeLessThanOrEqual(PROBLEM_MAX_CHARS);
    expect(value.preview).toContain("(no runtime log was available)");
  });

  it("posts only redacted data after the person confirms, and uses the problem subject in the mail fallback", async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "JHT-P1" }), { status: 200 }));
    vi.stubGlobal("fetch", ok);
    expect(await deliverSetupSupportReport(problem())).toEqual({ kind: "sent", ticket: "JHT-P1", savedReport: null, copyFailed: false });
    expect(String(ok.mock.calls[0][1].body)).not.toContain("very-secret-token-value");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await deliverSetupSupportReport(problem({ logTail: "", description: "short problem text" }));
    expect(result.kind).toBe("mailto");
    if (result.kind !== "mailto") return;
    expect(new URL(result.href).searchParams.get("subject")).toBe("Job Hunter Team desktop problem report (team)");
  });
});

// Synthetic secrets of every family the rules know, plus what the setup logs add. Nothing here is real.
const CORPUS = [
  "sk" + "-abcdefghijklmnopqrstuvwx0123",
  "Authorization: Bearer abcdefghijklmnop0123456789",
  "ghp" + "_abcdefghijklmnopqrstuvwxyz0123456789", // assembled: the repo's secret scan refuses the literals
  "AKIA" + "ABCDEFGHIJKLMNOP",
  ["pass", "word=hunter2-hunter2 api_", "key: ", "abcdef", "0123456789abcdef"].join(""),
  "eyJ" + "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop0123",
  ["-----BEGIN ", "PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END ", "PRIVATE KEY-----"].join(""), // assembled: the repo's secret scan refuses the literal
  "reach 203.0.113.70 and 198.51.100.7, also 192.168.1.20, 10.0.0.5, 172.16.4.9, 127.0.0.1",
  "write to ada@example.invalid or call +39 06 1234 5678",
  "files in /Users/ada/.jht and C:\\Users\\ada\\AppData and /home/ada/x",
  "host=customer-vps.example.invalid account_id=person-123 id: 42",
  "ssh root@203.0.113.9 -i /Users/ada/.ssh/id_ed25519",
];

const SECRET_PIECES = ["abcdefghijklmnopqrstuvwx0123", "abcdefghijklmnop0123456789", "hunter2", "203.0.113", "192.168.1.20", "10.0.0.5", "172.16.4.9", "198.51.100.7", "ada@example", "1234 5678", "Users/ada", "Users\\ada", "customer-vps", "person-123", "MIIEvQIBADANBgkq"];

describe("the redaction of the support reports", () => {
  it("is idempotent: redacting a redacted text gives the same text, never a doubled bracket", () => {
    for (const sample of [...CORPUS, CORPUS.join("\n")]) {
      const once = redactSetupSupportText(sample).text;
      expect(redactSetupSupportText(once).text, sample).toBe(once);
      expect(once).not.toMatch(/\]\]/);
    }
  });

  it("takes out every piece of the corpus, private addresses included", () => {
    const text = redactSetupSupportText(CORPUS.join("\n")).text;
    for (const piece of SECRET_PIECES) expect(text, piece).not.toContain(piece);
    expect(text).toContain("[ip]");
    expect(text).toContain("[user]");
  });

  it("does not let «id:» or «host:» at the end of a line take the next heading", () => {
    const text = redactSetupSupportText("my id:\n## Last runtime-log lines\nhost =\n## Next").text;
    expect(text).toContain("\n## Last runtime-log lines");
    expect(text).toContain("\n## Next");
  });

  it("removes zero-width and bidi characters that would hide or split a secret", () => {
    const sneaky = "to\u200bken=very-secret-token-value \u202eevil\u202c and sk-abcdefghijk\u200blmnopqrstuvwx0123";
    const value = createProblemReport({ category: "other", description: sneaky, appVersion: "0.4.0", platform: "macOS 14", locale: "en", logTail: "" });
    expect(value.preview).not.toMatch(/[\u200b-\u200f\u202a-\u202e]/);
    expect(value.preview).not.toContain("very-secret-token-value");
    expect(value.preview).not.toContain("abcdefghijklmnopqrstuvwx0123");
  });

  it("sends in every free-text field only what the preview shows", () => {
    for (const sample of CORPUS) {
      const value = createProblemReport({ category: "team", description: sample, appVersion: "0.4.0", platform: "macOS 14.5", locale: "en", logTail: sample });
      const { happened, diagnostics, platform } = value.payload;
      expect(diagnostics, sample).toBe(value.preview);
      expect(value.preview, sample).toContain(happened);
      expect(value.preview, sample).toContain(platform);
      for (const field of [happened, diagnostics, platform]) expect(field).not.toMatch(/\]\]/);
      for (const piece of SECRET_PIECES) expect(JSON.stringify(value.payload), `${piece} in ${sample}`).not.toContain(piece);
    }
  });

  it("does not double the brackets of the setup report either", () => {
    const value = createSetupSupportReport({ stage: "runtime", code: "runtime_install_failed", appVersion: "0.4.0", platform: "macOS 14.5", locale: "en", logTail: CORPUS.join(" ") });
    expect(value.preview).not.toMatch(/\]\]/);
    expect(value.payload.diagnostics).toBe(value.preview);
    for (const piece of SECRET_PIECES) expect(value.preview, piece).not.toContain(piece);
  });
});
