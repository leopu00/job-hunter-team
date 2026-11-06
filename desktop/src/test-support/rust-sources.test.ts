// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compiledRustSourceFiles, withoutRustTests } from "./rust-sources";

describe("Rust production source inventory", () => {
  it("follows nested modules, mod.rs, inline modules and explicit paths", () => {
    const files: Record<string, string> = {
      "/src/lib.rs": 'mod chat;\nmod runtime;\nmod inline {\n#[path = "bridge.rs"]\nmod bridge;\n}',
      "/src/chat.rs": 'mod wire;\n#[path = "shared.rs"]\nmod shared;',
      "/src/chat/wire.rs": 'fn read() { failure("wire_failed"); }',
      "/src/shared.rs": "",
      "/src/runtime/mod.rs": "mod selection;",
      "/src/runtime/selection.rs": "",
      "/src/inline/bridge.rs": "",
    };
    const found = compiledRustSourceFiles("/src/lib.rs", (file) => files[file], (file) => file in files);
    expect(found).toEqual(["lib.rs", "chat.rs", "chat/wire.rs", "shared.rs", "runtime/mod.rs", "runtime/selection.rs", "inline/bridge.rs"]);
  });

  it("keeps production after test declarations and excludes test-only helpers and modules", () => {
    const code = '#[cfg(test)]\n#[path = "fake.rs"]\nmod fake;\n#[cfg(all(test, unix))]\nfn fake_helper() { failure("fake_error"); }\n#[cfg(test)]\nmod inline { fn test() { let x = "}"; } }\n#[cfg(not(test))]\nmod production;\n#[cfg(any(test, windows))]\nmod windows;';
    const stripped = withoutRustTests(code);
    expect(stripped).not.toContain("fake_error");
    expect(stripped).not.toContain("fake.rs");
    expect(stripped).toContain("mod production;");
    expect(stripped).toContain("mod windows;");
    const files: Record<string, string> = { "/src/lib.rs": code, "/src/production.rs": "", "/src/windows.rs": "" };
    expect(compiledRustSourceFiles("/src/lib.rs", (file) => files[file], (file) => file in files))
      .toEqual(["lib.rs", "production.rs", "windows.rs"]);
  });

  it("ignores fake declarations and braces inside comments and literals", () => {
    const code = 'const S: &str = r##"\nmod absent;\n#[cfg(test)]\nmod fake {}\n"##;\n/* outer /* } */ mod absent; */\nfn f() { let c = \'{\'; let s = "}\\\""; }\nmod real;';
    const files: Record<string, string> = { "/src/lib.rs": code, "/src/real.rs": "" };
    expect(compiledRustSourceFiles("/src/lib.rs", (file) => files[file], (file) => file in files)).toEqual(["lib.rs", "real.rs"]);
    expect(withoutRustTests(code)).toBe(code);
  });

  it("fails when a declared production module is absent", () => {
    expect(() => compiledRustSourceFiles("/src/lib.rs", () => "mod missing;", () => false)).toThrow("missing production module missing");
  });

  it("removes path attributes before a test cfg together with the gated item", () => {
    const files: Record<string, string> = {
      "/src/lib.rs": '#[path = "fake.rs"]\n#[cfg(test)]\nmod fake;\nmod production;',
      "/src/fake.rs": "",
      "/src/production.rs": "",
    };
    expect(compiledRustSourceFiles("/src/lib.rs", (file) => files[file], (file) => file in files))
      .toEqual(["lib.rs", "production.rs"]);
  });

  it("removes gated fields and variants without swallowing later production", () => {
    const source = 'struct S { #[cfg(test)] fake: u8, value: u8, }\nenum E { #[cfg(test)] Fake, Real }\nfn production() { failure("production_error"); }\nmod after;';
    const production = withoutRustTests(source);
    expect(production).not.toContain("fake:");
    expect(production).not.toContain("Fake");
    expect(production).toContain("value: u8");
    expect(production).toContain("Real");
    expect(production).toContain('failure("production_error")');
    const files: Record<string, string> = { "/src/lib.rs": source, "/src/after.rs": "" };
    expect(compiledRustSourceFiles("/src/lib.rs", (file) => files[file], (file) => file in files)).toEqual(["lib.rs", "after.rs"]);
  });

  it("follows multiple declarations and path attributes on the same line", () => {
    const files: Record<string, string> = {
      "/src/lib.rs": 'mod a; mod b; #[path = "x.rs"] mod y;',
      "/src/a.rs": "", "/src/b.rs": "", "/src/x.rs": "",
    };
    expect(compiledRustSourceFiles("/src/lib.rs", (file) => files[file], (file) => file in files))
      .toEqual(["lib.rs", "a.rs", "b.rs", "x.rs"]);
  });

  it("removes complete test items with generic parameters or where-clause commas", () => {
    for (const signature of ["fn helper<A, B>()", "fn helper<A, B>() where A: Clone, B: Clone"]) {
      const source = `#[cfg(test)] ${signature} { failure("test_only_error"); }\nfn production() { failure("real_error"); }`;
      const production = withoutRustTests(source);
      expect(production).not.toContain("test_only_error");
      expect(production).toContain('failure("real_error")');
    }
  });
});
