/**
 * T30 (SICUREZZA §10): the PDF the team sends is rendered by the runtime, not
 * by a command the model writes.
 *
 * Three claims, and each is checked the way it would fail:
 * - the argument vector is ours, in full — the model's words never become an
 *   argument, and an extra field fails the call before anything runs;
 * - the source and the destination stay in the deliverables, symlinks
 *   resolved, and the PDF lands only in the role's own folder;
 * - a markdown that carries hostile HTML — a local file, an address — is
 *   rendered without reading the file and without a single request. The last
 *   one needs the real engine, so it runs where wkhtmltopdf exists (the
 *   image, whose `CMD` is `npm test`) and is skipped where it does not.
 */

import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENGINE, LAYOUT_CSS, PANDOC, blocked, createRenderPdfTool, safeHtml, type RunResult } from "../src/parity/skills/render-pdf.ts";
import { createSkillTools } from "../src/parity/skills/index.ts";
import { onPath, replacedCommand } from "../src/parity/jht-tools.ts";
import { realPath } from "../src/tools/paths.ts";
import type { ToolExecution, ToolHandler } from "../src/tools/registry.ts";

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), "..");
const context = { signal: new AbortController().signal } as never;

let root: string;
let userDir: string;
let cvDir: string;
let workdir: string;
let source: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-render-pdf-"));
  userDir = join(root, "user");
  cvDir = join(userDir, "cv");
  workdir = join(root, "home");
  for (const dir of [cvDir, join(userDir, "critiche"), workdir]) mkdirSync(dir, { recursive: true });
  source = join(cvDir, "CV_Mario_7.md");
  writeFileSync(source, "# Mario Rossi\n\nUno **sviluppatore**.\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A renderer whose two programs are recorded instead of run. */
function recorded(options: { onRun?: (file: string, args: string[]) => void; pdfBytes?: number; stderr?: string } = {}) {
  const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
  const tool = createRenderPdfTool({
    userDir,
    agent: "scrittore-1",
    workdir,
    run: async (file, args, cwd) => {
      calls.push({ file, args, cwd });
      options.onRun?.(file, args);
      // Each program writes what the next step expects: `--output` for pandoc,
      // the last argument for the engine.
      const out = file === PANDOC ? args[args.indexOf("--output") + 1]! : args[args.length - 1]!;
      writeFileSync(out, file === PANDOC ? "<html></html>" : Buffer.alloc(options.pdfBytes ?? 32_000, 1));
      return { code: 0, stdout: "", stderr: file === ENGINE ? (options.stderr ?? "") : "" };
    },
  });
  return { tool, calls };
}

const run = (tool: ToolHandler, args: Record<string, unknown>): Promise<ToolExecution> => tool.execute(tool.spec.schema.parse(args), context);

describe("the argument vector is the runtime's", () => {
  it("runs pandoc and the engine with exactly the arguments written in the runtime", async () => {
    const { tool, calls } = recorded();
    const result = await run(tool, { source, title: "CV Mario Rossi" });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.file)).toEqual([PANDOC, ENGINE]);
    const work = calls[0]!.cwd;
    // Both vectors written out here, not taken from the code they check: a
    // reviewer reads the arguments in the test, and dropping one of them is red.
    // The source is the file the path really names, every symlink resolved
    // (macOS puts the temporary folder behind /private) — that is what was checked.
    expect(calls[0]!.args).toEqual([
      realPath(source),
      "--from",
      "markdown",
      "--to",
      "html5",
      "--standalone",
      "--sandbox",
      "--variable",
      "document-css=",
      "--include-in-header",
      join(work, "layout.html"),
      "--metadata",
      "pagetitle=CV Mario Rossi",
      "--output",
      join(work, "page.html"),
    ]);
    expect(calls[1]!.args).toEqual([
      "--disable-local-file-access",
      "--disable-external-links",
      "--disable-internal-links",
      "--disable-javascript",
      "--no-images",
      "--proxy",
      "http://127.0.0.1:1",
      "--load-media-error-handling",
      "ignore",
      "--encoding",
      "utf-8",
      "--page-size",
      "A4",
      "--margin-top",
      "11mm",
      "--margin-bottom",
      "11mm",
      "--margin-left",
      "15mm",
      "--margin-right",
      "15mm",
      // Not page.html: the engine reads what `safeHtml` left of it.
      join(work, "clean.html"),
      join(work, "out.pdf"),
    ]);
    // Nothing excepts the denials, and the margins are the skill's (SKILL.md, W-03).
    expect(calls[1]!.args).not.toContain("--allow");
    expect(calls[1]!.args).not.toContain("--enable-local-file-access");
    // The PDF is beside the markdown it came from, and the temporary folder is gone.
    expect(existsSync(join(cvDir, "CV_Mario_7.pdf"))).toBe(true);
    expect(result.content).toContain("32000 bytes");
    expect(existsSync(work)).toBe(false);
  });

  it("refuses a call that carries one argument more", () => {
    const tool = recorded().tool;
    const extra = tool.spec.schema.safeParse({ source, title: "CV Mario Rossi", engine_args: "--enable-local-file-access" });
    expect(extra.success).toBe(false);
    expect(tool.spec.schema.safeParse({ source, title: "CV Mario Rossi" }).success).toBe(true);
  });

  it("keeps a flag written into the title inside the title", async () => {
    const { tool, calls } = recorded();
    await run(tool, { source, title: "--enable-local-file-access --allow /etc" });
    expect(calls[0]!.args).toContain("pagetitle=--enable-local-file-access --allow /etc");
    expect(calls[0]!.args).not.toContain("--enable-local-file-access");
    expect(calls[1]!.args).not.toContain("--allow");
  });

  it("names render_pdf when the shell is asked for the renderer, wherever the binaries are", () => {
    // The old rule refused pandoc only where it was missing. The command is the
    // hole: it is answered with the tool whether or not the box carries it.
    for (const has of [() => true, () => false]) {
      expect(replacedCommand("pandoc cv.md -o cv.pdf --pdf-engine=wkhtmltopdf", has)).toBe("pandoc");
      expect(replacedCommand("wkhtmltopdf page.html out.pdf", has)).toBe("wkhtmltopdf");
    }
    // Poppler only measures a PDF: still refused only where it is missing.
    expect(replacedCommand("pdftotext cv.pdf -", () => true)).toBeNull();
    expect(replacedCommand("pdftotext cv.pdf -", () => false)).toBe("pdftotext");
  });

  it("is the SCRITTORE's tool, and only with the deliverables folder", () => {
    const names = (skills: string[], dirs: { userDir?: string } = { userDir }) =>
      createSkillTools({ skills, agent: "scrittore-1", workdir, ...dirs }).map((t) => t.spec.name);
    expect(names(["cv-structure"])).toContain("render_pdf");
    expect(names(["cv-structure"], {})).not.toContain("render_pdf");
    expect(createSkillTools({ skills: ["scout-coord"], agent: "scout-1", userDir, workdir }).map((t) => t.spec.name)).not.toContain("render_pdf");
  });
});

