import type { ErrorCopy } from "./error-catalog";
import type { ErrorTranslations } from "./error-catalog.locales";

export const PAGE_DATA_ERRORS: Readonly<Record<string, ErrorCopy>> = {
  page_data_disk_read_failed: {
    text: { it: "Non è stato possibile leggere la copia salvata dei dati.", en: "The saved data copy could not be read." },
    action: { it: "La lettura aggiornata continua. Premi Aggiorna per riprovare.", en: "The live read continues. Press Refresh to try again." },
  },
  page_data_disk_write_failed: {
    text: { it: "I dati non sono stati salvati per il prossimo avvio.", en: "The data was not saved for the next start." },
    action: { it: "Puoi continuare con la copia in memoria. Riprova con Aggiorna.", en: "You can continue with the memory copy. Try Refresh again." },
  },
  page_data_disk_invalid: {
    text: { it: "La copia salvata dei dati non è valida e non viene mostrata.", en: "The saved data copy is invalid and is not shown." },
    action: { it: "Attendi la lettura aggiornata o premi Aggiorna.", en: "Wait for the live read or press Refresh." },
  },
  page_data_refresh_failed: {
    text: { it: "L’aggiornamento dei dati non è riuscito. La copia precedente resta segnata con la sua ora.",
      en: "The data refresh failed. The previous copy keeps its update time." },
    action: { it: "Premi Aggiorna per riprovare.", en: "Press Refresh to try again." },
  },
};

export const PAGE_DATA_ERROR_TRANSLATIONS: Readonly<Record<string, ErrorTranslations>> = {
  page_data_disk_read_failed: {
    de: ["Die gespeicherte Datenkopie konnte nicht gelesen werden.", "Die aktuelle Abfrage läuft weiter. Klicke auf Aktualisieren, um es erneut zu versuchen."],
    es: ["No se pudo leer la copia guardada de los datos.", "La lectura actual continúa. Pulsa Actualizar para volver a intentarlo."],
    fr: ["La copie enregistrée des données n’a pas pu être lue.", "La lecture actuelle continue. Appuie sur Actualiser pour réessayer."],
    hu: ["A mentett adatmásolat nem olvasható.", "Az aktuális adatok olvasása folytatódik. Az újrapróbáláshoz kattints a Frissítés gombra."],
    pt: ["Não foi possível ler a cópia guardada dos dados.", "A leitura atual continua. Carrega em Atualizar para tentar novamente."],
  },
  page_data_disk_write_failed: {
    de: ["Die Daten wurden nicht für den nächsten Start gespeichert.", "Du kannst mit der Kopie im Speicher fortfahren. Versuche es erneut mit Aktualisieren."],
    es: ["Los datos no se guardaron para el próximo inicio.", "Puedes continuar con la copia en memoria. Vuelve a pulsar Actualizar."],
    fr: ["Les données n’ont pas été enregistrées pour le prochain démarrage.", "Tu peux continuer avec la copie en mémoire. Réessaie avec Actualiser."],
    hu: ["Az adatok nem lettek mentve a következő indításhoz.", "A memóriában lévő másolattal folytathatod. Próbáld újra a Frissítés gombbal."],
    pt: ["Os dados não foram guardados para o próximo arranque.", "Podes continuar com a cópia em memória. Tenta novamente com Atualizar."],
  },
  page_data_disk_invalid: {
    de: ["Die gespeicherte Datenkopie ist ungültig und wird nicht angezeigt.", "Warte auf die aktuelle Abfrage oder klicke auf Aktualisieren."],
    es: ["La copia guardada de los datos no es válida y no se muestra.", "Espera a la lectura actual o pulsa Actualizar."],
    fr: ["La copie enregistrée des données n’est pas valide et n’est pas affichée.", "Attends la lecture actuelle ou appuie sur Actualiser."],
    hu: ["A mentett adatmásolat érvénytelen, ezért nem jelenik meg.", "Várd meg az aktuális adatok olvasását, vagy kattints a Frissítés gombra."],
    pt: ["A cópia guardada dos dados é inválida e não é apresentada.", "Espera pela leitura atual ou carrega em Atualizar."],
  },
  page_data_refresh_failed: {
    de: ["Die Daten konnten nicht aktualisiert werden. Die bisherige Kopie behält ihren Zeitstempel.", "Klicke auf Aktualisieren, um es erneut zu versuchen."],
    es: ["No se pudieron actualizar los datos. La copia anterior conserva su hora de actualización.", "Pulsa Actualizar para volver a intentarlo."],
    fr: ["L’actualisation des données a échoué. La copie précédente conserve son heure de mise à jour.", "Appuie sur Actualiser pour réessayer."],
    hu: ["Az adatok frissítése nem sikerült. A korábbi másolat megőrzi a frissítés idejét.", "Az újrapróbáláshoz kattints a Frissítés gombra."],
    pt: ["Não foi possível atualizar os dados. A cópia anterior mantém a hora da atualização.", "Carrega em Atualizar para tentar novamente."],
  },
};
