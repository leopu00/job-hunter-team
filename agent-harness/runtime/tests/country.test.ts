import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COUNTRY_NAMES, countryName, countryOf, deriveCountry } from "../src/db/country.ts";

const here = dirname(fileURLToPath(import.meta.url));
const TABLE = join(here, "..", "..", "..", "shared", "skills", "scout_coverage_table.json");

describe("the country of a position at the INSERT (scout_area.derive_country)", () => {
  it.each([
    ["Bologna, Italia", "linkedin", "https://www.linkedin.com/jobs/view/1", "it"],
    ["Stockholm, Sweden", "linkedin", "https://www.linkedin.com/jobs/view/1", "se"],
    ["Zürich, CH", "jobs.ch", "https://www.jobs.ch/x", "ch"],
    ["Bra (CN), Piemonte", "linkedin", "https://www.linkedin.com/jobs/view/1", "it"],
    ["Modugno (BA)", "talent-com-it", "https://it.talent.com/view?id=1", "it"],
    ["Modugno", "linkedin", "https://www.linkedin.com/jobs/view/1", null],
    ["Torino", "randstad.it", "https://www.randstad.it/offerte-lavoro/x/", "it"],
    ["", "it-talent-com", "https://it.talent.com/view?id=2", "it"],
    ["Lugano", "indeed", "https://ch.indeed.com/viewjob?jk=1", "ch"],
    ["Wien", "karriere-at", "https://www.karriere.at/j/1", "at"],
    ["London", "reed", "https://www.reed.co.uk/jobs/1", "gb"],
    ["Torino", "linkedin", "https://www.linkedin.com/jobs/view/1", null],
    ["Roma", "glassdoor", "https://www.glassdoor.com/job/1", null],
    ["Remote", "linkedin", "https://www.linkedin.com/jobs/view/1", null],
    [null, null, null, null],
  ])("%s on %s", (location, source, url, code) => {
    expect(deriveCountry(location, source, url)).toBe(code);
  });

  it.each([
    ["Bra (CN), Piemonte", null], ["Montiglio Monferrato (AT), Piemonte", null], ["Bra (CN)", null], ["Asti, AT, Piemonte", null],
    ["Torino, TO, Italia", "it"], ["Lyon, FR, Piemonte", null], ["Zürich, CH", "ch"], ["Wien, AT", "at"], ["Stockholm (SE)", "se"],
    ["Basel, CH (ibrido 50/50)", "ch"], ["Bra, CN", "cn"], ["Palma de Mallorca / Spain", "es"], ["Data Analyst IT", null],
  ])("the countries a location names: %s", (location, code) => {
    expect(countryOf(location)).toBe(code);
  });

  it("names a country the way Python's title() does", () => {
    expect(countryName("it")).toBe("Italy");
    expect(countryName("ch")).toBe("Switzerland");
    expect(countryName("gb")).toBe("United Kingdom");
    expect(countryName("zz")).toBe("ZZ");
  });

  it("holds the table of the TUI: the two lists of country names are copies and must not drift", () => {
    const table = JSON.parse(readFileSync(TABLE, "utf8")) as { country_names: Record<string, string[]> };
    expect(COUNTRY_NAMES).toEqual(table.country_names);
  });
});
