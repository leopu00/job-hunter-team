import type { Locale } from "@/i18n/config";

/** The words of the provider sign-in screen, in the seven languages of the app. */
export interface TakeoverText {
  eyebrow: string;
  title: (provider: string) => string;
  connecting: string;
  connected: string;
  disconnected: string;
  elapsed: (time: string) => string;
  /** No request from the provider yet. */
  waiting: string;
  /** Still nothing after a while: what the person can do. */
  waitingLong: string;
  verifying: string;
  invalidUrlInstruction: string;
  invalidUrlError: string;
  urlTitle: string;
  codeTitle: string;
  copyUrl: string;
  copyCode: string;
  openBrowser: string;
  copied: string;
  copyFailed: string;
  openFailed: string;
  /** How long the device code stays valid, as a countdown. */
  expiresIn: (time: string) => string;
  expired: string;
  errorInput: string;
  errorCancel: string;
  errorRestart: string;
  footer: string;
  cancel: string;
  cancelling: string;
  restart: string;
  restarting: string;
  submit: string;
  submitting: string;
}

const it: TakeoverText = {
  eyebrow: "Intervento richiesto",
  title: (provider) => `Completa l’accesso a ${provider}`,
  connecting: "Connessione in corso",
  connected: "Connesso",
  disconnected: "Connessione interrotta",
  elapsed: (time) => `Tempo trascorso ${time}`,
  waiting: "Attendo una richiesta verificata dal provider.",
  waitingLong: "Il provider non ha ancora mostrato il codice: di solito servono pochi secondi. Se resta così, annulla e riavvia l’accesso.",
  verifying: "Risposta inviata, attendo il provider.",
  invalidUrlInstruction: "L’indirizzo ricevuto non è valido. Riavvia l’accesso.",
  invalidUrlError: "Il provider ha restituito un indirizzo non valido. Riavvia l’accesso.",
  urlTitle: "URL di accesso",
  codeTitle: "Codice dispositivo",
  copyUrl: "Copia URL",
  copyCode: "Copia codice",
  openBrowser: "Apri nel browser",
  copied: "Copiato.",
  copyFailed: "Copia non riuscita. Selezionalo e copialo a mano.",
  openFailed: "Non riesco ad aprire il browser. Copia l’URL e aprilo a mano.",
  expiresIn: (time) => `Il codice scade tra ${time}.`,
  expired: "Il codice è scaduto. Riavvia l’accesso per averne uno nuovo.",
  errorInput: "La risposta non è stata inviata. La sessione resta aperta: riprova.",
  errorCancel: "Non sono riuscito ad annullare la sessione. Riprova.",
  errorRestart: "Il riavvio non è partito. Riprova.",
  footer: "Nessun dato del terminale viene salvato in questa schermata.",
  cancel: "Annulla",
  cancelling: "Annullamento…",
  restart: "Riavvia accesso",
  restarting: "Riavvio…",
  submit: "Invia risposta",
  submitting: "Invio…",
};

const en: TakeoverText = {
  eyebrow: "Action needed",
  title: (provider) => `Finish signing in to ${provider}`,
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Connection lost",
  elapsed: (time) => `Time elapsed ${time}`,
  waiting: "Waiting for a verified request from the provider.",
  waitingLong: "The provider has not shown the code yet: it usually takes a few seconds. If it stays like this, cancel and start the sign-in again.",
  verifying: "Answer sent, waiting for the provider.",
  invalidUrlInstruction: "The address received is not valid. Start the sign-in again.",
  invalidUrlError: "The provider returned an address that is not valid. Start the sign-in again.",
  urlTitle: "Sign-in URL",
  codeTitle: "Device code",
  copyUrl: "Copy URL",
  copyCode: "Copy code",
  openBrowser: "Open in browser",
  copied: "Copied.",
  copyFailed: "Copy failed. Select it and copy it by hand.",
  openFailed: "I cannot open the browser. Copy the URL and open it by hand.",
  expiresIn: (time) => `The code expires in ${time}.`,
  expired: "The code has expired. Start the sign-in again to get a new one.",
  errorInput: "The answer was not sent. The session stays open: try again.",
  errorCancel: "I could not cancel the session. Try again.",
  errorRestart: "The restart did not start. Try again.",
  footer: "No terminal data is saved on this screen.",
  cancel: "Cancel",
  cancelling: "Cancelling…",
  restart: "Restart sign-in",
  restarting: "Restarting…",
  submit: "Send answer",
  submitting: "Sending…",
};

