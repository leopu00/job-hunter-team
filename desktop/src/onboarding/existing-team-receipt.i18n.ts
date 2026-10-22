import type { Locale } from "@/i18n/config";

/**
 * The step that shows what the VPS declares about the team's container before
 * the app saves it. The wording never claims the data was confirmed or safe: it
 * is the server's own report, and the connection that follows is read only.
 */
export interface ExistingTeamReceiptText {
  discovering: string;
  discoveringDetail: string;
  eyebrow: string;
  intro: string;
  team: string;
  vps: string;
  fingerprint: string;
  container: string;
  image: string;
  revision: string;
  digest: string;
  assistant: string;
  assistantUp: string;
  assistantDown: string;
  caution: string;
  /** The caution of the same step when the person chose «Confirm and connect»: the team is connected in full. */
  cautionFull: string;
  confirm: string;
  cancel: string;
  registering: string;
  registeringDetail: string;
  registeringDetailFull: string;
}

export const EXISTING_TEAM_RECEIPT_TEXT: Record<Locale, ExistingTeamReceiptText> = {
  it: {
    discovering: "Leggo ciò che il server dichiara",
    discoveringDetail: "Chiedo alla VPS quale container ospita questa squadra. Non salvo e non modifico nulla.",
    eyebrow: "Ciò che il server dichiara",
    intro: "Questa è la descrizione che la VPS dà della squadra che hai indicato. L’app non può confermarla da sola: controlla che corrisponda a quello che ti aspetti.",
    team: "Squadra",
    vps: "VPS",
    fingerprint: "Impronta SSH già confermata",
    container: "Container",
    image: "Immagine",
    revision: "Revisione",
    digest: "Digest",
    assistant: "Assistente",
    assistantUp: "attivo",
    assistantDown: "non attivo",
    caution: "Confermando, l’app salva questo collegamento sul tuo profilo e apre la squadra in sola lettura. Non avvia agenti e non modifica nulla sulla VPS.",
    cautionFull: "Confermando, l’app salva questo collegamento sul tuo profilo e collega la squadra: da qui l’app potrà scriverle (la chat e i tuoi giudizi sugli annunci). Non avvia agenti.",
    confirm: "Conferma e apri in sola lettura",
    cancel: "Annulla",
    registering: "Salvo il collegamento",
    registeringDetail: "Rileggo la VPS, salvo il collegamento e apro la squadra in sola lettura.",
    registeringDetailFull: "Rileggo la VPS, salvo il collegamento e collego la squadra.",
  },
  en: {
    discovering: "Reading what the server declares",
    discoveringDetail: "Asking the VPS which container hosts this team. Nothing is saved or changed.",
    eyebrow: "What the server declares",
    intro: "This is the description the VPS gives of the team you entered. The app cannot confirm it on its own: check that it matches what you expect.",
    team: "Team",
    vps: "VPS",
    fingerprint: "SSH fingerprint already confirmed",
    container: "Container",
    image: "Image",
    revision: "Revision",
    digest: "Digest",
    assistant: "Assistant",
    assistantUp: "running",
    assistantDown: "not running",
    caution: "By confirming, the app saves this connection on your profile and opens the team read only. It starts no agents and changes nothing on the VPS.",
    cautionFull: "By confirming, the app saves this connection on your profile and connects the team: from here the app can write to it (the chat and your judgements on positions). It starts no agents.",
    confirm: "Confirm and open read only",
    cancel: "Cancel",
    registering: "Saving the connection",
    registeringDetail: "Reading the VPS again, saving the connection and opening the team read only.",
    registeringDetailFull: "Reading the VPS again, saving the connection and connecting the team.",
  },
  de: {
    discovering: "Ich lese, was der Server angibt",
    discoveringDetail: "Ich frage die VPS, welcher Container dieses Team hostet. Es wird nichts gespeichert oder geändert.",
    eyebrow: "Was der Server angibt",
    intro: "Das ist die Beschreibung, die die VPS zum angegebenen Team liefert. Die App kann sie nicht von sich aus bestätigen: Prüfe, ob sie deinen Erwartungen entspricht.",
    team: "Team",
    vps: "VPS",
    fingerprint: "SSH-Fingerabdruck bereits bestätigt",
    container: "Container",
    image: "Image",
    revision: "Revision",
    digest: "Digest",
    assistant: "Assistent",
    assistantUp: "läuft",
    assistantDown: "läuft nicht",
    caution: "Mit der Bestätigung speichert die App diese Verbindung in deinem Profil und öffnet das Team nur lesend. Es werden keine Agenten gestartet und auf der VPS wird nichts verändert.",
    cautionFull: "Mit der Bestätigung speichert die App diese Verbindung in deinem Profil und verbindet das Team: Von hier aus kann die App ihm schreiben (der Chat und deine Bewertungen der Stellen). Es werden keine Agenten gestartet.",
    confirm: "Bestätigen und nur lesend öffnen",
    cancel: "Abbrechen",
    registering: "Verbindung wird gespeichert",
    registeringDetail: "Ich lese die VPS erneut, speichere die Verbindung und öffne das Team nur lesend.",
    registeringDetailFull: "Ich lese die VPS erneut, speichere die Verbindung und verbinde das Team.",
  },
  fr: {
    discovering: "Lecture de ce que déclare le serveur",
    discoveringDetail: "Je demande au VPS quel conteneur héberge cette équipe. Rien n’est enregistré ni modifié.",
    eyebrow: "Ce que déclare le serveur",
    intro: "Voici la description que le VPS donne de l’équipe indiquée. L’application ne peut pas la confirmer d’elle-même : vérifie qu’elle correspond à ce que tu attends.",
    team: "Équipe",
    vps: "VPS",
    fingerprint: "Empreinte SSH déjà confirmée",
    container: "Conteneur",
    image: "Image",
    revision: "Révision",
    digest: "Digest",
    assistant: "Assistant",
    assistantUp: "actif",
    assistantDown: "inactif",
    caution: "En confirmant, l’application enregistre cette connexion dans ton profil et ouvre l’équipe en lecture seule. Elle ne lance aucun agent et ne modifie rien sur le VPS.",
    cautionFull: "En confirmant, l’application enregistre cette connexion dans ton profil et relie l’équipe : d’ici, l’application pourra lui écrire (le chat et tes avis sur les offres). Elle ne lance aucun agent.",
    confirm: "Confirmer et ouvrir en lecture seule",
    cancel: "Annuler",
    registering: "Enregistrement de la connexion",
    registeringDetail: "Je relis le VPS, j’enregistre la connexion et j’ouvre l’équipe en lecture seule.",
    registeringDetailFull: "Je relis le VPS, j’enregistre la connexion et je relie l’équipe.",
  },
  es: {
    discovering: "Leyendo lo que declara el servidor",
    discoveringDetail: "Pregunto al VPS qué contenedor aloja este equipo. No se guarda ni se cambia nada.",
    eyebrow: "Lo que declara el servidor",
    intro: "Esta es la descripción que da el VPS del equipo indicado. La aplicación no puede confirmarla por sí sola: comprueba que coincide con lo que esperas.",
    team: "Equipo",
    vps: "VPS",
    fingerprint: "Huella SSH ya confirmada",
    container: "Contenedor",
    image: "Imagen",
    revision: "Revisión",
    digest: "Digest",
    assistant: "Asistente",
    assistantUp: "activo",
    assistantDown: "no activo",
    caution: "Al confirmar, la aplicación guarda esta conexión en tu perfil y abre el equipo en solo lectura. No inicia agentes ni modifica nada en el VPS.",
    cautionFull: "Al confirmar, la aplicación guarda esta conexión en tu perfil y conecta el equipo: desde aquí la aplicación podrá escribirle (el chat y tus valoraciones de las ofertas). No inicia agentes.",
    confirm: "Confirmar y abrir en solo lectura",
    cancel: "Cancelar",
    registering: "Guardando la conexión",
    registeringDetail: "Vuelvo a leer el VPS, guardo la conexión y abro el equipo en solo lectura.",
    registeringDetailFull: "Vuelvo a leer el VPS, guardo la conexión y conecto el equipo.",
  },
  pt: {
    discovering: "A ler o que o servidor declara",
    discoveringDetail: "Pergunto à VPS que contentor aloja esta equipa. Nada é guardado nem alterado.",
    eyebrow: "O que o servidor declara",
    intro: "Esta é a descrição que a VPS dá da equipa indicada. A aplicação não a pode confirmar por si só: confirma que corresponde ao que esperas.",
    team: "Equipa",
    vps: "VPS",
    fingerprint: "Impressão digital SSH já confirmada",
    container: "Contentor",
    image: "Imagem",
    revision: "Revisão",
    digest: "Digest",
    assistant: "Assistente",
    assistantUp: "ativo",
    assistantDown: "não ativo",
    caution: "Ao confirmar, a aplicação guarda esta ligação no teu perfil e abre a equipa só em leitura. Não inicia agentes nem altera nada na VPS.",
    cautionFull: "Ao confirmar, a aplicação guarda esta ligação no teu perfil e liga a equipa: daqui a aplicação poderá escrever-lhe (o chat e as tuas avaliações das vagas). Não inicia agentes.",
    confirm: "Confirmar e abrir só em leitura",
    cancel: "Cancelar",
    registering: "A guardar a ligação",
    registeringDetail: "Volto a ler a VPS, guardo a ligação e abro a equipa só em leitura.",
    registeringDetailFull: "Volto a ler a VPS, guardo a ligação e ligo a equipa.",
  },
  hu: {
    discovering: "A szerver állításának beolvasása",
    discoveringDetail: "Megkérdezem a VPS-t, melyik konténer futtatja ezt a csapatot. Semmi nem kerül mentésre vagy módosításra.",
    eyebrow: "Amit a szerver állít",
    intro: "Ezt a leírást adja a VPS a megadott csapatról. Az alkalmazás ezt önmagától nem tudja megerősíteni: nézd meg, hogy egyezik-e azzal, amire számítasz.",
    team: "Csapat",
    vps: "VPS",
    fingerprint: "Már megerősített SSH-ujjlenyomat",
    container: "Konténer",
    image: "Kép",
    revision: "Revízió",
    digest: "Digest",
    assistant: "Asszisztens",
    assistantUp: "fut",
    assistantDown: "nem fut",
    caution: "A megerősítéssel az alkalmazás elmenti ezt a kapcsolatot a profilodra, és csak olvasható módban megnyitja a csapatot. Nem indít ügynököket, és semmit nem módosít a VPS-en.",
    cautionFull: "A megerősítéssel az alkalmazás elmenti ezt a kapcsolatot a profilodra, és csatlakoztatja a csapatot: innen az alkalmazás írhat neki (a chat és a pozíciókról adott értékeléseid). Nem indít ügynököket.",
    confirm: "Megerősítés és megnyitás csak olvasásra",
    cancel: "Mégse",
    registering: "A kapcsolat mentése",
    registeringDetail: "Újra beolvasom a VPS-t, elmentem a kapcsolatot, és csak olvasható módban megnyitom a csapatot.",
    registeringDetailFull: "Újra beolvasom a VPS-t, elmentem a kapcsolatot, és csatlakoztatom a csapatot.",
  },
};
