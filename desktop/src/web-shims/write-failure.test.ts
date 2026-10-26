import { describe, expect, it } from "vitest";
import { writeFailureReason } from "@/lib/write-failure";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";

const LOCALES = ["it", "en", "de", "fr", "es", "pt", "hu"] as const;

// On the site a refused write says «do it from the app»; in the app that sends the person in a circle.
// Here the 403 means the link to the team is read only, and the text points at the banner's own button.
describe("the app's 403 on a write", () => {
  it.each(LOCALES)("%s names the banner's button and does not send the person to «the app»", (locale) => {
    const reason = writeFailureReason(locale, 403);
    expect(reason).toContain(EXISTING_TEAM_READONLY_TEXT[locale].connectInFull);
    expect(reason).not.toMatch(/dall['’]app|from the app|in der App|depuis l['’]app|desde la app|na app|az alkalmazásban/i);
  });

  it("the other statuses keep the website's wording", () => {
    expect(writeFailureReason("en", 401)).toBe("Session expired: reload the page and sign in again.");
    expect(writeFailureReason("en", 500)).toBe("Server error, try again shortly.");
  });
});
