/**
 * Non si dichiara successo quando il lavoro non è stato fatto.
 *
 * Non è un rilievo isolato ma un'abitudine di questo repository, e
 * l'operatore l'ha nominata come tale: il wrapper PowerShell che usciva 0
 * senza copiare, `jht download --version` che usciva 0 senza scaricare, il
 * banner cookie che offriva una scelta senza spegnere gli analytics, la
 * segnalazione «arrivata al supporto» consegnata solo a un webhook, e
 * l'export parziale servito come allegato con HTTP 200.
 *
 * Questi test sorvegliano i punti del web dove quella tentazione si
 * ripresenta. Sono asserzioni sul SORGENTE di proposito: il modo in cui il
 * comportamento ottimista torna è che qualcuno rimetta il ramo permissivo
 * — e quello compila benissimo.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../../web");

const read = (p: string) => fs.readFileSync(path.join(WEB, p), "utf8");

describe("un export incompleto non è un successo", () => {
  const route = read("app/api/account/export/route.ts");

  it("con una tabella fallita non risponde 200 né allega un file", () => {
    // La forma da non ripristinare: raccogliere i fallimenti in un campo
    // del payload e consegnare comunque l'allegato.
    expect(route).toContain("export_incomplete");
    expect(route).toContain("status: 503");
    // Il campo `incomplete` dentro il JSON era il modo elegante di
    // nascondere il problema: un dettaglio che nessuno legge.
    expect(route.includes("incomplete: failed")).toBe(false);
  });

  it("il ramo di fallimento precede la costruzione dell'allegato", () => {
    const guard = route.indexOf("failed.length > 0");
    const attachment = route.indexOf("Content-Disposition");
    expect(guard).toBeGreaterThan(-1);
    expect(attachment).toBeGreaterThan(-1);
    expect(guard, "il 503 deve venire prima dell'allegato").toBeLessThan(
      attachment,
    );
  });
});

describe("una segnalazione non consegnata non è un successo", () => {
  const dispatch = read("lib/feedback-dispatch.ts");
  const route = read("app/api/feedback/route.ts");

  it("la posta decide da sola, e il webhook non la sostituisce", () => {
    expect(dispatch).toContain("delivered: false");
    // La forma da non ripristinare: due canali in parallelo e ok se ne
    // riesce almeno uno.
    //
    // Si cerca la CHIAMATA, non la parola: `Promise.all` compare anche nel
    // commento che spiega perché è stata tolta, e un match ingenuo lo
    // scambia per il difetto. Ci sono cascato due volte in questo lotto,
    // qui e col `select("*")` dell'export.
    expect(dispatch.includes("await Promise.all")).toBe(false);
    expect(route.includes("await Promise.all")).toBe(false);
  });

  it("senza posta la route risponde 503", () => {
    expect(route).toContain("outcome.delivered");
    expect(route).toContain("status: 503");
  });
});

describe("una cancellazione parziale non è una cancellazione", () => {
  const del = read("lib/account-deletion.ts");

  it("un file rimasto ferma la cancellazione invece di completarla", () => {
    expect(del).toContain("storage.failed.length > 0");
    // Il tipo dell'errore è cambiato in `DeletionError` per non far
    // uscire percorsi: qui conta che si INTERROMPA, non come si chiama.
    expect(del).toMatch(/throw new (Deletion)?Error/);
  });

  it("l'enumerazione dei file scende nelle cartelle", () => {
    // Fermarsi al primo livello significa non trovare i file veri, che
    // stanno in `${userId}/${requestId}/${nome}`, e credere di aver
    // cancellato tutto.
    expect(del).toContain("listRecursive");
    expect(del).toMatch(/id === null/);
  });

  it("oltre il limite si ferma invece di cancellare una parte", () => {
    expect(del).toContain("STORAGE_TOTAL_LIMIT");
    expect(del).toMatch(/budget\.left <= 0/);
  });
});

describe("il consenso non si presume", () => {
  const layout = read("app/layout.tsx");
  const gate = read("app/components/ConsentedAnalytics.tsx");

  it("la misurazione resta dietro un consenso esplicito", () => {
    expect(layout.includes("@vercel/analytics")).toBe(false);
    expect(gate).toContain('=== "accepted"');
  });
});
