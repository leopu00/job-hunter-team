// Dizionario dello stato di consegna di un turno di chat: il segno sulla
// bolla dell'utente (`ChatDeliveryMark`) e l'avviso sopra il composer
// della chat a tutta pagina. Due UI, un solo vocabolario — le stesse
// quattro parole devono voler dire la stessa cosa in tutta l'app.
//
// `satisfies Dictionary` fa pretendere al compilatore tutte e sette le
// lingue: una voce a cui ne manca una non compila, invece di mostrare
// l'inglese all'utente sbagliato.
import type { Dictionary } from "@/lib/i18n-dict";

export const CHAT_DELIVERY_T = {
  // Le quattro condizioni di `ChatTurnDelivery`. Restano CORTE: stanno in
  // un'etichetta da 9px accanto all'ora, e vanno lette in mezzo secondo.
  sending: {
    it: "Invio…",
    en: "Sending…",
    hu: "Küldés…",
    es: "Enviando…",
    de: "Senden…",
    fr: "Envoi…",
    pt: "Enviando…",
  },
  sent: {
    it: "Inviato",
    en: "Sent",
    hu: "Elküldve",
    es: "Enviado",
    de: "Gesendet",
    fr: "Envoyé",
    pt: "Enviado",
  },
  delivered: {
    it: "Consegnato all'agente",
    en: "Delivered to the agent",
    hu: "Átadva az ügynöknek",
    es: "Entregado al agente",
    de: "An den Agenten übergeben",
    fr: "Remis à l'agent",
    pt: "Entregue ao agente",
  },
  stalled: {
    it: "Non consegnato",
    en: "Not delivered",
    hu: "Nem érkezett meg",
    es: "No entregado",
    de: "Nicht zugestellt",
    fr: "Non remis",
    pt: "Não entregue",
  },
  // L'avviso che spiega il segno giallo. Dice le tre cose che servono:
  // l'agente NON ha il messaggio, arriverà da sé, e riscriverlo non serve
  // (senza questa terza riga l'utente manda lo stesso testo cinque volte).
  stalled_hint: {
    it: "Il team non ha ancora ritirato questo messaggio: l'agente non l'ha ricevuto. Verrà consegnato da sé appena il tuo box torna a leggere la chat — non serve riscriverlo.",
    en: "The team hasn't picked this message up yet: the agent has not received it. It will be delivered on its own as soon as your box reads the chat again — no need to send it twice.",
    hu: "A csapat még nem vette át ezt az üzenetet: az ügynök nem kapta meg. Magától átadásra kerül, amint a boxod újra olvassa a chatet — nem kell újraírni.",
    es: "El equipo aún no ha recogido este mensaje: el agente no lo ha recibido. Se entregará solo en cuanto tu box vuelva a leer el chat — no hace falta reescribirlo.",
    de: "Das Team hat diese Nachricht noch nicht abgeholt: Der Agent hat sie nicht erhalten. Sie wird von selbst zugestellt, sobald deine Box den Chat wieder liest — kein erneutes Schreiben nötig.",
    fr: "L'équipe n'a pas encore récupéré ce message : l'agent ne l'a pas reçu. Il sera remis tout seul dès que votre box relira la conversation — inutile de le réécrire.",
    pt: "A equipe ainda não recolheu esta mensagem: o agente não a recebeu. Será entregue por si só assim que o seu box voltar a ler o chat — não precisa reescrever.",
  },
  // L'azione accanto all'avviso. Richiama il box, NON rimanda il testo: il
  // turno è già salvato, riscriverlo creerebbe il doppione che l'utente
  // dell'incidente ha fatto a mano credendo di aver sbagliato lui.
  retry: {
    it: "Richiama il box",
    en: "Ping the box again",
    hu: "Box újrahívása",
    es: "Volver a llamar al box",
    de: "Box erneut anstoßen",
    fr: "Relancer le box",
    pt: "Chamar o box de novo",
  },
  retrying: {
    it: "Richiamo…",
    en: "Pinging…",
    hu: "Hívás…",
    es: "Llamando…",
    de: "Stoße an…",
    fr: "Relance…",
    pt: "A chamar…",
  },
  retry_done: {
    it: "Richiesta rimandata al box. Se il tuo box è spento o su una versione vecchia, resterà non consegnato.",
    en: "The box has been pinged again. If your box is off or on an old version, it will stay undelivered.",
    hu: "A boxot újra megszólítottuk. Ha a boxod ki van kapcsolva vagy régi verzión fut, kézbesítetlen marad.",
    es: "Se ha vuelto a llamar al box. Si tu box está apagado o en una versión antigua, seguirá sin entregarse.",
    de: "Die Box wurde erneut angestoßen. Ist sie aus oder auf einer alten Version, bleibt die Nachricht unzugestellt.",
    fr: "Le box a été relancé. S'il est éteint ou sur une version ancienne, le message restera non remis.",
    pt: "O box foi chamado de novo. Se estiver desligado ou numa versão antiga, continuará por entregar.",
  },
  // Il composer spento perché il box ha dichiarato di non saper ricevere la
  // chat. Dice la versione (il fatto), cosa manca (la conseguenza) e come si
  // chiude (l'azione) — senza mai dire "errore": non c'è nulla di rotto,
  // c'è una build vecchia.
  blocked_no_chat: {
    it: "Il tuo box è sulla versione {version} e non sa ancora ricevere i messaggi dal sito. Aggiornalo per scrivere agli agenti da qui.",
    en: "Your box is on version {version} and cannot receive messages from the site yet. Update it to write to the agents from here.",
    hu: "A boxod a(z) {version} verzión fut, és még nem tud üzenetet fogadni a webhelyről. Frissítsd, hogy innen írhass az ügynököknek.",
    es: "Tu box está en la versión {version} y todavía no puede recibir mensajes desde el sitio. Actualízalo para escribir a los agentes desde aquí.",
    de: "Deine Box läuft auf Version {version} und kann noch keine Nachrichten von der Website empfangen. Aktualisiere sie, um von hier aus mit den Agenten zu schreiben.",
    fr: "Votre box est en version {version} et ne sait pas encore recevoir les messages du site. Mettez-la à jour pour écrire aux agents depuis ici.",
    pt: "O teu box está na versão {version} e ainda não consegue receber mensagens do site. Atualiza-o para escrever aos agentes a partir daqui.",
  },
  // Stessa cosa quando il box non ha dichiarato quale versione sia: la
  // frase non può nominarla e non deve inventarla.
  blocked_no_chat_unknown_version: {
    it: "Il tuo box non sa ancora ricevere i messaggi dal sito. Aggiornalo per scrivere agli agenti da qui.",
    en: "Your box cannot receive messages from the site yet. Update it to write to the agents from here.",
    hu: "A boxod még nem tud üzenetet fogadni a webhelyről. Frissítsd, hogy innen írhass az ügynököknek.",
    es: "Tu box todavía no puede recibir mensajes desde el sitio. Actualízalo para escribir a los agentes desde aquí.",
    de: "Deine Box kann noch keine Nachrichten von der Website empfangen. Aktualisiere sie, um von hier aus mit den Agenten zu schreiben.",
    fr: "Votre box ne sait pas encore recevoir les messages du site. Mettez-la à jour pour écrire aux agents depuis ici.",
    pt: "O teu box ainda não consegue receber mensagens do site. Atualiza-o para escrever aos agentes a partir daqui.",
  },
  retry_failed: {
    it: "Non è stato possibile richiamare il box. Riprova fra poco.",
    en: "Could not ping the box. Try again shortly.",
    hu: "Nem sikerült megszólítani a boxot. Próbáld újra hamarosan.",
    es: "No se pudo llamar al box. Inténtalo de nuevo en un momento.",
    de: "Die Box konnte nicht angestoßen werden. Versuche es gleich noch einmal.",
    fr: "Impossible de relancer le box. Réessayez dans un instant.",
    pt: "Não foi possível chamar o box. Tenta de novo daqui a pouco.",
  },
} satisfies Dictionary;
