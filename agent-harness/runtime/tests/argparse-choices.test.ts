import { describe, expect, it } from "vitest";

import { argparseChoicesUnquoted } from "./helpers/python-skills.ts";

describe("the choices of argparse's invalid-choice error read the same on every Python", () => {
  const bare = "db_update.py company: error: argument --verdict: invalid choice: 'MAYBE' (choose from GO, CAUTIOUS, NO_GO)";
  const quoted = "db_update.py company: error: argument --verdict: invalid choice: 'MAYBE' (choose from 'GO', 'CAUTIOUS', 'NO_GO')";

  it("takes the quotes off the list of choices (the port, Python up to 3.13) and leaves the bare list (3.14) as it is", () => {
    expect(argparseChoicesUnquoted(quoted)).toBe(bare);
    expect(argparseChoicesUnquoted(bare)).toBe(bare);
  });

  it("keeps the value that was refused quoted, and every other message as it is", () => {
    expect(argparseChoicesUnquoted(quoted)).toContain("invalid choice: 'MAYBE'");
    const other = "team_directives.py: error: argument cmd: invalid choice: 'drop' (choose from active, list)\nusage: x";
    expect(argparseChoicesUnquoted(other)).toBe(other);
    expect(argparseChoicesUnquoted("error: 'quoted' text, no choices")).toBe("error: 'quoted' text, no choices");
  });

  it("does not hide a different list of choices", () => {
    expect(argparseChoicesUnquoted("invalid choice: 'x' (choose from 'a', 'b')")).not.toBe("invalid choice: 'x' (choose from a, b, c)");
  });
});
