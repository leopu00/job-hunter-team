// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OFFICE_TEXT } from "../office/office.i18n";
import { PROFILE_PAGE_TEXT } from "../pages/profile/profile-page.i18n";
import { pluralForm, pluralText } from "./plural";

const FORMS = { one: "{count} position", other: "{count} positions" };

describe("a sentence with a count", () => {
  it("takes the singular for one and the plural for the rest, as the language says", () => {
    expect(pluralText("it", 1, OFFICE_TEXT.it.onThePile)).toBe("1 posizione sulla pila");
    expect(pluralText("it", 0, OFFICE_TEXT.it.onThePile)).toBe("0 posizioni sulla pila");
    expect(pluralText("it", 13, OFFICE_TEXT.it.onThePile)).toBe("13 posizioni sulla pila");
    expect(pluralText("de", 1, OFFICE_TEXT.de.onThePile)).toBe("1 Stelle auf dem Stapel");
    expect(pluralText("pt", 1, OFFICE_TEXT.pt.phaseSubCount)).toBe("1 posição nesta fase");
  });

  it("tells one sealed contact and several of them apart", () => {
    const forms = PROFILE_PAGE_TEXT.it.sealedContacts;
    expect(pluralText("it", 1, forms, { list: "phone" })).toBe("Un contatto (phone) è cifrato sul server e nella desktop non si apre ancora.");
    expect(pluralText("it", 2, forms, { list: "phone, linkedin" })).toBe("Alcuni contatti (phone, linkedin) sono cifrati sul server e nella desktop non si aprono ancora.");
  });

  it("follows the language on zero: French is singular, English is not", () => {
    expect(pluralForm("fr", 0, FORMS)).toBe(FORMS.one);
    expect(pluralForm("en", 0, FORMS)).toBe(FORMS.other);
    expect(pluralForm("fr", 2, FORMS)).toBe(FORMS.other);
  });

  it("gives Hungarian the same sentence for one and many: no plural after a number", () => {
    expect(OFFICE_TEXT.hu.onThePile.one).toBe(OFFICE_TEXT.hu.onThePile.other);
    expect(pluralText("hu", 1, OFFICE_TEXT.hu.onThePile)).toBe("1 állás a halomban");
  });

  it("takes the plural for a count that is not a number, like the «—» of a pile nobody counted", () => {
    expect(pluralText("it", "—", OFFICE_TEXT.it.tipPile)).toBe("— posizioni sulla pila");
  });

  it("fills the other slots too", () => {
    expect(pluralText("en", 2, { one: "{list}", other: "{count} of {list}" }, { list: "a, b" })).toBe("2 of a, b");
  });
});
