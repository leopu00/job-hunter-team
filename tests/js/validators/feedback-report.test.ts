/**
 * Validazione e resa delle segnalazioni in arrivo da /api/feedback.
 *
 * Il valore di questi test è quasi tutto negativo: dicono cosa NON deve
 * finire dentro una issue pubblica (contatto dell'utente, credenziali,
 * menzioni che notificano estranei) e cosa NON deve passare la porta
 * (payload malformati, campi vuoti, testi smisurati).
 */
import { describe, it, expect } from "vitest";
import {
  sembraSpam,
  emailSubject,
  emailText,
  issueBody,
  issueTitle,
  neutralize,
  newTicket,
  parseReport,
  replyToSicuro,
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
  contact: "mario@rossi.it",
  diagnostics: "### App\n\n- versione: 0.2.1\n",
};

describe("parseReport — cosa entra", () => {
  it("accetta un payload completo", () => {
    const report = parseReport(VALID);
    expect(report).not.toBeNull();
    expect(report!.platform).toBe("macOS");
    expect(report!.contact).toBe("mario@rossi.it");
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
    expect(neutralize("scritto da mario@rossi.it")).toContain("rossi.it");
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

  it("NON contiene il contatto dell'utente", () => {
    // Finirebbe su una pagina pubblica indicizzabile: il contatto viaggia
    // sul canale privato, la issue dice solo che esiste.
    expect(body).not.toContain("mario@rossi.it");
    expect(body).toContain("contatto allegato");
  });

  it("dice esplicitamente quando non c'è modo di rispondere", () => {
    const anon = issueBody(parseReport({ ...VALID, contact: "" })!, "JHT-X");
    expect(anon).toContain("nessun contatto lasciato");
  });

  it("redige le credenziali incollate nel racconto", () => {
    const token = "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";
    const dirty = parseReport({
      ...VALID,
      happened: `ho usato ${token} e non va`,
    })!;
    const out = issueBody(dirty, "JHT-X");
    expect(out).not.toContain(token);
    expect(out).toContain("[github-token]");
  });

  it("redige i dati personali della diagnostica", () => {
    const dirty = parseReport({
      ...VALID,
      diagnostics: "log in /Users/mariorossi/.jht · ssh 65.108.14.22",
    })!;
    const out = issueBody(dirty, "JHT-X");
    expect(out).not.toContain("mariorossi");
    expect(out).not.toContain("65.108.14.22");
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

describe("email — la segnalazione che arriva in casella", () => {
  const report = parseReport(VALID)!;

  it("mette il riferimento nell'oggetto, per ritrovarla", () => {
    expect(emailSubject(report, "JHT-9Z")).toContain("JHT-9Z");
    expect(emailSubject(report, "JHT-9Z")).toContain("collegamento");
  });

  it("non produce un oggetto smisurato", () => {
    const lungo = parseReport({ ...VALID, happened: "x".repeat(500) })!;
    expect(emailSubject(lungo, "JHT-9Z").length).toBeLessThanOrEqual(95);
  });

  it("il contatto QUI c'e': la casella e' privata, la issue no", () => {
    const testo = emailText(report, "JHT-9Z");
    expect(testo).toContain("mario@rossi.it");
    expect(testo).toContain("RISPONDI A");
  });

  it("dice chiaramente quando non si puo' rispondere", () => {
    const anon = parseReport({ ...VALID, contact: "" })!;
    expect(emailText(anon, "JHT-9Z")).toContain("nessun contatto lasciato");
  });

  it("redige comunque i segreti e i dati personali della diagnostica", () => {
    const token = "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";
    const sporco = parseReport({
      ...VALID,
      happened: `ho incollato ${token}`,
      diagnostics: "path /Users/mariorossi/.jht · ssh 65.108.14.22",
    })!;
    const testo = emailText(sporco, "JHT-9Z");
    expect(testo).not.toContain(token);
    expect(testo).not.toContain("mariorossi");
    expect(testo).not.toContain("65.108.14.22");
  });
});

describe("replyToSicuro — header injection", () => {
  it("accetta un indirizzo normale", () => {
    expect(replyToSicuro(" mario@rossi.it ")).toBe("mario@rossi.it");
  });

  it("rifiuta gli a-capo, che inietterebbero header nella mail", () => {
    // Il contatto arriva da un campo libero di un client pubblico: un \r\n
    // dentro il valore permetterebbe di aggiungere Bcc arbitrari.
    expect(replyToSicuro("a@b.it\r\nBcc: vittima@x.it")).toBe("");
    expect(replyToSicuro("a@b.it\nBcc: vittima@x.it")).toBe("");
  });

  it("rifiuta le forme che non sono un indirizzo", () => {
    for (const brutto of [
      "",
      "non-una-mail",
      "a@b",
      "<a@b.it>",
      "a b@c.it",
      "a@b.it, c@d.it",
    ]) {
      expect(replyToSicuro(brutto)).toBe("");
    }
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
