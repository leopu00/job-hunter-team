import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS } from "../../../web/app/components/landing/LandingI18n";
import {
  TUTORIAL_GUIDES,
  TUTORIAL_PAGE_COPY,
} from "../../../web/app/tutorials/tutorial-content";

const firstGameStepByLanguage = {
  it: "Conosci l'ufficio",
  en: "Meet the office",
  es: "Conoce la oficina",
  fr: "Découvrez le bureau",
  de: "Lerne das Büro kennen",
  pt: "Conhece o escritório",
  hu: "Ismerd meg az irodát",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const cloudSyncActionByLanguage = {
  it: "Accedi con Google",
  en: "Sign in with Google",
  es: "Entrar con Google",
  fr: "Se connecter avec Google",
  de: "Mit Google anmelden",
  pt: "Entrar com o Google",
  hu: "Belépés Google-lel",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

describe("cataloghi dei tutorial pubblici", () => {
  it("offre entrambi i percorsi testuali completi in tutte le lingue supportate", () => {
    expect(Object.keys(TUTORIAL_GUIDES).sort()).toEqual(
      [...SUPPORTED_LANGS].sort(),
    );
    expect(Object.keys(TUTORIAL_PAGE_COPY).sort()).toEqual(
      [...SUPPORTED_LANGS].sort(),
    );

    for (const language of SUPPORTED_LANGS) {
      const { game, web } = TUTORIAL_GUIDES[language];
      const pageCopy = TUTORIAL_PAGE_COPY[language];

      expect(pageCopy.description).toBeTruthy();
      expect(pageCopy.pathNavLabel).toBeTruthy();
      expect(game.intro).toBeTruthy();
      expect(game.beforeYouBeginLabel).toBeTruthy();
      expect(game.beforeYouBegin).toBeTruthy();
      expect(game.beforeYouBegin).toMatch(/32.*58/);
      expect(game.beforeYouBegin).toContain("54");
      expect(game.setupHeading).toBeTruthy();
      expect(game.setupSteps).toHaveLength(8);
      expect(game.exploreHeading).toBeTruthy();
      expect(game.steps).toHaveLength(8);
      expect(game.steps[0]?.title).toBe(firstGameStepByLanguage[language]);
      expect(game.preferVideo).toBeTruthy();
      expect(game.videoAvailable).toBeTruthy();
      expect(web.intro).toBeTruthy();
      expect(web.beforeYouBeginLabel).toBeTruthy();
      expect(web.beforeYouBegin).toBeTruthy();
      expect(web.steps).toHaveLength(7);
      expect(web.preferVideo).toBeTruthy();
      expect(web.videoAvailable).toBeTruthy();

      for (const step of [
        ...(game.setupSteps ?? []),
        ...game.steps,
        ...web.steps,
      ]) {
        expect(step.title).toBeTruthy();
        expect(step.body).toBeTruthy();
      }
    }
  });

  it("rende configurabili sync e stati della pipeline senza un video", () => {
    const statuses = [
      "`new`",
      "`checked`",
      "`scored`",
      "`writing`",
      "`review`",
      "`ready`",
      "`applied`",
      "`response`",
    ];

    for (const language of SUPPORTED_LANGS) {
      const { game, web } = TUTORIAL_GUIDES[language];

      expect(web.beforeYouBegin).toContain(cloudSyncActionByLanguage[language]);
      expect(web.beforeYouBegin).not.toContain("sync configured");
      expect(game.steps[5]?.body).toEqual(expect.stringContaining(statuses[0]));

      for (const status of statuses.slice(1)) {
        expect(game.steps[5]?.body).toContain(status);
      }
    }
  });
});
