"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  lazy,
  Suspense,
  type ReactNode,
} from "react";

import { es } from "./i18n/es";
import { fr } from "./i18n/fr";
import { de } from "./i18n/de";
import { pt } from "./i18n/pt";

const CookieConsent = lazy(() => import("./CookieConsent"));

export type Lang = "it" | "en" | "es" | "fr" | "de" | "pt" | "hu";

// Overlay per le lingue aggiunte sopra la base it/en/hu. La risoluzione in
// t(): overlay[lang][key] → base[key][lang] → base[key].en (fallback EN).
const overlays: Partial<Record<Lang, Record<string, string>>> = {
  es,
  fr,
  de,
  pt,
};

export const SUPPORTED_LANGS: Lang[] = [
  "it",
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "hu",
];

const STORAGE_KEY = "jht-lang";

function getSavedLang(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (SUPPORTED_LANGS as string[]).includes(saved)) {
    return saved as Lang;
  }
  return "en";
}

const translations = {
  // Nav
  nav_home: { it: "Home", en: "Home", hu: "Home" },
  nav_github: { it: "GitHub", en: "GitHub", hu: "GitHub" },
  nav_download: { it: "Installa", en: "Install", hu: "Telepítés" },
  nav_run: { it: "Come si avvia", en: "How to run it", hu: "Hogyan indítható" },
  nav_team: { it: "Team", en: "Team", hu: "Csapat" },
  nav_pricing: { it: "Prezzi", en: "Pricing", hu: "Árak" },
  nav_case_studies: {
    it: "Studies",
    en: "Studies",
    hu: "Studies",
  },
  nav_project: { it: "Il progetto", en: "Project", hu: "Projekt" },
  nav_tutorials: { it: "Tutorial", en: "Tutorials", hu: "Oktatóanyagok" },
  nav_login: { it: "Accedi", en: "Sign in", hu: "Bejelentkezés" },

  // Hero
  hero_badge: { it: "beta pubblica", en: "public beta", hu: "nyilvános béta" },
  hero_desc_short: {
    it: "Una squadra di agenti AI autonomi per la tua ricerca di lavoro.",
    en: "An autonomous AI agent team for your job search.",
    hu: "Autonóm AI-ügynökök csapata az álláskeresésedhez.",
  },
  home_intro: {
    it: "Job Hunter Team è una squadra di agenti AI autonomi che cercano lavoro per te, di continuo. Ogni agente è uno specialista: c'è chi individua le offerte, chi le analizza nel dettaglio e chi assegna a ciascuna un punteggio, in base a quanto è vicina a ciò che conta davvero per te. Su tua richiesta preparano anche il CV per candidarti. Un agente dedicato ti aiuta inoltre a orientarti nel mercato del lavoro e ad avvicinarti al ruolo che desideri. Osservare il mercato è un uso completo del prodotto. La direzione la dai tu e l'ultima parola resta sempre tua; il resto lo porta avanti il team, in privato, sulla tua macchina.",
    en: "Job Hunter Team is a team of autonomous AI agents that hunt for jobs for you, around the clock. Each agent is a specialist: one finds the openings, one analyzes them in detail, and one gives each a score based on how close it is to what truly matters to you. On request, they also prepare your CV so you can apply. A dedicated agent can also help you get your bearings in the job market and move closer to the role you want. Observing the market is a complete use of the product. You set the direction and the final word is always yours; the rest is carried forward by the team, privately, on your own machine.",
    hu: "A Job Hunter Team autonóm AI-ügynökök csapata, amely folyamatosan állást keres neked. Minden ügynök szakember: az egyik megtalálja az ajánlatokat, egy másik részletesen elemzi őket, egy pedig pontszámot ad mindegyiknek aszerint, mennyire áll közel ahhoz, ami igazán számít neked. Kérésedre az önéletrajzot is elkészítik a jelentkezéshez. Egy dedikált ügynök a munkaerőpiacon való tájékozódásban és a kívánt szerep felé vezető úton is segít. A piac megfigyelése a termék teljes értékű használata. Az irányt te adod meg, és a végső szó mindig a tiéd; a többit a csapat viszi tovább, privát módon, a saját gépeden.",
  },

  // CTA
  cta_title_1: {
    it: "Pronto a rivoluzionare",
    en: "Ready to revolutionize",
    hu: "Készen állsz a forradalomra",
  },
  cta_title_2: {
    it: "la tua ricerca lavoro?",
    en: "your job search?",
    hu: "az álláskeresésedben?",
  },
  cta_button: {
    it: "Inizia",
    en: "Get started",
    hu: "Kezdés",
  },

  // Footer
  footer_brand_desc: {
    it: "Una squadra di agenti AI autonomi che cercano lavoro per te. Open source, locale, privato.",
    en: "A team of autonomous AI agents that job-hunts for you. Open source, local, private.",
    hu: "Autonóm AI-ügynökök csapata, amely állást keres helyetted. Nyílt forráskódú, helyi, privát.",
  },
  footer_product: { it: "Prodotto", en: "Product", hu: "Termék" },
  footer_stats: { it: "Progetto", en: "Project", hu: "Projekt" },
  footer_resources: { it: "Risorse", en: "Resources", hu: "Források" },
  footer_tutorials: { it: "Tutorial", en: "Tutorials", hu: "Oktatóanyagok" },
  footer_contacts: { it: "Contatti", en: "Contacts", hu: "Kapcsolat" },
  nav_contact: {
    it: "Contatti",
    en: "Contact",
    hu: "Kapcsolat",
  },
  footer_bug: {
    it: "Segnala un bug",
    en: "Report a bug",
    hu: "Hiba jelentése",
  },
  footer_privacy: {
    it: "Privacy Policy",
    en: "Privacy Policy",
    hu: "Adatvédelmi Irányelvek",
  },
  footer_terms: {
    it: "Termini di Servizio",
    en: "Terms of Service",
    hu: "Szolgáltatási Feltételek",
  },
  footer_copyright: {
    it: "Open Source sotto licenza MIT",
    en: "Open Source under MIT License",
    hu: "Nyílt forráskód MIT licenc alatt",
  },
  tutorials_title: { it: "Tutorial", en: "Tutorials", hu: "Oktatóanyagok" },
  tutorial_game_title: { it: "Gioco", en: "Game", hu: "Játék" },
  tutorial_web_title: { it: "Web", en: "Web", hu: "Web" },
  trailer_title: { it: "Trailer", en: "Trailer", hu: "Előzetes" },
  theme_system: { it: "sistema", en: "system", hu: "rendszer" },
  theme_dark: { it: "notte", en: "night", hu: "éjszaka" },
  theme_light: { it: "giorno", en: "day", hu: "nappal" },

  // Download page
  dl_desc: {
    it: "Scarica l'app desktop per configurare e seguire il tuo team. La CLI resta disponibile per chi preferisce il terminale.",
    en: "Download the desktop app to set up and follow your team. The CLI remains available if you prefer the terminal.",
    hu: "Töltsd le az asztali appot a csapat beállításához és követéséhez. Ha a terminált kedveled, a CLI továbbra is elérhető.",
  },
  dl_back: { it: "← Indietro", en: "← Back", hu: "← Vissza" },
  dl_title_1: {
    it: "Configura il tuo team",
    en: "Set up your team",
    hu: "Állítsd be a csapatod",
  },
  dl_title_2: {
    it: "sul tuo PC",
    en: "on your computer",
    hu: "a számítógépeden",
  },
  dl_copy_cmd: {
    it: "Copia comando",
    en: "Copy command",
    hu: "Parancs másolása",
  },
  dl_mode_desktop_title: { it: "Desktop", en: "Desktop", hu: "Asztali" },
  dl_mode_terminal_title: { it: "CLI", en: "CLI", hu: "CLI" },
  dl_desktop_beta_desc: {
    it: "L'app desktop è l'ufficio dove vedi il team lavorare. È in beta: la usiamo tutti i giorni, ma cambia spesso. Se preferisci una strada più collaudata, resta la CLI.",
    en: "The desktop app is the office where you watch the team work. It is in beta: we use it daily, but it changes often. If you prefer a more settled path, the CLI is still there.",
    hu: "Az asztali app az iroda, ahol a csapatot dolgozni látod. Bétában van: naponta használjuk, de gyakran változik. Ha kiforrottabb utat szeretnél, a CLI továbbra is elérhető.",
  },
  dl_desktop_beta_badge: {
    it: "Beta",
    en: "Beta",
    hu: "Béta",
  },
  dl_desktop_unsigned_note: {
    it: "Su macOS l'app è firmata e notarizzata: si apre con un doppio clic. Su Windows non è firmata, quindi SmartScreen mostra «Windows ha protetto il PC»: clicca «Ulteriori informazioni» e poi «Esegui comunque». Su Linux l'archivio va estratto e reso eseguibile.",
    en: "On macOS the app is signed and notarized: it opens with a double click. On Windows it is not signed, so SmartScreen shows “Windows protected your PC”: click “More info”, then “Run anyway”. On Linux, extract the archive and make it executable.",
    hu: "macOS-en az app aláírt és notarizált: dupla kattintással megnyílik. Windowson nincs aláírva, ezért a SmartScreen kiírja: „A Windows megvédte a számítógépét” — kattints a „További információk”, majd a „Futtatás mindenképp” gombra. Linuxon csomagold ki az archívumot és tedd futtathatóvá.",
  },
  dl_help_text: {
    it: "Non sai dove installarlo?",
    en: "Not sure where to install it?",
    hu: "Nem tudod, hová telepítsd?",
  },
  dl_help_link: {
    it: "Leggi la guida",
    en: "Read the guide",
    hu: "Olvasd el az útmutatót",
  },

  // ─── Login page (LandingClient) ───────────────────────────────────
  login_save_progress: {
    it: "Accedi per salvare i tuoi progressi",
    en: "Sign in to save your progress",
    hu: "Jelentkezz be a haladásod mentéséhez",
  },
  login_auth_failed: {
    it: "Autenticazione fallita.",
    en: "Authentication failed.",
    hu: "A hitelesítés sikertelen.",
  },
  login_config_missing: {
    it: "Configurazione mancante.",
    en: "Configuration missing.",
    hu: "Hiányzó konfiguráció.",
  },
  login_with_google: {
    it: "Accedi con Google",
    en: "Login with Google",
    hu: "Bejelentkezés Google-lel",
  },
  login_with_github: {
    it: "Accedi con GitHub",
    en: "Login with GitHub",
    hu: "Bejelentkezés GitHub-bal",
  },
  back: { it: "Indietro", en: "Back", hu: "Vissza" },

  // ─── Aria-labels (scroll / nav / cookie) ──────────────────────────
  scroll_to_top: {
    it: "Torna in cima",
    en: "Back to top",
    hu: "Vissza a tetejére",
  },
  nav_main: {
    it: "Navigazione principale",
    en: "Main navigation",
    hu: "Fő navigáció",
  },
  nav_menu: { it: "Menu", en: "Menu", hu: "Menü" },
  nav_language: {
    it: "Lingua: {label}",
    en: "Language: {label}",
    hu: "Nyelv: {label}",
  },
  cookie_consent: {
    it: "Consenso ai cookie",
    en: "Cookie consent",
    hu: "Cookie hozzájárulás",
  },

  // ─── CTA / Footer aria-labels (LandingCTA) ────────────────────────
  cta_section_aria: {
    it: "Inizia ora",
    en: "Get started",
    hu: "Kezdés",
  },
  theme_aria: { it: "Tema", en: "Theme", hu: "Téma" },
  footer_aria: {
    it: "Footer Job Hunter Team",
    en: "Job Hunter Team footer",
    hu: "Job Hunter Team lábléc",
  },
  footer_links_aria: {
    it: "Link footer",
    en: "Footer links",
    hu: "Lábléc hivatkozások",
  },

  // ─── LandingHome: sezioni ─────────────────────────────────────────
  // (l'alt dell'hero ora vive in LandingGlobe.i18n.ts col globo)
  home_team_alt: {
    it: "Tre agenti del team a figura intera: lo Scout con la lente, l'Analista in camice, lo Scrittore con la penna d'oca — tutti con gli occhiali da sole.",
    en: "Three full-body team agents: the Scout with a magnifying glass, the Analyst in a lab coat, the Writer with a quill pen — all wearing sunglasses.",
    hu: "Három teljes alakos csapatügynök: a Scout nagyítóval, az Analista fehér köpenyben, az Író lúdtollal — mind napszemüvegben.",
  },
  home_setup_alt: {
    it: "Un laptop da cui esce un cono di luce blu che si apre fino a un cubo di vetro luminoso: dentro c'è l'ufficio del team al lavoro.",
    en: "A laptop emitting a blue cone of light that opens into a glowing glass cube: inside is the team's office at work.",
    hu: "Egy laptop, amelyből kék fénykúp árad, és egy világító üvegkockává nyílik: belül a csapat irodája dolgozik.",
  },
  home_pricing_alt: {
    it: "Un lucchetto aperto circondato da poche monete, una verde luminosa: la piattaforma è gratuita e open source, paghi solo il provider AI.",
    en: "An open padlock surrounded by a few coins, one glowing green: the platform is free and open source, you only pay the AI provider.",
    hu: "Egy nyitott lakat néhány érmével körülvéve, egy zölden világít: a platform ingyenes és nyílt forráskódú, csak az AI-szolgáltatót fizeted.",
  },

  home_team_kicker: { it: "Il team", en: "The team", hu: "A csapat" },
  home_team_title: {
    it: "Una squadra, non un singolo bot",
    en: "A team, not a single bot",
    hu: "Egy csapat, nem egyetlen bot",
  },
  home_team_body: {
    it: "Un solo chatbot deve fare tutto da sé e non eccelle in niente. Una squadra no: ogni agente ha un compito preciso e lo porta a fondo, e il lavoro di ciascuno passa al vaglio di quello successivo. Così ogni fase è curata da chi la sa fare meglio, e quello che arriva a te è già stato controllato più volte.",
    en: "A single chatbot spreads itself thin and masters nothing. Here every agent has one job and goes deep — and nothing one produces goes unchecked: each step is reviewed by the next. The focus of a specialist at every stage, not one generalist cutting corners.",
    hu: "Egyetlen chatbotnak mindent magának kell csinálnia, és semmiben sem jeleskedik. Egy csapatnál ez másképp van: minden ügynöknek egy pontos feladata van, amelyet alaposan elvégez, és mindegyikük munkáját a következő ellenőrzi. Így minden szakaszt az gondoz, aki a legjobban ért hozzá, és ami hozzád eljut, azt már többször ellenőrizték.",
  },
  home_team_cta: {
    it: "Scopri il team →",
    en: "Meet the team →",
    hu: "Ismerd meg a csapatot →",
  },
  home_setup_kicker: { it: "Avvialo", en: "Run it", hu: "Indítsd el" },
  home_setup_title: {
    it: "Come vuoi, dove vuoi",
    en: "However and wherever you want",
    hu: "Ahogy és ahol szeretnéd",
  },
  home_setup_body: {
    it: "Gira su un computer dedicato sempre acceso o su una VPS economica, e lavora per te giorno e notte. Lo gestisci dall'app desktop: avvii, fermi e tieni d'occhio la squadra con un clic. E non sei costretto a stare al computer: dal web puoi seguire i risultati e parlare con il team anche da un altro PC o dal telefono.",
    en: "It runs on an always-on dedicated computer or an affordable VPS, working for you day and night. You manage it from the desktop app: start, stop and keep an eye on the team with one click. And you're not tied to that computer: from the web you can follow the results and talk to the team from another PC or your phone too.",
    hu: "Egy mindig bekapcsolt dedikált számítógépen vagy egy megfizethető VPS-en fut, és éjjel-nappal dolgozik érted. Az asztali appból kezeled: egyetlen kattintással indítod, leállítod és szemmel tartod a csapatot. És nem vagy ahhoz a géphez kötve: a webről is követheted az eredményeket, és beszélhetsz a csapattal egy másik PC-ről vagy a telefonodról is.",
  },
  home_setup_cta: {
    it: "Come si avvia →",
    en: "How to run it →",
    hu: "Hogyan indítsd el →",
  },
  home_pricing_kicker: { it: "Prezzi", en: "Pricing", hu: "Árak" },
  home_pricing_title: {
    it: "Open source. La piattaforma è gratis.",
    en: "Open source. The platform is free.",
    hu: "Nyílt forráskód. A platform ingyenes.",
  },
  home_pricing_body: {
    it: "Job Hunter Team non si paga. L'unico costo è l'abbonamento al provider AI che scegli — da circa €40 al mese — oppure nulla, se un domani userai modelli locali e pagherai solo l'elettricità.",
    en: "Job Hunter Team is free. The only cost is the subscription to the AI provider you choose — from about €40 a month — or nothing, if one day you use local models and pay only for electricity.",
    hu: "A Job Hunter Team ingyenes. Az egyetlen költség az általad választott AI szolgáltató előfizetése — körülbelül €40-tól havonta — vagy semmi, ha egy nap helyi modelleket használsz és csak az áramért fizetsz.",
  },
  home_pricing_cta: {
    it: "Vedi i costi →",
    en: "See the costs →",
    hu: "Lásd a költségeket →",
  },
} as const;

