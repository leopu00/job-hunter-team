// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EXISTING_TEAM_READONLY_TEXT } from "../../lib/existing-team-readonly.i18n";
import { EXISTING_TEAM_STATUS_TEXT } from "./existing-team-status.i18n";
import { ONBOARDING_TEXT } from "../../onboarding/onboarding.i18n";

// Since «Attiva assistente» exists, the read-only texts may not say that nothing
// starts or that nothing can be done from here. They say: viewing is read only,
// the actions on data stay disabled, and starting the assistant is separate and
// asks for a confirmation.
const ASSISTANT: Record<string, RegExp> = {
  it: /assistente/i, en: /assistant/i, de: /Assistenten/i, fr: /assistant/i, es: /asistente/i, pt: /assistente/i, hu: /asszisztens/i,
};
const CONFIRMATION: Record<string, RegExp> = {
  it: /conferma/i, en: /confirmation/i, de: /Bestätigung/i, fr: /confirmation/i, es: /confirmación/i, pt: /confirmação/i, hu: /megerősítést/i,
};
const OLD_CLAIMS = [
  /Da qui non parte nessuna azione/i, /No action starts from here/i, /Von hier startet keine Aktion/i,
  /Aucune action ne part d’ici/i, /Desde aquí no se inicia ninguna acción/i, /Daqui não parte nenhuma ação/i,
  /Innen nem indul semmilyen művelet/i,
  /restano disabilitate\.$/i, /stay disabled\.$/i,
];

describe("the read-only texts of an existing team", () => {
  it("cover the seven languages", () => {
    expect(Object.keys(EXISTING_TEAM_READONLY_TEXT).sort()).toEqual(Object.keys(ASSISTANT).sort());
    expect(Object.keys(EXISTING_TEAM_STATUS_TEXT).sort()).toEqual(Object.keys(ASSISTANT).sort());
  });

  it.each(Object.keys(ASSISTANT))("%s: the Team intro and the positions banner say the assistant start is separate and asks for a confirmation", (locale) => {
    const texts = [EXISTING_TEAM_STATUS_TEXT[locale as keyof typeof EXISTING_TEAM_STATUS_TEXT].intro, EXISTING_TEAM_READONLY_TEXT[locale as keyof typeof EXISTING_TEAM_READONLY_TEXT].banner];
    for (const text of texts) {
      expect(text, `${locale}: ${text}`).toMatch(ASSISTANT[locale]);
      expect(text, `${locale}: ${text}`).toMatch(CONFIRMATION[locale]);
      for (const old of OLD_CLAIMS) expect(text, `${locale}: ${text}`).not.toMatch(old);
    }
  });
});

describe("the disabled judgement controls of the read-only view", () => {
  it.each(Object.keys(ASSISTANT))("%s: say they come with an update, for a team connected with the onboarding's own button", (locale) => {
    const text = EXISTING_TEAM_READONLY_TEXT[locale as keyof typeof EXISTING_TEAM_READONLY_TEXT].judgementComing;
    const button = ONBOARDING_TEXT[locale as keyof typeof ONBOARDING_TEXT].existingTeam.confirmAndLink;
    // the exact label the person clicks, so the sentence points at something that exists
    expect(text, `${locale}: ${text}`).toContain(button);
    // a coming feature, not a broken one: never a date, never "now"
    expect(text, locale).not.toMatch(/\d/);
  });
});
