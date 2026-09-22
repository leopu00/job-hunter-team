/**
 * T39, piece three: the CV layout check against `pdf_layout_check.py`, and the
 * gate that reads it.
 *
 * The check is what lets the CLOSER's queue say READY: without it every CV is
 * `cv_pdf_check_unavailable` and nothing is ever taken. So the port is held to
 * the script byte for byte — the JSON report of the same PDF, compared as
 * text — on real PDFs poppler measures (helpers/pdf-fixtures.ts), one that
 * passes and one for every reason the script can give. Each case also names
 * the reasons it expects: a comparison alone would stay green on a PDF that
 * no longer produces the fault it was written for.
 *
 * The second half is the gate's side, which the script's comparisons cannot
 * see: the verdict remembered by content and never when unavailable, and the
 * CV path the database hands over — a column, confined here to the team's
 * folders before anything opens it.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { guarded } from "../src/db/tools.ts";
import { onPath } from "../src/parity/jht-tools.ts";
import { applyGate, createCvLayoutHold, type CloserOptions } from "../src/parity/skills/closer.ts";
import { createSkillTools } from "../src/parity/skills/index.ts";
import { analyze, CheckError, reportJson } from "../src/parity/skills/pdf-layout.ts";
import { column, FULL_LINE, LEFT, passingCv, writePdf } from "./helpers/pdf-fixtures.ts";
import { pythonSkills, RUNTIME, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();
/** Poppler is detected, as the port detects it: the image may not carry it. */
const poppler = onPath("pdftotext") && onPath("pdffonts");
const noPython = skills === null || !poppler;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-pdf-layout-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function pdf(name: string, bytes: Buffer | string): string {
  const path = join(root, name);
  writeFileSync(path, bytes);
  return path;
}

/** Both reports of one file: ours as `--json` prints it, and the script's. */
function reports(path: string): [ours: string, theirs: string, exit: number] {
  const r = runPython(skills!, ["pdf_layout_check.py", path, "--json"]);
  return [`${reportJson(analyze(path))}\n`, r.stdout, r.status];
}

/** Twelve words, 76 characters: a line that stays on an A4 sheet up to 13pt. */
const SHORT = FULL_LINE.slice(0, 76);

/** The cases, each a PDF and the reasons the script gives it. */
const CASES: Array<[name: string, bytes: () => Buffer, reasons: string[]]> = [
  ["a full page, full width, 11pt, embedded", passingCv, []],
  // Two pages that both carry a column: the second shares the first's left edge.
  ["two full pages", () => writePdf([column(40), column(30)]), []],
  // The 2067 fault: text in a column half the usable width.
  ["a narrow column", () => writePdf([column(40, { text: "lorem ipsum dolor sit amet consectetur adip" })]), ["narrow_text"]],
  // Indented lines on page two, measured from the SHARED left edge: still wide.
  ["an indented second page", () => writePdf([column(40), column(30, { x: LEFT + 30, text: FULL_LINE.slice(0, 80) })]), []],
  // A spill of three lines onto page two.
  ["a spill onto page two", () => writePdf([column(40), column(3)]), ["near_empty_page"]],
  // Lines enough, and all in the top tenth of the sheet.
  ["a page of lines packed at the top", () => writePdf([column(10, { step: 12 })]), ["near_empty_page"]],
  ["three pages", () => writePdf([column(40), column(40), column(40)]), ["too_many_pages"]],
  // The unpatched-Qt fault: full width, printed at 7pt.
  ["a body printed at 7pt", () => writePdf([column(60, { size: 7, step: 12, text: `${FULL_LINE} ${FULL_LINE.slice(0, 50)}` })]), ["small_body_font"]],
  // At 14pt, so the size passes and the one fault left is the font.
  ["the standard Helvetica, not embedded", () => writePdf([column(40, { text: FULL_LINE.slice(0, 76) })], { helvetica: true, size: 14 }), ["fonts_not_embedded"]],
  // Helvetica at 11pt reads as 8.7pt through the DejaVu constant: the strict side, as the script says.
  ["Helvetica at 11pt", () => writePdf([column(40)], { helvetica: true }), ["small_body_font", "fonts_not_embedded"]],
  // One line in Helvetica is enough: every font must be embedded.
  ["one font of two not embedded", () => writePdf([[...column(39), { x: LEFT, y: 80, text: "helvetica", helvetica: true }]]), ["fonts_not_embedded"]],
  // No page with enough lines to judge a column: nothing to measure, and nearly empty too.
  ["five short lines", () => writePdf([column(5, { text: "short line" })]), ["near_empty_page", "no_text"]],
  ["a page with no text at all", () => writePdf([[]]), ["near_empty_page", "fonts_not_embedded", "no_text"]],
  // As many words at 11pt as at 13pt: a tie goes to the SMALLER size (10.17pt, not 12.04pt).
  ["a tie between two sizes", () => writePdf([[...column(20, { size: 11, text: SHORT }), ...column(20, { size: 13, top: 420, text: SHORT })]]), []],
  // The same tie at 8pt and 13pt: the smaller is the one judged, and it is too small.
  ["a tie that hides a small size", () => writePdf([[...column(20, { size: 8, text: SHORT }), ...column(20, { size: 13, top: 420, text: SHORT })]]), ["small_body_font"]],
  // 89 characters at 10.5pt from x = 42.5: a column exactly 467.25pt wide, a
  // tie for round(…, 1). Python rounds it to the even 467.2; toFixed says 467.3.
  ["a width that is an exact rounding tie", () => writePdf([column(40, { x: 42.5, size: 10.5, text: FULL_LINE.slice(0, 89) })]), []],
  // Everything wrong at once, in the script's order.
  [
    "every fault at once",
    () => writePdf([column(20, { size: 7, text: "narrow" }), column(2), column(2)], { helvetica: true }),
    ["too_many_pages", "narrow_text", "near_empty_page", "small_body_font", "fonts_not_embedded"],
  ],
];