const de: TakeoverText = {
  eyebrow: "Aktion erforderlich",
  title: (provider) => `Anmeldung bei ${provider} abschließen`,
  connecting: "Verbindung wird aufgebaut",
  connected: "Verbunden",
  disconnected: "Verbindung unterbrochen",
  elapsed: (time) => `Verstrichene Zeit ${time}`,
  waiting: "Warte auf eine geprüfte Anfrage des Anbieters.",
  waitingLong: "Der Anbieter hat den Code noch nicht angezeigt: Das dauert meist nur wenige Sekunden. Bleibt es so, brich ab und starte die Anmeldung neu.",
  verifying: "Antwort gesendet, warte auf den Anbieter.",
  invalidUrlInstruction: "Die erhaltene Adresse ist ungültig. Starte die Anmeldung neu.",
  invalidUrlError: "Der Anbieter hat eine ungültige Adresse zurückgegeben. Starte die Anmeldung neu.",
  urlTitle: "Anmelde-URL",
  codeTitle: "Gerätecode",
  copyUrl: "URL kopieren",
  copyCode: "Code kopieren",
  openBrowser: "Im Browser öffnen",
  copied: "Kopiert.",
  copyFailed: "Kopieren fehlgeschlagen. Markiere es und kopiere es von Hand.",
  openFailed: "Ich kann den Browser nicht öffnen. Kopiere die URL und öffne sie von Hand.",
  expiresIn: (time) => `Der Code läuft in ${time} ab.`,
  expired: "Der Code ist abgelaufen. Starte die Anmeldung neu, um einen neuen zu erhalten.",
  errorInput: "Die Antwort wurde nicht gesendet. Die Sitzung bleibt offen: Versuche es erneut.",
  errorCancel: "Die Sitzung konnte nicht abgebrochen werden. Versuche es erneut.",
  errorRestart: "Der Neustart hat nicht begonnen. Versuche es erneut.",
  footer: "Auf diesem Bildschirm werden keine Terminaldaten gespeichert.",
  cancel: "Abbrechen",
  cancelling: "Wird abgebrochen…",
  restart: "Anmeldung neu starten",
  restarting: "Neustart…",
  submit: "Antwort senden",
  submitting: "Wird gesendet…",
};

const fr: TakeoverText = {
  eyebrow: "Action requise",
  title: (provider) => `Terminer la connexion à ${provider}`,
  connecting: "Connexion en cours",
  connected: "Connecté",
  disconnected: "Connexion interrompue",
  elapsed: (time) => `Temps écoulé ${time}`,
  waiting: "En attente d’une demande vérifiée du fournisseur.",
  waitingLong: "Le fournisseur n’a pas encore affiché le code : cela prend en général quelques secondes. Si cela dure, annulez et relancez la connexion.",
  verifying: "Réponse envoyée, en attente du fournisseur.",
  invalidUrlInstruction: "L’adresse reçue n’est pas valide. Relancez la connexion.",
  invalidUrlError: "Le fournisseur a renvoyé une adresse non valide. Relancez la connexion.",
  urlTitle: "URL de connexion",
  codeTitle: "Code de l’appareil",
  copyUrl: "Copier l’URL",
  copyCode: "Copier le code",
  openBrowser: "Ouvrir dans le navigateur",
  copied: "Copié.",
  copyFailed: "La copie a échoué. Sélectionnez-le et copiez-le à la main.",
  openFailed: "Je ne peux pas ouvrir le navigateur. Copiez l’URL et ouvrez-la à la main.",
  expiresIn: (time) => `Le code expire dans ${time}.`,
  expired: "Le code a expiré. Relancez la connexion pour en obtenir un nouveau.",
  errorInput: "La réponse n’a pas été envoyée. La session reste ouverte : réessayez.",
  errorCancel: "Je n’ai pas pu annuler la session. Réessayez.",
  errorRestart: "Le redémarrage n’a pas commencé. Réessayez.",
  footer: "Aucune donnée du terminal n’est enregistrée sur cet écran.",
  cancel: "Annuler",
  cancelling: "Annulation…",
  restart: "Relancer la connexion",
  restarting: "Redémarrage…",
  submit: "Envoyer la réponse",
  submitting: "Envoi…",
};

const es: TakeoverText = {
  eyebrow: "Acción necesaria",
  title: (provider) => `Termina el inicio de sesión en ${provider}`,
  connecting: "Conectando",
  connected: "Conectado",
  disconnected: "Conexión interrumpida",
  elapsed: (time) => `Tiempo transcurrido ${time}`,
  waiting: "Esperando una solicitud verificada del proveedor.",
  waitingLong: "El proveedor aún no ha mostrado el código: suele tardar unos segundos. Si sigue así, cancela y vuelve a iniciar la sesión.",
  verifying: "Respuesta enviada, esperando al proveedor.",
  invalidUrlInstruction: "La dirección recibida no es válida. Vuelve a iniciar la sesión.",
  invalidUrlError: "El proveedor devolvió una dirección no válida. Vuelve a iniciar la sesión.",
  urlTitle: "URL de acceso",
  codeTitle: "Código del dispositivo",
  copyUrl: "Copiar URL",
  copyCode: "Copiar código",
  openBrowser: "Abrir en el navegador",
  copied: "Copiado.",
  copyFailed: "No se pudo copiar. Selecciónalo y cópialo a mano.",
  openFailed: "No puedo abrir el navegador. Copia la URL y ábrela a mano.",
  expiresIn: (time) => `El código caduca en ${time}.`,
  expired: "El código ha caducado. Vuelve a iniciar la sesión para obtener uno nuevo.",
  errorInput: "La respuesta no se envió. La sesión sigue abierta: inténtalo de nuevo.",
  errorCancel: "No pude cancelar la sesión. Inténtalo de nuevo.",
  errorRestart: "El reinicio no empezó. Inténtalo de nuevo.",
  footer: "En esta pantalla no se guarda ningún dato del terminal.",
  cancel: "Cancelar",
  cancelling: "Cancelando…",
  restart: "Reiniciar el inicio de sesión",
  restarting: "Reiniciando…",
  submit: "Enviar respuesta",
  submitting: "Enviando…",
};

