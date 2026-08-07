import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  landingFamilyColors,
  landingShowcaseData,
  landingTour,
} from "../../../web/app/components/landing/LandingGlobe.data";
import {
  FAMILY_T,
  ROLE_T,
} from "../../../web/app/components/landing/LandingGlobe.roles.i18n";
import { T } from "../../../web/app/components/landing/LandingGlobe.i18n";

const LOCALES = ["it", "en", "es", "fr", "de", "pt", "hu"] as const;

const landingGlobeSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../web/app/components/landing/LandingGlobe.tsx",
  ),
  "utf8",
);
const jobsGlobeSource = fs.readFileSync(
  path.resolve(__dirname, "../../../web/app/components/JobsGlobe.tsx"),
  "utf8",
);
const globalCssSource = fs.readFileSync(
  path.resolve(__dirname, "../../../web/app/globals.css"),
  "utf8",
);

describe("globo della home pubblica", () => {
  it("dà a ogni città da 3 a 5 opportunità, alternando 3-4-4-5", () => {
    const tour = landingTour("en");
    expect(tour.length).toBeGreaterThanOrEqual(25);

    const CICLO = [3, 4, 4, 5];
    tour.forEach((stop, i) => {
      expect(stop.positions.length, stop.city).toBe(CICLO[i % CICLO.length]);
    });

    // Due pin nello stesso punto diventerebbero un fascio col contatore,
    // che in home non vogliamo: ogni segnaposto è UNA opportunità.
    for (const stop of tour) {
      const coords = stop.positions.map((p) => `${p.lat}|${p.lon}`);
      expect(new Set(coords).size, stop.city).toBe(coords.length);
      for (const position of stop.positions) {
        expect(position.lat).toBeGreaterThanOrEqual(-90);
        expect(position.lat).toBeLessThanOrEqual(90);
        expect(position.lon).toBeGreaterThanOrEqual(-180);
        expect(position.lon).toBeLessThanOrEqual(180);
      }
    }
  });

  it("dà a ogni città ruoli suoi, con settori e livelli diversi", () => {
    const tour = landingTour("en");

    // Nessuna città ripete due volte lo stesso mestiere: la vetrina
    // racconta un mercato, non una ricerca sola clonata.
    for (const stop of tour) {
      const titoli = stop.positions.map((p) => p.title);
      expect(new Set(titoli).size, stop.city).toBe(titoli.length);
      const settori = stop.positions.map((p) => p.role_family);
      expect(new Set(settori).size, `${stop.city}: un solo settore`).toBeGreaterThan(
        1,
      );
    }

    // Il livello varia: ogni città ha almeno un ruolo d'ingresso, e il
    // globo nel complesso non è un elenco di junior.
    const junior = tour.filter((stop) =>
      stop.positions.some((p) => p.title.startsWith("Junior ")),
    );
    expect(junior.length).toBe(tour.length);
    const tuttiJunior = tour.flatMap((s) => s.positions);
    expect(
      tuttiJunior.filter((p) => p.title.startsWith("Junior ")).length,
    ).toBeLessThan(tuttiJunior.length / 2);

    // I ruoli chiesti esplicitamente dall'operatore, città per città.
    const di = (city: string) =>
      tour.find((s) => s.city === city)?.positions.map((p) => p.title) ?? [];
    expect(di("Rome").join(" ")).toMatch(/Archaeological|Art Restorer/);
    expect(di("Vienna").join(" ")).toMatch(/Engineer/);
    expect(di("New York").join(" ")).toMatch(/Luxury Art Gallery Director/);
    expect(di("Monaco").join(" ")).toMatch(/Luxury Hotel General Manager/);
  });

  it("traduce titoli e settori in tutte e sette le lingue", () => {
    for (const locale of LOCALES) {
      const tour = landingTour(locale);
      for (const stop of tour) {
        for (const position of stop.positions) {
          // makeT ripiega sulla CHIAVE quando una voce manca: se a
          // schermo finisse `rome_site_curator`, deve fallire qui.
          expect(position.title, `${stop.city}/${locale}`).not.toMatch(
            /^[a-z0-9]+(_[a-z0-9]+)+$/,
          );
          expect(position.role_family, `${stop.city}/${locale}`).not.toMatch(
            /^[a-z0-9]+(_[a-z0-9]+)+$/,
          );
          expect(position.title.trim()).not.toBe("");
        }
      }
    }

    // Ogni voce del dizionario dei ruoli è davvero usata: una chiave
    // orfana è lavoro di traduzione buttato e un ruolo che nessuno vede.
    const usate = new Set(
      landingTour("en").flatMap((s) => s.positions.map((p) => p.title)),
    );
    const inglesi = new Set(Object.values(ROLE_T).map((v) => v.en));
    expect([...inglesi].filter((t) => !usate.has(t))).toEqual([]);
  });

  it("dà un colore a ogni settore e id stabili fra le lingue", () => {
    const colori = landingFamilyColors("it");
    for (const stop of landingTour("it")) {
      for (const position of stop.positions) {
        expect(colori[position.role_family ?? ""], position.title).toMatch(
          /^#[0-9a-f]{6}$/i,
        );
      }
    }
    expect(Object.keys(colori)).toHaveLength(Object.keys(FAMILY_T).length);

    // La card aperta è identificata dall'id: se cambiasse con la lingua,
    // cambiare lingua a metà giro la farebbe sparire.
    const it = landingTour("it").flatMap((s) => s.positions.map((p) => p.id));
    const de = landingTour("de").flatMap((s) => s.positions.map((p) => p.id));
    expect(de).toEqual(it);
    expect(new Set(it).size).toBe(it.length);
  });

  it("riduce i pin sul profilo leggero senza cambiare il racconto", () => {
    const full = landingShowcaseData(false, "en");
    const lean = landingShowcaseData(true, "en");

    expect(lean.positions.length).toBeLessThan(full.positions.length);
    expect(lean.tour).toHaveLength(full.tour.length);
    for (const stop of lean.tour) expect(stop.positions).toHaveLength(2);
    expect(lean.tour.map((s) => s.positions[0]?.id)).toEqual(
      full.tour.map((s) => s.positions[0]?.id),
    );
  });

  it("dice a parole che il globo è un esempio, senza timbri tecnici", () => {
    // La frase onesta esiste in tutte le lingue ed è a schermo.
    for (const locale of LOCALES) {
      expect(T.showcase_note[locale].trim().length).toBeGreaterThan(40);
    }
    expect(landingGlobeSource).toContain('tr("showcase_note")');

    // …e resta una frase: niente badge, niente etichette da debug
    // appiccicate sopra la scena.
    expect(landingGlobeSource).not.toContain("jht-globe-badge");
    expect(T).not.toHaveProperty("demo_badge");
    const testi = JSON.stringify(T).toLowerCase();
    for (const timbro of ["sample data", "mock", "dati finti", "demo data"]) {
      expect(testi, timbro).not.toContain(timbro);
    }
  });

  it("lascia girare il globo a mano senza rubare lo scroll della pagina", () => {
    // La vetrina è interattiva…
    expect(jobsGlobeSource).toContain("interactive: true");
    expect(jobsGlobeSource).toContain("tuneShowcaseHandlers(map);");
    // …ma la rotella resta alla pagina, e col dito il browser si tiene
    // lo scorrimento verticale (touch-action: pan-y).
    expect(jobsGlobeSource).toContain("map.scrollZoom.disable()");
    expect(jobsGlobeSource).toContain("map.dragPan.enable()");
    expect(jobsGlobeSource).toContain("touch-action: pan-y");
    expect(jobsGlobeSource).toContain("jht-globe-showcase ");
    // Il CSS da solo NON basta: MapLibre annulla lo scorrimento con
    // preventDefault sul primo touchmove, prima che Chrome lo avvii.
    // Serve il blocco d'asse — che qui si controlla solo COLLEGATO e
    // STACCATO: come si comporta lo prova `globe-touch-axis-lock.test.ts`
    // con eventi veri, perché una stringa nel sorgente non dice se
    // funziona.
    expect(jobsGlobeSource).toContain(
      "detachAxisLock = attachShowcaseTouchLock(",
    );
    expect(jobsGlobeSource).toContain("detachAxisLock?.()");
    expect(jobsGlobeSource).toContain(
      'attachTouchAxisLock } from "@/lib/globe-touch-axis-lock"',
    );
    // La rotella e lo swipe verticale appartengono alla pagina: non
    // devono nemmeno notificare l'autopilota. Il drag touch orizzontale
    // passa invece dalle callback del blocco d'asse.
    expect(jobsGlobeSource).not.toContain('addEventListener("wheel"');
    expect(jobsGlobeSource).toContain("onHorizontalStart,");
    expect(jobsGlobeSource).toContain("onHorizontalEnd,");

    // Click su un pin → card, click nel vuoto → chiusa. Nessun volo:
    // la camera resta dell'utente.
    expect(jobsGlobeSource).toContain(
      "showcaseRef.current.onPinSelect?.(g.positions[0]?.id ?? null)",
    );
    expect(jobsGlobeSource).toContain(
      "if (near.length === 0) showcaseRef.current.onPinSelect?.(null)",
    );
  });

  it("riprende quasi subito, ma solo dopo la fine del gesto", () => {
    expect(landingGlobeSource).toContain(
      "const RESUME_AFTER_IDLE_MS = 700",
    );
    expect(landingGlobeSource).toContain("const RESUME_RAMP_MS = 800");
    expect(landingGlobeSource).toContain("const RESUME_RAMP_DEG = 1.2");
    expect(landingGlobeSource).toContain("easing: (v) => v * v");
    expect(landingGlobeSource).toContain('autopilotRef.current?.pause("user")');
    expect(landingGlobeSource).toContain(
      'autopilotRef.current?.unpause("user")',
    );
    expect(jobsGlobeSource).toContain(
      "const activeHumanPointers = new Set<number>()",
    );
    expect(jobsGlobeSource).toContain(
      'window.addEventListener("pointerup", onHumanEnd',
    );
    expect(jobsGlobeSource).toContain(
      'window.addEventListener("pointercancel", onHumanEnd',
    );
    expect(jobsGlobeSource).toContain('if (e.pointerType === "touch") return');
    expect(jobsGlobeSource).toContain("activeHumanPointers.size === 0");
    // Le due pause sono indipendenti: uscire dal viewport non deve
    // essere annullato dallo scadere del timer dell'utente.
    expect(landingGlobeSource).toContain(
      'autopilotRef.current?.pause("offscreen")',
    );
    expect(landingGlobeSource).toContain("const paused = new Set<PauseReason>()");
    // La ripresa risale alla vista d'insieme invece di ricominciare a
    // girare da dove l'utente aveva lasciato lo zoom.
    expect(landingGlobeSource).toContain("const RECENTER_MS = 2200");
  });

  it("fa avanzare il loop mentre il canvas fuori viewport non disegna", () => {
    // Il componente non viene smontato: MapLibre viene fermato per non
    // produrre frame invisibili, mentre il tempo trascorso resta nel
    // cursore virtuale e al rientro ricostruisce fase, città e card.
    expect(landingGlobeSource).toContain(
      "offscreenCursor = captureTourCursor()",
    );
    expect(landingGlobeSource).toContain(
      "offscreenElapsedMs = Date.now() - offscreenStartedAt",
    );
    expect(landingGlobeSource).toContain("advanceTourCursor(");
    expect(landingGlobeSource).toContain("restoreTourCursor(cursor)");
    expect(landingGlobeSource).toContain("map.stop()");
    expect(landingGlobeSource).toContain("map.jumpTo({");
    // Un'assenza molto lunga non viene riprodotta card per card.
    expect(landingGlobeSource).toContain("const skipWholeLoops = () =>");
    expect(landingGlobeSource).toContain(
      "const loops = Math.floor(left / loopDurationMs)",
    );
  });

  it("non nasconde ai lettori di schermo una vetrina che ora si tocca", () => {
    // Da quando si può trascinare il globo e cliccare i pin, il globo
    // vivo contiene comandi VERI e raggiungibili col tab (chiudi card,
    // credito basemap). Un aria-hidden lì sopra li lascerebbe ricevere
    // il focus senza essere annunciati: focus fantasma.
    const vivo = landingGlobeSource.slice(
      landingGlobeSource.indexOf('{mode === "live" && ('),
      landingGlobeSource.indexOf("<JobsGlobeLazy"),
    );
    expect(vivo).not.toContain("aria-hidden");
    // …e la descrizione della scena non muore quando il fallback (con il
    // suo alt) viene rimosso: la porta il contenitore del globo vivo.
    expect(vivo).toContain('role="group"');
    expect(vivo).toContain('aria-label={tr("globe_live_label")}');
    for (const locale of LOCALES) {
      expect(T.globe_live_label[locale].trim().length).toBeGreaterThan(40);
      expect(T.globe_alt[locale].trim().length).toBeGreaterThan(40);
    }
    // Nessun doppione: finché il fallback è a schermo il blocco vivo è
    // `invisible`, cioè fuori dall'albero di accessibilità.
    expect(vivo).toContain('liveReady ? "visible" : "invisible"');
    // Il canvas non è una tappa di tabulazione: MapLibre gli darebbe
    // tabindex 0, ma in vetrina la tastiera è spenta apposta (le frecce
    // devono scorrere la home) — sarebbe un fermo del focus a vuoto.
    expect(jobsGlobeSource).toContain(
      'map.getCanvas().setAttribute("tabindex", "-1")',
    );
    expect(jobsGlobeSource).toContain("makeShowcaseCanvasUnfocusable(map)");
    expect(jobsGlobeSource).toContain("map.keyboard.disable()");
  });

  it("mostra le opportunità una alla volta sopra al pin", () => {
    expect(landingGlobeSource).toContain("const CARD_MS = 2300");
    expect(landingGlobeSource).toContain("const beginDwell = (");
    expect(landingGlobeSource).toContain(
      "schedule(() => beginDwell(stopSeq, cardIndex + 1), firstCardMs)",
    );
    // La card è quella della mappa dell'area riservata, pilotata da fuori.
    expect(landingGlobeSource).toContain("cardId");
    expect(jobsGlobeSource).toContain("const showcaseCardId = showcase?.cardId ?? null");
    // Sulla home il link alla scheda non c'è: manderebbe un visitatore
    // anonimo contro una pagina di login.
    expect(jobsGlobeSource).toContain("{!showcase && (");
  });

  it("sostituisce il fallback solo quando il globo vivo è pronto", () => {
    expect(landingGlobeSource).toContain(
      'const liveReady = mode === "live" && began',
    );
    expect(landingGlobeSource).toContain("{!liveReady && (");
    expect(landingGlobeSource).toContain('liveReady ? "visible" : "invisible"');
    expect(landingGlobeSource).not.toContain("transition-opacity");
  });

  it("usa un solo fallback e lo rende light dal tema pre-paint", () => {
    expect(landingGlobeSource.match(/className="jht-globe-still/g)).toHaveLength(
      1,
    );
    expect(globalCssSource).toContain(
      'html[data-theme="light"] .jht-globe-still',
    );
    expect(globalCssSource).toContain("invert(1) hue-rotate(180deg)");
    expect(jobsGlobeSource).toContain(
      'document.documentElement.getAttribute("data-theme")',
    );
    expect(jobsGlobeSource).toContain(
      'style: bootTheme === "light" ? STYLE_LIGHT : STYLE_DARK',
    );
  });

  it("rallenta zoom e viaggi e aspetta il caricamento a ogni arrivo", () => {
    expect(landingGlobeSource).toContain("const HOP_FLY_MS = 8500");
    expect(landingGlobeSource).toContain("const CONTINENT_FLY_MS = 14000");
    expect(landingGlobeSource).toContain("const FIRST_FLY_MS = 12000");
    expect(landingGlobeSource).toContain("const HOP_FLY_CURVE = 1.8");
    expect(landingGlobeSource).toContain("const CONTINENT_FLY_CURVE = 2");
    expect(landingGlobeSource).toContain(
      "curve: crossing ? CONTINENT_FLY_CURVE : HOP_FLY_CURVE",
    );
    const flyTo = landingGlobeSource.indexOf("map.flyTo({");
    const travelEnd = landingGlobeSource.indexOf(
      'map.once("moveend", onTravelEnd)',
    );
    expect(flyTo).toBeGreaterThan(-1);
    expect(travelEnd).toBeGreaterThan(flyTo);
    expect(landingGlobeSource).toContain('map.once("idle", settleAtStop)');
    const arrivalGate = landingGlobeSource.slice(
      landingGlobeSource.indexOf("const onTravelEnd"),
      flyTo,
    );
    expect(arrivalGate).not.toContain("map.loaded()");
    expect(landingGlobeSource).not.toContain("duration + 300");
  });

  it("consegna l'autopilota solo dopo il primo idle successivo ai pin", () => {
    const sourceUpdate = jobsGlobeSource.indexOf(
      'src.setData({ type: "FeatureCollection", features });',
    );
    const idleReady = jobsGlobeSource.indexOf(
      'map.once("idle", () => {',
      sourceUpdate,
    );
    const callback = jobsGlobeSource.indexOf(
      "showcaseRef.current?.onMapReady?.(map);",
      idleReady,
    );

    expect(sourceUpdate).toBeGreaterThan(-1);
    expect(idleReady).toBeGreaterThan(sourceUpdate);
    expect(callback).toBeGreaterThan(idleReady);
  });
});
