/**
 * ssh exits 255 for a refused key, a refused connection, a host that cannot be reached and a host key that
 * changed. The app read all of them as one sentence («cannot be reached… likely causes: …»). Each has its own
 * code and its own sentence now, in the seven languages, and the places that sort codes know them.
 */
import { describe, expect, it } from "vitest";
import { describeError, ERROR_LOCALES } from "./error-catalog";
import { existingTeamErrorCode } from "./existing-team";
import { stopsTheWatch } from "./notify/watch";
import { REOPEN_NO_RETRY } from "@/pages/messages/DirectChatScreen";
import { chatMayStillCome } from "./direct-chat-wait";

const WAY_IN = ["ssh_auth_failed", "ssh_connection_refused", "ssh_host_unreachable", "host_key_changed", "ssh_unavailable"] as const;

describe("the ways in to a VPS that fail have a sentence each", () => {
  for (const locale of ERROR_LOCALES) {
    it(`${locale}: five codes, five different sentences, none of them the generic one`, () => {
      const said = WAY_IN.map((code) => describeError(code, { locale }));
      for (const one of said) expect(one.known, one.code).toBe(true);
      expect(new Set(said.map((one) => one.text)).size, "each code says its own thing").toBe(WAY_IN.length);
      const unknown = describeError("no_such_code_at_all", { locale });
      for (const one of said) expect(one.text, one.code).not.toBe(unknown.text);
    });
  }

  it("a refused key does not say «try again» at once, a changed host key does not say it at all", () => {
    const en = (code: string) => describeError(code, { locale: "en" });
    expect(en("ssh_auth_failed").action).toMatch(/try once/i);
    expect(en("host_key_changed").action).toMatch(/do not proceed/i);
    // the key may be one that was never confirmed: ssh says the same for both
    expect(en("host_key_changed").text).toMatch(/unknown or has CHANGED/);
    expect(en("ssh_connection_refused").action).toMatch(/SSH port/);
    expect(en("ssh_host_unreachable").action).toMatch(/internet connection/);
  });

  it("the old sentence that listed every cause is gone from the code that says only «I cannot tell why»", () => {
    for (const locale of ERROR_LOCALES) {
      const unavailable = describeError("ssh_unavailable", { locale });
      expect(unavailable.text).not.toMatch(/passphrase/i);
    }
    expect(describeError("ssh_unavailable", { locale: "en" }).text).toMatch(/cannot tell why/);
  });
});

describe("the places that sort the codes know the new ones", () => {
  it("the existing-team reads keep the code instead of «unknown»", () => {
    for (const code of ["ssh_auth_failed", "ssh_connection_refused", "ssh_host_unreachable", "ssh_unavailable"]) {
      expect(existingTeamErrorCode(code), code).toBe(code);
    }
  });

  it("a refused key stops the background watch, the network does not", () => {
    expect(stopsTheWatch("ssh_auth_failed")).toBe(true);
    expect(stopsTheWatch("host_key_changed")).toBe(true);
    expect(stopsTheWatch("ssh_connection_refused")).toBe(false);
    expect(stopsTheWatch("ssh_host_unreachable")).toBe(false);
  });

  it("asking again is told at once for a refused key and a changed key, and goes on for the network", () => {
    expect(REOPEN_NO_RETRY.has("ssh_auth_failed")).toBe(true);
    expect(REOPEN_NO_RETRY.has("host_key_changed")).toBe(true);
    expect(REOPEN_NO_RETRY.has("ssh_connection_refused")).toBe(false);
    expect(REOPEN_NO_RETRY.has("ssh_host_unreachable")).toBe(false);
  });

  it("waiting for the chat does not cure a refused key, and may cure a host that is not there yet", () => {
    expect(chatMayStillCome({ state: "failed", code: "ssh_auth_failed" } as never)).toBe(false);
    expect(chatMayStillCome({ state: "failed", code: "ssh_host_unreachable" } as never)).toBe(true);
    expect(chatMayStillCome({ state: "failed", code: "ssh_connection_refused" } as never)).toBe(true);
  });
});
