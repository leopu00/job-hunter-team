import type { ErrorCopy } from "./error-catalog";
import type { ErrorTranslations } from "./error-catalog.locales";

/** The program that drives the agents (Codex or Pi), chosen in Settings: harness_choice.rs, `jht providers harness --json`.
 * Also `tools_unavailable`, the tools' round of tools_tier.rs (it has no other catalog file to live in). */
export const HARNESS_ERRORS: Readonly<Record<string, ErrorCopy>> = {
  harness_unavailable: {
    text: { it: "Non riesco a leggere quale programma guida gli agenti.", en: "The program that drives the agents cannot be read right now." },
    action: { it: "Riprova tra poco. La squadra continua con quello di prima.", en: "Try again in a moment. The team goes on with the one it had." },
  },
  harness_set_failed: {
    text: { it: "Non sono riuscito a cambiare il programma degli agenti.", en: "The program that drives the agents could not be changed." },
    action: { it: "Riprova. Se non è andata a buon fine, resta in uso quello di prima.", en: "Try again. If it did not succeed, the previous one stays in use." },
  },
  harness_refused: {
    text: { it: "Con questo accesso gli agenti non possono usare Pi.", en: "With this sign-in the agents cannot use Pi." },
    action: { it: "Resta su Codex, oppure cambia provider dal passo «Provider».", en: "Stay on Codex, or change the provider from the «Provider» step." },
  },
  tools_unavailable: {
    text: { it: "Non riesco a controllare gli strumenti della squadra.", en: "The team’s tools cannot be checked right now." },
    action: { it: "Non devi fare niente: ricontrollo tra poco.", en: "There is nothing for you to do: it is checked again shortly." },
  },
  harness_no_provider: {
    text: { it: "Prima di scegliere il programma degli agenti serve un provider attivo.", en: "An active provider is needed before choosing the program that drives the agents." },
    action: { it: "Completa il passo «Provider» e poi riprova.", en: "Complete the «Provider» step, then try again." },
  },
  agent_key_refused_glm: {
    text: { it: "GLM (Z.ai) ha rifiutato la chiave API: l’agente è bloccato (chiave sbagliata, scaduta o revocata).", en: "GLM (Z.ai) rejected the API key: the agent is blocked (wrong, expired or revoked)." },
    action: { it: "Dagli la chiave giusta con «jht setup --non-interactive --provider glm --harness pi --api-key-file <file>» (oppure con «--api-key-stdin»), poi riavvia la squadra: «jht team stop», «jht team start».", en: "Give it the right key with “jht setup --non-interactive --provider glm --harness pi --api-key-file <file>” (or with “--api-key-stdin”), then restart the team: “jht team stop”, “jht team start”." },
  },
  agent_key_refused_kimi: {
    text: { it: "Kimi (Moonshot) ha rifiutato la chiave API: l’agente è bloccato (chiave sbagliata, scaduta o revocata).", en: "Kimi (Moonshot) rejected the API key: the agent is blocked (wrong, expired or revoked)." },
    action: { it: "Dagli la chiave giusta con «jht setup --non-interactive --provider kimi --harness pi --api-key-file <file>» (oppure con «--api-key-stdin»), poi riavvia la squadra: «jht team stop», «jht team start».", en: "Give it the right key with “jht setup --non-interactive --provider kimi --harness pi --api-key-file <file>” (or with “--api-key-stdin”), then restart the team: “jht team stop”, “jht team start”." },
  },
  screen_unavailable: {
    text: { it: "Lo schermo live non è ancora disponibile in questa installazione.", en: "The live screen is not available in this installation yet." },
    action: { it: "Aggiorna Job Hunter Team e la squadra, poi riprova.", en: "Update Job Hunter Team and the team, then try again." },
  },
  screen_failed: {
    text: { it: "Non sono riuscito ad accendere o spegnere lo schermo live.", en: "The live screen could not be turned on or off." },
    action: { it: "Controlla che il motore dei container sia acceso e riprova.", en: "Check that the container engine is running, then try again." },
  },
  screen_local_only: {
    text: { it: "Lo schermo live si vede solo dal computer su cui gira la squadra.", en: "The live screen can only be seen from the computer the team runs on." },
    action: { it: "Usalo dal computer dove la squadra è installata.", en: "Use it from the computer where the team is installed." },
  },
  provider_key_invalid: {
    text: { it: "La chiave non ha la forma di una chiave API.", en: "That does not have the shape of an API key." },
    action: { it: "Incolla la chiave così com’è: una sola riga, da 16 a 512 caratteri, senza spazi.", en: "Paste the key as it is: a single line of 16 to 512 characters, without spaces." },
  },
  provider_key_provider_invalid: {
    text: { it: "Il provider della chiave non è uno di quelli che usano una chiave API.", en: "The provider of the key is not one that works with an API key." },
    action: { it: "Riapri le Impostazioni e riprova.", en: "Open the Settings again and try again." },
  },
  provider_key_failed: {
    text: { it: "Non sono riuscito a salvare la chiave nel team.", en: "The key could not be saved in the team." },
    action: { it: "Controlla che la squadra sia raggiungibile e riprova.", en: "Check that the team can be reached and try again." },
  },
};

