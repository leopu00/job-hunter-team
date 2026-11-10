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
};
