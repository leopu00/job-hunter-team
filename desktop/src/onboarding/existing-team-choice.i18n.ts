import type { Locale } from "@/i18n/config";

/**
 * The step shown when more than one running container answers as the team: the
 * person picks one, then checks and confirms it on the usual receipt. The words
 * never call one of them the right one: the app does not know which it is.
 */
export interface ExistingTeamChoiceText {
  eyebrow: string;
  /** `{count}`: how many containers answer as the team. */
  intro: string;
  cause: string;
  todo: string;
  listLabel: string;
  name: string;
  noName: string;
  state: string;
  /** `{date}`: when the container was started. */
  runningSince: string;
  running: string;
  newest: string;
  image: string;
  container: string;
  assistant: string;
  assistantUp: string;
  assistantDown: string;
  pick: string;
  cancel: string;
}

export const EXISTING_TEAM_CHOICE_TEXT: Record<Locale, ExistingTeamChoiceText> = {
  it: {
    eyebrow: "Più container per questa squadra",
    intro: "Sulla VPS {count} container accesi rispondono come questa squadra, e l’app non sa quale sia quello giusto.",
    cause: "Di solito è un container vecchio rimasto acceso dopo un aggiornamento o una seconda installazione.",
    todo: "Scegli quello che usi: nel passo dopo ne controlli i dati e confermi. Per non dover scegliere di nuovo, chiedi a chi gestisce la VPS di fermare quello vecchio.",
    listLabel: "Container che rispondono come questa squadra",
    name: "Nome",
    noName: "nome non letto",
    state: "Stato",
    runningSince: "acceso dal {date}",
    running: "acceso",
    newest: "il più recente",
    image: "Revisione dell’immagine",
    container: "Container",
    assistant: "Assistente",
    assistantUp: "attivo",
    assistantDown: "non attivo",
    pick: "Usa questo container",
    cancel: "Annulla",
  },
  en: {
    eyebrow: "More than one container for this team",
    intro: "On the VPS {count} running containers answer as this team, and the app cannot tell which one is right.",
    cause: "Usually it is an old container left running after an update or a second installation.",
    todo: "Pick the one you use: in the next step you check its details and confirm. So that you do not have to pick again, ask whoever manages the VPS to stop the old one.",
    listLabel: "Containers that answer as this team",
    name: "Name",
    noName: "name not read",
    state: "State",
    runningSince: "running since {date}",
    running: "running",
    newest: "the newest",
    image: "Image revision",
    container: "Container",
    assistant: "Assistant",
    assistantUp: "running",
    assistantDown: "not running",
    pick: "Use this container",
    cancel: "Cancel",
  },
  de: {
    eyebrow: "Mehrere Container für dieses Team",
    intro: "Auf der VPS antworten {count} laufende Container als dieses Team, und die App kann nicht erkennen, welcher der richtige ist.",
    cause: "Meist ist es ein alter Container, der nach einem Update oder einer zweiten Installation weiterläuft.",
    todo: "Wähle den, den du nutzt: Im nächsten Schritt prüfst du seine Angaben und bestätigst. Damit du nicht erneut wählen musst, bitte die Person, die die VPS verwaltet, den alten zu stoppen.",
    listLabel: "Container, die als dieses Team antworten",
    name: "Name",
    noName: "Name nicht gelesen",
    state: "Status",
    runningSince: "läuft seit {date}",
    running: "läuft",
    newest: "der neueste",
    image: "Revision des Images",
    container: "Container",
    assistant: "Assistent",
    assistantUp: "aktiv",
    assistantDown: "nicht aktiv",
    pick: "Diesen Container verwenden",
    cancel: "Abbrechen",
  },
  fr: {
    eyebrow: "Plusieurs conteneurs pour cette équipe",
    intro: "Sur le VPS, {count} conteneurs en marche répondent comme cette équipe, et l’app ne peut pas savoir lequel est le bon.",
    cause: "En général, c’est un ancien conteneur resté allumé après une mise à jour ou une deuxième installation.",
    todo: "Choisis celui que tu utilises : à l’étape suivante tu vérifies ses informations et tu confirmes. Pour ne pas avoir à choisir de nouveau, demande à qui gère le VPS d’arrêter l’ancien.",
    listLabel: "Conteneurs qui répondent comme cette équipe",
    name: "Nom",
    noName: "nom non lu",
    state: "État",
    runningSince: "en marche depuis le {date}",
    running: "en marche",
    newest: "le plus récent",
    image: "Révision de l’image",
    container: "Conteneur",
    assistant: "Assistant",
    assistantUp: "actif",
    assistantDown: "inactif",
    pick: "Utiliser ce conteneur",
    cancel: "Annuler",
  },
  es: {
    eyebrow: "Varios contenedores para este equipo",
    intro: "En el VPS, {count} contenedores en marcha responden como este equipo, y la app no puede saber cuál es el correcto.",
    cause: "Normalmente es un contenedor antiguo que quedó encendido tras una actualización o una segunda instalación.",
    todo: "Elige el que usas: en el paso siguiente compruebas sus datos y confirmas. Para no tener que elegir otra vez, pide a quien gestiona el VPS que detenga el antiguo.",
    listLabel: "Contenedores que responden como este equipo",
    name: "Nombre",
    noName: "nombre no leído",
    state: "Estado",
    runningSince: "en marcha desde el {date}",
    running: "en marcha",
    newest: "el más reciente",
    image: "Revisión de la imagen",
    container: "Contenedor",
    assistant: "Asistente",
    assistantUp: "activo",
    assistantDown: "inactivo",
    pick: "Usar este contenedor",
    cancel: "Cancelar",
  },
  pt: {
    eyebrow: "Vários contentores para esta equipa",
    intro: "Na VPS, {count} contentores em execução respondem como esta equipa, e a app não consegue saber qual é o certo.",
    cause: "Normalmente é um contentor antigo que ficou ligado depois de uma atualização ou de uma segunda instalação.",
    todo: "Escolhe o que usas: no passo seguinte verificas os dados e confirmas. Para não teres de escolher outra vez, pede a quem gere a VPS que pare o antigo.",
    listLabel: "Contentores que respondem como esta equipa",
    name: "Nome",
    noName: "nome não lido",
    state: "Estado",
    runningSince: "em execução desde {date}",
    running: "em execução",
    newest: "o mais recente",
    image: "Revisão da imagem",
    container: "Contentor",
    assistant: "Assistente",
    assistantUp: "ativo",
    assistantDown: "inativo",
    pick: "Usar este contentor",
    cancel: "Cancelar",
  },
  hu: {
    eyebrow: "Több konténer ehhez a csapathoz",
    intro: "A VPS-en {count} futó konténer válaszol ennek a csapatnak, és az app nem tudja eldönteni, melyik a helyes.",
    cause: "Általában egy régi konténer, amely egy frissítés vagy egy második telepítés után futva maradt.",
    todo: "Válaszd ki, amelyiket használod: a következő lépésben ellenőrzöd az adatait, és megerősíted. Hogy ne kelljen újra választanod, kérd meg a VPS kezelőjét, hogy állítsa le a régit.",
    listLabel: "A csapatként válaszoló konténerek",
    name: "Név",
    noName: "a név nem olvasható",
    state: "Állapot",
    runningSince: "fut {date} óta",
    running: "fut",
    newest: "a legújabb",
    image: "A kép revíziója",
    container: "Konténer",
    assistant: "Asszisztens",
    assistantUp: "aktív",
    assistantDown: "nem aktív",
    pick: "Ezt a konténert használom",
    cancel: "Mégse",
  },
};
