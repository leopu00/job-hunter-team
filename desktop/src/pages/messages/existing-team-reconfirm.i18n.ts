import type { Locale } from "@/i18n/config";

/** The chat's confirmation of an existing team: the words that are not already the setup's. */
export interface ExistingTeamReconfirmText {
  title: string;
  intro: string;
  account: string;
  loading: string;
  working: string;
}

export const EXISTING_TEAM_RECONFIRM_TEXT: Record<Locale, ExistingTeamReconfirmText> = {
  it: {
    title: "Collega il team per scrivere",
    intro: "Per scrivere agli agenti l’app deve collegarsi di nuovo a questa squadra, come al primo collegamento. Controlla che i dati siano quelli che ti aspetti.",
    account: "Account",
    loading: "Leggo il collegamento salvato…",
    working: "Collego il team…",
  },
  en: {
    title: "Connect the team to write",
    intro: "To write to the agents the app has to connect to this team again, as it did the first time. Check that these are the details you expect.",
    account: "Account",
    loading: "Reading the saved connection…",
    working: "Connecting the team…",
  },
  de: {
    title: "Team verbinden, um zu schreiben",
    intro: "Um den Agenten zu schreiben, muss sich die App erneut mit diesem Team verbinden, wie beim ersten Mal. Prüfe, ob die Angaben stimmen.",
    account: "Konto",
    loading: "Ich lese die gespeicherte Verbindung…",
    working: "Team wird verbunden…",
  },
  es: {
    title: "Conecta el equipo para escribir",
    intro: "Para escribir a los agentes, la app tiene que volver a conectarse a este equipo, como la primera vez. Comprueba que los datos son los que esperas.",
    account: "Cuenta",
    loading: "Leyendo la conexión guardada…",
    working: "Conectando el equipo…",
  },
  fr: {
    title: "Relie l’équipe pour écrire",
    intro: "Pour écrire aux agents, l’app doit se relier à nouveau à cette équipe, comme la première fois. Vérifie que les informations sont celles que tu attends.",
    account: "Compte",
    loading: "Je lis la connexion enregistrée…",
    working: "Liaison de l’équipe…",
  },
  hu: {
    title: "Csatlakoztasd a csapatot, hogy írhass",
    intro: "Ahhoz, hogy írhass az ügynököknek, az alkalmazásnak újra csatlakoznia kell ehhez a csapathoz, mint az első alkalommal. Ellenőrizd, hogy az adatok azok, amelyekre számítasz.",
    account: "Fiók",
    loading: "A mentett kapcsolat olvasása…",
    working: "A csapat csatlakoztatása…",
  },
  pt: {
    title: "Liga a equipa para escrever",
    intro: "Para escrever aos agentes, a app tem de voltar a ligar-se a esta equipa, como da primeira vez. Verifica se os dados são os que esperas.",
    account: "Conta",
    loading: "A ler a ligação guardada…",
    working: "A ligar a equipa…",
  },
};
