// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SCAM_FAMILY,
  SCAM_SIGNAL_CODES,
  filterByScamView,
  isInSuspectSection,
  parseScamSignals,
} from "../../../web/lib/scam-signals";
import { T } from "../../../web/lib/scam-signals.i18n";
import { readTable } from "../../../web/lib/table-csv";

/**
 * JHT-T06 — the scam signals the web reads from positions.scam_signals: a warning,
 * never an exclusion. One signal (or several of one family) is a badge; two
 * families are the «suspicious» section. The families are the skill's.
 */
const ROOT = resolve(__dirname, "../../..");

describe("parseScamSignals", () => {
  it("reads the stored JSON and recomputes the bucket instead of trusting it", () => {
    expect(
      parseScamSignals('{"v":1,"codes":["advance_payment"],"bucket":"section"}'),
    ).toEqual({ codes: ["advance_payment"], bucket: "badge" });
    expect(
      parseScamSignals({ codes: ["advance_payment", "private_chat_only"], bucket: "badge" }),
    ).toEqual({ codes: ["advance_payment", "private_chat_only"], bucket: "section" });
  });

  it("two signals of the same family stay a badge", () => {
    expect(
      parseScamSignals({ codes: ["same_text_many_places", "advance_payment"] })?.bucket,
    ).toBe("badge");
  });

  it("drops unknown codes and gives null for nothing usable", () => {
    expect(parseScamSignals({ codes: ["advance_payment", "made_up"] })?.codes).toEqual([
      "advance_payment",
    ]);
    for (const raw of [null, undefined, "", "not json", "{}", '{"codes":[]}', '{"codes":["made_up"]}', 7, []]) {
      expect(parseScamSignals(raw)).toBeNull();
    }
  });

  it("only the section view is the section", () => {
    expect(isInSuspectSection(parseScamSignals({ codes: ["advance_payment"] }))).toBe(false);
    expect(
      isInSuspectSection(parseScamSignals({ codes: ["advance_payment", "company_unverifiable"] })),
    ).toBe(true);
    expect(isInSuspectSection(null)).toBe(false);
  });
});

describe("the list's view of the section", () => {
  const rows = [
    { id: "plain", scam_signals: null },
    { id: "unchecked" },
    { id: "badge", scam_signals: parseScamSignals({ codes: ["advance_payment"] }) },
    {
      id: "section",
      scam_signals: parseScamSignals({ codes: ["advance_payment", "private_chat_only"] }),
    },
  ];

  it("hide keeps everything but the section; only keeps nothing else", () => {
    expect(filterByScamView(rows, "hide").map((r) => r.id)).toEqual(["plain", "unchecked", "badge"]);
    expect(filterByScamView(rows, "only").map((r) => r.id)).toEqual(["section"]);
  });

  it("the data layer asks for it, the page passes it and the reader gets it", () => {
    const queries = readFileSync(resolve(ROOT, "web/lib/queries.ts"), "utf-8");
    expect(queries).toContain('if (opts?.scam) out = filterByScamView(out, opts.scam);');
    const page = readFileSync(resolve(ROOT, "web/app/(protected)/positions/page.tsx"), "utf-8");
    expect(page).toContain('scam: scamOnly ? "only" : "hide"');
  });
});

describe("the web and the skill agree", () => {
  it("has the same codes and families as shared/skills/scam_signals.py", () => {
    const source = readFileSync(resolve(ROOT, "shared/skills/scam_signals.py"), "utf-8");
    const block = source.slice(source.indexOf("FAMILIES = {"), source.indexOf("}", source.indexOf("FAMILIES = {")));
    const python = Object.fromEntries(
      [...block.matchAll(/"(\w+)":\s*"(\w+)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(python).toEqual(SCAM_FAMILY);
    expect(Object.keys(python)).toEqual([...SCAM_SIGNAL_CODES]);
  });

  it("has the same codes and families as the team reader's Python (desktop core)", () => {
    const source = readFileSync(resolve(ROOT, "desktop/src-tauri/src/existing_team_runtime.rs"), "utf-8");
    const block = source.slice(source.indexOf("SCAM_FAMILY={"), source.indexOf("}", source.indexOf("SCAM_FAMILY={")));
    const python = Object.fromEntries(
      [...block.matchAll(/'(\w+)':'(\w+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(python).toEqual(SCAM_FAMILY);
  });

  it("says every code in the seven languages", () => {
    for (const code of SCAM_SIGNAL_CODES) {
      expect(Object.keys(T[code]).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
    }
  });
});

describe("the CSV export", () => {
  it("leaves the flags next to a cell out of its text", () => {
    document.body.innerHTML =
      "<table><thead><tr><th>Titolo</th></tr></thead><tbody>" +
      '<tr><td><a>Ruolo</a> <span data-csv-skip="">Sospetto</span></td></tr></tbody></table>';
    const { rows } = readTable(document.querySelector("table") as HTMLTableElement);
    expect(rows).toEqual([["Ruolo"]]);
  });
});
