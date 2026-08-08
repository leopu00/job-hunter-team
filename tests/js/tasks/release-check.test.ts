/**
 * Test unitari — confronto di versione e controllo release (vitest).
 *
 * [NO-UPDATE-SIGNAL-TO-THE-USER] Un box può stare quattro release indietro
 * per una settimana e ogni sintomo si legge come «il prodotto è rotto»:
 * misurato in produzione il 2026-08-03 su un account attivo, pairato il
 * giorno prima della 0.3.0, con la 0.3.3 già pubblicata.
 *
 * Il modo di sbagliare da temere non è tacere: è **avvisare a sproposito**.
 * Una fascia che dice «aggiorna» a chi è già aggiornato, o che propone di
 * retrocedere dopo una release ritirata, insegna a ignorare l'avviso — e a
 * quel punto il canale che stiamo aprendo torna chiuso, ma con più codice.
 * Quasi tutto quello che segue presidia il silenzio nei casi incerti.
 */
import { describe, it, expect } from "vitest";
import {
  compareVersions,
  latestReleaseInfo,
  parseVersion,
  updateAvailable,
} from "../../../shared/release/version.js";
import {
  cacheFresh,
  fetchLatestRelease,
  RELEASE_CACHE_TTL_MS,
  updateCheckDisabled,
  updateNotice,
} from "../../../cli/src/lib/release-check.js";

const REPO = "leopu00/job-hunter-team";

describe("lettura di una versione", () => {
  it("accetta le forme che pubblichiamo davvero", () => {
    expect(parseVersion("0.3.5")).toEqual([0, 3, 5]);
    expect(parseVersion("v0.3.5")).toEqual([0, 3, 5]);
    expect(parseVersion(" V1.10.0 ")).toEqual([1, 10, 0]);
  });

  it("rifiuta ciò che non sa confrontare", () => {
    // Una stringa illeggibile non deve poter innescare un avviso: meglio
    // nessuna notizia che una notizia inventata.
    for (const bad of ["", "latest", "0.3", "0.3.5-rc.1", null, undefined, 7]) {
      expect(parseVersion(bad as never)).toBeNull();
    }
    expect(parseVersion("9".repeat(64))).toBeNull();
  });
});

describe("confronto e decisione", () => {
  it("ordina per numero, non per stringa", () => {
    // "0.10.0" < "0.9.0" in ordine lessicografico: è la trappola classica,
    // e qui costerebbe un aggiornamento mai proposto.
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.3.5", "0.3.5")).toBe(0);
  });

  it("non propone di retrocedere", () => {
    // Release ritirata, o box su una build di sviluppo più avanti del tag
    // pubblicato: in nessuno dei due casi c'è qualcosa da consigliare.
    expect(updateAvailable("0.3.4", "0.3.5")).toBe(false);
    expect(updateAvailable("0.3.5", "0.3.5")).toBe(false);
    expect(updateAvailable("0.4.0", "0.3.5")).toBe(true);
  });

  it("versioni illeggibili = pari, cioè nessun avviso", () => {
    expect(updateAvailable("latest", "0.3.5")).toBe(false);
    expect(updateAvailable("0.4.0", null)).toBe(false);
  });
});

describe("risposta di GitHub", () => {
  const ok = {
    tag_name: "v0.4.0",
    html_url: `https://github.com/${REPO}/releases/tag/v0.4.0`,
  };

  it("estrae versione e pagina", () => {
    expect(latestReleaseInfo(ok, REPO)).toEqual({
      version: "0.4.0",
      page: `https://github.com/${REPO}/releases/tag/v0.4.0`,
    });
  });

  it("bozze e prerelease non passano", () => {
    expect(latestReleaseInfo({ ...ok, draft: true }, REPO)).toBeNull();
    expect(latestReleaseInfo({ ...ok, prerelease: true }, REPO)).toBeNull();
  });

  it("una pagina fuori dal nostro repo non diventa un link", () => {
    // È un URL che arriva dalla rete e finisce in un link su cui l'utente
    // clicca: se un giorno leggessimo un JSON diverso, non porterebbe
    // comunque altrove.
    const evil = { ...ok, html_url: "https://example.invalid/phish" };
    expect(latestReleaseInfo(evil, REPO)?.page).toBe(
      `https://github.com/${REPO}/releases/latest`,
    );
  });

  it("payload inutilizzabile: nessuna release", () => {
    expect(latestReleaseInfo(null, REPO)).toBeNull();
    expect(latestReleaseInfo({ tag_name: "nightly" }, REPO)).toBeNull();
  });
});

