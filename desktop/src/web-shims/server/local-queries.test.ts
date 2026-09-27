// @vitest-environment node
import { describe, expect, it } from "vitest";
// The web's own module, by relative path: the "@/lib/local-queries" alias
// would hand back the stand-in under test.
import * as web from "../../../../web/lib/local-queries";
import { categorizeExclusion } from "./local-queries";

// categorizeExclusion is copied into the stand-in (the web stays unchanged):
// the copy must bucket every note as the original does.
const NOTES = [
  null,
  "",
  "Esclusa: [geo] fuori area",
  "link scaduto dopo redirect",
  "score < 40",
  "già presente in lista",
  "US-only role",
  "tedesco obbligatorio",
  "5+ anni obbligatori",
  "solo java",
  "ruolo non-dev",
  "red flag: fantasma",
  "voto critico basso",
  "nessuna delle regole",
];

describe("the categorizeExclusion copy", () => {
  it.each(NOTES)("buckets %j as the web's original", (note) => {
    expect(categorizeExclusion(note)).toBe(web.categorizeExclusion(note));
  });
});
