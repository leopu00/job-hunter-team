import { describe, expect, it } from "vitest";

import { parseArgv, pyRepr } from "../src/db/argv.ts";
import { interpretEscapes, pyFloatRepr, pyInt, pyJson, pyStrip, pythonIsoUtc } from "../src/db/py-format.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();

/** Asks Python for `expr(x)` over every item, as JSON. */
function python(expr: string, items: unknown[]): unknown[] {
  const py = runPython(skills!, ["-c", `import json,sys,argparse\nf = lambda x: ${expr}\nprint(json.dumps([f(x) for x in json.load(sys.stdin)]))`], {}, JSON.stringify(items));
  if (py.status !== 0) throw new Error(py.stderr);
  return JSON.parse(py.stdout) as unknown[];
}

const FLOATS = [45, 45.5, 0.1, 1e-7, 0.0001, 0.00012, 1e16, 1.5e16, 123456789012345.6, 9999999999999998, 1e21, -2.5, 3.14159, 7.5, 1 / 3, 5e-324, 1.7976931348623157e308];

describe("Python formats", () => {
  it.skipIf(skills === null)("float repr", () => {
    expect(FLOATS.map(pyFloatRepr)).toEqual(python("repr(float(x))", FLOATS));
    expect([Infinity, -Infinity, NaN, -0].map(pyFloatRepr)).toEqual(["inf", "-inf", "nan", "-0.0"]);
  });

  it.skipIf(skills === null)("int() as argparse's type=int, and str.strip()", () => {
    const raws = [" 7 ", "+1", "-5", "1_0", "007", "\u0661\u0662", "\uff13", "\u{1D7D9}\u{1D7E2}", "1.5", "0x1", "", "1__0", "_1", "1_", "abc", "\u00b2", "\u0085 3\u001c"];
    const py = runPython(skills!, ["-c", "import json,sys\nout=[]\nfor x in json.load(sys.stdin):\n  try: out.append(int(x))\n  except ValueError: out.append(None)\nprint(json.dumps(out))"], {}, JSON.stringify(raws));
    expect(raws.map(pyInt)).toEqual(JSON.parse(py.stdout));
    const strips = ["  a  ", "\u0085x\u001c", "\ufeffy\ufeff", "\u3000z\u2029", "\t\n"];
    expect(strips.map(pyStrip)).toEqual(python("x.strip()", strips));
  });

  it.skipIf(skills === null)("repr() of the bad values argparse prints", () => {
    const values = ["abc", "it's", `say "hi"`, `both ' and "`, "tab\there", "back\\slash", "nl\n", "\u0001", "café \u{1F600}"];
    expect(values.map(pyRepr)).toEqual(python("repr(x)", values));
  });

  it.skipIf(skills === null)("json.dumps, with and without ensure_ascii", () => {
    const value = { a: "é ✓ \u{1F600} \u200b \u2028", b: [1, null, true, -3], "q\"k": "\\ / \u007f \u0001 \b \f" };
    const run = (ascii: boolean) =>
      runPython(skills!, ["-c", `import json,sys; sys.stdout.write(json.dumps(json.load(sys.stdin), ensure_ascii=${ascii ? "True" : "False"}))`], {}, JSON.stringify(value)).stdout;
    expect(pyJson(value)).toBe(run(true));
    expect(pyJson(value, { ensureAscii: false })).toBe(run(false));
    expect(pyJson({ x: { value: 45, declared: "REAL" }, y: { value: 45, declared: "INTEGER" }, z: { value: Infinity, declared: "REAL" } })).toBe(
      '{"x": 45.0, "y": 45, "z": Infinity}',
    );
  });

  it.skipIf(skills === null)("interpret_escapes of db_update.py", () => {
    const texts = ["a\\nb", "tab\\tend", "\\\\n", "\\u00e9", "\\U0001F916", "\\ud800", "\\U00110000", "\\u00E9\\u00e9", "plain"];
    const py = runPython(skills!, ["-c", "import json,sys,db_update\nprint(json.dumps([db_update.interpret_escapes(x) for x in json.load(sys.stdin)]))"], { JHT_DB: "/nonexistent/x.db" }, JSON.stringify(texts));
    expect(texts.map(interpretEscapes)).toEqual(JSON.parse(py.stdout));
  });

  it("isoformat() in UTC drops the fraction when there is none", () => {
    expect(pythonIsoUtc(new Date("2026-01-02T03:04:05.006Z"))).toBe("2026-01-02T03:04:05.006000+00:00");
    expect(pythonIsoUtc(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05+00:00");
  });

  it.skipIf(skills === null)("argparse errors, line for line", () => {
    const script = `
import argparse, contextlib, io, json, sys
p = argparse.ArgumentParser(prog="db_update.py")
sub = p.add_subparsers(dest="entity", required=True)
q = sub.add_parser("position")
q.add_argument("id", type=int)
q.add_argument("--status", choices=["new", "excluded"])
q.add_argument("--notes")
q.add_argument("--source")
q.add_argument("--json", action="store_true")
out = []
for argv in json.load(sys.stdin):
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        try:
            out.append(["ok", vars(p.parse_args(argv))])
        except SystemExit as e:
            out.append([e.code, err.getvalue().strip().splitlines()[-1]])
print(json.dumps(out))
`;
    const cases = [
      ["position", "x"],
      ["position", "1", "--status", "bad"],
      ["position"],
      ["position", "1", "--st", "new"],
      ["position", "1", "--s", "new"],
      ["position", "1", "--no=hi", "--notes", "last"],
      ["position", "1", "extra"],
      ["position", "1", "--zz"],
      ["position", "1", "--json=1"],
      ["position", "1", "--notes"],
      ["position", "1", "--notes", "-x"],
      ["position", "-5", "--json"],
      ["position", " 1_0 "],
      ["position", "it's"],
    ];
    const py = runPython(skills!, ["-c", script], {}, JSON.stringify(cases));
    const expected = JSON.parse(py.stdout) as Array<[string | number, unknown]>;
    const spec = {
      prog: "db_update.py position",
      positionals: [{ name: "id", type: "int" as const }],
      options: [
        { flag: "--status", choices: ["new", "excluded"] },
        { flag: "--notes" },
        { flag: "--source" },
        { flag: "--json", storeTrue: true },
      ],
    };
    cases.forEach((argv, i) => {
      const [code, detail] = expected[i]!;
      let parsed: unknown;
      let failure = "";
      try {
        parsed = parseArgv(spec, argv.slice(1));
      } catch (error) {
        failure = (error as Error).message.split("\n").at(-1)!;
      }
      if (code === "ok") {
        const { entity: _entity, ...fields } = detail as Record<string, unknown>;
        expect(parsed, argv.join(" ")).toEqual(fields);
      } else {
        expect([code, failure], argv.join(" ")).toEqual([2, detail]);
      }
    });
  });
});
