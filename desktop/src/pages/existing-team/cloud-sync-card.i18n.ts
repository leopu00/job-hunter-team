import type { Locale } from "@/i18n/config";

/** The card of the team page that says how the box's push to the website is going. */
export interface CloudSyncCardText {
  title: string;
  reading: string;
  absent: string;
  unreadable: string;
  unsupported: string;
  ok: string; // {time}: the last push that went through
  okNever: string;
  refused: string;
  refusedAction: string;
  failing: string; // {count}
  lastSuccess: string; // {time}
  lastSuccessNever: string;
  failed: string; // {code}
}

export const CLOUD_SYNC_CARD_TEXT: Record<Locale, CloudSyncCardText> = {
  it: {
    title: "Sincronizzazione con il sito",
    reading: "Leggo dal team…",
    absent: "Questo team non sincronizza con il sito.",
    unreadable: "Lo stato della sincronizzazione sul team non si legge.",
    unsupported: "La versione del team non dice ancora come va la sincronizzazione: aggiornalo per vederlo qui.",
    ok: "Funziona: ultimo invio riuscito {time}.",
    okNever: "Attiva: nessun invio ancora riuscito.",
    refused: "Il sito rifiuta il token di questo box (scaduto o revocato): le posizioni nuove non arrivano sul sito.",
    refusedAction: "Genera un token nuovo sul sito (jobhunterteam.ai › Impostazioni › Cloud sync) e lancialo sul box con «jht cloud enable --token …».",
    failing: "Gli ultimi invii non sono riusciti ({count} di fila): il box riprova da solo.",
    lastSuccess: "Ultimo invio riuscito: {time}.",
    lastSuccessNever: "Nessun invio è mai riuscito.",
    failed: "Lo stato della sincronizzazione non si è letto ({code}).",
  },
  en: {
    title: "Sync with the website",
    reading: "Reading from the team…",
    absent: "This team does not sync with the website.",
    unreadable: "The sync state on the team cannot be read.",
    unsupported: "The team's version does not tell how the sync is going yet: update it to see it here.",
    ok: "Working: last push that went through {time}.",
    okNever: "On: no push has gone through yet.",
    refused: "The website refuses this box's token (expired or revoked): new positions do not reach the website.",
    refusedAction: "Generate a new token on the website (jobhunterteam.ai › Settings › Cloud sync) and run «jht cloud enable --token …» on the box.",
    failing: "The last pushes did not go through ({count} in a row): the box tries again by itself.",
    lastSuccess: "Last push that went through: {time}.",
    lastSuccessNever: "No push has ever gone through.",
    failed: "The sync state could not be read ({code}).",
  },
  de: {
    title: "Synchronisierung mit der Website",
    reading: "Lese vom Team…",
    absent: "Dieses Team synchronisiert nicht mit der Website.",
    unreadable: "Der Synchronisierungsstand im Team ist nicht lesbar.",
    unsupported: "Die Version des Teams zeigt den Synchronisierungsstand noch nicht: Aktualisiere es, um ihn hier zu sehen.",
    ok: "Funktioniert: letzte erfolgreiche Übertragung {time}.",
    okNever: "Aktiv: noch keine Übertragung erfolgreich.",
    refused: "Die Website lehnt das Token dieses Geräts ab (abgelaufen oder widerrufen): Neue Stellen kommen auf der Website nicht an.",
    refusedAction: "Erzeuge auf der Website ein neues Token (jobhunterteam.ai › Einstellungen › Cloud sync) und führe auf dem Gerät «jht cloud enable --token …» aus.",
    failing: "Die letzten Übertragungen sind fehlgeschlagen ({count} in Folge): Das Gerät versucht es von selbst erneut.",
    lastSuccess: "Letzte erfolgreiche Übertragung: {time}.",
    lastSuccessNever: "Noch nie war eine Übertragung erfolgreich.",
    failed: "Der Synchronisierungsstand wurde nicht gelesen ({code}).",
  },
  fr: {
    title: "Synchronisation avec le site",
    reading: "Lecture depuis l'équipe…",
    absent: "Cette équipe ne se synchronise pas avec le site.",
    unreadable: "L'état de la synchronisation sur l'équipe est illisible.",
    unsupported: "La version de l'équipe n'indique pas encore l'état de la synchronisation : mets-la à jour pour le voir ici.",
    ok: "Fonctionne : dernier envoi réussi {time}.",
    okNever: "Activée : aucun envoi n'a encore réussi.",
    refused: "Le site refuse le jeton de cette machine (expiré ou révoqué) : les nouvelles offres n'arrivent pas sur le site.",
    refusedAction: "Génère un nouveau jeton sur le site (jobhunterteam.ai › Paramètres › Cloud sync) et lance « jht cloud enable --token … » sur la machine.",
    failing: "Les derniers envois ont échoué ({count} d'affilée) : la machine réessaie toute seule.",
    lastSuccess: "Dernier envoi réussi : {time}.",
    lastSuccessNever: "Aucun envoi n'a jamais réussi.",
    failed: "L'état de la synchronisation n'a pas été lu ({code}).",
  },
  es: {
    title: "Sincronización con el sitio",
    reading: "Leyendo del equipo…",
    absent: "Este equipo no se sincroniza con el sitio.",
    unreadable: "El estado de la sincronización en el equipo no se puede leer.",
    unsupported: "La versión del equipo todavía no indica cómo va la sincronización: actualízalo para verlo aquí.",
    ok: "Funciona: último envío correcto {time}.",
    okNever: "Activa: todavía no ha salido bien ningún envío.",
    refused: "El sitio rechaza el token de este equipo (caducado o revocado): las posiciones nuevas no llegan al sitio.",
    refusedAction: "Genera un token nuevo en el sitio (jobhunterteam.ai › Ajustes › Cloud sync) y ejecuta «jht cloud enable --token …» en el equipo.",
    failing: "Los últimos envíos no han salido bien ({count} seguidos): el equipo vuelve a intentarlo solo.",
    lastSuccess: "Último envío correcto: {time}.",
    lastSuccessNever: "Nunca ha salido bien ningún envío.",
    failed: "No se ha podido leer el estado de la sincronización ({code}).",
  },
  pt: {
    title: "Sincronização com o site",
    reading: "A ler da equipa…",
    absent: "Esta equipa não sincroniza com o site.",
    unreadable: "Não se consegue ler o estado da sincronização na equipa.",
    unsupported: "A versão da equipa ainda não indica como está a sincronização: atualiza-a para o ver aqui.",
    ok: "Funciona: último envio com êxito {time}.",
    okNever: "Ativa: ainda nenhum envio teve êxito.",
    refused: "O site recusa o token desta máquina (expirado ou revogado): as posições novas não chegam ao site.",
    refusedAction: "Gera um token novo no site (jobhunterteam.ai › Definições › Cloud sync) e executa «jht cloud enable --token …» na máquina.",
    failing: "Os últimos envios falharam ({count} seguidos): a máquina tenta de novo sozinha.",
    lastSuccess: "Último envio com êxito: {time}.",
    lastSuccessNever: "Nenhum envio teve êxito até agora.",
    failed: "Não foi possível ler o estado da sincronização ({code}).",
  },
  hu: {
    title: "Szinkronizálás a webhellyel",
    reading: "Olvasás a csapattól…",
    absent: "Ez a csapat nem szinkronizál a webhellyel.",
    unreadable: "A szinkronizálás állapota a csapaton nem olvasható.",
    unsupported: "A csapat verziója még nem mutatja a szinkronizálás állapotát: frissítsd, hogy itt lásd.",
    ok: "Működik: utolsó sikeres küldés {time}.",
    okNever: "Bekapcsolva: még egyetlen küldés sem sikerült.",
    refused: "A webhely elutasítja ennek a gépnek a tokenjét (lejárt vagy visszavonták): az új pozíciók nem érkeznek meg a webhelyre.",
    refusedAction: "Generálj új tokent a webhelyen (jobhunterteam.ai › Beállítások › Cloud sync), és futtasd a gépen: «jht cloud enable --token …».",
    failing: "Az utolsó küldések nem sikerültek ({count} egymás után): a gép magától újrapróbálja.",
    lastSuccess: "Utolsó sikeres küldés: {time}.",
    lastSuccessNever: "Még egyetlen küldés sem sikerült.",
    failed: "A szinkronizálás állapota nem olvasható ({code}).",
  },
};
