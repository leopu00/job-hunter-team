/** Test UI batch 28 — TagInput (ScrollToTop e MultiSelect non ancora su master) */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) {
  const raw = fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

/* ── TagInput ── */
describe("TagInput", () => {
  const src = readSrc("components/TagInput.tsx");

  it("export default TagInput + TagInputProps + value/onChange/suggestions/maxTags/separators", () => {
    expect(src).toMatch(/export default function TagInput\b/);
    expect(src).toContain("export interface TagInputProps");
    expect(src).toContain("value: string[]");
    expect(src).toContain("onChange: (tags: string[]) => void");
    expect(src).toContain("suggestions?: string[]");
    expect(src).toContain("maxTags?: number");
    expect(src).toContain("separators?: string[]");
  });

  it("add: addTag trim + deduplica tags.includes + maxTags default 20 + separatori virgola + Enter aggiunge", () => {
    expect(src).toContain("const addTag");
    expect(src).toContain("raw.trim()");
    expect(src).toContain("tags.includes(tag)");
    expect(src).toContain("tags.length >= maxTags");
    expect(src).toContain("maxTags = 20");
    expect(src).toContain("separators = [',']");
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain("val.includes(sep)");
  });

  it("remove: removeTag + Backspace su input vuoto rimuove ultimo + button × + count tags.length/maxTags + atMax", () => {
    expect(src).toContain("const removeTag");
    expect(src).toContain("e.key === 'Backspace' && !input && tags.length > 0");
    expect(src).toContain("removeTag(tags.length - 1)");
    expect(src).toContain("{tags.length}/{maxTags}");
    expect(src).toContain("const atMax = tags.length >= maxTags");
    expect(src).toContain("atMax ? 'var(--color-red)'");
  });

  it("autocomplete: filtered suggestions slice(0,8) + ArrowDown/Up focusIdx + Escape chiude + click fuori + placeholder", () => {
    expect(src).toContain("const filtered = suggestions.filter");
    expect(src).toContain(".slice(0, 8)");
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("!containerRef.current?.contains(e.target as Node)");
    expect(src).toContain("placeholder = 'Aggiungi tag");
    expect(src).toContain("i === focusIdx ? 'var(--color-row)'");
  });
});