describe("analyze against pdf_layout_check.py", () => {
  for (const [name, bytes, reasons] of CASES) {
    it.skipIf(noPython)(`${name}: the same report, byte for byte`, () => {
      const path = pdf("cv.pdf", bytes());
      const [ours, theirs, exit] = reports(path);
      expect(ours).toBe(theirs);
      const report = JSON.parse(ours) as { ok: boolean; reasons: string[] };
      expect(report.reasons).toEqual(reasons);
      expect(report.ok).toBe(reasons.length === 0);
      expect(exit).toBe(reasons.length === 0 ? 0 : 1);
    });
  }

  it.skipIf(noPython)("the fixture CV of the repository: Helvetica at 7pt, both faults named", () => {
    const [ours, theirs] = reports(join(RUNTIME, "..", "..", "tests", "fixtures", "sample-cv.pdf"));
    expect(ours).toBe(theirs);
    expect(JSON.parse(ours).reasons).toEqual(["small_body_font", "fonts_not_embedded"]);
  });

  it.skipIf(noPython)("a file that is not a PDF, a PDF with no page, a missing file: no report, a CheckError in the same words", () => {
    const cases: Array<[string, string]> = [
      [pdf("junk.pdf", "not a pdf at all"), "pdftotext exit 1: "],
      // Poppler refuses a PDF with no page itself (exit 99): the script's own
      // "no pages found" is for an output with no <page>, which poppler never gives.
      [pdf("empty.pdf", writePdf([])), "pdftotext exit 99: "],
      [join(root, "missing.pdf"), `not a file: ${join(root, "missing.pdf")}`],
    ];
    for (const [path, words] of cases) {
      const r = runPython(skills!, ["pdf_layout_check.py", path, "--json"]);
      expect(r.status).toBe(2);
      const theirs = JSON.parse(r.stdout) as { reasons: string[]; error: string };
      expect(theirs.reasons).toEqual(["check_failed"]);
      expect(theirs.error.startsWith(words)).toBe(true);
      let thrown: unknown;
      try {
        analyze(path);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CheckError);
      expect((thrown as Error).message).toBe(theirs.error);
    }
  });
});

describe("analyze without poppler", () => {
  it("is a CheckError in the script's words — never a report", () => {
    const path = pdf("cv.pdf", passingCv());
    const empty = join(root, "bin");
    mkdirSync(empty);
    expect(() => analyze(path, { env: { PATH: empty } })).toThrow(new CheckError("pdftotext not found (poppler-utils missing)"));
  });
});

// ── the gate's side ──────────────────────────────────────────────────────

