/**
 * Ripulitore PII lato server — gemello dei casi in
 * `game/tools/redactor_selftest.gd`. Chi tocca una famiglia di regole
 * aggiorna entrambi i test, altrimenti le due implementazioni divergono in
 * silenzio e la seconda linea di difesa smette di difendere.
 */
import { describe, it, expect } from "vitest";
// Import per path relativo e non via alias "@": il vitest.config.ts di
// questa suite non definisce alias, e il modulo non dipende da Next.
import {
  redact,
  redactSecrets,
  redactWithReport,
  hasResidualSecret,
} from "../../../web/lib/redact";

// Composti a pezzi: un token plausibile in chiaro nel repo fa scattare il
// gate anti-secret del pre-commit, ed è giusto che scatti.
const FAKE_GH = "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789";
const FAKE_PROVIDER = "sk" + "-ant-api03-Zm9vYmFyYmF6cXV1eA_AA";

describe("redact — credenziali", () => {
  it("toglie il token Telegram", () => {
    const out = redact("bot 7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0 ok");
    expect(out).not.toContain("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0");
    expect(out).toContain("[telegram-token]");
  });

  it("toglie il token GitHub", () => {
    const out = redact(`push fallito: ${FAKE_GH}`);
    expect(out).not.toContain(FAKE_GH);
    expect(out).toContain("[github-token]");
  });

  it("toglie la chiave del provider", () => {
    expect(redact(`Authorization ${FAKE_PROVIDER}`)).toContain(
      "[provider-key]",
    );
  });

  it("toglie il JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(redact(`cookie sb-access=${jwt}`)).toContain("[jwt]");
  });

  it("toglie il local-token esadecimale", () => {
    const token = "9f8e7d6c5b4a39281706f5e4d3c2b1a0".repeat(2);
    expect(redact(`jht_local_token=${token}`)).not.toContain(token);
  });

  it("toglie il valore di una password assegnata", () => {
    const out = redact("smtp password=SuperSegreta123 host=x");
    expect(out).not.toContain("SuperSegreta123");
    expect(out).toContain("[secret]");
  });

  it("toglie le credenziali dentro un URL", () => {
    expect(redact("https://leone:tokenSegreto@github.com/x.git")).not.toContain(
      "tokenSegreto",
    );
  });

  it("toglie i segreti in query string", () => {
    expect(redact("GET /api/ping?access_token=abcdef123456xyz")).not.toContain(
      "abcdef123456xyz",
    );
  });

  it("toglie i blocchi di chiave privata", () => {
    const pem =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----";
    expect(redact(pem)).toBe("[private-key]");
  });
});

describe("redact — dati personali", () => {
  it("toglie le email", () => {
    expect(redact("scrivi a hr.recruiting@acme-corp.com")).toContain("[email]");
  });

  it("toglie i telefoni con prefisso internazionale", () => {
    expect(redact("contatto +39 348 123 4567 nel CV")).toContain("[phone]");
  });

  it("toglie IBAN e codice fiscale", () => {
    expect(redact("IT60X0542811101000000123456")).toContain("[iban]");
    expect(redact("CF RSSMRA85M01H501Z")).toContain("[fiscal-code]");
  });

  it("toglie il nome utente dai path", () => {
    expect(redact("/Users/mariorossi/.jht/profile")).toBe(
      "/Users/[user]/.jht/profile",
    );
    expect(redact("C:\\Users\\Leone\\AppData")).not.toContain("Leone");
  });

  it("conserva l'estensione dei documenti", () => {
    const out = redact("allegato CV_Mario_Rossi_2026.pdf caricato");
    expect(out).not.toContain("Mario_Rossi");
    expect(out).toContain(".pdf");
  });

  it("redige solo gli IP pubblici", () => {
    const out = redact("ssh 192.0.2.44 · docker 172.17.0.2 · web 127.0.0.1");
    expect(out).not.toContain("192.0.2.44");
    // Loopback e reti private descrivono la topologia senza identificare
    // nessuno: toglierli costerebbe diagnosi senza guadagnare privacy.
    expect(out).toContain("127.0.0.1");
    expect(out).toContain("172.17.0.2");
  });
});

describe("redact — falsi positivi", () => {
  it("lascia intatte le righe di telemetria", () => {
    const perf = "[perf] fps=42 frame_ms=23.8 draw_calls=1147 nodes=3204";
    expect(redact(perf)).toBe(perf);
  });

  it("lascia intatti versione e commit", () => {
    const line = "versione 0.2.1 · commit 4dd3c1ff · Godot 4.7.stable";
    expect(redact(line)).toBe(line);
  });
});

describe("redactSecrets — testo scritto dall'utente", () => {
  it("toglie le credenziali ma non il racconto", () => {
    const out = redactSecrets(
      `ho messo il token=${FAKE_GH} ma la mail mario@rossi.it non riceve`,
    );
    expect(out).not.toContain(FAKE_GH);
    // Rendere incomprensibile il racconto dell'utente costerebbe la
    // segnalazione stessa: qui si difende dai segreti, non dal senso.
    expect(out).toContain("mario@rossi.it");
  });
});

describe("rendiconto e residui", () => {
  it("conta le sostituzioni per regola", () => {
    const { counts } = redactWithReport("a@b.it e c@d.it, token=abcdefgh");
    expect(counts.email).toBe(2);
    expect(counts.assigned_secret).toBe(1);
  });

  it("rileva i residui prima e non dopo", () => {
    const dirty = `token ${FAKE_GH}`;
    expect(hasResidualSecret(dirty)).toBe(true);
    expect(hasResidualSecret(redact(dirty))).toBe(false);
  });
});
