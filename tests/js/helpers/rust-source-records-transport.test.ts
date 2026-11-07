// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compiledRustRecords } from "../../helpers/rust-source-records";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: run }));

const RECORD = {
  logical_module: "feature",
  relative: "feature.rs",
  source: "pub fn fixture() {}",
  code: "pub fn fixture() {}",
  original_source: "pub fn fixture() {}",
  original_code: "pub fn fixture() {}",
  offset_units: "utf16",
};
const VALID_OUTPUT = JSON.stringify([RECORD]);

beforeEach(() => run.mockReset());

describe("failed canonical Rust transport never becomes a partial source set", () => {
  it.each(["ENOENT", "ETIMEDOUT"])("propagates child acquisition errors (%s)", (code) => {
    const cause = Object.assign(new Error("synthetic child error"), { code });
    run.mockReturnValue({ error: cause, status: null, stdout: VALID_OUTPUT, stderr: "", signal: null });
    let failure: unknown;
    try { compiledRustRecords("synthetic-root"); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBe(cause);
  });

  it.each([
    { status: 1, signal: null, stderr: "unreadable source: feature.rs" },
    { status: null, signal: "SIGTERM", stderr: "" },
  ])("rejects a failed child despite valid partial stdout (%j)", (result) => {
    run.mockReturnValue({ ...result, stdout: VALID_OUTPUT });
    expect(() => compiledRustRecords("synthetic-root")).toThrow(/Rust compiled acquisition failed/);
    if (result.stderr) expect(() => compiledRustRecords("synthetic-root")).toThrow(result.stderr);
  });

  it("rejects truncated JSON instead of using any decoded prefix", () => {
    run.mockReturnValue({ status: 0, stdout: VALID_OUTPUT.slice(0, -1), stderr: "" });
    expect(() => compiledRustRecords("synthetic-root")).toThrow(SyntaxError);
  });

  it("rejects an empty source-record response", () => {
    run.mockReturnValue({ status: 0, stdout: "[]", stderr: "" });
    expect(() => compiledRustRecords("synthetic-root")).toThrow(/no records/);
  });

  it.each([
    { ...RECORD, offset_units: "codepoints" },
    { ...RECORD, source: "🚀" },
    { ...RECORD, original_code: "" },
    { ...RECORD, relative: "../outside.rs" },
    { ...RECORD, code: undefined },
  ])("rejects incompatible or incomplete canonical wire records (%j)", (record) => {
    run.mockReturnValue({ status: 0, stdout: JSON.stringify([record]), stderr: "" });
    expect(() => compiledRustRecords("synthetic-root")).toThrow();
  });
});
