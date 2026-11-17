import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  missingTokenOriginColumn,
  originHoldsNoSession,
} from "../../../web/lib/cloud-sync/pairing-session";

// 107: every route that creates a cloud-sync token says where it was born. Only device-register hands a user session
// to a box; `jht cloud login` (device-confirm) and the page of the tokens do not, and without a pairing session their
// tokens must not close the L3 door of the website (the site answered not_found to every authorisation).
const repo = join(__dirname, "..", "..", "..");
const source = (p: string) => readFileSync(join(repo, p), "utf-8");

describe("the origin of a cloud-sync token", () => {
  it.each([
    ["web/app/api/cloud-sync/device-register/route.ts", 'token_origin: "device_register"'],
    ["web/app/api/cloud-sync/device-confirm/route.ts", 'token_origin: "device_code"'],
    ["web/app/api/cloud-sync/tokens/route.ts", 'token_origin: "page"'],
  ])("%s writes it, and without 107 writes the token all the same", (file, origin) => {
    const text = source(file);
    expect(text).toContain(origin);
    expect(text).toContain("missingTokenOriginColumn(");
  });

  it("only device_code and page hold no session; an unknown or another origin may", () => {
    expect(originHoldsNoSession("device_code")).toBe(true);
    expect(originHoldsNoSession("page")).toBe(true);
    for (const origin of ["device_register", null, undefined, "", "PAGE", "browser"]) {
      expect(originHoldsNoSession(origin)).toBe(false);
    }
  });

  it("the missing column is told only by its code and its name", () => {
    expect(missingTokenOriginColumn({ code: "PGRST204", message: "Could not find the 'token_origin' column" })).toBe(true);
    expect(missingTokenOriginColumn({ code: "42703", message: 'column "token_origin" does not exist' })).toBe(true);
    expect(missingTokenOriginColumn({ code: "42703", message: 'column "name" does not exist' })).toBe(false);
    expect(missingTokenOriginColumn({ code: "23514", message: "token_origin check" })).toBe(false);
    expect(missingTokenOriginColumn(null)).toBe(false);
  });

  it("the door of 107 lets only device_code and page through without a session, and keeps comparing the session", () => {
    const sql = source("supabase/migrations/107_cloud_sync_token_origin.sql");
    expect(sql).toContain("AND (t.token_origin IS NULL OR t.token_origin = 'device_register')");
    expect(sql).toContain("OR (v_session IS NOT NULL AND t.pairing_session_id = v_session)");
    expect(sql).toContain("REVOKE ALL ON FUNCTION web_door.ext_position(TEXT, TEXT, UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;");
  });
});
