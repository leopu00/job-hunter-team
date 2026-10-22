import type { Locale } from "@/i18n/config";

/** The header of the link to an existing team's VPS: state names and buttons. Sentences come from the catalog. */
export type VpsLinkCopy = {
  connected: string;
  checking: string;
  reconnecting: string;
  network: string;
  application: string;
  version: string;
  blocked: string;
  /** `{time}`: the last working read. */
  lastContact: string;
  revision: string;
  image: string;
  copyRevision: string;
  copyDigest: string;
  retry: string;
  reviewKey: string;
  /** The control that opens the pinned revision and image, and the error code. */
  details: string;
  /** Visible label of the copy buttons inside the details. */
  copy: string;
  /** Label of the error code inside the details. */
  errorCode: string;
  /** On a control that changes the team, while the link is not confirmed. */
  actionsWait: string;
};

const it: VpsLinkCopy = {
  connected: "Squadra collegata",
  checking: "Verifica del collegamento…",
  reconnecting: "Riconnessione in corso",
  network: "Errore di rete",
  application: "Errore della squadra",
  version: "Versione diversa",
  blocked: "Collegamento bloccato",
  lastContact: "ultimo contatto {time}",
  revision: "rev",
  image: "img",
  copyRevision: "Copia la revisione",
  copyDigest: "Copia il digest dell’immagine",
  retry: "Riprova",
  reviewKey: "Torna alla configurazione",
  details: "Dettagli tecnici",
  copy: "Copia",
  errorCode: "codice",
  actionsWait: "Le azioni sulla squadra partono solo quando risulta collegata.",
};

const en: VpsLinkCopy = {
  connected: "Team connected",
  checking: "Checking the link…",
  reconnecting: "Reconnecting",
  network: "Network error",
  application: "Team error",
  version: "Different version",
  blocked: "Link blocked",
  lastContact: "last contact {time}",
  revision: "rev",
  image: "img",
  copyRevision: "Copy the revision",
  copyDigest: "Copy the image digest",
  retry: "Retry",
  reviewKey: "Back to the setup",
  details: "Technical details",
  copy: "Copy",
  errorCode: "code",
  actionsWait: "Actions on the team run only while it is connected.",
};

const de: VpsLinkCopy = {
  connected: "Team verbunden",
  checking: "Verbindung wird geprüft…",
  reconnecting: "Verbindung wird wiederhergestellt",
  network: "Netzwerkfehler",
  application: "Fehler im Team",
  version: "Andere Version",
  blocked: "Verbindung gesperrt",
  lastContact: "letzter Kontakt {time}",
  revision: "Rev.",
  image: "Image",
  copyRevision: "Revision kopieren",
  copyDigest: "Image-Digest kopieren",
  retry: "Erneut versuchen",
  reviewKey: "Zurück zur Einrichtung",
  details: "Technische Details",
  copy: "Kopieren",
  errorCode: "Code",
  actionsWait: "Aktionen im Team laufen nur, solange es verbunden ist.",
};

const es: VpsLinkCopy = {
  connected: "Equipo conectado",
  checking: "Comprobando la conexión…",
  reconnecting: "Reconectando",
  network: "Error de red",
  application: "Error del equipo",
  version: "Versión distinta",
  blocked: "Conexión bloqueada",
  lastContact: "último contacto {time}",
  revision: "rev",
  image: "img",
  copyRevision: "Copiar la revisión",
  copyDigest: "Copiar el digest de la imagen",
  retry: "Reintentar",
  reviewKey: "Volver a la configuración",
  details: "Detalles técnicos",
  copy: "Copiar",
  errorCode: "código",
  actionsWait: "Las acciones en el equipo solo se ejecutan mientras está conectado.",
};

const fr: VpsLinkCopy = {
  connected: "Équipe connectée",
  checking: "Vérification de la connexion…",
  reconnecting: "Reconnexion en cours",
  network: "Erreur réseau",
  application: "Erreur de l’équipe",
  version: "Version différente",
  blocked: "Connexion bloquée",
  lastContact: "dernier contact {time}",
  revision: "rév.",
  image: "img",
  copyRevision: "Copier la révision",
  copyDigest: "Copier le digest de l’image",
  retry: "Réessayer",
  reviewKey: "Retour à la configuration",
  details: "Détails techniques",
  copy: "Copier",
  errorCode: "code",
  actionsWait: "Les actions sur l’équipe ne partent que lorsqu’elle est connectée.",
};

const hu: VpsLinkCopy = {
  connected: "A csapat csatlakoztatva",
  checking: "Kapcsolat ellenőrzése…",
  reconnecting: "Újracsatlakozás folyamatban",
  network: "Hálózati hiba",
  application: "Hiba a csapatban",
  version: "Eltérő verzió",
  blocked: "Kapcsolat letiltva",
  lastContact: "utolsó kapcsolat {time}",
  revision: "rev.",
  image: "kép",
  copyRevision: "Revízió másolása",
  copyDigest: "Képkivonat másolása",
  retry: "Újra",
  reviewKey: "Vissza a beállításhoz",
  details: "Műszaki részletek",
  copy: "Másolás",
  errorCode: "kód",
  actionsWait: "A csapatot érintő műveletek csak akkor indulnak, ha csatlakoztatva van.",
};

const pt: VpsLinkCopy = {
  connected: "Equipa ligada",
  checking: "A verificar a ligação…",
  reconnecting: "A restabelecer a ligação",
  network: "Erro de rede",
  application: "Erro da equipa",
  version: "Versão diferente",
  blocked: "Ligação bloqueada",
  lastContact: "último contacto {time}",
  revision: "rev",
  image: "img",
  copyRevision: "Copiar a revisão",
  copyDigest: "Copiar o digest da imagem",
  retry: "Tentar novamente",
  reviewKey: "Voltar à configuração",
  details: "Detalhes técnicos",
  copy: "Copiar",
  errorCode: "código",
  actionsWait: "As ações na equipa só são executadas enquanto estiver ligada.",
};

export const VPS_LINK_TEXT: Record<Locale, VpsLinkCopy> = { it, en, de, es, fr, hu, pt };
