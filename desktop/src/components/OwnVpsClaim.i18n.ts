import type { Locale } from "@/i18n/config";

export interface OwnVpsClaimText {
  /** a VPS the app set up before it marked them */
  inviteClaim: string;
  /** the key of the VPS is not the one confirmed before */
  inviteKeyChanged: string;
  button: string;
  confirmTitle: string;
  confirmBody: string;
  /** added to the body when the key changed */
  confirmKeyChanged: string;
  confirm: string;
  cancel: string;
  working: string;
  done: string;
}

const it: OwnVpsClaimText = {
  inviteClaim:
    "Questa VPS è stata creata prima che l’app la segnasse come tua: la puoi leggere, ma per comandarla o scriverle devi confermare che è la tua.",
  inviteKeyChanged:
    "La chiave di questa VPS è cambiata dall’ultima conferma (reinstallata o sostituita?). La puoi leggere, ma per comandarla o scriverle devi confermarla di nuovo.",
  button: "È la mia VPS",
  confirmTitle: "Confermi che questa VPS è tua?",
  confirmBody:
    "Confermi di averla creata tu con questa app, per il tuo team. L’app lo verifica chiedendo alla VPS di quale account è. Dopo la conferma l’app potrà avviare, fermare e riavviare gli agenti e scrivere ai tuoi agenti su questa VPS. Se non l’hai creata tu, annulla.",
  confirmKeyChanged:
    "La chiave di sicurezza della VPS è diversa da quella che avevi confermato: confermala solo se l’hai reinstallata o sostituita tu.",
  confirm: "Sì, è la mia",
  cancel: "Annulla",
  working: "Verifica in corso…",
  done: "Fatto: la VPS è confermata come tua.",
};

const en: OwnVpsClaimText = {
  inviteClaim:
    "This VPS was set up before the app marked VPSs as yours: you can read it, but to control it or write to it you must confirm that it is yours.",
  inviteKeyChanged:
    "The key of this VPS has changed since you last confirmed it (reinstalled or replaced?). You can read it, but to control it or write to it you must confirm it again.",
  button: "This is my VPS",
  confirmTitle: "Do you confirm that this VPS is yours?",
  confirmBody:
    "You confirm that you set it up with this app, for your own team. The app checks it by asking the VPS which account it belongs to. After the confirmation the app can start, stop and restart the agents and write to your agents on this VPS. If you did not set it up, cancel.",
  confirmKeyChanged:
    "The security key of the VPS is different from the one you confirmed before: confirm it only if you reinstalled or replaced it yourself.",
  confirm: "Yes, it is mine",
  cancel: "Cancel",
  working: "Checking…",
  done: "Done: the VPS is confirmed as yours.",
};

const de: OwnVpsClaimText = {
  inviteClaim:
    "Dieser VPS wurde eingerichtet, bevor die App VPS als deine markiert hat: Du kannst ihn lesen, aber um ihn zu steuern oder an ihn zu schreiben, musst du bestätigen, dass er dir gehört.",
  inviteKeyChanged:
    "Der Schlüssel dieses VPS hat sich seit deiner letzten Bestätigung geändert (neu installiert oder ersetzt?). Du kannst ihn lesen, aber um ihn zu steuern oder an ihn zu schreiben, musst du ihn erneut bestätigen.",
  button: "Das ist mein VPS",
  confirmTitle: "Bestätigst du, dass dieser VPS dir gehört?",
  confirmBody:
    "Du bestätigst, dass du ihn mit dieser App für dein eigenes Team eingerichtet hast. Die App prüft das, indem sie den VPS fragt, zu welchem Konto er gehört. Nach der Bestätigung kann die App die Agenten starten, stoppen und neu starten und deinen Agenten auf diesem VPS schreiben. Wenn du ihn nicht eingerichtet hast, brich ab.",
  confirmKeyChanged:
    "Der Sicherheitsschlüssel des VPS unterscheidet sich von dem, den du zuvor bestätigt hast: Bestätige ihn nur, wenn du ihn selbst neu installiert oder ersetzt hast.",
  confirm: "Ja, er gehört mir",
  cancel: "Abbrechen",
  working: "Wird geprüft …",
  done: "Fertig: Der VPS ist als deiner bestätigt.",
};

