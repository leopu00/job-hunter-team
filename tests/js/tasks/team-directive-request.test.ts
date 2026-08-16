import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  directiveErrorTranslationKey,
  isDirectiveAcknowledgement,
  retainDirectiveRequest,
} from "@/lib/team-directive-request";

describe("directive client request lifetime", () => {
  it("retains one request id for retries until an exact acknowledgement", () => {
    const pending = new Map();
    const ids = ["first-id", "second-id"];
    const makeId = () => ids.shift()!;
    const payload = { body: "keep me", kind: "strategy" };
    const first = retainDirectiveRequest(pending, "create", payload, makeId);
    expect(retainDirectiveRequest(pending, "create", payload, makeId)).toBe(
      first,
    );
    expect(
      isDirectiveAcknowledgement(
        {
          ok: true,
          id: "7",
          request_id: first.requestId,
          action: "created",
          captain_event: { status: "queued" },
        },
        { requestId: first.requestId, action: "created" },
      ),
    ).toBe(true);
    pending.delete("create");
    expect(
      retainDirectiveRequest(pending, "create", payload, makeId).requestId,
    ).toBe("second-id");
  });

  it("rejects response loss shapes and acknowledgements for another operation", () => {
    const expected = { requestId: "opaque", action: "edited" as const, id: 4 };
    for (const response of [
      {},
      { ok: true, id: "4", request_id: "opaque", action: "edited" },
      {
        ok: true,
        id: "4",
        request_id: "other",
        action: "edited",
        captain_event: { status: "queued" },
      },
      {
        ok: true,
        id: "4",
        request_id: "opaque",
        action: "archived",
        captain_event: { status: "queued" },
      },
      {
        ok: true,
        id: "5",
        request_id: "opaque",
        action: "edited",
        captain_event: { status: "queued" },
      },
    ])
      expect(isDirectiveAcknowledgement(response, expected)).toBe(false);
  });

  // La seconda riga era il pannello dentro `desktop/app-payload/`, rimosso da
  // #177: era il residuo dell'app Electron, non buildato e gia' divergente.
  it.each(["../../../web/app/(protected)/team/DirectivesPanel.tsx"])(
    "wires the retained id and exact ACK gate into %s",
    (relativePath) => {
      const source = readFileSync(resolve(__dirname, relativePath), "utf8");
      expect(source).toContain("retainDirectiveRequest(");
      expect(source).toContain("isDirectiveAcknowledgement(");
      expect(source).toContain("pendingRequests.current.delete(key)");
      expect(source).toContain("await load().catch(() => undefined)");
      expect(source).not.toContain("request_id: crypto.randomUUID()");
    },
  );

  it("maps unknown server text to localized generic UI without echoing it", () => {
    const secret =
      "/synthetic/private/path session=synth-session token=synth-token";
    const key = directiveErrorTranslationKey({ error: secret, detail: secret });
    const translated = {
      errGeneric: "Operation failed",
      errMismatch: "Mismatch",
      errNotFound: "Not found",
    }[key];
    expect(key).toBe("errGeneric");
    expect(translated).not.toContain(secret);
  });
});