describe("createCvLayoutHold: the verdict, remembered by content", () => {
  it("measures a content once, whatever its name, and a new content again", () => {
    const seen: string[] = [];
    const hold = createCvLayoutHold((file) => {
      seen.push(file);
      return { ok: true };
    });
    const a = pdf("a.pdf", "same bytes");
    const b = pdf("b.pdf", "same bytes");
    expect([hold(a), hold(b), hold(a)]).toEqual(["", "", ""]);
    expect(seen).toEqual([a]);
    // The same NAME with a new content is a new CV: measured again.
    writeFileSync(a, "rendered again");
    expect(hold(a)).toBe("");
    expect(seen).toEqual([a, a]);
  });

  it("a report that is not ok is layout_bad, and that is remembered too", () => {
    let calls = 0;
    const hold = createCvLayoutHold(() => {
      calls++;
      return { ok: false, reasons: ["narrow_text"] };
    });
    const cv = pdf("cv.pdf", "x");
    expect([hold(cv), hold(cv)]).toEqual(["cv_pdf_layout_bad", "cv_pdf_layout_bad"]);
    expect(calls).toBe(1);
  });

  it("only `ok: true` passes: a truthy ok, no report, a crash — none of them is a pass", () => {
    const cv = pdf("cv.pdf", "x");
    expect(createCvLayoutHold(() => ({ ok: "true" }))(cv)).toBe("cv_pdf_layout_bad");
    expect(createCvLayoutHold(() => ({ ok: 1 }))(cv)).toBe("cv_pdf_layout_bad");
    expect(createCvLayoutHold(() => null)(cv)).toBe("cv_pdf_check_unavailable");
    expect(createCvLayoutHold(() => [true])(cv)).toBe("cv_pdf_check_unavailable");
    expect(
      createCvLayoutHold(() => {
        throw new TypeError("a bug in the check");
      })(cv),
    ).toBe("cv_pdf_check_unavailable");
    expect(createCvLayoutHold(() => ({ ok: true }))(join(root, "gone.pdf"))).toBe("cv_pdf_check_unavailable");
  });

  it("unavailable is never remembered: when poppler comes back, the same file is measured", () => {
    let there = false;
    let calls = 0;
    const hold = createCvLayoutHold(() => {
      calls++;
      if (!there) throw new CheckError("pdftotext not found (poppler-utils missing)");
      return { ok: true };
    });
    const cv = pdf("cv.pdf", "x");
    expect([hold(cv), hold(cv)]).toEqual(["cv_pdf_check_unavailable", "cv_pdf_check_unavailable"]);
    there = true;
    expect(hold(cv)).toBe("");
    expect(calls).toBe(3);
  });
});

