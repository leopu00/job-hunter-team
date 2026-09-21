/**
 * `render_pdf`: the CV and the cover letter turned into the one document the
 * team sends to a company (SICUREZZA-HARNESS.md §10, P1).
 *
 * The TUI runs the render from the shell, as `cv-structure/SKILL.md` writes
 * it: `pandoc … --pdf-engine=wkhtmltopdf …`. wkhtmltopdf is a whole WebKit —
 * by default it follows `file://`, loads remote images and runs JavaScript —
 * and the markdown it renders is written from scraped job ads, that is from
 * outside. A posting that says "add this image" can get a CV that carries a
 * local file or the host's provisioning data out of the box, inside the only
 * artefact the product ever sends to a stranger. The leak does not pass
 * through the model and does not pass through `web_fetch`: it passes through
 * the renderer, which has neither fence.
 *
 * So the renderer is a tool, not a command: **the model chooses the content,
 * the runtime chooses every argument** — the same rule the Python skills
 * follow. The two argument vectors below are constants; the model supplies a
 * source file, a destination and a title, each checked, and nothing else (the
 * schema is `.strict()`, so one extra field fails the call before it runs).
 *
 * What the flags do, in order of the hole they close. Every line was measured
 * on 21/09 in the image's own toolchain (pandoc 2.17, wkhtmltopdf 0.12.6
 * with Debian's unpatched Qt), against a markdown carrying `file://`, a remote
 * image, a remote stylesheet, an `<iframe>` and a `<script>`:
 * - `--sandbox` (pandoc): the reader and writer may touch only the files named
 *   on the command line, so `![](file:///etc/passwd)` is not embedded;
 * - `--disable-local-file-access` (wkhtmltopdf): the page may not read local
 *   files — `--allow` is never passed, so nothing is excepted. Measured:
 *   "Blocked access to file /root/secret.txt", and the input page still loads;
 * - `--proxy` at a dead port: **the network fence**. The deny flags do not
 *   cover a stylesheet — with them alone the render still fetched
 *   `<link rel="stylesheet" href="http://…">` and the listening server saw the
 *   request. Pointed at a closed port, the same render made none;
 * - `--no-images`: no image is loaded at all, local or remote. A CV has none;
 * - `--disable-javascript`: no script in the page runs;
 * - `--disable-external-links`, `--disable-internal-links`: kept because
 *   SICUREZZA asked for them and a patched Qt honours them; measured **ignored**
 *   on this image, which says it on stderr. A flag that exists and does nothing
 *   is exactly why the fences above do not rely on it.
 *
 * **The fence that holds against the network is the proxy.** What pandoc
 * produces is also stripped of the elements that can only fetch or run
 * something (`safeHtml`), but that is a second layer, not the defence: it is a
 * regex, and it keeps `<style>` on purpose because `cv-structure/SKILL.md`
 * relies on it — so a remote `@import` inside a `<style>` walks straight
 * through it, which SICUREZZA measured (21/09). The dead proxy is what stops
 * that one too. Whoever drops `--proxy` because "the stripping covers it"
 * reopens the hole. What the stripping is good for: it does not depend on a
 * switch the engine may ignore, and it keeps hostile HTML from failing an
 * otherwise good render — a blocked `<iframe>` makes wkhtmltopdf exit 1
 * (`about:blank`, ProtocolUnknownError).
 *
 * Two steps instead of `--pdf-engine`, on purpose: with pandoc driving the
 * engine the engine's argv is pandoc's to build, and what reaches wkhtmltopdf
 * depends on the pandoc version. Here each vector is written here, in full,
 * where a reviewer reads it.
 *
 * Parity with the skill's command: same margins, same page size, same base
 * layout, same `pagetitle` metadata. Two differences, both deliberate:
 * - the base CSS is embedded with `--include-in-header` instead of
 *   `-c … --self-contained`, because `--sandbox` refuses to fetch the
 *   stylesheet; `-V document-css=` then leaves pandoc's own 36em column out,
 *   which is what `-c` used to do;
 * - the size and Producer gates stay with the agent: the tool reports the
 *   size in bytes, and the engine is no longer a thing the agent can get
 *   wrong — the Producer check existed to catch a render that fell back to
 *   fpdf2, and nothing here can.
 */

