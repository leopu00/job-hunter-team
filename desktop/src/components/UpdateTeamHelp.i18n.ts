import type { Locale } from "@/i18n/config";

/**
 * The guide that shows how to update the team, in plain words: no «runtime», no «image», no «host». The person is told which
 * program to open, what to paste and what to do afterwards. 7 languages; Italian is the source and its shape is the type.
 */
const it = {
  button: "Aggiorna la squadra",
  title: "Come aggiornare la squadra",
  intro: "La squadra è una versione più vecchia dell’app e non sa ancora fare questa cosa. Si aggiorna con un solo comando.",
  step1: "Apri il Terminale (su Windows: PowerShell).",
  step2: "Incolla questo comando e premi Invio:",
  step3: "Aspetta che finisca: può volerci qualche minuto. Quando ha finito, torna qui e riprova.",
  server: "Se la squadra gira su un server, apri il Terminale su quel server e lancia lo stesso comando.",
  copy: "Copia il comando",
  copied: "Comando copiato.",
  copyFailed: "Non riesco a copiare: selezionalo e copialo a mano.",
  close: "Chiudi",
};

export type UpdateTeamText = typeof it;

const en: UpdateTeamText = {
  button: "Update the team",
  title: "How to update the team",
  intro: "The team runs an older version than the app and cannot do this yet. One command updates it.",
  step1: "Open the Terminal (on Windows: PowerShell).",
  step2: "Paste this command and press Enter:",
  step3: "Wait for it to finish; it can take a few minutes. When it is done, come back here and try again.",
  server: "If the team runs on a server, open the Terminal on that server and run the same command.",
  copy: "Copy the command",
  copied: "Command copied.",
  copyFailed: "Copying did not work: select the command and copy it by hand.",
  close: "Close",
};

const de: UpdateTeamText = {
  button: "Team aktualisieren",
  title: "So aktualisierst du das Team",
  intro: "Das Team läuft in einer älteren Version als die App und kann das noch nicht. Ein einziger Befehl aktualisiert es.",
  step1: "Öffne das Terminal (unter Windows: PowerShell).",
  step2: "Füge diesen Befehl ein und drücke die Eingabetaste:",
  step3: "Warte, bis er fertig ist; das kann ein paar Minuten dauern. Danach komm hierher zurück und versuche es erneut.",
  server: "Läuft das Team auf einem Server, öffne das Terminal auf diesem Server und führe denselben Befehl aus.",
  copy: "Befehl kopieren",
  copied: "Befehl kopiert.",
  copyFailed: "Kopieren hat nicht geklappt: Markiere den Befehl und kopiere ihn von Hand.",
  close: "Schließen",
};

const es: UpdateTeamText = {
  button: "Actualizar el equipo",
  title: "Cómo actualizar el equipo",
  intro: "El equipo funciona con una versión más antigua que la app y todavía no sabe hacer esto. Se actualiza con un solo comando.",
  step1: "Abre la Terminal (en Windows: PowerShell).",
  step2: "Pega este comando y pulsa Intro:",
  step3: "Espera a que termine; puede tardar unos minutos. Cuando acabe, vuelve aquí e inténtalo de nuevo.",
  server: "Si el equipo funciona en un servidor, abre la Terminal en ese servidor y ejecuta el mismo comando.",
  copy: "Copiar el comando",
  copied: "Comando copiado.",
  copyFailed: "No se pudo copiar: selecciona el comando y cópialo a mano.",
  close: "Cerrar",
};

const fr: UpdateTeamText = {
  button: "Mettre à jour l’équipe",
  title: "Comment mettre à jour l’équipe",
  intro: "L’équipe tourne avec une version plus ancienne que l’application et ne sait pas encore faire cela. Une seule commande la met à jour.",
  step1: "Ouvre le Terminal (sous Windows : PowerShell).",
  step2: "Colle cette commande et appuie sur Entrée :",
  step3: "Attends qu’elle se termine ; cela peut prendre quelques minutes. Ensuite, reviens ici et réessaie.",
  server: "Si l’équipe tourne sur un serveur, ouvre le Terminal sur ce serveur et lance la même commande.",
  copy: "Copier la commande",
  copied: "Commande copiée.",
  copyFailed: "La copie n’a pas fonctionné : sélectionne la commande et copie-la à la main.",
  close: "Fermer",
};

const hu: UpdateTeamText = {
  button: "Csapat frissítése",
  title: "Hogyan frissítsd a csapatot",
  intro: "A csapat az alkalmazásnál régebbi verzión fut, és ezt még nem tudja. Egyetlen paranccsal frissíthető.",
  step1: "Nyisd meg a Terminált (Windowson: PowerShell).",
  step2: "Illeszd be ezt a parancsot, és nyomj Entert:",
  step3: "Várd meg, amíg lefut; ez eltarthat pár percig. Utána gyere vissza, és próbáld újra.",
  server: "Ha a csapat egy szerveren fut, nyisd meg a Terminált azon a szerveren, és futtasd ugyanezt a parancsot.",
  copy: "Parancs másolása",
  copied: "A parancs másolva.",
  copyFailed: "A másolás nem sikerült: jelöld ki a parancsot, és másold ki kézzel.",
  close: "Bezárás",
};

const pt: UpdateTeamText = {
  button: "Atualizar a equipa",
  title: "Como atualizar a equipa",
  intro: "A equipa funciona com uma versão mais antiga do que a app e ainda não sabe fazer isto. Atualiza-se com um único comando.",
  step1: "Abre o Terminal (no Windows: PowerShell).",
  step2: "Cola este comando e carrega em Enter:",
  step3: "Espera que termine; pode demorar alguns minutos. Quando acabar, volta aqui e tenta de novo.",
  server: "Se a equipa corre num servidor, abre o Terminal nesse servidor e executa o mesmo comando.",
  copy: "Copiar o comando",
  copied: "Comando copiado.",
  copyFailed: "Não foi possível copiar: seleciona o comando e copia-o à mão.",
  close: "Fechar",
};

export const UPDATE_TEAM_TEXT: Record<Locale, UpdateTeamText> = { it, en, de, es, fr, hu, pt };