describe("la riga di jht status", () => {
  it("tace quando non c'è niente da dire", () => {
    expect(updateNotice("0.3.5", null)).toBeNull();
    expect(updateNotice("0.3.5", { version: "0.3.5" })).toBeNull();
    expect(updateNotice("0.3.5", { version: "0.3.4" })).toBeNull();
  });

  it("nomina entrambe le versioni e dove si lancia l'aggiornamento", () => {
    const notice = updateNotice("0.3.1", { version: "0.4.0" });
    expect(notice).toMatchObject({ current: "0.3.1", latest: "0.4.0" });
    // Il runtime è un'immagine immutabile: `jht upgrade` dentro il container
    // esce con un errore. Mandare l'utente sull'host è metà del consiglio.
    expect(notice?.command).toBe("jht upgrade");
    expect(notice?.where).toContain("hosts Docker");
  });
});

describe("JHT_UPDATE_CHECK=0 — la stessa leva in tutto il prodotto", () => {
  // Il gioco la onora dalla 0.3.1 (`update_check.gd`, `skip_reason`); il CLI
  // la ignorava. Una leva che funziona in un pezzo del prodotto e non
  // nell'altro non è una leva: chi la mette si aspetta silenzio, e riceve
  // silenzio solo a metà.
  it("il valore 0 spegne, spazi inclusi", () => {
    expect(updateCheckDisabled({ JHT_UPDATE_CHECK: "0" })).toBe(true);
    expect(updateCheckDisabled({ JHT_UPDATE_CHECK: "  0 " })).toBe(true);
  });

  it("nessun altro valore spegne per conto suo", () => {
    // Un interruttore che scatta su una stringa inattesa non è un
    // interruttore. Stessa regola del gioco: solo `0` esatto.
    for (const value of ["1", "false", "no", "", "00", "0.0", undefined]) {
      expect(updateCheckDisabled({ JHT_UPDATE_CHECK: value })).toBe(false);
    }
    expect(updateCheckDisabled({})).toBe(false);
  });

  it("spento vuol dire nessuna rete E nessuna cache", () => {
    // Chi mette questa variabile non ha chiesto di risparmiare una
    // richiesta: ha chiesto di non sentir parlare di aggiornamenti.
    const shouldNotRun = () => {
      throw new Error("la rete non doveva essere toccata");
    };
    return expect(
      fetchLatestRelease({
        fetchFn: shouldNotRun,
        env: { JHT_UPDATE_CHECK: "0" },
      }),
    ).resolves.toBeNull();
  });
});

describe("una domanda al giorno, e mai un errore per la rete", () => {
  const now = Date.parse("2026-08-08T12:00:00Z");

  it("la cache scade dopo un giorno", () => {
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    expect(cacheFresh({ checked_at: iso(60_000) }, now)).toBe(true);
    expect(cacheFresh({ checked_at: iso(RELEASE_CACHE_TTL_MS + 1) }, now)).toBe(
      false,
    );
    expect(cacheFresh(null, now)).toBe(false);
    expect(cacheFresh({ checked_at: "non una data" }, now)).toBe(false);
  });

  it("offline non è un guasto: nessuna release, nessuna eccezione", async () => {
    const dead = () => Promise.reject(new Error("ENOTFOUND"));
    await expect(
      fetchLatestRelease({ fetchFn: dead, now, useCache: false }),
    ).resolves.toBeNull();
  });

  it("GitHub che risponde storto non produce un avviso", async () => {
    const rateLimited = () =>
      Promise.resolve({ ok: false, status: 403, json: async () => ({}) });
    await expect(
      fetchLatestRelease({ fetchFn: rateLimited, now, useCache: false }),
    ).resolves.toBeNull();
    // 200 con un corpo che non è una release: stessa risposta.
    const junk = () =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ a: 1 }) });
    await expect(
      fetchLatestRelease({ fetchFn: junk, now, useCache: false }),
    ).resolves.toBeNull();
  });
});