import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { scrubEnv } from "../../tools/bash.ts";
import { isInside, realPath, resolveUserPath } from "../../tools/paths.ts";
import type { ToolExecution, ToolHandler } from "../../tools/registry.ts";
import { deliverableDir } from "../deliverables.ts";

export const RENDER_PDF_TOOL = "render_pdf";

/** The two programs the render needs, in the order they run. */
export const PANDOC = "pandoc";
export const ENGINE = "wkhtmltopdf";

/** A render that has not finished by now is killed: a CV is seconds of work. */
const TIMEOUT_MS = 120_000;
/** The biggest markdown the tool renders. A CV is a few KB; this is a wall, not a target. */
const MAX_SOURCE_BYTES = 1_000_000;
/** Output kept from each program when it fails, so a message stays readable. */
const MAX_OUTPUT_BYTES = 20_000;
/**
 * The proxy every request is sent to: port 1 of the loopback, where nothing
 * listens. Not a real proxy — a wall that answers nothing.
 */
const DEAD_PROXY = "http://127.0.0.1:1";

/**
 * The elements taken out of the HTML before it is rendered: everything whose
 * only job is to fetch or to run something. A CV needs none of them — its own
 * `<style>` block, which `cv-structure/SKILL.md` relies on, stays.
 *
 * A regex over HTML, and a layer UNDER the two fences, never one to lean on:
 * the `<style>` it keeps may hold `@import url(http://…)`, which it does not
 * see and `--proxy` does stop. What it misses is a reference the engine
 * refuses anyway, and that costs a render, never a secret.
 */
const RUNS_OR_FETCHES = /script|iframe|object|embed|applet|frame|frameset|link|base|img|audio|video|source|track|input/.source;
const PAIRED = new RegExp(String.raw`<\s*(script|iframe|object|applet|frame|frameset)\b[^>]*>[\s\S]*?<\s*/\s*\1\s*>`, "gi");
const TAG = new RegExp(String.raw`<\s*/?\s*(?:${RUNS_OR_FETCHES})\b[^>]*>`, "gi");
const REFRESH = /<\s*meta\b[^>]*http-equiv[^>]*>/gi;

/** `html` without the elements that fetch or run. Everything else is untouched. */
export function safeHtml(html: string): string {
  return html.replace(PAIRED, "").replace(TAG, "").replace(REFRESH, "");
}

/** The layout every CV and cover letter starts from, shipped with the runtime (the image has no `shared/`). */
export const LAYOUT_CSS = readFileSync(new URL("./pdf-layout-base.css", import.meta.url), "utf8");

/**
 * What pandoc turns the markdown into: one standalone HTML file, in a folder
 * of ours. `%s` are the paths the runtime fills in.
 */
export function pandocArgs(source: string, header: string, page: string, title: string): string[] {
  return [
    source,
    "--from",
    "markdown",
    "--to",
    "html5",
    "--standalone",
    "--sandbox",
    // Leaves pandoc's built-in stylesheet out, `max-width: 36em` included: the
    // base CSS below is the layout, and it comes last so it wins anyway.
    "--variable",
    "document-css=",
    "--include-in-header",
    header,
    // `pagetitle`, not `title`: the document's title without a printed header.
    // The cover letter passes its own — 31 beta-3 letters went out titled "CV".
    "--metadata",
    `pagetitle=${title}`,
    "--output",
    page,
  ];
}

/**
 * What wkhtmltopdf makes of that HTML. The five deny flags are SICUREZZA's
 * §10 minimum; the margins and the page size are the skill's, passed here
 * because wkhtmltopdf ignores `@page`.
 */
