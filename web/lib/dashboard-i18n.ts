import type { ServerLocale } from './server-locale'

const T = {
  it: {
    live:            'live · team attivo',
    data_updated:    'dati aggiornati',
    title:           'Dashboard',
    total_positions: (total: number, excluded: number, active: number) =>
      `${total} posizioni totali · ${excluded} escluse · ${active} attive`,

    // Onboarding
    start_here:           'Inizia qui',
    setup_intro:          'Configura il tuo profilo per avviare la ricerca.',
    step1_title:          'Configura il Profilo',
    step1_completed:      'completato',
    step1_desc_done:      'Profilo configurato. Il team userà queste informazioni per personalizzare la ricerca.',
    step1_desc_todo:      'Ruolo target, skill, preferenze e range stipendio. Il team userà queste informazioni per la ricerca.',
    step2_title:          'Avvia il Team',
    step2_desc_done:      'Profilo pronto. Avvia il team di agenti per iniziare la ricerca automatica.',
    step2_desc_todo:      'Configura prima il profilo. Il team ha bisogno delle tue informazioni per cercare posizioni compatibili.',
    help_text:            'Hai bisogno di aiuto? L\'assistente può guidarti nella compilazione del profilo.',
    open_assistant:       'Apri assistente →',

    // Stats
    overview:             'Panoramica',
    found:                'Trovate',
    analyzed:             'Analizzate',
    scored:               'Valutate',
    cvs_written:          'CV scritti',
    ready:                'Pronte',
    sent:                 'Inviate',

    // Pipeline
    pipeline:             'Pipeline',
    p_new:                'Nuove',
    p_checked:            'Verificate',
    p_scored:             'Valutate',
    p_writing:            'Scrittura',
    p_review:             'Revisione',
    p_ready:              'Pronte',
    p_applied:            'Inviate',

    // Charts
    score_distribution:   'Distribuzione Score',
    score_footer:         (w: number, t: number) => `${w} di ${t} con score · ${t - w} senza`,
    sources:              'Fonti',
    no_data:              'Nessun dato',

    // Table
    recent_positions:     'Posizioni Recenti',
    view_all:             'Vedi tutte →',
    col_id:               'ID',
    col_title:            'Titolo',
    col_company:          'Azienda',
    col_location:         'Luogo',
    col_remote:           'Remote',
    col_score:            'Score',
    col_status:           'Stato',
    no_positions:         'Nessuna posizione trovata.',

    // Pipeline statuses
    status_new:      'Nuova',
    status_checked:  'Verificata',
    status_scored:   'Valutata',
    status_writing:  'Scrittura',
    status_review:   'Revisione',
    status_ready:    'Pronta',
    status_applied:  'Inviata',
    status_response: 'Risposta',
    status_excluded: 'Esclusa',
  },

  en: {
    live:            'live · team active',
    data_updated:    'data updated',
    title:           'Dashboard',
    total_positions: (total: number, excluded: number, active: number) =>
      `${total} total positions · ${excluded} excluded · ${active} active`,

    start_here:           'Start here',
    setup_intro:          'Configure your profile to start the search.',
    step1_title:          'Configure your Profile',
    step1_completed:      'completed',
    step1_desc_done:      'Profile configured. The team will use this information to personalize the search.',
    step1_desc_todo:      'Target role, skills, preferences and salary range. The team will use this information for the search.',
    step2_title:          'Start the Team',
    step2_desc_done:      'Profile ready. Start the agent team to begin automated job searching.',
    step2_desc_todo:      'Configure your profile first. The team needs your information to search for matching positions.',
    help_text:            'Need help? The assistant can guide you in filling out your profile.',
    open_assistant:       'Open assistant →',

    overview:             'Overview',
    found:                'Found',
    analyzed:             'Analyzed',
    scored:               'Scored',
    cvs_written:          'CVs written',
    ready:                'Ready',
    sent:                 'Sent',

    pipeline:             'Pipeline',
    p_new:                'New',
    p_checked:            'Checked',
    p_scored:             'Scored',
    p_writing:            'Writing',
    p_review:             'Review',
    p_ready:              'Ready',
    p_applied:            'Applied',

    score_distribution:   'Score Distribution',
    score_footer:         (w: number, t: number) => `${w} of ${t} with score · ${t - w} without`,
    sources:              'Sources',
    no_data:              'No data',

    recent_positions:     'Recent Positions',
    view_all:             'View all →',
    col_id:               'ID',
    col_title:            'Title',
    col_company:          'Company',
    col_location:         'Location',
    col_remote:           'Remote',
    col_score:            'Score',
    col_status:           'Status',
    no_positions:         'No positions found.',

    status_new:      'New',
    status_checked:  'Checked',
    status_scored:   'Scored',
    status_writing:  'Writing',
    status_review:   'Review',
    status_ready:    'Ready',
    status_applied:  'Applied',
    status_response: 'Response',
    status_excluded: 'Excluded',
  },

  hu: {
    live:            'élő · csapat aktív',
    data_updated:    'adatok frissítve',
    title:           'Irányítópult',
    total_positions: (total: number, excluded: number, active: number) =>
      `${total} összes állás · ${excluded} kizárva · ${active} aktív`,

    start_here:           'Kezdj itt',
    setup_intro:          'Konfiguráld a profilodat a keresés indításához.',
    step1_title:          'Profil konfigurálása',
    step1_completed:      'kész',
    step1_desc_done:      'Profil konfigurálva. A csapat ezt az információt használja a keresés személyre szabásához.',
    step1_desc_todo:      'Célszerepkör, készségek, preferenciák és fizetési sáv. A csapat ezt az információt használja a kereséshez.',
    step2_title:          'Csapat indítása',
    step2_desc_done:      'Profil kész. Indítsd el az ügynök csapatot az automatikus álláskereséshez.',
    step2_desc_todo:      'Először konfiguráld a profilodat. A csapatnak szüksége van az adataidra a megfelelő állások kereséséhez.',
    help_text:            'Segítségre van szükséged? Az asszisztens segíthet a profil kitöltésében.',
    open_assistant:       'Asszisztens megnyitása →',

    overview:             'Áttekintés',
    found:                'Talált',
    analyzed:             'Elemzett',
    scored:               'Értékelt',
    cvs_written:          'Megírt önéletrajz',
    ready:                'Kész',
    sent:                 'Elküldve',

    pipeline:             'Folyamat',
    p_new:                'Új',
    p_checked:            'Ellenőrzött',
    p_scored:             'Értékelt',
    p_writing:            'Írás',
    p_review:             'Áttekintés',
    p_ready:              'Kész',
    p_applied:            'Elküldve',

    score_distribution:   'Pontszám eloszlás',
    score_footer:         (w: number, t: number) => `${w} / ${t} pontszámmal · ${t - w} nélkül`,
    sources:              'Források',
    no_data:              'Nincs adat',

    recent_positions:     'Legutóbbi állások',
    view_all:             'Összes megtekintése →',
    col_id:               'ID',
    col_title:            'Cím',
    col_company:          'Cég',
    col_location:         'Helyszín',
    col_remote:           'Távmunka',
    col_score:            'Pontszám',
    col_status:           'Állapot',
    no_positions:         'Nem találhatók állások.',

    status_new:      'Új',
    status_checked:  'Ellenőrzött',
    status_scored:   'Értékelt',
    status_writing:  'Írás',
    status_review:   'Áttekintés',
    status_ready:    'Kész',
    status_applied:  'Elküldve',
    status_response: 'Válasz',
    status_excluded: 'Kizárva',
  },
}

export type DashboardT = typeof T.it
export function getDashboardT(locale: ServerLocale): DashboardT {
  return T[locale] ?? T.it
}