type StringKeys = {
  [
    K in keyof typeof translations
  ]: (typeof translations)[K]["it"] extends string ? K : never;
}[keyof typeof translations];
interface I18nCtx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKeys) => string;
}

const LandingI18nContext = createContext<I18nCtx>({
  lang: "en",
  setLang: () => {},
  t: (key) => translations[key].en as string,
});

export function useLandingI18n() {
  return useContext(LandingI18nContext);
}

export function LandingI18nProvider({ children }: { children: ReactNode }) {
  // Inizializza sempre con 'en' per evitare hydration mismatch
  // Dopo il mount, legge il localStorage
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = getSavedLang();
    setLangState(saved);
    fetch("/api/i18n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: saved }),
    }).catch(() => {
      /* best effort */
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    fetch("/api/i18n", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    }).catch(() => {
      /* best effort */
    });
  }, []);

  const t = useCallback(
    (key: StringKeys) => {
      // Overlay lingua → base[lang] → fallback su `en`.
      const o = overlays[lang]?.[key];
      if (o) return o;
      const entry = translations[key] as Record<string, string>;
      return entry[lang] ?? entry.en;
    },
    [lang],
  );

  return (
    <LandingI18nContext.Provider value={{ lang, setLang, t }}>
      {children}
      <Suspense>
        <CookieConsent />
      </Suspense>
    </LandingI18nContext.Provider>
  );
}
