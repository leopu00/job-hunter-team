import type { Locale } from "@/i18n/config";

export interface WriteAccessRestoredText {
  /** The fixed row. `{where}` is the user and the masked address of the saved VPS. */
  title: string;
  /** Used when the saved connection's address cannot be read: still says which team. */
  fallbackWhere: string;
  /** What persists, for how long, how it ends. */
  note: string;
  /** The button: takes the permission away and keeps the team linked, read only. */
  switchToReadOnly: string;
  switching: string;
  /** After a refused removal: this run is read only, the saved record is still there. */
  removalFailed: string;
}

export const WRITE_ACCESS_RESTORED_TEXT: Record<Locale, WriteAccessRestoredText> = {
  it: {
    title: "Accesso in scrittura attivo su {where}",
    fallbackWhere: "la squadra collegata",
    note: "L’hai confermato tu: resta attivo dopo il riavvio per 30 giorni al massimo, finché non passi a sola lettura, scolleghi la squadra o la squadra cambia versione.",
    switchToReadOnly: "Passa a sola lettura",
    switching: "Passo a sola lettura…",
    removalFailed: "Questa sessione è in sola lettura, ma l’accesso salvato non si è potuto togliere: al prossimo avvio potrebbe tornare attivo.",
  },
  en: {
    title: "Write access is on for {where}",
    fallbackWhere: "the connected team",
    note: "You confirmed it: it stays on after a restart for 30 days at most, until you switch to read only, unlink the team or the team changes version.",
    switchToReadOnly: "Switch to read only",
    switching: "Switching to read only…",
    removalFailed: "This session is read only, but the saved access could not be removed: it may come back at the next start.",
  },
  es: {
    title: "Acceso de escritura activo en {where}",
    fallbackWhere: "el equipo conectado",
    note: "Lo confirmaste tú: sigue activo tras reiniciar durante 30 días como máximo, hasta que pases a solo lectura, desvincules el equipo o el equipo cambie de versión.",
    switchToReadOnly: "Pasar a solo lectura",
    switching: "Pasando a solo lectura…",
    removalFailed: "Esta sesión es de solo lectura, pero no se pudo quitar el acceso guardado: puede volver a activarse en el próximo inicio.",
  },
  fr: {
    title: "Accès en écriture actif sur {where}",
    fallbackWhere: "l’équipe connectée",
    note: "Vous l’avez confirmé : il reste actif après un redémarrage pendant 30 jours au maximum, jusqu’à ce que vous passiez en lecture seule, déconnectiez l’équipe ou que l’équipe change de version.",
    switchToReadOnly: "Passer en lecture seule",
    switching: "Passage en lecture seule…",
    removalFailed: "Cette session est en lecture seule, mais l’accès enregistré n’a pas pu être retiré : il peut revenir au prochain démarrage.",
  },
  de: {
    title: "Schreibzugriff aktiv auf {where}",
    fallbackWhere: "das verbundene Team",
    note: "Du hast ihn bestätigt: Er bleibt nach einem Neustart höchstens 30 Tage aktiv, bis du auf Nur Lesen umschaltest, das Team trennst oder das Team die Version wechselt.",
    switchToReadOnly: "Auf Nur Lesen umschalten",
    switching: "Schalte auf Nur Lesen um…",
    removalFailed: "Diese Sitzung ist nur lesend, aber der gespeicherte Zugriff konnte nicht entfernt werden: Er kann beim nächsten Start wieder aktiv sein.",
  },
  pt: {
    title: "Acesso de escrita ativo em {where}",
    fallbackWhere: "a equipa ligada",
    note: "Foste tu a confirmá-lo: continua ativo após reiniciar durante 30 dias no máximo, até passar a só de leitura, desligar a equipa ou a equipa mudar de versão.",
    switchToReadOnly: "Passar a só de leitura",
    switching: "A passar a só de leitura…",
    removalFailed: "Esta sessão é só de leitura, mas não foi possível remover o acesso guardado: pode voltar a ficar ativo no próximo arranque.",
  },
  hu: {
    title: "Írási hozzáférés aktív: {where}",
    fallbackWhere: "a csatlakoztatott csapat",
    note: "Te hagytad jóvá: újraindítás után legfeljebb 30 napig marad aktív, amíg csak olvashatóra nem váltasz, le nem választod a csapatot, vagy a csapat verziót nem vált.",
    switchToReadOnly: "Váltás csak olvasásra",
    switching: "Váltás csak olvasásra…",
    removalFailed: "Ez a munkamenet csak olvasható, de a mentett hozzáférést nem sikerült eltávolítani: a következő indításkor újra aktív lehet.",
  },
};
