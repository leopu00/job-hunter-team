import { describe, expect, it } from "vitest";
import { EMOTIONS, splitEmotion } from "./assistant-emotion";

describe("the mood tag of an agent's message", () => {
  it("takes a leading tag of the closed list out of the text and says which it was", () => {
    for (const emotion of EMOTIONS) {
      expect(splitEmotion(`[${emotion}] Ciao, come stai?`)).toEqual({ emotion, text: "Ciao, come stai?" });
    }
    expect(splitEmotion("[caldo]Senza spazio")).toEqual({ emotion: "caldo", text: "Senza spazio" });
    expect(splitEmotion("  [divertito]   Con spazi")).toEqual({ emotion: "divertito", text: "Con spazi" });
    expect(splitEmotion("[caldo] Riga uno\n\nRiga due")).toEqual({ emotion: "caldo", text: "Riga uno\n\nRiga due" });
  });

  it("leaves everything else as it was written, with no emotion", () => {
    for (const text of [
      "Nessun tag qui", "", "[Caldo] maiuscola", "[CALDO] maiuscole", "[triste] fuori lista", "[] vuoto", "[caldo caldo] due",
      "Ciao [caldo] in mezzo", "[caldo", "caldo] rotto", "[caldo2] cifra", "[ caldo ] spazi dentro", "(caldo) tonde",
    ]) {
      expect(splitEmotion(text), text).toEqual({ emotion: null, text });
    }
  });

  it("takes out ONE tag only: a second one stays text", () => {
    expect(splitEmotion("[caldo] [severo] due tag")).toEqual({ emotion: "caldo", text: "[severo] due tag" });
  });

  it("does not eat a message that is only a tag (the text is empty, the emotion is kept)", () => {
    expect(splitEmotion("[sorpreso]")).toEqual({ emotion: "sorpreso", text: "" });
  });

  it("does not confuse a markdown link or a checklist with a tag", () => {
    for (const text of ["[x] fatto", "[link](https://example.invalid) testo", "[1] nota", "[neutro](x) link"]) {
      expect(splitEmotion(text), text).toEqual({ emotion: null, text });
    }
  });
});
