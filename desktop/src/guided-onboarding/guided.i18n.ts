import type { LocaleDict } from "@/lib/i18n-dict";
import type { GuidedMoment } from "./moments";

/** The words of the screen that follows the setup. The Assistant's own words come from the Assistant, in the chat. */

export const GUIDED_PROFILE_ARIA: LocaleDict = {
  en: "Your profile so far",
  it: "Il tuo profilo finora",
  hu: "A profilod eddig",
  es: "Tu perfil hasta ahora",
  de: "Dein Profil bisher",
  fr: "Ton profil jusqu’ici",
  pt: "O teu perfil até agora",
};

export const GUIDED_CHAT_ARIA: LocaleDict = {
  en: "Chat with the Assistant",
  it: "Chat con l’Assistente",
  hu: "Csevegés az Asszisztenssel",
  es: "Chat con el Asistente",
  de: "Chat mit dem Assistenten",
  fr: "Chat avec l’Assistant",
  pt: "Conversa com o Assistente",
};

/** One line above the chat: where the person is. */
export const GUIDED_MOMENT_LINE: Record<GuidedMoment, LocaleDict> = {
  interview: {
    en: "Answer my questions: the card fills in as we go.",
    it: "Rispondi alle mie domande: la scheda si riempie man mano.",
    hu: "Válaszolj a kérdéseimre: a kártya menet közben kitöltődik.",
    es: "Responde a mis preguntas: la ficha se rellena sobre la marcha.",
    de: "Beantworte meine Fragen: Die Karte füllt sich nach und nach.",
    fr: "Réponds à mes questions : la fiche se remplit au fur et à mesure.",
    pt: "Responde às minhas perguntas: a ficha vai-se preenchendo.",
  },
  confirm: {
    en: "The profile is complete: check it and confirm it here in the chat.",
    it: "Il profilo è completo: controllalo e confermalo qui in chat.",
    hu: "A profil teljes: nézd át, és erősítsd meg itt a csevegésben.",
    es: "El perfil está completo: revísalo y confírmalo aquí en el chat.",
    de: "Das Profil ist vollständig: Prüfe es und bestätige es hier im Chat.",
    fr: "Le profil est complet : vérifie-le et confirme-le ici dans le chat.",
    pt: "O perfil está completo: revê-o e confirma-o aqui na conversa.",
  },
  plan: {
    en: "Now tell me which subscription you have (“I don’t know” is fine).",
    it: "Ora dimmi che abbonamento hai («non lo so» va benissimo).",
    hu: "Most mondd meg, milyen előfizetésed van („nem tudom” is jó válasz).",
    es: "Ahora dime qué suscripción tienes («no lo sé» vale).",
    de: "Sag mir jetzt, welches Abo du hast („weiß ich nicht“ ist in Ordnung).",
    fr: "Dis-moi maintenant quel abonnement tu as (« je ne sais pas » convient).",
    pt: "Agora diz-me que subscrição tens («não sei» serve).",
  },
  team: {
    en: "The team is starting to work…",
    it: "La squadra sta cominciando a lavorare…",
    hu: "A csapat munkához lát…",
    es: "El equipo empieza a trabajar…",
    de: "Das Team beginnt zu arbeiten …",
    fr: "L’équipe se met au travail…",
    pt: "A equipa está a começar a trabalhar…",
  },
  started: {
    en: "The team is working. You can go on to the app.",
    it: "La squadra sta lavorando. Puoi passare all’app.",
    hu: "A csapat dolgozik. Továbbléphetsz az alkalmazásba.",
    es: "El equipo está trabajando. Puedes pasar a la aplicación.",
    de: "Das Team arbeitet. Du kannst zur App weitergehen.",
    fr: "L’équipe travaille. Tu peux passer à l’application.",
    pt: "A equipa está a trabalhar. Podes passar à aplicação.",
  },
};

/** After the patience: the team did not start in time. The way out is always there; here it is said. */
export const GUIDED_TEAM_LATE: LocaleDict = {
  en: "The team is taking longer than expected to start. You can wait a little more, or continue later: I will bring you back here the next time you open the app.",
  it: "La squadra ci mette più del previsto a partire. Puoi aspettare ancora, oppure continuare più tardi: ti riporto qui al prossimo avvio dell’app.",
  hu: "A csapat a vártnál tovább indul. Várhatsz még egy kicsit, vagy folytathatod később: az alkalmazás következő megnyitásakor ide hozlak vissza.",
  es: "El equipo tarda más de lo previsto en arrancar. Puedes esperar un poco más o continuar más tarde: te traigo de vuelta aquí la próxima vez que abras la aplicación.",
  de: "Das Team braucht länger als erwartet, um zu starten. Du kannst noch etwas warten oder später weitermachen: Beim nächsten Öffnen der App bringe ich dich hierher zurück.",
  fr: "L’équipe met plus de temps que prévu à démarrer. Tu peux attendre encore un peu, ou continuer plus tard : je te ramène ici à la prochaine ouverture de l’application.",
  pt: "A equipa está a demorar mais do que o previsto a arrancar. Podes esperar mais um pouco ou continuar mais tarde: trago-te de volta aqui da próxima vez que abrires a aplicação.",
};

export const GUIDED_CONTINUE_LATER: LocaleDict = {
  en: "Continue later",
  it: "Continua più tardi",
  hu: "Folytatás később",
  es: "Continuar más tarde",
  de: "Später weitermachen",
  fr: "Continuer plus tard",
  pt: "Continuar mais tarde",
};

export const GUIDED_CONTINUE_LATER_HINT: LocaleDict = {
  en: "Opens the app. The conversation stays here for the next time.",
  it: "Apre l’app. La conversazione resta qui per la prossima volta.",
  hu: "Megnyitja az alkalmazást. A beszélgetés itt marad a következő alkalomra.",
  es: "Abre la aplicación. La conversación queda aquí para la próxima vez.",
  de: "Öffnet die App. Das Gespräch bleibt hier für das nächste Mal.",
  fr: "Ouvre l’application. La conversation reste ici pour la prochaine fois.",
  pt: "Abre a aplicação. A conversa fica aqui para a próxima vez.",
};

export const GUIDED_CONTINUE_TO_APP: LocaleDict = {
  en: "Go to the app",
  it: "Vai all’app",
  hu: "Tovább az alkalmazásba",
  es: "Ir a la aplicación",
  de: "Zur App",
  fr: "Aller à l’application",
  pt: "Ir para a aplicação",
};
