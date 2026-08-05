import { existsSync } from "node:fs";
import { resolve } from "node:path";
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

const preselectedEnglishByLanguage = {
  it: "English è preselezionato",
  en: "English is preselected",
  es: "English está preseleccionado",
  fr: "English est présélectionné",
  de: "English ist vorausgewählt",
  pt: "English vem pré-selecionado",
  hu: "English van előre kijelölve",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const titleAfterLanguageChoiceByLanguage = {
  it: "schermata iniziale",
  en: "title screen",
  es: "pantalla inicial",
  fr: "écran de départ",
  de: "Startbildschirm",
  pt: "ecrã inicial",
  hu: "kezdőképernyő",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const languageChoiceBeforeTitleByLanguage = {
  it: "prima della schermata iniziale",
  en: "before the title screen",
  es: "antes de la pantalla inicial",
  fr: "avant l'écran de départ",
  de: "vor dem Startbildschirm",
  pt: "antes do ecrã inicial",
  hu: "a kezdőképernyő előtt",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const languageChoiceAfterTitleByLanguage = {
  it: "dopo la schermata iniziale",
  en: "after the title screen",
  es: "después de la pantalla inicial",
  fr: "après l'écran de départ",
  de: "nach dem Startbildschirm",
  pt: "depois do ecrã inicial",
  hu: "a kezdőképernyő után",
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

const officeAfterNameByLanguage = {
  it: "entra nell'ufficio",
  en: "enter the office",
  es: "entra en la oficina",
  fr: "entrez dans le bureau",
  de: "betritt das Büro",
  pt: "entra no escritório",
  hu: "lépj be az irodába",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const desktopPreselectedByLanguage = {
  it: "Desktop è già selezionato",
  en: "Desktop is already selected",
  es: "Desktop ya está seleccionado",
  fr: "Desktop est déjà sélectionné",
  de: "Desktop ist bereits ausgewählt",
  pt: "Desktop já está selecionado",
  hu: "Desktop már ki van jelölve",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const platformClickStartsDownloadByLanguage = {
  it: "clicca una volta macOS, Windows o Linux",
  en: "click macOS, Windows, or Linux once",
  es: "haz clic una vez en macOS, Windows o Linux",
  fr: "cliquez une fois sur macOS, Windows ou Linux",
  de: "Klicke einmal auf macOS, Windows oder Linux",
  pt: "clica uma vez em macOS, Windows ou Linux",
  hu: "kattints egyszer a macOS, Windows vagy Linux lehetőségre",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const outdatedDesktopChoiceByLanguage = {
  it: "scegli Desktop",
  en: "choose Desktop",
  es: "elige Desktop",
  fr: "choisissez Desktop",
  de: "wähle Desktop",
  pt: "escolhe Desktop",
  hu: "válaszd a Desktop",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const linuxExtractionByLanguage = {
  it: "estrai job-hunter-team-linux-x64.tar.gz",
  en: "extract job-hunter-team-linux-x64.tar.gz",
  es: "extrae job-hunter-team-linux-x64.tar.gz",
  fr: "extrayez job-hunter-team-linux-x64.tar.gz",
  de: "entpacke unter Linux job-hunter-team-linux-x64.tar.gz",
  pt: "extrai job-hunter-team-linux-x64.tar.gz",
  hu: "csomagold ki a job-hunter-team-linux-x64.tar.gz",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const executablePermissionByLanguage = {
  it: "abilita il permesso di esecuzione",
  en: "enable its executable permission",
  es: "activa su permiso de ejecución",
  fr: "activez son autorisation d'exécution",
  de: "aktiviere bei Bedarf seine Ausführungsberechtigung",
  pt: "ativa a respetiva permissão de execução",
  hu: "engedélyezd a futtatási jogosultságát",
} satisfies Record<(typeof SUPPORTED_LANGS)[number], string>;

const executableRunAfterPermissionByLanguage = {
  it: "prima di avviarlo",
  en: "before running it",
  es: "antes de ejecutarlo",
  fr: "avant de le lancer",
  de: "bevor du es ausführst",
  pt: "antes de o executar",
  hu: "mielőtt futtatnád",
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

      const download = game.setupSteps[0]?.body ?? "";
      expect(download).toContain(desktopPreselectedByLanguage[language]);
      expect(download).toContain(
        platformClickStartsDownloadByLanguage[language],
      );
      expect(download).not.toContain(outdatedDesktopChoiceByLanguage[language]);

      const openDownload = game.setupSteps[1]?.body ?? "";
      expect(openDownload).toContain(linuxExtractionByLanguage[language]);
      expect(openDownload).toContain(executablePermissionByLanguage[language]);
      expect(openDownload).toContain(
        executableRunAfterPermissionByLanguage[language],
      );
      expect(
        openDownload.indexOf(linuxExtractionByLanguage[language]),
      ).toBeLessThan(
        openDownload.indexOf(executablePermissionByLanguage[language]),
      );
      expect(
        openDownload.indexOf(executablePermissionByLanguage[language]),
      ).toBeLessThan(
        openDownload.indexOf(executableRunAfterPermissionByLanguage[language]),
      );

      const enterOffice = game.setupSteps[2]?.body;
      expect(enterOffice).toContain(
        firstLaunchLanguageChoiceByLanguage[language],
      );
      expect(enterOffice).toContain(requiredLanguageChoiceByLanguage[language]);
      expect(enterOffice).toContain(preselectedEnglishByLanguage[language]);
      expect(enterOffice).toContain(savedLanguageChoiceByLanguage[language]);
      expect(enterOffice).toContain(
        languageChoiceBeforeTitleByLanguage[language],
      );
      expect(enterOffice).not.toContain(
        languageChoiceAfterTitleByLanguage[language],
      );
      const enterOfficeText = enterOffice ?? "";
      expect(
        enterOfficeText.indexOf(firstLaunchLanguageChoiceByLanguage[language]),
      ).toBeLessThan(
        enterOfficeText.indexOf(titleAfterLanguageChoiceByLanguage[language]),
      );
      expect(
        enterOfficeText.indexOf(titleAfterLanguageChoiceByLanguage[language]),
      ).toBeLessThan(
        enterOfficeText.indexOf(nameAfterLanguageChoiceByLanguage[language]),
      );
      expect(
        enterOfficeText.indexOf(nameAfterLanguageChoiceByLanguage[language]),
      ).toBeLessThan(
        enterOfficeText.indexOf(officeAfterNameByLanguage[language]),
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

  it("collega screenshot verificabili ai primi due passi dell'ufficio in tutte le lingue", () => {
    const screenshotPaths = [
      "/tutorials/game/office-overview.png",
      "/tutorials/game/departments.png",
    ];

    for (const language of SUPPORTED_LANGS) {
      const steps = TUTORIAL_GUIDES[language].game.steps;
      const screenshots = steps.slice(0, 2).map((step) => step.image);

      expect(screenshots).toHaveLength(2);
      expect(screenshots).not.toContain(undefined);
      expect(screenshots.map((image) => image?.src)).toEqual(screenshotPaths);
      expect(steps.slice(2).every((step) => step.image === undefined)).toBe(
        true,
      );

      for (const image of screenshots) {
        expect(image).toBeDefined();
        expect(image.width).toBe(1600);
        expect(image.height).toBe(900);
        expect(image.alt).toBeTruthy();
        expect(image.caption).toBeTruthy();
        expect(
          existsSync(
            resolve(
              import.meta.dirname,
              "../../../web/public",
              image.src.replace(/^\//, ""),
            ),
          ),
          `${language}: asset ${image.src} assente`,
        ).toBe(true);
      }
    }
  });
});
