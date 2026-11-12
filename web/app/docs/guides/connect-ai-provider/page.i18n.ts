// Dizionario di `page.tsx`.
//
// Le chiavi sono LOCALI a questa guida: lo stesso nome può valere tutt'altro
// altrove, quindi non vanno accorpate in un dizionario comune. Il tipo su
// `T` fa pretendere al compilatore ogni lingua dichiarata: una voce a cui
// ne manca una non compila, invece di mostrare l'inglese all'utente
// sbagliato.
import type { Locale } from "@/i18n/config";

export type Copy = {
  title: string;
  tagline: string;
  intro: string;
  whichProvider: string;
  whichProviderP: string;
  connectIt: string;
  connectP1: string;
  connectP2: string;
  step3: string;
  neverLeavesStrong: string;
  neverLeavesRest: string;
  apiKey: string;
  coming: string;
  apiKeyP1: string;
  apiKeyP2: string;
};

export const T: Record<Locale, Copy> = {
  en: {
    title: "Connect your AI provider",
    tagline:
      "The provider is the team's brain — and the only thing you pay for",
    intro:
      "The platform is free and open source. The intelligence behind the agents comes from an LLM provider you choose and sign into. This page connects it.",
    whichProvider: "🤔 Which provider?",
    whichProviderP: "In 0.4.0 the team runs on one provider: GLM (Z.ai), with an API key, on the Pi harness. Codex (ChatGPT subscription) is not in this version.",
    connectIt: "🔌 Connect it",
    connectP1: "The setup wizard asks for the GLM API key, checks it and keeps it in a private folder of the container. If you ran",
    connectP2: "you're done. To do it again, or without questions:",
    step3: "✅ Verify",
    neverLeavesStrong: "What never leaves your machine:",
    neverLeavesRest:
      "provider credentials live inside your container. We never see them, and they're never pushed to the cloud or to git.",
    apiKey: "(Z.ai) — with an API key, paid per call; jht setup asks for it (typed hidden) and checks it with Z.ai.",
    apiKeyP1:
      "The agents run on the Pi harness. Give the key from a file or from stdin, never on the command line (it would stay in your shell history):",
    apiKeyP2:
      "An API key has no usage window: only a daily ceiling stops the spending. Set it in the configuration as no_quota_cap (for example eur: 10) or ask the Captain; at the ceiling the team pauses and nothing is lost. Measured: about 0.10 USD per scored position on GLM.",
    coming: "Codex — not in this version.",
  },
  it: {
    title: "Collega il tuo provider AI",
    tagline: "Il provider è il cervello del team — e l'unica cosa che paghi",
    intro:
      "La piattaforma è gratuita e open source. L'intelligenza dietro gli agenti viene da un provider LLM che scegli e a cui accedi. Questa pagina lo collega.",
    whichProvider: "🤔 Quale provider?",
    whichProviderP: "Nella 0.4.0 il team gira su un solo provider: GLM (Z.ai), con una chiave API, sull'harness Pi. Codex (abbonamento ChatGPT) non è in questa versione.",
    connectIt: "🔌 Collegalo",
    connectP1: "Il setup guidato chiede la chiave API di GLM, la controlla e la tiene in una cartella privata del container. Se hai lanciato",
    connectP2: "hai finito. Per rifarlo, o senza domande:",
    step3: "✅ Verifica",
    neverLeavesStrong: "Cosa non lascia mai la tua macchina:",
    neverLeavesRest:
      "le credenziali del provider vivono dentro il tuo container. Noi non le vediamo mai e non vengono mai inviate al cloud o a git.",
    apiKey: "(Z.ai) — con una chiave API, a consumo; jht setup la chiede (scritta nascosta) e la controlla con Z.ai.",
    apiKeyP1:
      "Gli agenti girano sull'harness Pi. Dai la chiave da un file o da stdin, mai sulla riga di comando (resterebbe nella cronologia della shell):",
    apiKeyP2:
      "Una chiave API non ha una finestra d'uso: la spesa la ferma solo un tetto giornaliero. Impostalo nella configurazione come no_quota_cap (per esempio eur: 10) o chiedilo al Capitano; al tetto la squadra si mette in pausa e non si perde niente. Misurato: circa 0,10 USD per posizione valutata su GLM.",
    coming: "Codex — non in questa versione.",
  },
  es: {
    title: "Conecta tu proveedor de IA",
    tagline: "El proveedor es el cerebro del equipo — y lo único que pagas",
    intro:
      "La plataforma es gratuita y de código abierto. La inteligencia detrás de los agentes proviene de un proveedor de LLM que eliges y en el que inicias sesión. Esta página lo conecta.",
    whichProvider: "🤔 ¿Qué proveedor?",
    whichProviderP: "En la 0.4.0 el equipo funciona con un solo proveedor: GLM (Z.ai), con una clave de API, sobre el harness Pi. Codex (suscripción a ChatGPT) no está en esta versión.",
    connectIt: "🔌 Conéctalo",
    connectP1: "El asistente de configuración pide la clave de API de GLM, la comprueba y la guarda en una carpeta privada del contenedor. Si ejecutaste",
    connectP2: "ya está. Para repetirlo, o sin preguntas:",
    step3: "✅ Comprueba",
    neverLeavesStrong: "Lo que nunca sale de tu máquina:",
    neverLeavesRest:
      "las credenciales del proveedor viven dentro de tu contenedor. Nunca las vemos y nunca se envían a la nube ni a git.",
    apiKey: "(Z.ai) — con una clave de API, de pago por uso; jht setup la pide (escrita oculta) y la comprueba con Z.ai.",
    apiKeyP1:
      "Los agentes funcionan en el harness Pi. Da la clave desde un archivo o desde stdin, nunca en la línea de comandos (quedaría en el historial de la shell):",
    apiKeyP2:
      "Una clave de API no tiene ventana de uso: solo un tope diario detiene el gasto. Configúralo como no_quota_cap (por ejemplo eur: 10) o pídeselo al Capitán; al llegar al tope el equipo se pausa y no se pierde nada. Medido: unos 0,10 USD por posición puntuada con GLM.",
    coming: "Codex — no está en esta versión.",
  },
  fr: {
    title: "Connectez votre fournisseur d'IA",
    tagline:
      "Le fournisseur est le cerveau de l'équipe — et la seule chose que vous payez",
    intro:
      "La plateforme est gratuite et open source. L'intelligence derrière les agents provient d'un fournisseur de LLM que vous choisissez et auquel vous vous connectez. Cette page le connecte.",
    whichProvider: "🤔 Quel fournisseur ?",
    whichProviderP: "Dans la 0.4.0, l'équipe fonctionne avec un seul fournisseur : GLM (Z.ai), avec une clé d'API, sur le harness Pi. Codex (abonnement ChatGPT) n'est pas dans cette version.",
    connectIt: "🔌 Connectez-le",
    connectP1: "L'assistant de configuration demande la clé d'API GLM, la vérifie et la garde dans un dossier privé du conteneur. Si vous avez lancé",
    connectP2: "c'est fait. Pour recommencer, ou sans questions :",
    step3: "✅ Vérifier",
    neverLeavesStrong: "Ce qui ne quitte jamais votre machine :",
    neverLeavesRest:
      "les identifiants du fournisseur vivent à l'intérieur de votre conteneur. Nous ne les voyons jamais, et ils ne sont jamais envoyés vers le cloud ni vers git.",
    apiKey: "(Z.ai) — avec une clé d'API, payée à l'usage ; jht setup la demande (saisie masquée) et la vérifie auprès de Z.ai.",
    apiKeyP1:
      "Les agents tournent sur le harness Pi. Donnez la clé depuis un fichier ou depuis stdin, jamais sur la ligne de commande (elle resterait dans l'historique du shell) :",
    apiKeyP2:
      "Une clé d'API n'a pas de fenêtre d'usage : seul un plafond journalier arrête la dépense. Réglez-le dans la configuration avec no_quota_cap (par exemple eur: 10) ou demandez-le au Capitaine ; au plafond l'équipe se met en pause et rien n'est perdu. Mesuré : environ 0,10 USD par poste évalué avec GLM.",
    coming: "Codex — pas dans cette version.",
  },
  de: {
    title: "Verbinde deinen KI-Anbieter",
    tagline:
      "Der Anbieter ist das Gehirn des Teams — und das Einzige, wofür du zahlst",
    intro:
      "Die Plattform ist kostenlos und Open Source. Die Intelligenz hinter den Agenten stammt von einem LLM-Anbieter, den du auswählst und bei dem du dich anmeldest. Diese Seite verbindet ihn.",
    whichProvider: "🤔 Welcher Anbieter?",
    whichProviderP: "In 0.4.0 läuft das Team mit einem einzigen Anbieter: GLM (Z.ai), mit einem API-Key, auf dem Pi-Harness. Codex (ChatGPT-Abo) ist nicht in dieser Version.",
    connectIt: "🔌 Verbinde ihn",
    connectP1: "Der Einrichtungsassistent fragt nach dem GLM-API-Key, prüft ihn und bewahrt ihn in einem privaten Ordner des Containers auf. Wenn du",
    connectP2: "ausgeführt hast, bist du fertig. Zum Wiederholen, oder ohne Fragen:",
    step3: "✅ Prüfen",
    neverLeavesStrong: "Was deine Maschine niemals verlässt:",
    neverLeavesRest:
      "die Zugangsdaten des Anbieters bleiben in deinem Container. Wir sehen sie nie, und sie werden niemals in die Cloud oder nach git übertragen.",
    apiKey: "(Z.ai) — mit einem API-Key, pro Aufruf bezahlt; jht setup fragt danach (verdeckt eingegeben) und prüft ihn bei Z.ai.",
    apiKeyP1:
      "Die Agenten laufen auf dem Pi-Harness. Gib den Key aus einer Datei oder über stdin, nie auf der Kommandozeile (er bliebe im Shell-Verlauf):",
    apiKeyP2:
      "Ein API-Key hat kein Nutzungsfenster: nur ein Tageslimit stoppt die Ausgaben. Setze es in der Konfiguration als no_quota_cap (zum Beispiel eur: 10) oder bitte den Kapitän darum; am Limit pausiert das Team, nichts geht verloren. Gemessen: etwa 0,10 USD pro bewerteter Stelle mit GLM.",
    coming: "Codex — nicht in dieser Version.",
  },
  hu: {
    title: "Csatlakoztasd az AI-szolgáltatódat",
    tagline:
      "A szolgáltató a csapat agya — és az egyetlen dolog, amiért fizetsz",
    intro:
      "A platform ingyenes és nyílt forráskódú. Az ügynökök mögötti intelligencia egy LLM-szolgáltatótól származik, amelyet te választasz ki, és amelybe bejelentkezel. Ez az oldal köti össze.",
    whichProvider: "🤔 Melyik szolgáltató?",
    whichProviderP: "A 0.4.0-ban a csapat egyetlen szolgáltatóval fut: GLM (Z.ai), API-kulccsal, a Pi harness-en. A Codex (ChatGPT-előfizetés) nincs benne ebben a verzióban.",
    connectIt: "🔌 Csatlakoztasd",
    connectP1: "A beállító varázsló elkéri a GLM API-kulcsot, ellenőrzi, és a konténer egy privát mappájában tartja. Ha futtattad a",
    connectP2: "parancsot, kész vagy. Újra, vagy kérdések nélkül:",
    step3: "✅ Ellenőrzés",
    neverLeavesStrong: "Ami soha nem hagyja el a gépedet:",
    neverLeavesRest:
      "a szolgáltató hitelesítő adatai a konténereden belül élnek. Mi soha nem látjuk őket, és soha nem kerülnek fel a felhőbe vagy a git-be.",
    apiKey: "(Z.ai) — API-kulccsal, hívásonként fizetve; a jht setup elkéri (rejtett beírással) és ellenőrzi a Z.ai-nál.",
    apiKeyP1:
      "Az ügynökök a Pi harnessen futnak. A kulcsot fájlból vagy stdinről add meg, soha ne a parancssorban (ott maradna a shell előzményeiben):",
    apiKeyP2:
      "Egy API-kulcsnak nincs használati ablaka: a költést csak egy napi plafon állítja meg. Állítsd be a konfigurációban no_quota_cap néven (például eur: 10), vagy kérd a Kapitánytól; a plafonnál a csapat szünetel, semmi sem vész el. Mérve: kb. 0,10 USD egy értékelt pozícióra GLM-mel.",
    coming: "Codex — nincs benne ebben a verzióban.",
  },
  pt: {
    title: "Conecte o seu provedor de IA",
    tagline: "O provedor é o cérebro da equipe — e a única coisa que você paga",
    intro:
      "A plataforma é gratuita e de código aberto. A inteligência por trás dos agentes vem de um provedor de LLM que você escolhe e no qual faz login. Esta página o conecta.",
    whichProvider: "🤔 Qual provedor?",
    whichProviderP: "Na 0.4.0 a equipa funciona com um só fornecedor: GLM (Z.ai), com uma chave de API, no harness Pi. Codex (subscrição ChatGPT) não está nesta versão.",
    connectIt: "🔌 Conecte-o",
    connectP1: "O assistente de configuração pede a chave de API do GLM, verifica-a e guarda-a numa pasta privada do contentor. Se correste",
    connectP2: "está feito. Para repetir, ou sem perguntas:",
    step3: "✅ Verificar",
    neverLeavesStrong: "O que nunca sai da sua máquina:",
    neverLeavesRest:
      "as credenciais do provedor vivem dentro do seu contêiner. Nós nunca as vemos, e elas nunca são enviadas para a nuvem ou para o git.",
    apiKey: "(Z.ai) — com uma chave de API, paga por uso; o jht setup pede-a (escrita oculta) e verifica-a com a Z.ai.",
    apiKeyP1:
      "Os agentes rodam no harness Pi. Passe a chave por um arquivo ou por stdin, nunca na linha de comando (ficaria no histórico do shell):",
    apiKeyP2:
      "Uma chave de API não tem janela de uso: só um teto diário para o gasto. Defina-o na configuração como no_quota_cap (por exemplo eur: 10) ou peça ao Capitão; no teto a equipe pausa e nada se perde. Medido: cerca de 0,10 USD por vaga avaliada com GLM.",
    coming: "Codex — não está nesta versão.",
  },
};
