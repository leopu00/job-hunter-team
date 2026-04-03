import { describe, it, expect } from "vitest";
import {
  hasVariables, substituteVariables, extractVariableNames,
  createSection, formatContextFile, formatContextFiles,
  composePrompt, renderTemplate,
} from "../../../shared/templates/template-engine.js";

describe("hasVariables", () => {
  it("rileva variabili {var} nel testo", () => {
    expect(hasVariables("Ciao {nome}!")).toBe(true);
    expect(hasVariables("Nessuna variabile")).toBe(false);
  });
});

describe("substituteVariables", () => {
  it("sostituisce variabili presenti", () => {
    const result = substituteVariables("Ciao {nome}, sei {ruolo}", { nome: "Max", ruolo: "backend" });
    expect(result).toBe("Ciao Max, sei backend");
  });

  it("case-insensitive sulla chiave", () => {
    const result = substituteVariables("{NOME} {Ruolo}", { nome: "Max", ruolo: "dev" });
    expect(result).toBe("Max dev");
  });

  it("lascia invariate variabili non risolte", () => {
    const result = substituteVariables("{nome} {cognome}", { nome: "Max" });
    expect(result).toBe("Max {cognome}");
  });

  it("ignora valori undefined", () => {
    const result = substituteVariables("{a} {b}", { a: undefined, b: "ok" });
    expect(result).toBe("{a} ok");
  });
});

describe("extractVariableNames", () => {
  it("estrae tutti i nomi di variabile", () => {
    const names = extractVariableNames("{nome} testo {ruolo} e {nome}");
    expect(names).toContain("nome");
    expect(names).toContain("ruolo");
    expect(names).toHaveLength(2);
  });
});

describe("createSection", () => {
  it("crea sezione con priorità default 50", () => {
    const s = createSection("intro", "contenuto");
    expect(s.id).toBe("intro");
    expect(s.content).toBe("contenuto");
    expect(s.priority).toBe(50);
  });

  it("accetta priorità e label personalizzati", () => {
    const s = createSection("system", "testo", 90, "Sistema");
    expect(s.priority).toBe(90);
    expect(s.label).toBe("Sistema");
  });
});

describe("formatContextFile", () => {
  it("formatta context file come tag XML", () => {
    const result = formatContextFile({ path: "test.md", content: "contenuto" });
    expect(result).toContain('<context-file path="test.md">');
    expect(result).toContain("contenuto");
    expect(result).toContain("</context-file>");
  });
});

describe("formatContextFiles", () => {
  it("formatta multipli context files", () => {
    const result = formatContextFiles([
      { path: "a.md", content: "A" },
      { path: "b.md", content: "B" },
    ]);
    expect(result).toContain("a.md");
    expect(result).toContain("b.md");
  });

  it("ritorna stringa vuota per lista vuota", () => {
    expect(formatContextFiles([])).toBe("");
  });
});

describe("composePrompt", () => {
  it("compone sezioni ordinate per priorità decrescente", () => {
    const result = composePrompt({
      sections: [
        createSection("low", "Bassa", 10),
        createSection("high", "Alta", 90),
        createSection("mid", "Media", 50),
      ],
    });
    expect(result.text.indexOf("Alta")).toBeLessThan(result.text.indexOf("Media"));
    expect(result.text.indexOf("Media")).toBeLessThan(result.text.indexOf("Bassa"));
    expect(result.sectionCount).toBe(3);
  });

  it("rispetta budget maxChars escludendo sezioni bassa priorità", () => {
    const result = composePrompt({
      maxChars: 50,
      sections: [
        createSection("a", "A".repeat(30), 90),
        createSection("b", "B".repeat(30), 10),
      ],
    });
    expect(result.includedSections).toContain("a");
    expect(result.charCount).toBeLessThanOrEqual(50);
  });

  it("mode minimal include solo priorità >= 80", () => {
    const result = composePrompt({
      mode: "minimal",
      sections: [
        createSection("sys", "Sistema", 90),
        createSection("extra", "Extra", 30),
      ],
    });
    expect(result.includedSections).toContain("sys");
    expect(result.includedSections).not.toContain("extra");
  });

  it("mode none ritorna vuoto", () => {
    const result = composePrompt({
      mode: "none",
      sections: [createSection("a", "testo", 90)],
    });
    expect(result.sectionCount).toBe(0);
  });

  it("applica variabili alle sezioni", () => {
    const result = composePrompt({
      sections: [createSection("greet", "Ciao {nome}!", 50)],
      variables: { nome: "Max" },
    });
    expect(result.text).toContain("Ciao Max!");
  });

  it("include context files se dentro budget", () => {
    const result = composePrompt({
      contextFiles: [{ path: "info.md", content: "info" }],
    });
    expect(result.includedSections).toContain("context-files");
  });
});

describe("renderTemplate", () => {
  it("shortcut per sostituzione variabili", () => {
    const result = renderTemplate("Agente: {agente}", { agente: "scout" });
    expect(result).toBe("Agente: scout");
  });
});