export const HARNESS_ERROR_TRANSLATIONS: Readonly<Record<string, ErrorTranslations>> = {
  harness_unavailable: {
    de: ["Es lässt sich gerade nicht lesen, welches Programm die Agenten steuert.", "Versuche es gleich noch einmal. Das Team arbeitet mit dem bisherigen weiter."],
    es: ["Ahora mismo no se puede leer qué programa dirige a los agentes.", "Vuelve a intentarlo en un momento. El equipo sigue con el que tenía."],
    fr: ["Impossible de lire pour l’instant quel programme pilote les agents.", "Réessaie dans un instant. L’équipe continue avec celui qu’elle avait."],
    hu: ["Jelenleg nem olvasható, melyik program irányítja az ügynököket.", "Próbáld újra egy pillanat múlva. A csapat a korábbival folytatja."],
    pt: ["Neste momento não é possível ler que programa dirige os agentes.", "Tenta novamente daqui a pouco. A equipa continua com o que tinha."],
  },
  harness_set_failed: {
    de: ["Das Programm der Agenten konnte nicht geändert werden.", "Versuche es erneut. Falls es nicht geklappt hat, bleibt das bisherige in Gebrauch."],
    es: ["No se pudo cambiar el programa de los agentes.", "Vuelve a intentarlo. Si no se logró, sigue en uso el anterior."],
    fr: ["Le programme des agents n’a pas pu être changé.", "Réessaie. Si cela n’a pas abouti, le précédent reste en service."],
    hu: ["Az ügynökök programját nem sikerült megváltoztatni.", "Próbáld újra. Ha nem sikerült, a korábbi marad használatban."],
    pt: ["Não foi possível mudar o programa dos agentes.", "Tenta novamente. Se não resultou, continua em uso o anterior."],
  },
  harness_refused: {
    de: ["Mit dieser Anmeldung können die Agenten Pi nicht verwenden.", "Bleibe bei Codex oder wechsle den Anbieter im Schritt «Anbieter»."],
    es: ["Con este acceso los agentes no pueden usar Pi.", "Quédate con Codex o cambia de proveedor en el paso «Proveedor»."],
    fr: ["Avec cet accès, les agents ne peuvent pas utiliser Pi.", "Reste sur Codex, ou change de fournisseur à l’étape « Fournisseur »."],
    hu: ["Ezzel a bejelentkezéssel az ügynökök nem használhatják a Pi-t.", "Maradj a Codexnél, vagy válts szolgáltatót a «Szolgáltató» lépésben."],
    pt: ["Com este acesso os agentes não podem usar o Pi.", "Fica no Codex ou muda de fornecedor no passo «Fornecedor»."],
  },
  tools_unavailable: {
    de: ["Die Werkzeuge des Teams lassen sich gerade nicht prüfen.", "Du musst nichts tun: Es wird gleich erneut geprüft."],
    es: ["Ahora mismo no se pueden comprobar las herramientas del equipo.", "No tienes que hacer nada: se vuelve a comprobar enseguida."],
    fr: ["Impossible de vérifier les outils de l’équipe pour l’instant.", "Tu n’as rien à faire : ils sont revérifiés dans un instant."],
    hu: ["A csapat eszközeit most nem lehet ellenőrizni.", "Nincs teendőd: hamarosan újra ellenőrzöm."],
    pt: ["Neste momento não é possível verificar as ferramentas da equipa.", "Não tens de fazer nada: volta a ser verificado daqui a pouco."],
  },
  harness_no_provider: {
    de: ["Vor der Wahl des Agenten-Programms ist ein aktiver Anbieter nötig.", "Schließe den Schritt «Anbieter» ab und versuche es dann erneut."],
    es: ["Antes de elegir el programa de los agentes hace falta un proveedor activo.", "Completa el paso «Proveedor» y vuelve a intentarlo."],
    fr: ["Il faut un fournisseur actif avant de choisir le programme des agents.", "Termine l’étape « Fournisseur », puis réessaie."],
    hu: ["Az ügynökök programjának kiválasztása előtt aktív szolgáltató kell.", "Fejezd be a «Szolgáltató» lépést, majd próbáld újra."],
    pt: ["É preciso um fornecedor ativo antes de escolher o programa dos agentes.", "Conclui o passo «Fornecedor» e tenta novamente."],
  },
  agent_key_refused_glm: {
    de: ["GLM (Z.ai) hat den API-Schlüssel abgelehnt: Der Agent ist blockiert (Schlüssel falsch, abgelaufen oder widerrufen).", "Gib ihm den richtigen Schlüssel mit «jht setup --non-interactive --provider glm --harness pi --api-key-file <file>» (oder mit «--api-key-stdin») und starte dann das Team neu: «jht team stop», «jht team start»."],
    es: ["GLM (Z.ai) ha rechazado la clave de API: el agente está bloqueado (clave incorrecta, caducada o revocada).", "Dale la clave correcta con «jht setup --non-interactive --provider glm --harness pi --api-key-file <file>» (o con «--api-key-stdin») y reinicia el equipo: «jht team stop», «jht team start»."],
    fr: ["GLM (Z.ai) a refusé la clé d’API : l’agent est bloqué (clé erronée, expirée ou révoquée).", "Donne-lui la bonne clé avec « jht setup --non-interactive --provider glm --harness pi --api-key-file <file> » (ou avec « --api-key-stdin »), puis redémarre l’équipe : « jht team stop », « jht team start »."],
    hu: ["A(z) GLM (Z.ai) elutasította az API-kulcsot: az ügynök blokkolva van (hibás, lejárt vagy visszavont kulcs).", "Add meg neki a helyes kulcsot a „jht setup --non-interactive --provider glm --harness pi --api-key-file <file>” paranccsal (vagy a „--api-key-stdin” kapcsolóval), majd indítsd újra a csapatot: „jht team stop”, „jht team start”."],
    pt: ["GLM (Z.ai) rejeitou a chave de API: o agente está bloqueado (chave errada, expirada ou revogada).", "Dá-lhe a chave certa com «jht setup --non-interactive --provider glm --harness pi --api-key-file <file>» (ou com «--api-key-stdin») e reinicia a equipa: «jht team stop», «jht team start»."],
  },
  agent_key_refused_kimi: {
    de: ["Kimi (Moonshot) hat den API-Schlüssel abgelehnt: Der Agent ist blockiert (Schlüssel falsch, abgelaufen oder widerrufen).", "Gib ihm den richtigen Schlüssel mit «jht setup --non-interactive --provider kimi --harness pi --api-key-file <file>» (oder mit «--api-key-stdin») und starte dann das Team neu: «jht team stop», «jht team start»."],
    es: ["Kimi (Moonshot) ha rechazado la clave de API: el agente está bloqueado (clave incorrecta, caducada o revocada).", "Dale la clave correcta con «jht setup --non-interactive --provider kimi --harness pi --api-key-file <file>» (o con «--api-key-stdin») y reinicia el equipo: «jht team stop», «jht team start»."],
    fr: ["Kimi (Moonshot) a refusé la clé d’API : l’agent est bloqué (clé erronée, expirée ou révoquée).", "Donne-lui la bonne clé avec « jht setup --non-interactive --provider kimi --harness pi --api-key-file <file> » (ou avec « --api-key-stdin »), puis redémarre l’équipe : « jht team stop », « jht team start »."],
    hu: ["A(z) Kimi (Moonshot) elutasította az API-kulcsot: az ügynök blokkolva van (hibás, lejárt vagy visszavont kulcs).", "Add meg neki a helyes kulcsot a „jht setup --non-interactive --provider kimi --harness pi --api-key-file <file>” paranccsal (vagy a „--api-key-stdin” kapcsolóval), majd indítsd újra a csapatot: „jht team stop”, „jht team start”."],
    pt: ["Kimi (Moonshot) rejeitou a chave de API: o agente está bloqueado (chave errada, expirada ou revogada).", "Dá-lhe a chave certa com «jht setup --non-interactive --provider kimi --harness pi --api-key-file <file>» (ou com «--api-key-stdin») e reinicia a equipa: «jht team stop», «jht team start»."],
  },
  screen_unavailable: {
    de: ["Der Live-Bildschirm ist in dieser Installation noch nicht verfügbar.", "Aktualisiere Job Hunter Team und das Team und versuche es dann erneut."],
    es: ["La pantalla en vivo todavía no está disponible en esta instalación.", "Actualiza Job Hunter Team y el equipo y vuelve a intentarlo."],
    fr: ["L’écran en direct n’est pas encore disponible dans cette installation.", "Mets à jour Job Hunter Team et l’équipe, puis réessaie."],
    hu: ["Az élő képernyő ebben a telepítésben még nem érhető el.", "Frissítsd a Job Hunter Teamet és a csapatot, majd próbáld újra."],
    pt: ["O ecrã em direto ainda não está disponível nesta instalação.", "Atualiza o Job Hunter Team e a equipa e tenta novamente."],
  },
  screen_failed: {
    de: ["Der Live-Bildschirm konnte nicht ein- oder ausgeschaltet werden.", "Prüfe, ob die Container-Engine läuft, und versuche es erneut."],
    es: ["No se pudo encender o apagar la pantalla en vivo.", "Comprueba que el motor de contenedores esté en marcha y vuelve a intentarlo."],
    fr: ["L’écran en direct n’a pas pu être allumé ou éteint.", "Vérifie que le moteur de conteneurs fonctionne, puis réessaie."],
    hu: ["Az élő képernyőt nem sikerült be- vagy kikapcsolni.", "Ellenőrizd, hogy fut-e a konténermotor, majd próbáld újra."],
    pt: ["Não foi possível ligar ou desligar o ecrã em direto.", "Verifica se o motor de contentores está em execução e tenta novamente."],
  },
  screen_local_only: {
    de: ["Der Live-Bildschirm ist nur auf dem Computer zu sehen, auf dem das Team läuft.", "Nutze ihn auf dem Computer, auf dem das Team installiert ist."],
    es: ["La pantalla en vivo solo se ve desde el ordenador donde funciona el equipo.", "Úsala desde el ordenador donde está instalado el equipo."],
    fr: ["L’écran en direct ne se voit que depuis l’ordinateur sur lequel l’équipe fonctionne.", "Utilise-le depuis l’ordinateur où l’équipe est installée."],
    hu: ["Az élő képernyő csak arról a számítógépről látható, amelyen a csapat fut.", "Azon a számítógépen használd, ahová a csapat telepítve van."],
    pt: ["O ecrã em direto só se vê a partir do computador onde a equipa funciona.", "Usa-o no computador onde a equipa está instalada."],
  },
  provider_key_invalid: {
    de: ["Das hat nicht die Form eines API-Schlüssels.", "Füge den Schlüssel unverändert ein: eine einzelne Zeile mit 16 bis 512 Zeichen, ohne Leerzeichen."],
    es: ["Eso no tiene la forma de una clave de API.", "Pega la clave tal cual: una sola línea de 16 a 512 caracteres, sin espacios."],
    fr: ["Cela n’a pas la forme d’une clé d’API.", "Colle la clé telle quelle : une seule ligne de 16 à 512 caractères, sans espaces."],
    hu: ["Ez nem API-kulcs alakú.", "Illeszd be a kulcsot úgy, ahogy van: egyetlen sor, 16–512 karakter, szóközök nélkül."],
    pt: ["Isso não tem a forma de uma chave de API.", "Cola a chave tal como está: uma única linha de 16 a 512 caracteres, sem espaços."],
  },
  provider_key_provider_invalid: {
    de: ["Der Anbieter des Schlüssels arbeitet nicht mit einem API-Schlüssel.", "Öffne die Einstellungen erneut und versuche es noch einmal."],
    es: ["El proveedor de la clave no es de los que funcionan con una clave de API.", "Vuelve a abrir los ajustes e inténtalo de nuevo."],
    fr: ["Le fournisseur de la clé ne fonctionne pas avec une clé d’API.", "Rouvre les réglages et réessaie."],
    hu: ["A kulcs szolgáltatója nem dolgozik API-kulccsal.", "Nyisd meg újra a beállításokat, és próbáld újra."],
    pt: ["O fornecedor da chave não é dos que funcionam com uma chave de API.", "Volta a abrir as definições e tenta novamente."],
  },
  provider_key_failed: {
    de: ["Der Schlüssel konnte nicht im Team gespeichert werden.", "Prüfe, ob das Team erreichbar ist, und versuche es erneut."],
    es: ["No se pudo guardar la clave en el equipo.", "Comprueba que el equipo sea accesible y vuelve a intentarlo."],
    fr: ["La clé n’a pas pu être enregistrée dans l’équipe.", "Vérifie que l’équipe est joignable et réessaie."],
    hu: ["A kulcsot nem sikerült elmenteni a csapatban.", "Ellenőrizd, hogy a csapat elérhető-e, és próbáld újra."],
    pt: ["Não foi possível guardar a chave na equipa.", "Verifica se a equipa está acessível e tenta novamente."],
  },
};
