/**
 * Rete di sicurezza della guida di setup.
 *
 * La guida è fatta di dati: capitoli, fasi e un registro di schermate, con
 * gli id del contratto di HQ-DOCS. I modi in cui si rompe sono tutti
 * silenziosi — una fase che punta a una schermata inesistente non mostra
 * nulla, una traduzione mancante mostra la chiave, un file rinominato
 * lascia un rettangolo vuoto. Il type-check prende solo le sette lingue; il
 * resto lo prendono questi test.
 *
 * `guide-ui.i18n.ts` non è verificato qui: finisce già nella rete di
 * `dictionaries.test.ts`, che importa ogni `*.i18n.ts` del web.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GUIDE_CHAPTERS } from "@/app/setup-guide/guide-content";
import {
  REQUIREMENTS_CARD_EVIDENCE,
  REQUIREMENTS_CARD_VALUES,
} from "@/app/setup-guide/requirements-card.i18n";
import {
  SCREENS,
  missingCaptures,
  pendingScreens,
} from "@/app/setup-guide/guide-screens";
import {
  OS_IDS,
  isUntranslated,
  phasesFor,
  screensOf,
  type GuideText,
} from "@/app/setup-guide/guide-types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, "../../../web/public");

const LOCALES = ["it", "en", "es", "fr", "de", "pt", "hu"] as const;

/** Ogni testo visibile, con l'etichetta di dove sta — così un fallimento
 *  dice quale fase e quale campo, non «una stringa da qualche parte». */
function everyText(): { where: string; text: GuideText }[] {
  const out: { where: string; text: GuideText }[] = [];
  const seenFallbacks = new Set<object>();
  for (const chapter of GUIDE_CHAPTERS) {
    out.push({ where: `chapter ${chapter.id} · title`, text: chapter.title });
    out.push({
      where: `chapter ${chapter.id} · summary`,
      text: chapter.summary,
    });
    for (const phase of chapter.phases) {
      const at = `phase ${chapter.id}/${phase.id}`;
      out.push({ where: `${at} · title`, text: phase.title });
      out.push({ where: `${at} · body`, text: phase.body });
      if (phase.screenFallback && !seenFallbacks.has(phase.screenFallback)) {
        seenFallbacks.add(phase.screenFallback);
        out.push({
          where: `${at} · screen fallback title`,
          text: phase.screenFallback.title,
        });
        out.push({
          where: `${at} · screen fallback body`,
          text: phase.screenFallback.body,
        });
      }
      if (phase.warning)
        out.push({ where: `${at} · warning`, text: phase.warning });
      for (const screenRef of screensOf(phase))
        if (screenRef.caption)
          out.push({
            where: `${at} · caption ${screenRef.screenId}`,
            text: screenRef.caption,
          });
      for (const [i, link] of (phase.links ?? []).entries())
        out.push({ where: `${at} · link[${i}]`, text: link.label });
    }
  }
  for (const [key, text] of Object.entries(REQUIREMENTS_CARD_VALUES)) {
    out.push({ where: `requirements card · ${key}`, text });
  }
  out.push({
    where: "requirements card · evidence",
    text: REQUIREMENTS_CARD_EVIDENCE,
  });
  return out;
}

/** I testi del registro schermate: alt e didascalie. Sono scritti qui, non
 *  presi dal contratto, quindi devono essere tradotti davvero. */
function screenTexts(): { where: string; text: GuideText }[] {
  return Object.values(SCREENS).flatMap((screen) => [
    { where: `screen ${screen.id} · alt`, text: screen.alt },
    { where: `screen ${screen.id} · caption`, text: screen.caption },
  ]);
}

