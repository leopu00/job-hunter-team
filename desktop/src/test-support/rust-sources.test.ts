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
});
