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

      for (const step of [...game.steps, ...web.steps]) {
        expect(step.title).toBeTruthy();
        expect(step.body).toBeTruthy();
      }
    }
  });
});