export function engineArgs(page: string, pdf: string): string[] {
  return [
    "--disable-local-file-access",
    "--disable-external-links",
    "--disable-internal-links",
    "--disable-javascript",
    "--no-images",
    // Every address the page names resolves to a closed port of its own box:
    // the deny flags above do not stop a stylesheet, and this does.
    "--proxy",
    DEAD_PROXY,
    // A resource the fences refused must not fail the render: the page is the
    // document, a blocked reference is the point.
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
    page,
    pdf,
  ];
}

export interface RenderPdfOptions {
  /** The deliverables folder: the source is read from here. Absolute. */
  userDir: string;
  /** The agent rendering: the PDF goes in its own deliverables folder, nowhere else. */
  agent: string;
  /** Where a relative path resolves (the role's home). Absolute. */
  workdir: string;
  /** Test seam: runs a program and reports what it did. */
  run?: Runner;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the program could not be started at all. */
  error?: string;
}

export type Runner = (file: string, args: string[], cwd: string) => Promise<RunResult>;

const schema = z
  .object({
    source: z.string().min(1).max(1_000).describe("the markdown file to render, in the deliverables folder"),
    title: z.string().min(1).max(200).describe('the document title: "CV Mario Rossi" for a CV, "Cover Letter Mario Rossi" for a letter'),
    output: z.string().min(1).max(1_000).optional().describe("where the PDF goes (default: the source with .pdf)"),
  })
  .strict();

type Args = z.infer<typeof schema>;

