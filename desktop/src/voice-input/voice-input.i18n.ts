import type { Locale } from "@/i18n/config";

/**
 * The words of the dictation control. It speaks the language it listens in:
 * the primary subtag of its `locale` prop ("it-IT" → it), else the app's.
 * 7 languages; Italian is the source and its shape is the type.
 */
export interface VoiceInputText {
  requestingPermission: string;
  recording: string;
  transcribing: string;
  checking: string;
  dictate: string;
  waitingPermission: string;
  cancel: string;
  listening: string;
  stopAndTranscribe: string;
  transcribingOnMac: string;
  retry: string;
  transcriptInserted: string;
}

export const VOICE_INPUT_TEXT: Record<Locale, VoiceInputText> = {
  it: {
    requestingPermission: "Richiesta dei permessi in corso.",
    recording: "Registrazione in corso.",
    transcribing: "Trascrizione in corso.",
    checking: "Verifico il dettato sul dispositivo…",
    dictate: "Detta un messaggio",
    waitingPermission: "Attendo i permessi…",
    cancel: "Annulla",
    listening: "In ascolto",
    stopAndTranscribe: "Ferma e trascrivi",
    transcribingOnMac: "Trascrizione sul Mac…",
    retry: "Riprova",
    transcriptInserted: "Trascrizione inserita: rileggila prima di inviare.",
  },
  en: {
    requestingPermission: "Asking for permissions.",
    recording: "Recording.",
    transcribing: "Transcribing.",
    checking: "Checking dictation on this device…",
    dictate: "Dictate a message",
    waitingPermission: "Waiting for permissions…",
    cancel: "Cancel",
    listening: "Listening",
    stopAndTranscribe: "Stop and transcribe",
    transcribingOnMac: "Transcribing on the Mac…",
    retry: "Retry",
    transcriptInserted: "Transcript inserted: read it again before sending.",
  },
  de: {
    requestingPermission: "Berechtigungen werden angefragt.",
    recording: "Aufnahme läuft.",
    transcribing: "Transkription läuft.",
    checking: "Diktat auf dem Gerät wird geprüft…",
    dictate: "Nachricht diktieren",
    waitingPermission: "Warte auf die Berechtigungen…",
    cancel: "Abbrechen",
    listening: "Hört zu",
    stopAndTranscribe: "Stoppen und transkribieren",
    transcribingOnMac: "Transkription auf dem Mac…",
    retry: "Erneut versuchen",
    transcriptInserted: "Transkript eingefügt: Lies es vor dem Senden noch einmal.",
  },
  fr: {
    requestingPermission: "Demande des autorisations en cours.",
    recording: "Enregistrement en cours.",
    transcribing: "Transcription en cours.",
    checking: "Vérification de la dictée sur l’appareil…",
    dictate: "Dicter un message",
    waitingPermission: "En attente des autorisations…",
    cancel: "Annuler",
    listening: "À l’écoute",
    stopAndTranscribe: "Arrêter et transcrire",
    transcribingOnMac: "Transcription sur le Mac…",
    retry: "Réessayer",
    transcriptInserted: "Transcription insérée : relis-la avant d’envoyer.",
  },
  es: {
    requestingPermission: "Solicitando los permisos.",
    recording: "Grabando.",
    transcribing: "Transcribiendo.",
    checking: "Comprobando el dictado en el dispositivo…",
    dictate: "Dictar un mensaje",
    waitingPermission: "Esperando los permisos…",
    cancel: "Cancelar",
    listening: "Escuchando",
    stopAndTranscribe: "Detener y transcribir",
    transcribingOnMac: "Transcribiendo en el Mac…",
    retry: "Reintentar",
    transcriptInserted: "Transcripción insertada: léela de nuevo antes de enviar.",
  },
  pt: {
    requestingPermission: "A pedir as permissões.",
    recording: "A gravar.",
    transcribing: "A transcrever.",
    checking: "A verificar o ditado no dispositivo…",
    dictate: "Ditar uma mensagem",
    waitingPermission: "A aguardar as permissões…",
    cancel: "Cancelar",
    listening: "A ouvir",
    stopAndTranscribe: "Parar e transcrever",
    transcribingOnMac: "A transcrever no Mac…",
    retry: "Tentar de novo",
    transcriptInserted: "Transcrição inserida: relê-a antes de enviar.",
  },
  hu: {
    requestingPermission: "Engedélyek kérése folyamatban.",
    recording: "Felvétel folyamatban.",
    transcribing: "Átírás folyamatban.",
    checking: "A diktálás ellenőrzése az eszközön…",
    dictate: "Üzenet diktálása",
    waitingPermission: "Várakozás az engedélyekre…",
    cancel: "Mégse",
    listening: "Hallgatom",
    stopAndTranscribe: "Leállítás és átírás",
    transcribingOnMac: "Átírás a Macen…",
    retry: "Újra",
    transcriptInserted: "Az átirat bekerült: olvasd át küldés előtt.",
  },
};
