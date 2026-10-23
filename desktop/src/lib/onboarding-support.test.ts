import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSetupSupportReport,
  deliverSetupSupportReport,
  mailtoForSetupSupport,
  SETUP_SUPPORT_MAILTO_MAX,
} from "./onboarding-support";

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

afterEach(() => vi.unstubAllGlobals());

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
    expect(result).toEqual({ kind: "sent", ticket: "JHT-OK" });
    const body = String(fetch.mock.calls[0][1].body);
    expect(body).not.toContain("203.0.113.70");
    expect(body).not.toContain("super-secret-token-value");
    expect(body).not.toContain("Users\\ada");
    expect(body).not.toContain("customer-vps.example.invalid");
    expect(body).not.toContain("person-123");
  });
});
