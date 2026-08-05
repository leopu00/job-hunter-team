/**
 * Validazione e resa delle segnalazioni in arrivo da /api/feedback.
 *
 * Il valore di questi test è quasi tutto negativo: dicono cosa NON deve
 * finire dentro una issue pubblica (contatto dell'utente, credenziali,
 * menzioni che notificano estranei) e cosa NON deve passare la porta
 * (payload malformati, campi vuoti, testi smisurati).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  sembraSpam,
  emailSubject,
  emailText,
  issueBody,
  issueTitle,
  neutralize,
  newTicket,
  parseReport,
  MAX_STORY_CHARS,
} from "../../../web/lib/feedback-report";

const VALID = {
  client: "godot-desktop",
  app_version: "0.2.1",
  locale: "it",
  platform: "macOS",
  doing: "attivavo il team",
  happened: "la schermata è rimasta ferma su collegamento",
  expected: "che partisse",
  diagnostics: "### App\n\n- versione: 0.2.1\n",
};
const FEEDBACK_ROUTE = readFileSync(
  path.resolve(__dirname, "../../../web/app/api/feedback/route.ts"),
  "utf8",
);

describe("parseReport — cosa entra", () => {
  it("accetta un payload completo", () => {
    const report = parseReport(VALID);
    expect(report).not.toBeNull();
    expect(report!.platform).toBe("macOS");
    expect(report!.client).toBe("godot-desktop");
  });

  it("rifiuta payload non oggetto", () => {
    for (const bad of [null, "stringa", 42, [], undefined]) {
      expect(parseReport(bad)).toBeNull();
    }
  });

  it("rifiuta la segnalazione senza racconto", () => {
    expect(parseReport({ ...VALID, happened: "" })).toBeNull();
    expect(parseReport({ ...VALID, happened: "no" })).toBeNull();
  });

  it("accetta anche quando solo il racconto è compilato", () => {
    const report = parseReport({ happened: "si è chiuso tutto da solo" });
    expect(report).not.toBeNull();
    expect(report!.doing).toBe("");
    expect(report!.client).toBe("unknown");
  });

  it("ignora i campi di tipo sbagliato invece di esplodere", () => {
    const report = parseReport({
      ...VALID,
      doing: { nested: true },
      locale: 5,
    });
    expect(report!.doing).toBe("");
    expect(report!.locale).toBe("it");
  });

  it("tronca i testi smisurati", () => {
    const report = parseReport({ ...VALID, happened: "x".repeat(50_000) });
    expect(report!.happened.length).toBe(MAX_STORY_CHARS);
  });
});

describe("neutralize — la issue non deve spammare estranei", () => {
  it("spezza le menzioni", () => {
    const out = neutralize("grazie @octocat per l'aiuto");
    expect(out).not.toContain("@octocat");
    expect(out).toContain("octocat");
  });

  it("spezza i riferimenti a issue", () => {
    expect(neutralize("come in #1234")).not.toContain("#1234");
  });

  it("non rompe il blocco di codice che racchiude i log", () => {
    expect(neutralize("```rm -rf```")).not.toContain("```");
  });

  it("lascia stare le email, che non sono menzioni", () => {
    // La chiocciola di un'email non notifica nessuno su GitHub: qui serve
    // solo che il testo resti leggibile.
    expect(neutralize("scritto da mario@example.com")).toContain("example.com");
  });
});

describe("issueBody — cosa esce", () => {
  const report = parseReport(VALID)!;
  const body = issueBody(report, "JHT-TEST");

  it("riporta il riferimento e le tre domande", () => {
    expect(body).toContain("JHT-TEST");
    expect(body).toContain("### Cosa stavo facendo");
    expect(body).toContain("### Cosa è successo");
    expect(body).toContain("### Cosa mi aspettavo");
  });

  it("NON contiene un contatto ricevuto da un client vecchio", () => {
    const legacy = parseReport({ ...VALID, contact: "mario@example.com" })!;
    const legacyBody = issueBody(legacy, "JHT-TEST");
    // Finirebbe su una pagina pubblica indicizzabile: il server lo ignora.
    expect(legacyBody).not.toContain("mario@example.com");
    expect(legacyBody).toContain("non include contatti");
  });

  it("dichiara che non trasporta contatti", () => {
    expect(body).toContain("non include contatti");
  });

  it("redige credenziali e dati personali incollati nel racconto", () => {
    const token = "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";
    const dirty = parseReport({
      ...VALID,
      happened: `ho usato ${token}, scrivetemi a mario@example.com e non va`,
    })!;
    const out = issueBody(dirty, "JHT-X");
    expect(out).not.toContain(token);
    expect(out).toContain("[github-token]");
    expect(out).not.toContain("mario@example.com");
  });

  it("redige i dati personali della diagnostica", () => {
    const dirty = parseReport({
      ...VALID,
      diagnostics: "log in /Users/testuser/.jht · ssh 203.0.113.42",
    })!;
    const out = issueBody(dirty, "JHT-X");
    expect(out).not.toContain("testuser");
    expect(out).not.toContain("203.0.113.42");
  });

  it("piega la diagnostica in un blocco richiudibile", () => {
    expect(body).toContain("<details>");
  });

  it("omette il blocco quando non c'è diagnostica", () => {
    const bare = issueBody(
      parseReport({ ...VALID, diagnostics: "" })!,
      "JHT-X",
    );
    expect(bare).not.toContain("<details>");
  });
});

describe("titolo e riferimento", () => {
  it("usa la prima riga del racconto", () => {
    const report = parseReport({ ...VALID, happened: "primo\nsecondo" })!;
    expect(issueTitle(report)).toBe("[in-app] primo");
  });

  it("non produce un titolo lunghissimo", () => {
    const report = parseReport({ ...VALID, happened: "x".repeat(500) })!;
    expect(issueTitle(report).length).toBeLessThanOrEqual(100);
  });

  it("il riferimento è ripetibile a voce", () => {
    const ticket = newTicket(1_700_000_000_000);
    expect(ticket).toMatch(/^JHT-[0-9A-Z]+$/);
  });
});

describe("email — la segnalazione anonima che arriva in casella", () => {
  const report = parseReport(VALID)!;

  it("mette il riferimento nell'oggetto, per ritrovarla", () => {
    expect(emailSubject(report, "JHT-9Z")).toContain("JHT-9Z");
    expect(emailSubject(report, "JHT-9Z")).toContain("collegamento");
  });

  it("non produce un oggetto smisurato", () => {
    const lungo = parseReport({ ...VALID, happened: "x".repeat(500) })!;
    expect(emailSubject(lungo, "JHT-9Z").length).toBeLessThanOrEqual(95);
  });

  it("non include il contatto ricevuto da un client vecchio", () => {
    const legacy = parseReport({ ...VALID, contact: "mario@example.com" })!;
    expect(emailText(legacy, "JHT-9Z")).not.toContain("mario@example.com");
  });

  it("redige comunque i segreti e i dati personali della diagnostica", () => {
    const token = "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";
    const sporco = parseReport({
      ...VALID,
      happened: `ho incollato ${token}`,
      diagnostics: "path /Users/testuser/.jht · ssh 203.0.113.42",
    })!;
    const testo = emailText(sporco, "JHT-9Z");
    expect(testo).not.toContain(token);
    expect(testo).not.toContain("testuser");
    expect(testo).not.toContain("203.0.113.42");
  });
});

describe("privacy del contratto", () => {
  it("ignora contact e normalizza metadata non in allowlist", () => {
    const report = parseReport({
      ...VALID,
      contact: "mario@example.com",
      client: "Mario Laptop",
      app_version: "Mario 1.0",
      platform: "MarioOS",
      locale: "mario",
      kind: "Mario",
    })!;
    expect(JSON.stringify(report)).not.toContain("mario@example.com");
    expect(report).toMatchObject({
      client: "unknown",
      appVersion: "unknown",
      platform: "unknown",
      locale: "it",
      kind: "",
    });
  });

  it("non ha alcun ramo di delivery che reintroduce contact", () => {
    expect(FEEDBACK_ROUTE).not.toContain("reply_to");
    expect(FEEDBACK_ROUTE).not.toMatch(/\bcontact\s*:/);
    expect(FEEDBACK_ROUTE).toContain("redact(");
  });

  it("esclude le sonde honeypot prima del rate limit", () => {
    expect(FEEDBACK_ROUTE.indexOf("if (sembraSpam(parsed))")).toBeLessThan(
      FEEDBACK_ROUTE.indexOf("const rl = await checkRateLimit"),
    );
  });

  it("conserva soltanto le categorie web previste", () => {
    const report = parseReport({
      ...VALID,
      kind: "supporto",
      platform: "web",
    })!;
    expect(report).toMatchObject({ kind: "supporto", platform: "Web" });
  });

  it("redige anche la diagnostica di un client non aggiornato", () => {
    const report = parseReport({
      ...VALID,
      diagnostics: "profilo /Users/testuser/CV.pdf, mail mario@example.com",
    })!;
    expect(report.diagnostics).not.toContain("testuser");
    expect(report.diagnostics).not.toContain("mario@example.com");
  });

  it("non inoltra il nome che un vecchio modulo pubblico metteva in doing", () => {
    const report = parseReport({
      ...VALID,
      client: "web-contact",
      doing: "Modulo di contatto — Mario Rossi",
      contact: "mario@example.com",
    })!;
    const delivered = `${emailText(report, "JHT-9Z")}\n${issueBody(report, "JHT-9Z")}`;
    expect(report.doing).toBe("Modulo di contatto web");
    expect(delivered).not.toContain("Mario Rossi");
    expect(delivered).not.toContain("mario@example.com");
  });
});

describe("modulo di contatto del sito", () => {
  it("il tipo compare in oggetto, per smistare a colpo d'occhio", () => {
    const domanda = parseReport({ ...VALID, kind: "domanda" })!;
    expect(emailSubject(domanda, "JHT-1")).toContain("(domanda)");
  });

  it("senza tipo l'oggetto resta pulito", () => {
    expect(emailSubject(parseReport(VALID)!, "JHT-1")).not.toContain("(");
  });

  it("riconosce il campo trappola compilato", () => {
    expect(sembraSpam({ ...VALID, website: "http://spam.example" })).toBe(true);
  });

  it("non scambia per spam un invio umano", () => {
    // Il campo esiste ma resta vuoto: e' quello che fa un browser vero.
    expect(sembraSpam({ ...VALID, website: "" })).toBe(false);
    expect(sembraSpam(VALID)).toBe(false);
    expect(sembraSpam(null)).toBe(false);
  });
});

describe("oggetto scritto da chi invia", () => {
  it("vince sul troncamento automatico del messaggio", () => {
    const r = parseReport({ ...VALID, subject: "Non parte il team su Windows" })!;
    expect(emailSubject(r, "JHT-1")).toBe(
      "[JHT-1] Non parte il team su Windows",
    );
  });

  it("senza oggetto si ripiega sulla prima riga", () => {
    const r = parseReport(VALID)!;
    expect(emailSubject(r, "JHT-1")).toContain("collegamento");
  });

  it("non lascia passare un oggetto smisurato", () => {
    const r = parseReport({ ...VALID, subject: "x".repeat(400) })!;
    expect(r.subject.length).toBe(120);
  });
});
