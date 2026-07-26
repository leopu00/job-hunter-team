// Dizionario di `SettingsMenu.tsx`.
//
// Le chiavi sono LOCALI a questo file: lo stesso nome può valere
// tutt'altro altrove (`empty` è "nessun backup" in una pagina e
// "nessun canale" in un'altra), quindi non vanno accorpate in un
// dizionario comune. `satisfies Dictionary` fa pretendere al
// compilatore tutte e sette le lingue: una voce a cui ne manca una
// non compila, invece di mostrare l'inglese all'utente sbagliato.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  settings: {
    it: 'Impostazioni',
    en: 'Settings',
    hu: 'Beállítások',
    es: 'Ajustes',
    de: 'Einstellungen',
    fr: 'Paramètres',
    pt: 'Configurações',
  },
  theme: {
    it: 'Tema',
    en: 'Theme',
    hu: 'Téma',
    es: 'Tema',
    de: 'Design',
    fr: 'Thème',
    pt: 'Tema',
  },
  team: {
    it: 'Team',
    en: 'Team',
    hu: 'Csapat',
    es: 'Equipo',
    de: 'Team',
    fr: 'Équipe',
    pt: 'Equipe',
  },
  org_chart: {
    it: 'Organigramma',
    en: 'Org chart',
    hu: 'Szervezeti ábra',
    es: 'Organigrama',
    de: 'Organigramm',
    fr: 'Organigramme',
    pt: 'Organograma',
  },
} satisfies Dictionary;