describe("the files it may touch", () => {
  /** Each case names the path the model would have given, from the role's home. */
  const cases: Array<[string, (dirs: { cv: string; user: string }) => Record<string, unknown>, RegExp]> = [
    ["a source outside the deliverables", () => ({ source: "/etc/hosts.md", title: "CV" }), /not in the deliverables folder/],
    ["a source that climbs out of it", ({ cv }) => ({ source: `${cv}/../../../etc/passwd.md`, title: "CV" }), /not in the deliverables folder/],
    ["a source that is not markdown", ({ cv }) => ({ source: `${cv}/CV_Mario_7.pdf`, title: "CV" }), /not a markdown file/],
    ["a destination in another role's folder", ({ cv, user }) => ({ source: `${cv}/CV_Mario_7.md`, title: "CV", output: `${user}/critiche/CV.pdf` }), /not yours to write/],
    ["a destination outside the deliverables", ({ cv }) => ({ source: `${cv}/CV_Mario_7.md`, title: "CV", output: "/tmp/CV.pdf" }), /not yours to write/],
    ["a destination that climbs out of the role's folder", ({ cv }) => ({ source: `${cv}/CV_Mario_7.md`, title: "CV", output: `${cv}/../critiche/CV.pdf` }), /not yours to write/],
    ["a destination that is not a PDF", ({ cv }) => ({ source: `${cv}/CV_Mario_7.md`, title: "CV", output: `${cv}/CV.md` }), /not a \.pdf/],
  ];

  for (const [name, args, refusal] of cases) {
    it(`refuses ${name}, and runs nothing`, async () => {
      const { tool, calls } = recorded();
      const result = await run(tool, args({ cv: cvDir, user: userDir }));
      expect(result.ok).toBe(false);
      expect(result.content).toMatch(refusal);
      expect(calls).toEqual([]);
    });
  }

  it("refuses a destination whose folder is a symlink out of the deliverables", async () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(cvDir, "out"));
    const { tool, calls } = recorded();
    const result = await run(tool, { source, title: "CV", output: join(cvDir, "out", "CV.pdf") });
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/not yours to write/);
    expect(calls).toEqual([]);
  });

  it("refuses an empty source and a source that is not there", async () => {
    const empty = join(cvDir, "empty.md");
    writeFileSync(empty, "");
    const { tool } = recorded();
    expect((await run(tool, { source: empty, title: "CV" })).content).toMatch(/is empty/);
    expect((await run(tool, { source: join(cvDir, "missing.md"), title: "CV" })).content).toMatch(/cannot be read/);
  });

  it("leaves the markdown and says what to do when the box has no toolchain", async () => {
    const tool = createRenderPdfTool({
      userDir,
      agent: "scrittore-1",
      workdir,
      run: async (): Promise<RunResult> => ({ code: null, stdout: "", stderr: "", error: "spawn pandoc ENOENT" }),
    });
    const result = await run(tool, { source, title: "CV Mario Rossi" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("db_update application --cv-path");
    expect(existsSync(join(cvDir, "CV_Mario_7.pdf"))).toBe(false);
    expect(readFileSync(source, "utf8")).toContain("Mario Rossi");
  });

  it("writes no PDF when the engine fails, and hands back what it said", async () => {
    const tool = createRenderPdfTool({
      userDir,
      agent: "scrittore-1",
      workdir,
      run: async (file, args): Promise<RunResult> => {
        if (file === PANDOC) {
          writeFileSync(args[args.indexOf("--output") + 1]!, "<html></html>");
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "Exit with code 1 due to network error: ContentNotFoundError" };
      },
    });
    const result = await run(tool, { source, title: "CV Mario Rossi" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("ContentNotFoundError");
    expect(existsSync(join(cvDir, "CV_Mario_7.pdf"))).toBe(false);
  });
});

describe("the HTML the engine is given", () => {
  it("loses everything that fetches or runs, and keeps the CV's own style", () => {
    const clean = safeHtml(
      '<html><head><style>body { font-size: 10pt; }</style><link rel="stylesheet" href="http://host/x.css">' +
        '<meta http-equiv="refresh" content="0; url=http://host/"></head><body><h1>Mario</h1>' +
        '<img src="file:///etc/hostname"><iframe src="file:///etc/passwd">fallback</iframe>' +
        '<script>fetch("http://host/")</script><embed src="http://host/e"><p>Uno <b>sviluppatore</b>.</p></body></html>',
    );
    expect(clean).toContain("<style>body { font-size: 10pt; }</style>");
    expect(clean).toContain("Uno <b>sviluppatore</b>.");
    for (const gone of ["<img", "<iframe", "<script", "<link", "<embed", "http-equiv", "fallback", 'fetch("http://host/")']) {
      expect(clean).not.toContain(gone);
    }
  });

  it("leaves a remote @import inside the CV's own style, which is why the proxy is the fence", () => {
    // SICUREZZA measured it (21/09): `<style>@import url(http://…)</style>`
    // fetches, deny flags and stripping notwithstanding. The `<style>` stays
    // because cv-structure needs it; what stops the request is `--proxy` at a
    // closed port, which `engineArgs` passes. Written here so that dropping
    // the proxy because "the stripping covers it" is not an easy mistake.
    expect(safeHtml('<style>@import url("http://host/x.css");</style>')).toContain("@import");
  });

  it("takes each of them out even with no closing tag", () => {
    // A tag that is never closed is the shape PAIRED cannot see: each name is
    // named here, so dropping one from the list is red.
    for (const tag of ["script", "iframe", "object", "embed", "applet", "frame", "link", "base", "img", "audio", "video", "source", "track", "input"]) {
      expect(safeHtml(`<p>keep</p><${tag} src="http://host/x">`)).toBe("<p>keep</p>");
    }
  });

  it("is not fooled by whitespace or a closing tag on its own", () => {
    expect(safeHtml('<  img src="file:///etc/hostname" >')).toBe("");
    expect(safeHtml("</script>")).toBe("");
    // A word that starts like a tag name is not a tag: `\b` holds the line.
    expect(safeHtml("<imgur>keep</imgur>")).toBe("<imgur>keep</imgur>");
  });
});

describe("what the renderer refused", () => {
  it("reports the engine's own words, and not its note about an unpatched Qt", () => {
    const stderr =
      "The switch --disable-external-links, is not support using unpatched qt, and will be ignored." +
      "Loading page (1/2)\nWarning: Blocked access to file /root/secret.txt\nWarning: Failed to load http://127.0.0.1:8099/x.css (ignore)\n";
    expect(blocked(stderr)).toEqual([
      "Warning: Blocked access to file /root/secret.txt",
      "Warning: Failed to load http://127.0.0.1:8099/x.css (ignore)",
    ]);
    expect(blocked("")).toEqual([]);
  });

  it("puts them in the answer the agent reads", async () => {
    const { tool } = recorded({ stderr: "Warning: Blocked access to file /root/secret.txt\n" });
    const result = await run(tool, { source, title: "CV Mario Rossi" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("The renderer refused what the markdown asked for:");
    expect(result.content).toContain("Blocked access to file /root/secret.txt");
  });
});

/**
 * The layout is a copy: the image carries no `shared/`. A copy is how a ruler
 * splits in silence (the scoring caps did exactly that), so the two are held
 * together against the commit the header names.
 */
describe("the layout CSS against shared/skills/pdf_layout_base.css", () => {
  const css = readFileSync(join(RUNTIME, "src", "parity", "skills", "pdf-layout-base.css"), "utf8");
  const commit = /^\/\* COPY of (\S+) at ([0-9a-f]{7,40})/.exec(css);
  const original = commit === null ? undefined : `${commit[2]}:${commit[1]}`;
  const reachable =
    original !== undefined &&
    (() => {
      try {
        execFileSync("git", ["cat-file", "-e", original], { cwd: RUNTIME, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();

  it.skipIf(!reachable)(`is ${commit?.[1] ?? "?"} at ${commit?.[2] ?? "?"}, byte for byte`, () => {
    const upstream = execFileSync("git", ["show", original!], { cwd: RUNTIME, encoding: "utf8" });
    // The copy is the header that says where it comes from, then the file itself.
    expect(css.slice(css.indexOf("*/\n") + 3)).toBe(upstream);
  });

  it("is what the renderer embeds", () => {
    expect(LAYOUT_CSS).toBe(css);
    // The reset that undoes pandoc's 36em column, and the printed size.
    expect(LAYOUT_CSS).toContain("max-width: none !important");
    expect(LAYOUT_CSS).toContain("zoom: 1.35");
  });
});

/**
 * With the real pandoc: the HTML the engine is handed carries the layout and
 * not a byte of the file the markdown pointed at.
 */
describe.skipIf(!onPath(PANDOC))("what pandoc hands the engine", () => {
  it("embeds the layout and reads no file the markdown names", async () => {
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "SECRET-MARKER-9c4b\n");
    writeFileSync(
      source,
      `# Mario Rossi\n\n![](file://${secret})\n\n<img src="file://${secret}">\n<iframe src="file://${secret}"></iframe>\n<script>fetch("http://127.0.0.1:9/")</script>\n`,
    );

    let page = "";
    const tool = createRenderPdfTool({
      userDir,
      agent: "scrittore-1",
      workdir,
      // pandoc for real; the engine recorded, since it may not be on this box.
      run: async (file, args, cwd) => {
        if (file === PANDOC) return realRun(PANDOC, args, cwd);
        page = readFileSync(args[args.length - 2]!, "utf8");
        writeFileSync(args[args.length - 1]!, Buffer.alloc(32_000, 1));
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    const result = await run(tool, { source, title: "CV Mario Rossi" });
    expect(result.ok).toBe(true);
    // Nothing that fetches or runs survives as far as the engine.
    for (const tag of ["<img", "<iframe", "<script", "<link", "<embed"]) expect(page.toLowerCase()).not.toContain(tag);
    expect(page).toContain("max-width: none !important");
    expect(page).toContain("<title>CV Mario Rossi</title>");
    // pandoc's own 36em column is out, as `-c … --self-contained` used to leave it
    // (the rule, not the line of our CSS that explains it).
    expect(page).not.toMatch(/max-width: 36em;/);
    // The file was named, never read.
    expect(page).not.toContain("SECRET-MARKER-9c4b");
  });
});

/**
 * With the real engine — the image, where `CMD` is `npm test`. SICUREZZA's own
 * check: hostile HTML rendered by the product's path, and neither the file nor
 * the address reaches the PDF, with no request made at all.
 */
describe.skipIf(!onPath(PANDOC) || !onPath(ENGINE))("what the engine does with hostile markdown", () => {
  let server: Server;
  let hits: string[];
  let port: number;

  beforeEach(async () => {
    hits = [];
    server = createServer((request, response) => {
      hits.push(request.url ?? "");
      response.end("secret");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("renders it without reading the file and without one request", async () => {
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "SECRET-MARKER-9c4b\n");
    writeFileSync(
      source,
      `# Mario Rossi\n\nUno sviluppatore con anni di esperienza, e una riga di testo per riempire la pagina.\n\n` +
        `<img src="file://${secret}">\n<img src="http://127.0.0.1:${port}/metadata">\n` +
        `<iframe src="file://${secret}"></iframe>\n<link rel="stylesheet" href="http://127.0.0.1:${port}/x.css">\n` +
        `<script>fetch("http://127.0.0.1:${port}/js")</script>\n`,
    );

    const tool = createRenderPdfTool({ userDir, agent: "scrittore-1", workdir });
    const result = await run(tool, { source, title: "CV Mario Rossi" });

    expect(result.ok).toBe(true);
    expect(hits).toEqual([]);
    const pdf = readFileSync(join(cvDir, "CV_Mario_7.pdf"));
    expect(pdfText(pdf)).not.toContain("SECRET-MARKER-9c4b");
  });
});

/** The real program, for the steps a test wants run rather than recorded. */
function realRun(file: string, args: string[], cwd: string): Promise<RunResult> {
  try {
    const stdout = execFileSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, TMPDIR: cwd } });
    return Promise.resolve({ code: 0, stdout, stderr: "" });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string; message: string };
    return Promise.resolve({ code: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message });
  }
}

/**
 * Everything readable in a PDF: the file as it stands plus every compressed
 * stream in it. No poppler needed, so the check reads the same on a box
 * without it.
 */
function pdfText(pdf: Buffer): string {
  const parts = [pdf.toString("latin1")];
  for (const match of parts[0]!.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = parts[0]!.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      parts.push(inflateSync(pdf.subarray(start, end)).toString("latin1"));
    } catch {
      // Not a deflate stream: nothing to read out of it.
    }
  }
  return parts.join("\n");
}
