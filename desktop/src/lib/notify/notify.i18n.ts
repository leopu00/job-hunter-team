import type { Locale } from "@/i18n/config";
import type { PluralForms } from "../plural";

/**
 * The words of the new-position notifications, 7 languages; Italian is the source. The
 * notification carries nothing else: without details only these words, with details the
 * position's title and company.
 */
export interface NotifyText {
  /** the notification's title without details */
  appName: string;
  /** one new position, without details */
  newOne: string;
  /** several at once ({count}), with or without details: never their names */
  newMany: PluralForms;
  /** next to the settings' switch: where the notification shows */
  lockScreen: string;
  /** the settings' choice that adds the title and the company */
  withDetails: string;
  /** the settings card's title, and the switch's own words */
  switchTitle: string;
  switchLabel: string;
}

export const NOTIFY_TEXT: Record<Locale, NotifyText> = {
  it: {
    appName: "Job Hunter Team",
    newOne: "Nuova posizione trovata",
    newMany: { one: "{count} nuova posizione trovata", other: "{count} nuove posizioni trovate" },
    lockScreen:
      "Le notifiche compaiono nel centro notifiche del sistema, sullo schermo bloccato e in uno schermo condiviso: chiunque lo guardi le legge.",
    withDetails: "Mostra titolo e azienda della posizione",
    switchTitle: "Notifiche",
    switchLabel: "Avvisami quando arriva una nuova posizione",
  },
  en: {
    appName: "Job Hunter Team",
    newOne: "New position found",
    newMany: { one: "{count} new position found", other: "{count} new positions found" },
    lockScreen:
      "Notifications show in the system's notification centre, on the locked screen and on a shared screen: anyone looking at it can read them.",
    withDetails: "Show the position's title and company",
    switchTitle: "Notifications",
    switchLabel: "Notify me when a new position arrives",
  },
  de: {
    appName: "Job Hunter Team",
    newOne: "Neue Stelle gefunden",
    newMany: { one: "{count} neue Stelle gefunden", other: "{count} neue Stellen gefunden" },
    lockScreen:
      "Benachrichtigungen erscheinen in der Mitteilungszentrale des Systems, auf dem Sperrbildschirm und auf einem geteilten Bildschirm: Wer hinschaut, kann sie lesen.",
    withDetails: "Titel und Unternehmen der Stelle anzeigen",
    switchTitle: "Benachrichtigungen",
    switchLabel: "Benachrichtige mich, wenn eine neue Stelle eintrifft",
  },
  fr: {
    appName: "Job Hunter Team",
    newOne: "Nouvelle offre trouvée",
    newMany: { one: "{count} nouvelle offre trouvée", other: "{count} nouvelles offres trouvées" },
    lockScreen:
      "Les notifications s’affichent dans le centre de notifications du système, sur l’écran verrouillé et sur un écran partagé : toute personne qui le regarde peut les lire.",
    withDetails: "Afficher l’intitulé et l’entreprise de l’offre",
    switchTitle: "Notifications",
    switchLabel: "Me prévenir quand une nouvelle offre arrive",
  },
  es: {
    appName: "Job Hunter Team",
    newOne: "Nueva oferta encontrada",
    newMany: { one: "{count} nueva oferta encontrada", other: "{count} nuevas ofertas encontradas" },
    lockScreen:
      "Las notificaciones aparecen en el centro de notificaciones del sistema, en la pantalla bloqueada y en una pantalla compartida: quien la mire puede leerlas.",
    withDetails: "Mostrar el título y la empresa de la oferta",
    switchTitle: "Notificaciones",
    switchLabel: "Avisarme cuando llegue una oferta nueva",
  },
  pt: {
    appName: "Job Hunter Team",
    newOne: "Nova vaga encontrada",
    newMany: { one: "{count} nova vaga encontrada", other: "{count} novas vagas encontradas" },
    lockScreen:
      "As notificações aparecem no centro de notificações do sistema, no ecrã bloqueado e num ecrã partilhado: quem olhar pode lê-las.",
    withDetails: "Mostrar o título e a empresa da vaga",
    switchTitle: "Notificações",
    switchLabel: "Avisar-me quando chegar uma vaga nova",
  },
  hu: {
    appName: "Job Hunter Team",
    newOne: "Új állás érkezett",
    newMany: { one: "{count} új állás érkezett", other: "{count} új állás érkezett" },
    lockScreen:
      "Az értesítések megjelennek a rendszer értesítési központjában, a zárolt képernyőn és a megosztott képernyőn is: aki ránéz, elolvashatja őket.",
    withDetails: "Az állás címének és cégének megjelenítése",
    switchTitle: "Értesítések",
    switchLabel: "Értesítsen, amikor új állás érkezik",
  },
};
