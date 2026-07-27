// Overlay traduzioni Deutsch (de). Sovrascrive le chiavi presenti sopra la
// base it/en/hu; le chiavi assenti ripiegano automaticamente su `en`.
export const de: Record<string, string> = {
  // Chiavi aggiunte (allineamento i18n)
  home_intro:
    "Job Hunter Team ist ein Team autonomer KI-Agenten, die ununterbrochen für dich nach Arbeit suchen. Jeder Agent ist ein Spezialist: Einer spürt die Stellen auf, einer analysiert sie im Detail und einer vergibt jeder eine Bewertung, je nachdem, wie nah sie an dem ist, was dir wirklich wichtig ist. Auf Wunsch erstellen sie auch den Lebenslauf für deine Bewerbung. Und wenn die versendeten Bewerbungen nicht ausreichen, um Arbeit zu finden, steht dir ein eigener Agent zur Seite: Er hilft dir, dich auf dem Arbeitsmarkt zu orientieren und dich der gewünschten Rolle zu nähern. Du gibst die Richtung vor und behältst das letzte Wort; den Rest übernimmt das Team, privat, auf deiner eigenen Maschine.",
  theme_system: "System",
  theme_dark: "Nacht",
  theme_light: "Tag",
  nav_run: "Wie man es startet",
  home_pricing_alt:
    "Ein offenes Vorhängeschloss, umgeben von wenigen Münzen, eine leuchtend grün: Die Plattform ist kostenlos und Open Source, du zahlst nur den KI-Anbieter.",
  // Nav
  // Invariati rispetto all'inglese per scelta di prodotto: il marchio
  // usa "Home" e "Studies" in tutte e sette le lingue, italiano
  // compreso. Dichiarati esplicitamente perché il fallback silenzioso
  // non distingue una decisione da una dimenticanza.
  nav_home: "Home",
  nav_case_studies: "Studies",
  nav_team: "Team",
  nav_github: "GitHub",
  nav_download: "Installieren",
  nav_project: "Projekt",
  nav_pricing: "Preise",
  nav_login: "Anmelden",

  // Hero
  hero_badge: "öffentliche Beta",
  hero_desc_short: "Ein autonomes KI-Agententeam für deine Jobsuche.",

  // CTA
  cta_title_1: "Bereit, deine",
  cta_title_2: "Jobsuche zu revolutionieren?",
  cta_button: "Loslegen",

  // Footer
  footer_brand_desc:
    "Ein autonomes KI-Agententeam, das für dich auf Jobsuche geht. Open Source, lokal, privat.",
  footer_product: "Produkt",
  footer_stats: "Projekt",
  footer_resources: "Ressourcen",
  footer_contacts: "Kontakt",
  nav_contact: "Kontakt",
  footer_bug: "Fehler melden",
  footer_privacy: "Datenschutz",
  footer_terms: "Nutzungsbedingungen",
  footer_copyright: "Open Source unter MIT-Lizenz",

  // Download page
  dl_desc:
    "Das JHT-Dashboard wird über das Terminal gestartet, mit dem CLI- und TUI-Setup. Die Runtime läuft auf deinem Computer und deine Daten bleiben unter deiner Kontrolle.",
  dl_back: "← Zurück",
  dl_title_1: "Richte dein Team ein",
  dl_title_2: "auf deinem PC",
  dl_copy_cmd: "Befehl kopieren",
  dl_mode_desktop_title: "Desktop",
  dl_mode_terminal_title: "CLI",
  dl_desktop_soon_desc:
    "Die Desktop-App kommt für alle drei Betriebssysteme: Wir feilen noch daran, sie ist noch nicht herunterladbar. In der Zwischenzeit installiert die CLI alles.",
  dl_desktop_soon_badge: "Demnächst",
  dl_help_text: "Du weißt nicht, wo du es installieren sollst?",
  dl_help_link: "Lies die Anleitung",

  // Login page (LandingClient)
  login_save_progress: "Melde dich an, um deinen Fortschritt zu speichern",
  login_auth_failed: "Authentifizierung fehlgeschlagen.",
  login_config_missing: "Konfiguration fehlt.",
  login_with_google: "Anmelden mit Google",
  login_with_github: "Anmelden mit GitHub",
  back: "Zurück",

  // Aria-labels
  scroll_to_top: "Nach oben",
  nav_main: "Hauptnavigation",
  nav_menu: "Menü",
  nav_language: "Sprache: {label}",
  cookie_consent: "Cookie-Zustimmung",

  // CTA / Footer aria-labels
  cta_section_aria: "Jetzt starten",
  theme_aria: "Design",
  footer_aria: "Job Hunter Team Fußzeile",
  footer_links_aria: "Fußzeilen-Links",

  // LandingHome: hero alt + Abschnitte
  home_hero_alt:
    "Comic-Illustration: ein Team von KI-Agenten — alle mit derselben schwarzen Sonnenbrille — sitzt an einem langen Konferenztisch in einem eleganten Hochhausbüro, während ein stehender Agent Diagramme an einer Tafel präsentiert.",
  home_team_alt:
    "Drei Team-Agenten in voller Größe: der Scout mit einer Lupe, der Analyst im Laborkittel, der Schreiber mit einer Federkielfeder — alle mit Sonnenbrille.",
  home_setup_alt:
    "Ein Laptop, der einen blauen Lichtkegel aussendet, der sich zu einem leuchtenden Glaswürfel öffnet: darin arbeitet das Büro des Teams.",
  home_team_kicker: "Das Team",
  home_team_title: "Ein Team, kein einzelner Bot",
  home_team_body:
    "Ein einzelner Chatbot muss alles allein machen und glänzt in nichts. Ein Team nicht: Jeder Agent hat eine genaue Aufgabe und führt sie gründlich aus, und die Arbeit jedes Einzelnen wird vom Nächsten geprüft. So kümmert sich um jede Phase, wer sie am besten beherrscht, und was bei dir ankommt, wurde bereits mehrfach kontrolliert.",
  home_team_cta: "Lerne das Team kennen →",
  home_setup_kicker: "Starte es",
  home_setup_title: "Wie du willst, wo du willst",
  home_setup_body:
    "Es läuft auf einem dauerhaft eingeschalteten dedizierten Computer oder einem günstigen VPS und arbeitet Tag und Nacht für dich. Du verwaltest es über die Desktop-App: starten, stoppen und das Team mit einem Klick im Blick behalten. Und du bist nicht an diesen Computer gebunden: Über das Web kannst du die Ergebnisse verfolgen und mit dem Team auch von einem anderen PC oder deinem Handy sprechen.",
  home_setup_cta: "Wie man es startet →",
  home_pricing_kicker: "Preise",
  home_pricing_title: "Open Source. Die Plattform ist kostenlos.",
  home_pricing_body:
    "Job Hunter Team ist kostenlos. Die einzigen Kosten sind das Abonnement des KI-Anbieters, den du wählst — ab etwa 40 € pro Monat — oder nichts, wenn du eines Tages lokale Modelle verwendest und nur den Strom bezahlst.",
  home_pricing_cta: "Sieh die Kosten →",
};
