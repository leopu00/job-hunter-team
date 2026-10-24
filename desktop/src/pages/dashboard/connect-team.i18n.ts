import type { Locale } from "@/i18n/config";

/** The dashboard of a set-up profile with no team linked: where to link the team that is already on a VPS. */
export interface ConnectTeamPromptText {
  title: string;
  body: string;
  button: string;
}

export const CONNECT_TEAM_PROMPT_TEXT: Record<Locale, ConnectTeamPromptText> = {
  it: {
    title: "Nessuna squadra collegata a questa app",
    body: "Se hai già una squadra attiva su una VPS, collegala: l’app ti chiede i dati della VPS e controlla l’impronta SSH prima di salvare qualcosa.",
    button: "Collega un team",
  },
  en: {
    title: "No team is connected to this app",
    body: "If you already have a team running on a VPS, connect it: the app asks for the VPS details and checks the SSH fingerprint before saving anything.",
    button: "Connect a team",
  },
  de: {
    title: "Mit dieser App ist kein Team verbunden",
    body: "Wenn du bereits ein Team auf einer VPS laufen hast, verbinde es: Die App fragt nach den VPS-Daten und prüft den SSH-Fingerabdruck, bevor sie etwas speichert.",
    button: "Team verbinden",
  },
  es: {
    title: "Ningún equipo conectado a esta app",
    body: "Si ya tienes un equipo activo en un VPS, conéctalo: la app te pide los datos del VPS y comprueba la huella SSH antes de guardar nada.",
    button: "Conectar un equipo",
  },
  fr: {
    title: "Aucune équipe n’est connectée à cette app",
    body: "Si tu as déjà une équipe active sur un VPS, connecte-la : l’app te demande les informations du VPS et contrôle l’empreinte SSH avant d’enregistrer quoi que ce soit.",
    button: "Connecter une équipe",
  },
  hu: {
    title: "Ehhez az apphoz nincs csapat csatlakoztatva",
    body: "Ha már van egy VPS-en futó csapatod, csatlakoztasd: az app elkéri a VPS adatait, és mentés előtt ellenőrzi az SSH-ujjlenyomatot.",
    button: "Csapat csatlakoztatása",
  },
  pt: {
    title: "Nenhuma equipa ligada a esta app",
    body: "Se já tens uma equipa ativa numa VPS, liga-a: a app pede os dados da VPS e confere a impressão digital SSH antes de guardar o que quer que seja.",
    button: "Ligar uma equipa",
  },
};
