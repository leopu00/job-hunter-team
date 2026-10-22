// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeError } from "../../lib/error-catalog";
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
  // Said before: judging «arrives in an update» / is done by connecting with «Confirm and connect». Neither is true yet.
  const PROMISE: Record<string, RegExp> = {
    it: /aggiornament|arriva con/i,
    en: /update|arrives/i,
    de: /update|kommt mit/i,
    fr: /mise à jour|arrive avec/i,
    es: /actualizaci|llega con/i,
    pt: /atualiza|chega com/i,
    hu: /frissít|érkezik/i,
  };

  it.each(Object.keys(ASSISTANT))("%s: say that the positions are only read and judging is not available yet, with no button to press and no promised update", (locale) => {
    const text = EXISTING_TEAM_READONLY_TEXT[locale as keyof typeof EXISTING_TEAM_READONLY_TEXT].judgementComing;
    const button = ONBOARDING_TEXT[locale as keyof typeof ONBOARDING_TEXT].existingTeam.confirmAndLink;
    expect(text, `${locale}: ${text}`).not.toContain(button);
    expect(text, `${locale}: ${text}`).not.toMatch(PROMISE[locale]);
    expect(text, locale).not.toMatch(/\d/);
  });

  it.each(Object.keys(ASSISTANT))("%s: the refusal of a write in a read-only team does not send the person to a button either", (locale) => {
    const copy = describeError("position_write_read_only", { locale: locale as never });
    const button = ONBOARDING_TEXT[locale as keyof typeof ONBOARDING_TEXT].existingTeam.confirmAndLink;
    expect(copy.action, `${locale}: ${copy.action}`).not.toContain(button);
    expect(copy.action, `${locale}: ${copy.action}`).not.toMatch(PROMISE[locale]);
    expect(copy.text.trim(), locale).not.toBe("");
  });

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.|error-catalog/.test(entry.name) ? [path] : [];
    });
  }

  it("holds only while the renderer does not call the native judgement command: the day it does, the sentence must change", () => {
    const callers = sources("src").filter((file) => readFileSync(file, "utf8").includes("existing_team_position_write"));
    expect(callers, "the renderer now writes judgements on a VPS: rewrite judgementComing (and this test)").toEqual([]);
  });
});