describe("the CV path the database names", () => {
  let db: Database;
  let home: string;
  let options: CloserOptions;
  let measured: string[];
  beforeEach(() => {
    home = join(root, "jht");
    mkdirSync(join(home, "cv"), { recursive: true });
    writeFileSync(join(home, "jht.config.json"), JSON.stringify({ applications: { auto_apply: { enabled: true } } }));
    db = openJobsDb(join(root, "jobs.db"));
    measured = [];
    options = {
      db: () => db,
      jhtHome: home,
      profileDir: join(home, "profile"),
      cvRoots: [join(home, "cv"), join(root, "out")],
      cvLayout: (cv) => {
        measured.push(cv);
        return "";
      },
    };
  });
  afterEach(() => db.close());

  const seed = (cv: string) => {
    db.prepare(
      "INSERT INTO positions (id, title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) " +
        "VALUES (1, 'T', 'Acme', 'https://x.example/1', 'ready', 'scout-1', 1, '2026-09-20 10:00:00', 'user_web')",
    ).run();
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'ready', 'scrittore-1', ?)").run(cv);
  };
  const queue = () => JSON.parse(guarded(() => applyGate(["queue", "--json"], options)).stdout) as { ready: boolean; held: unknown[]; positions: unknown[] };

  it("inside the home or the deliverables: measured, and the path printed as the script prints it", () => {
    mkdirSync(join(root, "out", "cv"), { recursive: true });
    writeFileSync(join(root, "out", "cv", "CV.pdf"), "x");
    seed(join(root, "out", "cv", "CV.pdf"));
    expect(queue()).toMatchObject({ ready: true, positions: [{ position_id: 1, cv_pdf_path: join(root, "out", "cv", "CV.pdf") }] });
    expect(measured).toEqual([join(root, "out", "cv", "CV.pdf")]);
  });

  it("an absolute path, a `../` or a link that leads outside: held, and never opened", () => {
    const secret = join(root, "elsewhere", "secret.pdf");
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(secret, "not the team's");
    symlinkSync(secret, join(home, "cv", "link.pdf"));
    for (const path of [secret, "../elsewhere/secret.pdf", "cv/link.pdf", join(home, "cv", "link.pdf")]) {
      db.exec("DELETE FROM applications; DELETE FROM positions;");
      seed(path);
      expect(queue()).toMatchObject({ ready: false, reason: "queue_empty", held: [{ position_id: 1, reason: "cv_pdf_path_outside" }] });
    }
    expect(measured).toEqual([]);
  });

  // SICUREZZA's probe (T39-3): under the JHT home the product keeps the
  // person's secrets, and this path comes from a column a model writes. With
  // the home as a root, a row naming a credentials file had the gate hash it
  // and run poppler on it. The roots are the CV folders, not the house.
  it("a file under the JHT home that is not a CV — the person's credentials — is outside, and never opened", () => {
    for (const secret of ["credentials/ats-accounts/icims_acme.json", "credentials/email_monitor.json", "credentials/linkedin.json"]) {
      mkdirSync(join(home, secret, ".."), { recursive: true });
      writeFileSync(join(home, secret), '{"password": "not for the gate"}');
      db.exec("DELETE FROM applications; DELETE FROM positions;");
      seed(secret);
      expect(queue().held).toEqual([{ position_id: 1, reason: "cv_pdf_path_outside" }]);
      db.exec("DELETE FROM applications; DELETE FROM positions;");
      seed(join(home, secret));
      expect(queue().held).toEqual([{ position_id: 1, reason: "cv_pdf_path_outside" }]);
    }
    expect(measured).toEqual([]);
  });

  it("with no roots given, nothing opens — not even a file under the home", () => {
    const { cvRoots: _dropped, ...bare } = options;
    options = bare;
    writeFileSync(join(home, "cv", "CV.pdf"), "x");
    seed(join(home, "cv", "CV.pdf"));
    expect(queue().held).toEqual([{ position_id: 1, reason: "cv_pdf_path_outside" }]);
    expect(measured).toEqual([]);
  });

  it("is not an oracle of what exists: outside is outside whether or not the file is there", () => {
    // Confined before any stat. A path outside answers `outside` exists or not;
    // only a path inside the CV folders can answer `missing`.
    for (const path of [join(root, "nowhere", "a.pdf"), "/etc/does-not-exist.pdf", join(root, "elsewhere-real.pdf")]) {
      if (path.endsWith("elsewhere-real.pdf")) writeFileSync(path, "x");
      db.exec("DELETE FROM applications; DELETE FROM positions;");
      seed(path);
      expect(queue().held).toEqual([{ position_id: 1, reason: "cv_pdf_path_outside" }]);
    }
    db.exec("DELETE FROM applications; DELETE FROM positions;");
    seed(join(home, "cv", "not-there.pdf"));
    expect(queue().held).toEqual([{ position_id: 1, reason: "cv_pdf_missing" }]);
  });
});