const pt: TakeoverText = {
  eyebrow: "Ação necessária",
  title: (provider) => `Conclui o início de sessão em ${provider}`,
  connecting: "A ligar",
  connected: "Ligado",
  disconnected: "Ligação interrompida",
  elapsed: (time) => `Tempo decorrido ${time}`,
  waiting: "A aguardar um pedido verificado do fornecedor.",
  waitingLong: "O fornecedor ainda não mostrou o código: costuma demorar poucos segundos. Se continuar assim, cancela e inicia a sessão de novo.",
  verifying: "Resposta enviada, a aguardar o fornecedor.",
  invalidUrlInstruction: "O endereço recebido não é válido. Inicia a sessão de novo.",
  invalidUrlError: "O fornecedor devolveu um endereço que não é válido. Inicia a sessão de novo.",
  urlTitle: "URL de acesso",
  codeTitle: "Código do dispositivo",
  copyUrl: "Copiar URL",
  copyCode: "Copiar código",
  openBrowser: "Abrir no navegador",
  copied: "Copiado.",
  copyFailed: "A cópia falhou. Seleciona-o e copia-o à mão.",
  openFailed: "Não consigo abrir o navegador. Copia o URL e abre-o à mão.",
  expiresIn: (time) => `O código expira dentro de ${time}.`,
  expired: "O código expirou. Inicia a sessão de novo para obter um novo.",
  errorInput: "A resposta não foi enviada. A sessão continua aberta: tenta de novo.",
  errorCancel: "Não consegui cancelar a sessão. Tenta de novo.",
  errorRestart: "O reinício não começou. Tenta de novo.",
  footer: "Nenhum dado do terminal é guardado neste ecrã.",
  cancel: "Cancelar",
  cancelling: "A cancelar…",
  restart: "Reiniciar o início de sessão",
  restarting: "A reiniciar…",
  submit: "Enviar resposta",
  submitting: "A enviar…",
};

const hu: TakeoverText = {
  eyebrow: "Beavatkozás szükséges",
  title: (provider) => `Fejezd be a bejelentkezést ide: ${provider}`,
  connecting: "Kapcsolódás",
  connected: "Kapcsolódva",
  disconnected: "A kapcsolat megszakadt",
  elapsed: (time) => `Eltelt idő ${time}`,
  waiting: "Várakozás a szolgáltató ellenőrzött kérésére.",
  waitingLong: "A szolgáltató még nem mutatta meg a kódot: ez általában néhány másodperc. Ha így marad, szakítsd meg, és indítsd újra a bejelentkezést.",
  verifying: "A válasz elküldve, várakozás a szolgáltatóra.",
  invalidUrlInstruction: "A kapott cím érvénytelen. Indítsd újra a bejelentkezést.",
  invalidUrlError: "A szolgáltató érvénytelen címet adott vissza. Indítsd újra a bejelentkezést.",
  urlTitle: "Bejelentkezési URL",
  codeTitle: "Eszközkód",
  copyUrl: "URL másolása",
  copyCode: "Kód másolása",
  openBrowser: "Megnyitás böngészőben",
  copied: "Másolva.",
  copyFailed: "A másolás nem sikerült. Jelöld ki, és másold kézzel.",
  openFailed: "Nem tudom megnyitni a böngészőt. Másold ki az URL-t, és nyisd meg kézzel.",
  expiresIn: (time) => `A kód ${time} múlva lejár.`,
  expired: "A kód lejárt. Indítsd újra a bejelentkezést, hogy újat kapj.",
  errorInput: "A választ nem sikerült elküldeni. A munkamenet nyitva marad: próbáld újra.",
  errorCancel: "Nem tudtam megszakítani a munkamenetet. Próbáld újra.",
  errorRestart: "Az újraindítás nem indult el. Próbáld újra.",
  footer: "Ezen a képernyőn nem tárolunk terminálból származó adatot.",
  cancel: "Mégse",
  cancelling: "Megszakítás…",
  restart: "Bejelentkezés újraindítása",
  restarting: "Újraindítás…",
  submit: "Válasz küldése",
  submitting: "Küldés…",
};

export const TAKEOVER_TEXT: Record<Locale, TakeoverText> = { it, en, de, fr, es, pt, hu };
