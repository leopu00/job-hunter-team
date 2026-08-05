import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { feedbackDeliveryOutcome } from "../../../web/lib/feedback-delivery";

const REPO = path.resolve(__dirname, "../../..");

function response(status: number, ok = status >= 200 && status < 300) {
  return { status, ok } as Pick<Response, "status" | "ok">;
}

describe("esito della consegna feedback", () => {
  it("tratta status 0 come offline e non confonde un 503", () => {
    expect(feedbackDeliveryOutcome(response(0), undefined)).toEqual({
      kind: "offline",
    });
    expect(feedbackDeliveryOutcome(response(503), undefined)).toEqual({
      kind: "not-delivered",
    });
  });

  it("mantiene rate limit e ticket come stati distinti", () => {
    expect(feedbackDeliveryOutcome(response(429), undefined)).toEqual({
      kind: "rate-limited",
    });
    expect(feedbackDeliveryOutcome(response(200), " JHT-E2E ")).toEqual({
      kind: "delivered",
      ticket: "JHT-E2E",
    });
  });

  it("fa usare la stessa decisione al modulo pubblico e al dialogo", () => {
    for (const file of [
      "web/app/contact/ContactForm.tsx",
      "web/app/components/SupportDialog.tsx",
    ]) {
      expect(readFileSync(path.join(REPO, file), "utf8")).toContain(
        "feedbackDeliveryOutcome",
      );
    }
  });
});
