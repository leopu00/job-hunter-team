// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compiledRustRecords, entrypointRustRecords } from "../../helpers/rust-source-records";

const temporaryRoots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "rust-source-records-"));
  temporaryRoots.push(root);
  for (const [relative, source] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the canonical Rust acquisition transport", () => {
  it("keeps logical ownership and code when a real module moves into a nested file", () => {
    const root = fixture({ "lib.rs": "mod feature;\n", "feature.rs": "pub fn actual() {}\n" });
    const before = compiledRustRecords(root, "feature.rs");
    mkdirSync(join(root, "feature"));
    writeFileSync(join(root, "feature/mod.rs"), readFileSync(join(root, "feature.rs")));
    rmSync(join(root, "feature.rs"));
    const after = compiledRustRecords(root, "feature.rs");
    expect(before.map(({ logical_module, source, code }) => ({ logical_module, source, code })))
      .toEqual(after.map(({ logical_module, source, code }) => ({ logical_module, source, code })));
    expect(before.map((record) => record.relative)).toEqual(["feature.rs"]);
    expect(after.map((record) => record.relative)).toEqual(["feature/mod.rs"]);
  });

  it("rejects an existing physical orphan beside the real library graph", () => {
    const root = fixture({ "lib.rs": "pub fn root() {}\n", "orphan.rs": "pub fn decoy() {}\n" });
    expect(() => compiledRustRecords(root, "orphan.rs")).toThrow(/missing or ambiguous Rust entry module/);
  });

  it("requires the library even when the requested physical entry exists", () => {
    const root = fixture({ "feature.rs": "pub fn actual() {}\n" });
    expect(() => compiledRustRecords(root, "feature.rs")).toThrow(/missing Rust library entrypoint/);
  });

  it("reads a standalone entry only through the explicit executable contract", () => {
    const root = fixture({ "main.rs": "fn main() {}\n" });
    expect(entrypointRustRecords(root, "main.rs").map((record) => record.relative)).toEqual(["main.rs"]);
    expect(() => compiledRustRecords(root, "main.rs")).toThrow(/missing Rust library entrypoint/);
  });

  it("fails if a declared leaf disappears instead of returning partial records", () => {
    const root = fixture({ "lib.rs": "mod missing;\npub fn root() {}\n" });
    expect(() => compiledRustRecords(root)).toThrow(/missing or ambiguous Rust module missing/);
  });

  it("preserves aliases as distinct logical owners with visible multiplicity", () => {
    const root = fixture({
      "lib.rs": '#[path="shared.rs"] mod first;\n#[path="shared.rs"] mod second;\n',
      "shared.rs": "pub fn actual() {}\n",
    });
    const aliases = compiledRustRecords(root).filter((record) => record.relative === "shared.rs");
    expect(aliases.map((record) => record.logical_module)).toEqual(["first", "second"]);
    expect(aliases.map((record) => record.source)).toEqual(["pub fn actual() {}\n", "pub fn actual() {}\n"]);
  });

  it("keeps both OS variants, filters test code, and preserves production after tests", () => {
    const root = fixture({ "lib.rs": [
      "#[cfg(windows)] pub fn hidden() {}",
      "#[cfg(not(windows))] pub fn hidden() {}",
      '#[cfg(test)] mod tests { fn decoy() {} }',
      "pub fn after_tests() {}",
    ].join("\n") });
    const [record] = compiledRustRecords(root);
    expect([...record.code.matchAll(/\bfn hidden\(/g)]).toHaveLength(2);
    expect(record.source).not.toContain("fn decoy");
    expect(record.code).toContain("fn after_tests");
    expect(compiledRustRecords(root, "lib.rs", { includeTests: true })[0].code).toContain("fn decoy");
  });

  it("uses UTF-16 masks at original CRLF and normalized offsets after non-BMP text", () => {
    const original = '\ufeff// hidden 🚀\r\nconst TEXT: &str = "🚀";\r\npub fn actual() {}\r\n';
    const root = fixture({ "lib.rs": original });
    const [record] = compiledRustRecords(root);
    expect(record.original_source).toBe(original);
    expect(record.source).toBe(original.slice(1).replace(/\r\n/g, "\n"));
    expect(record.code.length).toBe(record.source.length);
    expect(record.original_code.length).toBe(original.length);
    for (const [source, code] of [[record.source, record.code], [original, record.original_code]]) {
      const offset = code.indexOf("pub fn actual");
      expect(offset).toBe(source.indexOf("pub fn actual"));
      expect(source.slice(offset)).toContain("pub fn actual() {}");
      expect(code).not.toContain("🚀");
    }
    expect(record.offset_units).toBe("utf16");
  });
});
