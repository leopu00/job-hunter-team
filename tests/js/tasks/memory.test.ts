/**
 * Test unitari — shared/memory (vitest)
 *
 * Edge cases: soul parsing avanzato, identity normalizzazione,
 * memory-manager ordine file, fallback lowercase, template costanti.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseSoulMarkdown, loadSoulFromWorkspace, SOUL_TEMPLATE } from "../../../shared/memory/soul.js";
import {
  parseIdentityMarkdown, identityHasValues, loadIdentityFromWorkspace,
  resolveIdentityName, resolveIdentityPrefix, IDENTITY_TEMPLATE,
} from "../../../shared/memory/identity.js";
import {
  loadBootstrapFiles, loadAgentMemory, ensureTemplates,
  hasMemoryFiles, listMemoryFiles,
} from "../../../shared/memory/memory-manager.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jht-vitest-memory-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Soul — parsing avanzato", () => {
  it("preserva contenuto multilinea nella sezione", () => {
    const content = `## Core Truths\n\nRiga uno.\n\nRiga due con **bold**.`;
    const soul = parseSoulMarkdown(content);
    expect(soul.coreTruths).toContain("Riga uno.");
    expect(soul.coreTruths).toContain("Riga due con **bold**.");
  });

  it("sub-heading ### non spezza la sezione", () => {
    const content = `## Core Truths\n\n### Dettaglio\n\nContenuto sotto.\n\n## Vibe\n\nCalmo.`;
    const soul = parseSoulMarkdown(content);
    expect(soul.coreTruths).toContain("### Dettaglio");
    expect(soul.coreTruths).toContain("Contenuto sotto.");
    expect(soul.vibe).toBe("Calmo.");
  });

  it("sezione con solo spazi ritorna undefined", () => {
    const content = `## Core Truths\n   \n   \n## Boundaries\n\nOk.`;
    const soul = parseSoulMarkdown(content);
    expect(soul.coreTruths).toBeUndefined();
    expect(soul.boundaries).toBe("Ok.");
  });

  it("SOUL_TEMPLATE contiene tutte e 4 le sezioni", () => {
    expect(SOUL_TEMPLATE).toContain("## Core Truths");
    expect(SOUL_TEMPLATE).toContain("## Boundaries");
    expect(SOUL_TEMPLATE).toContain("## Vibe");
    expect(SOUL_TEMPLATE).toContain("## Continuity");
  });

  it("loadSoulFromWorkspace con sezione Continuity sola", () => {
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "## Continuity\n\nRicorda tutto.");
    const soul = loadSoulFromWorkspace(tmpDir);
    expect(soul).not.toBeNull();
    expect(soul!.continuity).toBe("Ricorda tutto.");
    expect(soul!.coreTruths).toBeUndefined();
  });
});

describe("Identity — normalizzazione e campi", () => {
  it("parsa theme e avatar", () => {
    const content = `- **Theme:** dark\n- **Avatar:** https://example.com/img.png`;
    const id = parseIdentityMarkdown(content);
    expect(id.theme).toBe("dark");
    expect(id.avatar).toBe("https://example.com/img.png");
  });

  it("ignora righe senza due-punti", () => {
    const content = `- **Name:** Bot\nQuesta riga non ha campo\n- **Emoji:** 🤖`;
    const id = parseIdentityMarkdown(content);
    expect(id.name).toBe("Bot");
    expect(id.emoji).toBe("🤖");
  });

  it("ignora valori placeholder con parentesi e formattazione", () => {
    const content = `- **Vibe:** _(how do you come across? sharp? warm? chaotic? calm?)_`;
    const id = parseIdentityMarkdown(content);
    expect(id.vibe).toBeUndefined();
  });

  it("identityHasValues true per singolo campo theme", () => {
    expect(identityHasValues({ theme: "retro" })).toBe(true);
  });

  it("identityHasValues true per singolo campo avatar", () => {
    expect(identityHasValues({ avatar: "data:image/png;base64,abc" })).toBe(true);
  });

  it("loadIdentityFromWorkspace carica dalla directory", () => {
    fs.writeFileSync(path.join(tmpDir, "IDENTITY.md"), "- **Name:** Agent\n- **Vibe:** chill");
    const id = loadIdentityFromWorkspace(tmpDir);
    expect(id).not.toBeNull();
    expect(id!.name).toBe("Agent");
    expect(id!.vibe).toBe("chill");
  });

  it("resolveIdentityName trims whitespace", () => {
    expect(resolveIdentityName({ name: "  Spaced  " })).toBe("Spaced");
  });

  it("resolveIdentityPrefix con nome vuoto ritorna undefined", () => {
    expect(resolveIdentityPrefix({ name: "   " })).toBeUndefined();
  });

  it("IDENTITY_TEMPLATE contiene campi Name, Emoji, Creature", () => {
    expect(IDENTITY_TEMPLATE).toContain("**Name:**");
    expect(IDENTITY_TEMPLATE).toContain("**Emoji:**");
    expect(IDENTITY_TEMPLATE).toContain("**Creature:**");
  });
});

describe("MemoryManager — ordine file e fallback", () => {
  it("loadBootstrapFiles rispetta ordine BOOTSTRAP_FILES", () => {
    fs.writeFileSync(path.join(tmpDir, "TOOLS.md"), "# Tools");
    fs.writeFileSync(path.join(tmpDir, "SOUL.md"), "## Vibe\nOk");
    const files = loadBootstrapFiles(tmpDir);
    const names = files.map((f) => f.name);
    const soulIdx = names.indexOf("SOUL.md");
    const toolsIdx = names.indexOf("TOOLS.md");
    expect(soulIdx).toBeLessThan(toolsIdx);
  });

  it("loadBootstrapFiles fallback memory.md minuscolo", () => {
    fs.writeFileSync(path.join(tmpDir, "memory.md"), "# Ricordi\n- appunto");
    const files = loadBootstrapFiles(tmpDir);
    expect(files.some((f) => f.content.includes("Ricordi"))).toBe(true);
  });

  it("ensureTemplates ritorna array nomi creati", () => {
    const dir = path.join(tmpDir, "new-ws");
    const created = ensureTemplates(dir);
    expect(created).toContain("SOUL.md");
    expect(created).toContain("IDENTITY.md");
    expect(created.length).toBe(2);
  });

  it("loadAgentMemory senza file ritorna null per soul e identity", () => {
    const dir = path.join(tmpDir, "no-soul");
    fs.mkdirSync(dir, { recursive: true });
    const ctx = loadAgentMemory({ workspaceDir: dir });
    expect(ctx.soul).toBeNull();
    expect(ctx.identity).toBeNull();
    expect(ctx.files).toEqual([]);
  });

  it("hasMemoryFiles rileva USER.md e AGENTS.md", () => {
    const dir = path.join(tmpDir, "extra");
    fs.mkdirSync(dir, { recursive: true });
    expect(hasMemoryFiles(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, "USER.md"), "# User");
    expect(hasMemoryFiles(dir)).toBe(true);
    expect(listMemoryFiles(dir)).toEqual(["USER.md"]);
  });

  it("listMemoryFiles elenca tutti i 6 tipi se presenti", () => {
    for (const name of ["SOUL.md", "IDENTITY.md", "MEMORY.md", "AGENTS.md", "USER.md", "TOOLS.md"]) {
      fs.writeFileSync(path.join(tmpDir, name), `# ${name}`);
    }
    const list = listMemoryFiles(tmpDir);
    expect(list.length).toBe(6);
  });
});
