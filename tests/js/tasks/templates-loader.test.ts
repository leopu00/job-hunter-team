import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFrontmatter, loadTemplate, loadTemplateCached,
  loadTemplatesFromDir, isBootstrapFile, templateToContextFile,
  templatesToContextFiles, truncateContent, clearTemplateCache,
} from "../../../shared/templates/template-loader.js";

let tmpDir: string;

beforeEach(() => {
  clearTemplateCache();
  tmpDir = mkdtempSync(join(tmpdir(), "jht-templates-"));
});

describe("parseFrontmatter", () => {
  it("parsa frontmatter YAML tra delimitatori ---", () => {
    const raw = `---\ntitle: Test\nsummary: Un test\n---\nContenuto qui.`;
    const { frontmatter, content } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe("Test");
    expect(frontmatter.summary).toBe("Un test");
    expect(content).toBe("Contenuto qui.");
  });

  it("ritorna content integro se nessun frontmatter", () => {
    const { frontmatter, content } = parseFrontmatter("Solo testo");
    expect(frontmatter).toEqual({});
    expect(content).toBe("Solo testo");
  });

  it("gestisce frontmatter con valori tra virgolette", () => {
    const raw = `---\ntitle: "Quoted Title"\n---\nBody`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe("Quoted Title");
  });
});

describe("loadTemplate", () => {
  it("carica template .md da file", () => {
    const file = join(tmpDir, "test.md");
    writeFileSync(file, "---\ntitle: Demo\n---\nBody del template", "utf-8");
    const t = loadTemplate(file);
    expect(t).not.toBeNull();
    expect(t!.name).toBe("test.md");
    expect(t!.frontmatter.title).toBe("Demo");
    expect(t!.content).toBe("Body del template");
  });

  it("ritorna null per file inesistente", () => {
    expect(loadTemplate(join(tmpDir, "nope.md"))).toBeNull();
  });

  it("ritorna null per file vuoto", () => {
    const file = join(tmpDir, "empty.md");
    writeFileSync(file, "", "utf-8");
    expect(loadTemplate(file)).toBeNull();
  });
});

describe("loadTemplateCached", () => {
  it("usa cache per caricamenti successivi", () => {
    const file = join(tmpDir, "cached.md");
    writeFileSync(file, "---\ntitle: Cached\n---\nContenuto", "utf-8");
    const a = loadTemplateCached(file);
    const b = loadTemplateCached(file);
    expect(a).toBe(b);
  });
});

describe("loadTemplatesFromDir", () => {
  it("carica tutti i .md dalla directory", () => {
    writeFileSync(join(tmpDir, "a.md"), "---\ntitle: A\n---\nA", "utf-8");
    writeFileSync(join(tmpDir, "b.md"), "---\ntitle: B\n---\nB", "utf-8");
    writeFileSync(join(tmpDir, "c.txt"), "non un md", "utf-8");
    const templates = loadTemplatesFromDir(tmpDir);
    expect(templates).toHaveLength(2);
  });

  it("ritorna lista vuota per directory inesistente", () => {
    expect(loadTemplatesFromDir(join(tmpDir, "nope"))).toEqual([]);
  });
});

describe("isBootstrapFile", () => {
  it("riconosce file bootstrap noti", () => {
    expect(isBootstrapFile("SOUL.md")).toBe(true);
    expect(isBootstrapFile("IDENTITY.md")).toBe(true);
    expect(isBootstrapFile("random.md")).toBe(false);
  });
});

describe("truncateContent", () => {
  it("non tronca se sotto il limite", () => {
    expect(truncateContent("breve", 100)).toBe("breve");
  });

  it("tronca con strategia 70/20/marker", () => {
    const long = "A".repeat(100);
    const result = truncateContent(long, 50);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain("[...contenuto troncato...]");
  });
});

describe("templateToContextFile / templatesToContextFiles", () => {
  it("converte template in ContextFile", () => {
    const file = join(tmpDir, "ctx.md");
    writeFileSync(file, "---\ntitle: Ctx\n---\nDati contesto", "utf-8");
    const t = loadTemplate(file)!;
    const cf = templateToContextFile(t);
    expect(cf.path).toBe(file);
    expect(cf.content).toContain("Dati contesto");
  });

  it("rispetta budget totale in templatesToContextFiles", () => {
    const templates = [];
    for (let i = 0; i < 5; i++) {
      const f = join(tmpDir, `t${i}.md`);
      writeFileSync(f, `---\ntitle: T${i}\n---\n${"X".repeat(100)}`, "utf-8");
      templates.push(loadTemplate(f)!);
    }
    const files = templatesToContextFiles(templates, 250);
    const totalChars = files.reduce((s, f) => s + f.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(250);
  });
});