export function createRenderPdfTool(options: RenderPdfOptions): ToolHandler {
  const run = options.run ?? spawnProgram;
  const userDir = realPath(options.userDir);
  const ownDir = deliverableDir(userDir, options.agent);
  const at = (path: string) => realPath(resolveUserPath(path, options.workdir));

  return {
    spec: {
      name: RENDER_PDF_TOOL,
      description:
        "Render a CV or cover letter written in markdown to the PDF the company receives. " +
        `Replaces the skill's \`${PANDOC} … --pdf-engine=${ENGINE} …\` command: same page size, margins and base layout, ` +
        "and the arguments are the runtime's, so nothing in the markdown can make the renderer read a local file, " +
        "fetch an address or run a script. Images are not printed. " +
        "Reports the size of the PDF in bytes: the skill's own size gate is yours to apply, " +
        "and so is the `db_update application --cv-pdf-path` that records the file.",
      schema,
    },

    classify(args) {
      const { source, output } = args as Args;
      const from = at(source);
      return { risk: "execute", paths: [from, output === undefined ? pdfBeside(from) : at(output)], summary: `render_pdf ${source}` };
    },

    async execute(args) {
      const { source, title, output } = args as Args;
      const from = at(source);
      const to = output === undefined ? pdfBeside(from) : at(output);

      if (!isInside(userDir, from)) return no(`${source} is not in the deliverables folder (${userDir}): render what the team wrote.`);
      if (!from.endsWith(".md")) return no(`${source} is not a markdown file: render_pdf takes the .md the CV was written in.`);
      if (ownDir === undefined) return no(`${options.agent} writes no deliverable, so it renders none.`);
      if (!isInside(ownDir, to)) return no(`${to} is not yours to write: your PDF goes in ${ownDir}.`);
      if (!to.endsWith(".pdf")) return no(`${to} is not a .pdf.`);

      let size: number;
      try {
        const stat = statSync(from);
        if (!stat.isFile()) return no(`${source} is not a file.`);
        size = stat.size;
      } catch (error) {
        return no(`${source} cannot be read: ${message(error)}`);
      }
      if (size === 0) return no(`${source} is empty: there is nothing to render.`);
      if (size > MAX_SOURCE_BYTES) return no(`${source} is ${size} bytes, over the ${MAX_SOURCE_BYTES} the renderer takes.`);

      // Everything the two programs write goes here, and TMPDIR points at it: a
      // folder of ours, removed whatever happens, never the deliverables.
      const work = mkdtempSync(join(tmpdir(), "jht-api-pdf-"));
      try {
        const header = join(work, "layout.html");
        const page = join(work, "page.html");
        const pdf = join(work, "out.pdf");
        writeFileSync(header, `<style>\n${LAYOUT_CSS}</style>\n`);

        const rendered = await run(PANDOC, pandocArgs(from, header, page, title), work);
        if (failed(rendered)) return no(step(PANDOC, rendered, source));

        // What the engine is given is never what pandoc wrote: the elements
        // that fetch or run are gone first.
        const clean = join(work, "clean.html");
        writeFileSync(clean, safeHtml(readFileSync(page, "utf8")));
        const printed = await run(ENGINE, engineArgs(clean, pdf), work);
        if (failed(printed)) return no(step(ENGINE, printed, source));

        let bytes: number;
        try {
          bytes = statSync(pdf).size;
        } catch {
          return no(`${ENGINE} exited 0 but wrote no PDF for ${source}. Report it: the markdown is intact.`);
        }
        if (bytes === 0) return no(`${ENGINE} wrote an empty PDF for ${source}. Report it: the markdown is intact.`);

        move(pdf, to);
        // What the fences refused, in the renderer's own words: a CV written
        // from a job ad that asked for a file or an address says so here, and
        // the agent can report it instead of wondering why a box is empty.
        const refused = blocked(printed.stderr);
        return {
          ok: true,
          content:
            `Rendered ${source} to ${to} — ${bytes} bytes. No image is printed and no address is fetched.` +
            (refused.length === 0 ? "" : `\nThe renderer refused what the markdown asked for:\n${refused.join("\n")}`),
          details: { exitCode: 0, pdfBytes: bytes, ...(refused.length === 0 ? {} : { refused }) },
        };
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
  };
}

/** The PDF beside a markdown file: `CV_x.md` → `CV_x.pdf`. */
function pdfBeside(source: string): string {
  return `${source.slice(0, -".md".length)}.pdf`;
}

function failed(result: RunResult): boolean {
  return result.error !== undefined || result.code !== 0;
}

/** Why a step failed, in the words the agent can act on. */
function step(program: string, result: RunResult, source: string): string {
  if (result.error !== undefined) {
    return (
      `${program} could not be started (${result.error}). This box has no PDF toolchain: ` +
      `deliver the CV as the markdown file ${source}, record its path with \`db_update application --cv-path\`, ` +
      "and say in your report that no PDF was rendered."
    );
  }
  const said = [result.stderr, result.stdout].filter((text) => text.trim() !== "").join("\n");
  return `${program} failed on ${source} (exit ${result.code}):\n${said || "(no output)"}`;
}

/**
 * The resources the engine refused, from what it printed. Its own two notes
 * about switches an unpatched Qt ignores are not refusals and stay out.
 */
export function blocked(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?=Warning: |Error: )/))
    .map((line) => line.trim())
    .filter((line) => /^(Warning|Error): /.test(line) && !/using unpatched qt/i.test(line))
    .slice(0, 5);
}

function no(content: string): ToolExecution {
  return { ok: false, content };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The finished PDF into place, in one move where the temporary folder and the
 * deliverables share a filesystem and by copy where they do not (a container
 * mounts the deliverables from elsewhere).
 */
function move(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

/** Runs one program with no shell, no stdin and a deadline. */
const spawnProgram: Runner = (file, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd,
        // The allowlist the shell tool uses, with its own folder for anything
        // either program writes on the side.
        env: { ...scrubEnv(process.env), TMPDIR: cwd },
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const failure = error as (Error & { code?: number | string; killed?: boolean }) | null;
        if (failure === null) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof failure.code === "number") {
          // The program ran and said no: its own words are the answer.
          resolve({ code: failure.code, stdout, stderr });
        } else {
          resolve({ code: null, stdout, stderr, error: failure.killed ? `killed after ${TIMEOUT_MS / 1000}s` : failure.message });
        }
      },
    );
  });