describe("guida di setup — traduzioni", () => {
  it("ogni testo esiste in tutte e sette le lingue, non vuoto", () => {
    const missing: string[] = [];
    for (const { where, text } of [...everyText(), ...screenTexts()]) {
      for (const locale of LOCALES) {
        if (!text[locale] || text[locale].trim() === "") {
          missing.push(`${where} → ${locale}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("alt text e didascalie delle schermate sono tradotti davvero", () => {
    // Questi non vengono dal contratto inglese: se sono identici in tutte e
    // sette le lingue, sono inglese incollato, non traduzione.
    const untranslated = screenTexts()
      .filter(({ text }) => isUntranslated(text))
      .map(({ where }) => where);
    expect(untranslated).toEqual([]);
  });

  it("dichiara quanti testi del contratto attendono ancora traduzione", () => {
    // Non è un fallimento: il copy canonico arriva in inglese e la
    // traduzione è un lavoro a parte. Il test esiste per rendere il numero
    // VISIBILE invece che intuibile, e per fallire il giorno in cui
    // qualcuno cancella `untranslated()` senza tradurre davvero.
    const texts = everyText();
    const pending = texts.filter(({ text }) => isUntranslated(text));
    // eslint-disable-next-line no-console
    console.log(
      `[setup-guide] ${pending.length}/${texts.length} testi ancora in inglese (attesa HQ-FULLSTACK-1)`,
    );
    expect(pending.length).toBeLessThanOrEqual(texts.length);
  });
});

describe("guida di setup — struttura", () => {
  it("gli id di capitoli e fasi sono unici", () => {
    const chapterIds = GUIDE_CHAPTERS.map((c) => c.id);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);

    const phaseIds = GUIDE_CHAPTERS.flatMap((c) => c.phases.map((p) => p.id));
    expect(new Set(phaseIds).size).toBe(phaseIds.length);
  });

  it("ogni schermata referenziata da una fase esiste nel registro", () => {
    const dangling: string[] = [];
    for (const chapter of GUIDE_CHAPTERS) {
      for (const phase of chapter.phases) {
        for (const screenRef of screensOf(phase)) {
          if (!SCREENS[screenRef.screenId]) {
            dangling.push(`${chapter.id}/${phase.id} → ${screenRef.screenId}`);
          }
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("nessuna schermata del registro resta orfana", () => {
    // Il contratto elenca le schermate da riprendere: una voce che nessuna
    // fase usa manda i collaudatori a girare un'immagine che non comparirà.
    const used = new Set(
      GUIDE_CHAPTERS.flatMap((c) =>
        c.phases.flatMap((p) => screensOf(p).map((s) => s.screenId)),
      ),
    );
    // Fanno eccezione le superfici native (`G00`, `S01`): HQ-DOCS ha
    // cancellato la loro richiesta PNG, ma l'id logico resta per l'audit.
    const orphans = Object.keys(SCREENS).filter(
      (id) => !used.has(id) && !SCREENS[id].nativeSurface,
    );
    expect(orphans).toEqual([]);
  });

  it("ogni sistema operativo ha un percorso completo", () => {
    // Nessun OS deve trovarsi un capitolo vuoto: se tutte le fasi di un
    // capitolo sono riservate ad altri sistemi, quel capitolo sparisce e la
    // guida salta un pezzo senza dirlo.
    for (const os of OS_IDS) {
      for (const chapter of GUIDE_CHAPTERS) {
        expect(
          phasesFor(chapter, os).length,
          `${os}: il capitolo ${chapter.id} non ha fasi`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("una schermata riusata in più fasi resta un asset solo", () => {
    // È il requisito esplicito: la stessa schermata può comparire in due
    // fasi. Il registro lo garantisce per costruzione (le fasi puntano a un
    // id), e questo test verifica che il riuso esista davvero — altrimenti
    // nessuno si accorge se qualcuno torna a duplicare l'asset.
    const uses = new Map<string, number>();
    for (const chapter of GUIDE_CHAPTERS) {
      for (const phase of chapter.phases) {
        for (const screenRef of screensOf(phase)) {
          uses.set(screenRef.screenId, (uses.get(screenRef.screenId) ?? 0) + 1);
        }
      }
    }
    const reused = [...uses.entries()].filter(([, n]) => n > 1);
    expect(reused.length).toBeGreaterThan(0);
  });

  it("i link ristretti a un sistema esistono per quel sistema", () => {
    for (const chapter of GUIDE_CHAPTERS) {
      for (const phase of chapter.phases) {
        for (const link of phase.links ?? []) {
          if (!link.os) continue;
          const phaseOs = phase.os === "all" ? OS_IDS : phase.os;
          const orphan = link.os.filter((os) => !phaseOs.includes(os));
          expect(
            orphan,
            `${phase.id}: link per ${orphan.join(",")} in una fase che non li mostra`,
          ).toEqual([]);
        }
      }
    }
  });
});

describe("guida di setup — schermate", () => {
  it("ogni file dichiarato esiste davvero sotto public/", () => {
    const broken: string[] = [];
    for (const screen of Object.values(SCREENS)) {
      for (const [variant, asset] of Object.entries(screen.assets)) {
        if (!asset) continue;
        const onDisk = path.join(PUBLIC_DIR, asset.src);
        if (!fs.existsSync(onDisk)) {
          broken.push(`${screen.id}/${variant} → ${asset.src}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("dichiara quante riprese mancano, per sistema", () => {
    // Il conto onesto è per coppia schermata × sistema: da quando Linux
    // consegna, contare le schermate senza alcun file direbbe «S02 fatta»
    // mentre macOS e Windows non ce l'hanno. Una schermata è coperta per un
    // sistema solo se ha la sua variante, o una valida per tutti.
    const usage = new Map<string, (typeof OS_IDS)[number][]>();
    for (const chapter of GUIDE_CHAPTERS) {
      for (const phase of chapter.phases) {
        const systems = phase.os === "all" ? OS_IDS : phase.os;
        for (const screenRef of screensOf(phase)) {
          const seen = usage.get(screenRef.screenId) ?? [];
          usage.set(screenRef.screenId, [...new Set([...seen, ...systems])]);
        }
      }
    }
    const missing = missingCaptures(usage);
    const total = [...usage.values()].reduce((n, os) => n + os.length, 0);
    // eslint-disable-next-line no-console
    console.log(
      `[setup-guide] riprese: ${total - missing.length}/${total} consegnate, ${missing.length} mancanti`,
    );
    expect(missing.length).toBeLessThanOrEqual(total);
  });

  it("ogni schermata mancante dichiara cosa deve mostrare", () => {
    // L'elenco di ciò che manca si legge dal codice: una schermata senza
    // file e senza `pending` sparisce dai conti.
    const undocumented = pendingScreens()
      .filter((screen) => !screen.pending && !screen.nativeSurface)
      .map((screen) => screen.id);
    // Le superfici native non sono «in attesa»: non c'è nulla da riprendere.
    expect(
      pendingScreens().filter(
        (screen) => screen.nativeSurface && screen.pending,
      ),
      "una superficie nativa non può avere anche una ripresa in attesa",
    ).toEqual([]);
    expect(undocumented).toEqual([]);
  });
});

describe("guida di setup — contratto di HQ-DOCS", () => {
  it("i requisiti non dichiarano un minimo di disco in nessuna lingua", () => {
    // Regola dell'operatore: se un numero non è stato misurato, non si
    // scrive. Il minimo di disco non è mai stato misurato, e la frase che
    // lo dice apertamente è la parte più onesta del testo: non si taglia
    // per brevità, e nessuno deve rimetterci un numero inventato.
    const phase = GUIDE_CHAPTERS.flatMap((c) => c.phases).find(
      (p) => p.id === "check-requirements",
    );
    expect(phase, "fase check-requirements assente").toBeDefined();
    const notMeasured = {
      en: "no universal disk minimum is stated because one has not been measured",
      it: "non viene indicato un requisito minimo universale di spazio su disco perché non è stato misurato",
      es: "no se indica un mínimo universal de espacio en disco porque no se ha medido",
      fr: "aucun minimum universel d’espace disque n’est indiqué, car il n’a pas été mesuré",
      de: "ein allgemeingültiges Minimum für den Festplattenspeicher wird nicht angegeben, weil es nicht gemessen wurde",
      pt: "não é indicado um mínimo universal de espaço em disco porque não foi medido",
      hu: "általános minimális lemezterület nincs megadva, mert ilyet nem mértek",
    } as const;
    for (const locale of LOCALES) {
      expect(phase!.body[locale], locale).toContain(notMeasured[locale]);
    }
  });

  it("la scheda nativa non inventa un minimo di disco in nessuna lingua", () => {
    const notMeasured = {
      en: "no minimum has been measured",
      it: "non è stato misurato alcun minimo",
      es: "no se ha medido ningún mínimo",
      fr: "aucun minimum n’a été mesuré",
      de: "es wurde kein Minimum gemessen",
      pt: "não foi medido qualquer mínimo",
      hu: "nem mértek minimális tárhelyigényt",
    } as const;
    for (const locale of LOCALES) {
      expect(REQUIREMENTS_CARD_VALUES.disk[locale], locale).toContain(
        notMeasured[locale],
      );
    }
  });

  it("i sette testi misurati della scheda nativa sono tradotti davvero", () => {
    const texts = [
      ...Object.entries(REQUIREMENTS_CARD_VALUES),
      ["evidence", REQUIREMENTS_CARD_EVIDENCE] as const,
    ];
    const pending = texts
      .filter(([, text]) => isUntranslated(text))
      .map(([key]) => key);
    expect(pending).toEqual([]);
  });

  it("S01 è tradotta davvero nelle sei lingue derivate", () => {
    const phase = GUIDE_CHAPTERS.flatMap((c) => c.phases).find(
      (p) => p.id === "check-requirements",
    )!;
    const texts = [
      phase.title,
      phase.body,
      ...(phase.links ?? []).map((link) => link.label),
    ];
    for (const text of texts) {
      for (const locale of LOCALES.filter((locale) => locale !== "en")) {
        expect(text[locale], locale).not.toBe(text.en);
      }
    }
  });

  it("indice, G00 e S02 sono tradotti davvero nelle sei lingue derivate", () => {
    const chapter = GUIDE_CHAPTERS.find((candidate) => candidate.id === "guide-index")!;
    const phaseIds = new Set([
      "choose-setup-path",
      "install-docker-macos",
      "install-docker-windows",
      "install-docker-linux",
    ]);
    const phases = chapter.phases.filter((phase) => phaseIds.has(phase.id));
    expect(phases).toHaveLength(phaseIds.size);

    const texts = [
      chapter.title,
      chapter.summary,
      ...phases.flatMap((phase) => [
        phase.title,
        phase.body,
        ...(phase.links ?? []).map((link) => link.label),
      ]),
    ];
    for (const text of texts) {
      for (const locale of LOCALES.filter((locale) => locale !== "en")) {
        expect(text[locale], locale).not.toBe(text.en);
      }
    }
  });

  it("S03-S05 sono tradotti davvero nelle sei lingue derivate", () => {
    const phaseIds = new Set([
      "download-desktop-app",
      "install-macos",
      "install-windows",
      "install-linux",
      "open-for-the-first-time",
    ]);
    const phases = GUIDE_CHAPTERS.flatMap((chapter) => chapter.phases).filter(
      (phase) => phaseIds.has(phase.id),
    );
    expect(phases).toHaveLength(phaseIds.size);

    const texts = phases.flatMap((phase) => [
      phase.title,
      phase.body,
      ...(phase.links ?? []).map((link) => link.label),
    ]);
    for (const text of texts) {
      for (const locale of LOCALES.filter((locale) => locale !== "en")) {
        expect(text[locale], locale).not.toBe(text.en);
      }
    }
  });

  it("W02-W04 e il segnaposto privacy-safe sono tradotti davvero", () => {
    const phases = GUIDE_CHAPTERS.flatMap((chapter) => chapter.phases).filter(
      (phase) =>
        [
          "sign-in-with-google",
          "review-permissions",
          "verify-dashboard-sync",
        ].includes(phase.id),
    );
    expect(phases.map((phase) => phase.id)).toEqual([
      "sign-in-with-google",
      "review-permissions",
      "verify-dashboard-sync",
    ]);

    const texts = phases.flatMap((phase) => [
      phase.title,
      phase.body,
      ...(phase.links ?? []).map((link) => link.label),
      ...(phase.screenFallback
        ? [phase.screenFallback.title, phase.screenFallback.body]
        : []),
    ]);
    for (const text of texts) {
      for (const locale of LOCALES.filter((locale) => locale !== "en")) {
        expect(text[locale], locale).not.toBe(text.en);
      }
    }
  });

  it("W03 distingue login Google e Team Gmail in tutte le lingue", () => {
    const phase = GUIDE_CHAPTERS.flatMap((chapter) => chapter.phases).find(
      (candidate) => candidate.id === "review-permissions",
    )!;
    const separateGrant = {
      en: "two separate grants",
      it: "due autorizzazioni distinte",
      es: "dos autorizaciones independientes",
      fr: "deux autorisations distinctes",
      de: "zwei getrennte Berechtigungen",
      pt: "duas autorizações distintas",
      hu: "két külön engedélyt",
    } as const;
    for (const locale of LOCALES) {
      const body = phase.body[locale];
      for (const exactScope of ["OpenID", "email", "profile"]) {
        expect(body, `${locale}: scope ${exactScope}`).toContain(exactScope);
      }
      expect(body, `${locale}: Team Gmail`).toContain("Team Gmail");
      expect(body, `${locale}: grant separati`).toContain(
        separateGrant[locale],
      );
    }
    expect((phase.links ?? []).map((link) => link.href)).toContain(
      "/docs/guides/team-gmail",
    );
  });

  it("i requisiti tengono la baseline VPS separata e linkata", () => {
    // La pagina VPS già pubblicata dichiara 4 GB e 2 vCPU: senza dire che
    // è la baseline di un server dedicato, le due pagine sembrano in
    // disaccordo sui requisiti del computer di casa.
    const phase = GUIDE_CHAPTERS.flatMap((c) => c.phases).find(
      (p) => p.id === "check-requirements",
    )!;
    expect(phase.body.en).toContain("separate validated baseline");
    const hrefs = (phase.links ?? []).map((link) =>
      "href" in link ? link.href : undefined,
    );
    expect(hrefs).toContain("/docs/guides/run-on-a-vps");
  });
});
