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
} satisfies Dictionary;