describe("the gate as the runtime builds it: poppler measures the CV", () => {
  const build = (home: string, userDir: string, dbPath: string) => {
    const tools = createSkillTools({ skills: ["apply-authorization"], agent: "closer-1", jobsDb: { open: () => openJobsDb(dbPath), path: dbPath }, jhtHome: home, userDir });
    const gate = tools.find((t) => t.spec.name === "apply_gate")!;
    return async () => {
      const r = await gate.execute({ args: ["queue", "--json"] }, {} as never);
      return JSON.parse(r.content.split("\n")[0]!) as { ready: boolean; held: Array<{ reason: string }> };
    };
  };

  it("the roots are the deliverables' `cv/` and the hub's `cvDirs`, never the JHT home: a CV elsewhere is never opened", async () => {
    const home = join(root, "jht");
    mkdirSync(join(root, "hub-out", "cv"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "jht.config.json"), JSON.stringify({ applications: { auto_apply: { enabled: true } } }));
    const dbPath = join(root, "jobs.db");
    const db = openJobsDb(dbPath);
    db.prepare(
      "INSERT INTO positions (id, title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) " +
        "VALUES (1, 'T', 'Acme', 'https://x.example/1', 'ready', 'scout-1', 1, '2026-09-20 10:00:00', 'user_web')",
    ).run();
    const cv = join(root, "hub-out", "cv", "CV.pdf");
    // Not a PDF: measured, it is unavailable; refused before measuring, it is outside.
    writeFileSync(cv, "not a pdf");
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'ready', 'scrittore-1', ?)").run(cv);
    db.close();
    const gate = (extra: object) =>
      createSkillTools({ skills: ["apply-authorization"], agent: "closer-1", jobsDb: { open: () => openJobsDb(dbPath), path: dbPath }, jhtHome: home, ...extra }).find(
        (t) => t.spec.name === "apply_gate",
      )!;
    const held = async (extra: object) => {
      const r = await gate(extra).execute({ args: ["queue", "--json"] }, {} as never);
      return (JSON.parse(r.content.split("\n")[0]!) as { held: unknown[] }).held;
    };
    expect(await held({})).toEqual([{ position_id: 1, reason: "cv_pdf_path_outside" }]);
    expect(await held({ cvDirs: [join(root, "hub-out")] })).toEqual([{ position_id: 1, reason: "cv_pdf_check_unavailable" }]);
    expect(await held({ userDir: join(root, "hub-out") })).toEqual([{ position_id: 1, reason: "cv_pdf_check_unavailable" }]);
  });

  // SICUREZZA, after piece three: the credentials test above hands the roots in
  // itself, so it proves `resolveFile` and not the code that builds the roots.
  // Putting the JHT home back among them in skills/index.ts — where the product
  // really builds them — left the whole suite green. This one goes through
  // `createSkillTools`, the real wiring, and the reason tells the two apart: a
  // credentials file the gate MEASURED would answer `cv_pdf_check_unavailable`
  // (it is not a PDF); one it refused before opening answers `outside`.
  it("through the runtime's own wiring, the person's credentials under the home are outside, and never measured", async () => {
    const home = join(root, "jht");
    const userDir = join(root, "out");
    mkdirSync(join(home, "credentials", "ats-accounts"), { recursive: true });
    mkdirSync(join(userDir, "cv"), { recursive: true });
    writeFileSync(join(home, "jht.config.json"), JSON.stringify({ applications: { auto_apply: { enabled: true } } }));
    const secrets = ["credentials/ats-accounts/icims_acme.json", "credentials/email_monitor.json"];
    for (const secret of secrets) writeFileSync(join(home, secret), '{"password": "not for the gate"}');
    const dbPath = join(root, "jobs.db");
    const reasons: string[] = [];
    for (const cv of [...secrets, ...secrets.map((s) => join(home, s))]) {
      rmSync(dbPath, { force: true });
      const db = openJobsDb(dbPath);
      db.prepare(
        "INSERT INTO positions (id, title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) " +
          "VALUES (1, 'T', 'Acme', 'https://x.example/1', 'ready', 'scout-1', 1, '2026-09-20 10:00:00', 'user_web')",
      ).run();
      db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'ready', 'scrittore-1', ?)").run(cv);
      db.close();
      const queue = build(home, userDir, dbPath);
      reasons.push(...(await queue()).held.map((h) => h.reason));
    }
    expect(reasons).toEqual(["cv_pdf_path_outside", "cv_pdf_path_outside", "cv_pdf_path_outside", "cv_pdf_path_outside"]);
  });

  it.skipIf(!poppler)("a CV that passes makes the queue READY; one that fails holds it; no poppler holds it, and is not remembered", async () => {
    const home = join(root, "jht");
    const userDir = join(root, "out");
    mkdirSync(join(userDir, "cv"), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "jht.config.json"), JSON.stringify({ applications: { auto_apply: { enabled: true } } }));
    const dbPath = join(root, "jobs.db");
    const db = openJobsDb(dbPath);
    db.prepare(
      "INSERT INTO positions (id, title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) " +
        "VALUES (1, 'T', 'Acme', 'https://x.example/1', 'ready', 'scout-1', 1, '2026-09-20 10:00:00', 'user_web')",
    ).run();
    const cv = join(userDir, "cv", "CV.pdf");
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'ready', 'scrittore-1', ?)").run(cv);
    db.close();
    const read = build(home, userDir, dbPath);

    // Poppler gone from PATH: unmeasured, held — and the next read, with it back, measures.
    writeFileSync(cv, passingCv());
    const path = process.env["PATH"];
    process.env["PATH"] = join(root, "no-bin");
    try {
      expect((await read()).held).toEqual([{ position_id: 1, reason: "cv_pdf_check_unavailable" }]);
    } finally {
      process.env["PATH"] = path;
    }
    expect(await read()).toMatchObject({ ready: true, reason: "queue_ready" });

    // Rendered again, badly: the new content is measured and holds.
    writeFileSync(cv, writePdf([column(40)], { helvetica: true }));
    expect(await read()).toMatchObject({ ready: false, held: [{ position_id: 1, reason: "cv_pdf_layout_bad" }] });
  });
});