const es: OwnVpsClaimText = {
  inviteClaim:
    "Este VPS se creó antes de que la app marcara los VPS como tuyos: puedes leerlo, pero para controlarlo o escribirle debes confirmar que es tuyo.",
  inviteKeyChanged:
    "La clave de este VPS ha cambiado desde tu última confirmación (¿reinstalado o sustituido?). Puedes leerlo, pero para controlarlo o escribirle debes confirmarlo de nuevo.",
  button: "Es mi VPS",
  confirmTitle: "¿Confirmas que este VPS es tuyo?",
  confirmBody:
    "Confirmas que lo creaste con esta app, para tu propio equipo. La app lo comprueba preguntando al VPS de qué cuenta es. Tras la confirmación, la app podrá iniciar, detener y reiniciar los agentes y escribir a tus agentes en este VPS. Si no lo creaste tú, cancela.",
  confirmKeyChanged:
    "La clave de seguridad del VPS es distinta de la que confirmaste antes: confírmala solo si lo reinstalaste o sustituiste tú.",
  confirm: "Sí, es mío",
  cancel: "Cancelar",
  working: "Comprobando…",
  done: "Hecho: el VPS queda confirmado como tuyo.",
};

const fr: OwnVpsClaimText = {
  inviteClaim:
    "Ce VPS a été créé avant que l’app ne marque les VPS comme les tiens : tu peux le lire, mais pour le piloter ou lui écrire tu dois confirmer qu’il est à toi.",
  inviteKeyChanged:
    "La clé de ce VPS a changé depuis ta dernière confirmation (réinstallé ou remplacé ?). Tu peux le lire, mais pour le piloter ou lui écrire tu dois le confirmer à nouveau.",
  button: "C’est mon VPS",
  confirmTitle: "Confirmes-tu que ce VPS est à toi ?",
  confirmBody:
    "Tu confirmes l’avoir créé avec cette app, pour ta propre équipe. L’app le vérifie en demandant au VPS à quel compte il appartient. Après la confirmation, l’app pourra démarrer, arrêter et redémarrer les agents et écrire à tes agents sur ce VPS. Si tu ne l’as pas créé, annule.",
  confirmKeyChanged:
    "La clé de sécurité du VPS est différente de celle que tu avais confirmée : ne la confirme que si tu l’as réinstallé ou remplacé toi-même.",
  confirm: "Oui, il est à moi",
  cancel: "Annuler",
  working: "Vérification en cours…",
  done: "Terminé : le VPS est confirmé comme le tien.",
};

const hu: OwnVpsClaimText = {
  inviteClaim:
    "Ezt a VPS-t még azelőtt hoztuk létre, hogy az app a VPS-eket a tiédnek jelölte volna: olvashatod, de a vezérléséhez vagy az íráshoz meg kell erősítened, hogy a tiéd.",
  inviteKeyChanged:
    "A VPS kulcsa megváltozott az utolsó megerősítésed óta (újratelepítve vagy kicserélve?). Olvashatod, de a vezérléséhez vagy az íráshoz újra meg kell erősítened.",
  button: "Ez az én VPS-em",
  confirmTitle: "Megerősíted, hogy ez a VPS a tiéd?",
  confirmBody:
    "Megerősíted, hogy ezzel az appal hoztad létre, a saját csapatodnak. Az app úgy ellenőrzi, hogy megkérdezi a VPS-t, melyik fiókhoz tartozik. A megerősítés után az app elindíthatja, leállíthatja és újraindíthatja az ügynököket, és írhat az ügynökeidnek ezen a VPS-en. Ha nem te hoztad létre, mégse.",
  confirmKeyChanged:
    "A VPS biztonsági kulcsa eltér attól, amelyet korábban megerősítettél: csak akkor erősítsd meg, ha te telepítetted újra vagy cserélted ki.",
  confirm: "Igen, az enyém",
  cancel: "Mégse",
  working: "Ellenőrzés…",
  done: "Kész: a VPS meg van erősítve a tiédként.",
};

const pt: OwnVpsClaimText = {
  inviteClaim:
    "Este VPS foi criado antes de a app marcar os VPS como teus: podes lê-lo, mas para o controlar ou escrever-lhe tens de confirmar que é teu.",
  inviteKeyChanged:
    "A chave deste VPS mudou desde a tua última confirmação (reinstalado ou substituído?). Podes lê-lo, mas para o controlar ou escrever-lhe tens de o confirmar de novo.",
  button: "Este VPS é meu",
  confirmTitle: "Confirmas que este VPS é teu?",
  confirmBody:
    "Confirmas que o criaste com esta app, para a tua própria equipa. A app verifica-o perguntando ao VPS a que conta pertence. Depois da confirmação, a app poderá iniciar, parar e reiniciar os agentes e escrever aos teus agentes neste VPS. Se não o criaste tu, cancela.",
  confirmKeyChanged:
    "A chave de segurança do VPS é diferente da que confirmaste antes: confirma-a apenas se o reinstalaste ou substituíste tu.",
  confirm: "Sim, é meu",
  cancel: "Cancelar",
  working: "A verificar…",
  done: "Feito: o VPS fica confirmado como teu.",
};

export const OWN_VPS_CLAIM_TEXT: Record<Locale, OwnVpsClaimText> = { it, en, de, es, fr, hu, pt };
