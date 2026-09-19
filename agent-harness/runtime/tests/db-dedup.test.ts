import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkDuplicate, extractLinkedinJobId, normalizeCityCanonical } from "../src/db/dedup.ts";
import { openJobsDb } from "../src/db/jobs-db.ts";
import { sequenceRatio } from "../src/db/sequence-matcher.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();
const root = mkdtempSync(join(tmpdir(), "jht-dedup-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const long = (seed: string, n: number) => Array.from({ length: n }, (_, i) => seed[i % seed.length]).join("");

/** Pairs that exercise every branch of difflib: empty, identical, reordered, unicode, and b ≥ 200 (autojunk). */
const PAIRS: Array<[string, string]> = [
  ["", ""],
  ["", "abc"],
  ["abc", "abc"],
  ["junior software engineer", "software engineer, junior"],
  ["senior backend developer", "backend developer senior"],
  ["data engineer", "data engineering intern"],
  ["développeur full-stack", "developpeur full stack"],
  ["frontend engineer (react)", "front-end engineer - react"],
  ["qa", "aq"],
  ["abcd", "bcda"],
  ["👨\u200d👩\u200d👧 team lead", "team lead 👨\u200d👩\u200d👧"],
  [long("ab cd ef ", 250), long("ab cd eg ", 260)],
  [long("the quick brown fox ", 300), long("the quick brown fox jumps ", 400)],
  ["x" + long("a", 250), long("a", 250) + "x"],
  [long("abcdefghij", 199), long("abcdefghij", 201)],
  // b has 200 items, so ntest = 3: a "z" seen exactly 3 times is NOT popular, one more time would be.
  // The "q" keeps the extension step from finding the "z" at the edge instead.
  ["qz", long("abcdefghij", 66) + "z" + long("abcdefghij", 66) + "z" + long("abcdefghij", 65) + "z"],
  ["qz", long("abcdefghij", 65) + "zz" + long("abcdefghij", 66) + "z" + long("abcdefghij", 65) + "z"],
];

describe("sequenceRatio", () => {
  it("knows the two cases every ratio rests on", () => {
    expect(sequenceRatio("", "")).toBe(1);
    expect(sequenceRatio("abc", "abc")).toBe(1);
    expect(sequenceRatio("abc", "xyz")).toBe(0);
  });

  it.skipIf(skills === null)("equals difflib.SequenceMatcher(None, a, b).ratio() on every pair, both ways", () => {
    const both = PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]);
    const py = runPython(
      skills!,
      ["-c", "import json,sys,difflib; print(json.dumps([difflib.SequenceMatcher(None,a,b).ratio() for a,b in json.load(sys.stdin)]))"],
      {},
      JSON.stringify(both),
    );
    const expected = JSON.parse(py.stdout) as number[];
    both.forEach(([a, b], i) => expect(sequenceRatio(a!, b!), `${a!.slice(0, 30)} | ${b!.slice(0, 30)}`).toBe(expected[i]));
  });
});

describe("checkDuplicate", () => {
  const dbPath = join(root, "jobs.db");
  const db = openJobsDb(dbPath);
  const add = db.prepare("INSERT INTO positions (title, company, location, url) VALUES (?, ?, ?, ?)");
  add.run("Software Engineer, Junior", "Acme", "Milano, IT", "https://acme.example/jobs/1");
  add.run("Data Engineer", "Acme", "Berlin, Germany", "https://www.linkedin.com/jobs/view/4381470286?currentJobId=1");
  add.run("Data Engineer", "Globex", "München", "https://www.linkedin.com/jobs/view/43814702861");
  add.run("Backend Developer", "Initech", null, "https://initech.example/careers/backend");
  add.run("QA Analyst", "Umbrella", "Roma", "https://umbrella.example/qa");

  /** Candidates, each aimed at one level or at a near miss of one. */
  const CASES = [
    { url: "https://www.linkedin.com/jobs/view/4381470286/", company: "X", title: "Y", location: null },
    { url: "https://www.linkedin.com/jobs/view/438147028", company: "X", title: "Y", location: null },
    { url: "https://www.linkedin.com/jobs/search?currentJobId=4381470286", company: "X", title: "Y", location: null },
    { url: "https://acme.example/jobs/1", company: "Other", title: "Other", location: null },
    { url: "https://new.example/1", company: "ACME", title: "software engineer, junior", location: "Milan, Lombardy" },
    { url: "https://new.example/2", company: "Acme", title: "Software Engineer, Junior", location: "Torino" },
    { url: "https://new.example/3", company: "acme", title: "Junior Software Engineer", location: "Milan" },
    { url: "https://new.example/4", company: "Globex", title: "Data Engineer", location: "Munich, Bavaria" },
    { url: "https://new.example/5", company: "Initech", title: "Backend Developer", location: "" },
    { url: "https://new.example/6", company: "Initech", title: "Backend Developers", location: null },
    // Ratio ≈ 0.92, between the threshold and a near-identical title; and ≈ 0.79, just under it.
    { url: "https://new.example/6b", company: "Initech", title: "Backend Developer II", location: null },
    { url: "https://new.example/6c", company: "Initech", title: "Backend Developer III Lead", location: null },
    { url: "https://new.example/7", company: "Umbrella", title: "QA Analyst", location: "Rome, Italy" },
    { url: "https://new.example/8", company: "Nobody", title: "Nothing", location: "Nowhere" },
    { url: null, company: null, title: null, location: null },
  ];

  it("reads LinkedIn ids from the path only, and maps cities across languages", () => {
    expect(extractLinkedinJobId("https://www.linkedin.com/jobs/view/123/?currentJobId=9")).toBe("123");
    expect(extractLinkedinJobId("https://www.linkedin.com/jobs/search?currentJobId=9")).toBeNull();
    expect(normalizeCityCanonical("München, Bayern")).toBe("munich");
    expect(normalizeCityCanonical("Milano, IT")).toBe("milan");
  });

  it.skipIf(skills === null)("finds the same duplicate, at the same level, as db_insert.check_duplicate", () => {
    const script = `
import json, sys
import _db, db_insert
conn = _db.get_db()
out = []
for c in json.load(sys.stdin):
    row, match = db_insert.check_duplicate(conn, c["url"], c["company"], c["title"], c["location"])
    out.append(None if row is None else [row["id"], match])
print(json.dumps(out))
`;
    const py = runPython(skills!, ["-c", script], { JHT_DB: dbPath, JHT_HOME: join(root, "home") }, JSON.stringify(CASES));
    expect(py.stderr).toBe("");
    const expected = JSON.parse(py.stdout) as Array<[number, string] | null>;

    const ours = CASES.map((c) => {
      const found = checkDuplicate(db, c);
      return found === null ? null : [found.row.id, found.matchType];
    });
    expect(ours).toEqual(expected);
    // The cases reach every level and the no-match answer, or the test proves less than it says.
    expect(new Set(CASES.map((c) => checkDuplicate(db, c)?.level ?? "none"))).toEqual(new Set([0, 1, 2, 3, "none"]));
  });
});
