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

const providerAuthorizationBlockByLanguage = {
  it: "blocco durante l'autorizzazione del provider",
  en: "provider-authorization block",
  es: "bloqueo de autorización del proveedor",
  fr: "blocage d'autorisation du fournisseur",
  de: "Blockierung bei der Provider-Autorisierung",
  pt: "bloqueio da autorização do fornecedor",
  hu: "szolgáltatói engedélyezésnél",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const outdatedProviderLoginByLanguage = {
  it: "prima dell'accesso al provider",
  en: "before provider login",
  es: "antes del inicio de sesión con el proveedor",
  fr: "avant la connexion au fournisseur",
  de: "vor der Provider-Anmeldung",
  pt: "antes do início de sessão no fornecedor",
  hu: "szolgáltatói bejelentkezés előtt",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const completedOnboardingAtDockerPanelByLanguage = {
  it: "al completamento dell'onboarding e al pannello Docker post-onboarding",
  en: "completing onboarding and reaching the Docker setup panel",
  es: "completar el onboarding y llegar al panel de configuración de Docker",
  fr: "la fin de l'onboarding et l'arrivée au panneau de configuration Docker",
  de: "dem Abschluss des Onboardings und dem Erreichen des Docker-Einrichtungspanels",
  pt: "a conclusão do onboarding e a chegada ao painel de configuração do Docker",
  hu: "az onboarding befejezéséig és a Docker beállítási panel eléréséig",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const outdatedFirstOnboardingPanelByLanguage = {
  it: "al primo pannello di onboarding",
  en: "to the first onboarding panel",
  es: "hasta el primer panel de onboarding",
  fr: "premier panneau d'onboarding",
  de: "ersten Onboarding-Panel",
  pt: "primeiro painel de onboarding",
  hu: "első onboarding panelig",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const firstLaunchLanguageChoiceByLanguage = {
  it: "Al primo avvio",
  en: "On first launch",
  es: "En el primer inicio",
  fr: "Lors du premier lancement",
  de: "beim ersten Start",
  pt: "No primeiro arranque",
  hu: "Első indításkor",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const requiredLanguageChoiceByLanguage = {
  it: "devi confermare la scelta",
  en: "confirming a choice is required",
  es: "debes confirmar la elección",
  fr: "vous devez confirmer ce choix",
  de: "musst die Auswahl bestätigen",
  pt: "tens de confirmar a escolha",
  hu: "meg kell erősítened a választást",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const savedLanguageChoiceByLanguage = {
  it: "l'app la salva per le aperture successive",
  en: "app saves it for later openings",
  es: "la aplicación la guarda para las siguientes aperturas",
  fr: "l'application le mémorise pour les ouvertures suivantes",
  de: "die App speichert sie für spätere Starts",
  pt: "a aplicação guarda-a para aberturas posteriores",
  hu: "az alkalmazás a következő megnyitásokhoz elmenti",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const nameAfterLanguageChoiceByLanguage = {
  it: "Poi inserisci il nome",
  en: "Then add your name",
  es: "Después añade tu nombre",
  fr: "Ajoutez ensuite votre nom",
  de: "Gib danach deinen Namen",
  pt: "Depois acrescenta o teu nome",
  hu: "Ezután add meg a nevedet",
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
      expect(game.beforeYouBegin).toContain(
        completedOnboardingAtDockerPanelByLanguage[language],
      );
      expect(game.beforeYouBegin).not.toContain(
        outdatedFirstOnboardingPanelByLanguage[language],
      );
      expect(game.beforeYouBegin).toContain("54");
      expect(game.beforeYouBegin).toContain("54:40");
      expect(game.beforeYouBegin).toContain(
        providerAuthorizationBlockByLanguage[language],
      );
      expect(game.beforeYouBegin).not.toContain(
        outdatedProviderLoginByLanguage[language],
      );
      expect(game.setupHeading).toBeTruthy();
      expect(game.setupSteps).toHaveLength(8);
      expect(game.exploreHeading).toBeTruthy();
      expect(game.steps).toHaveLength(8);
      expect(game.steps[0]?.title).toBe(firstGameStepByLanguage[language]);
      expect(game.preferVideo).toBeTruthy();
      expect(game.videoAvailable).toBeTruthy();

      const enterOffice = game.setupSteps[2]?.body;
      expect(enterOffice).toContain(
        firstLaunchLanguageChoiceByLanguage[language],
      );
      expect(enterOffice).toContain(requiredLanguageChoiceByLanguage[language]);
      expect(enterOffice).toContain("English");
      expect(enterOffice).toContain(savedLanguageChoiceByLanguage[language]);
      const enterOfficeText = enterOffice ?? "";
      expect(
        enterOfficeText.indexOf(firstLaunchLanguageChoiceByLanguage[language]),
      ).toBeLessThan(
        enterOfficeText.indexOf(nameAfterLanguageChoiceByLanguage[language]),
      );

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
