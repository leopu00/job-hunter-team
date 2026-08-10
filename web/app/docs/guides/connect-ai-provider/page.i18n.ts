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
  kimi: string;
  codex: string;
  claude: string;
  dedicatedStrong: string;
  dedicatedRest: string;
  pricingLink: string;
  pricingAfter: string;
  connectIt: string;
  connectP1: string;
  connectP2: string;
  step1: string;
  step2: string;
  step2P1Strong: string;
  step2P1Rest: string;
  step2P2: string;
  step3: string;
  switching: string;
  switchingP: string;
  neverLeavesStrong: string;
  neverLeavesRest: string;
};

export const T: Record<Locale, Copy> = {
  en: {
    title: "Connect your AI provider",
    tagline:
      "The provider is the team's brain — and the only thing you pay for",
    intro:
      "The platform is free and open source. The intelligence behind the agents comes from an LLM provider you choose and sign into. This page connects it.",
    whichProvider: "🤔 Which provider?",
    whichProviderP:
      "Three are supported and tested. Pick one — you can switch later in a couple of commands.",
    kimi: "(Moonshot Pro) — validated on multi-day runs. The simplest starting point.",
    codex: "(OpenAI Plus/Pro) — balanced quality and cost.",
    claude: "(Anthropic Max) — top precision for scoring and CV writing.",
    dedicatedStrong: "Use a dedicated subscription.",
    dedicatedRest:
      "Sharing the account you use for personal AI drains the same weekly quota twice and the team will hit rate limits. See the",
    pricingLink: "pricing page",
    pricingAfter: "for the full comparison.",
    connectIt: "🔌 Connect it",
    connectP1:
      "The setup wizard already asks for your provider and runs the sign-in. If you ran",
    connectP2: "you're likely done. To do it (or redo it) by hand:",
    step1: "1. Select the provider",
    step2: "2. Sign in (OAuth device flow)",
    step2P1Strong: "subscriptions, not API keys",
    step2P1Rest:
      ": you log into your provider account through a browser device-flow, the same way their own CLI does. The wizard launches this for you; to force a clean login:",
    step2P2:
      "Follow the on-screen URL + code, confirm in the browser, and the credentials are stored inside the container (never in git).",
    step3: "3. Verify",
    switching: "🔄 Switching provider later",
    switchingP: "Change your mind any time:",
    neverLeavesStrong: "What never leaves your machine:",
    neverLeavesRest:
      "provider credentials live inside your container. We never see them, and they're never pushed to the cloud or to git.",
  },
  it: {
    title: "Collega il tuo provider AI",
    tagline: "Il provider è il cervello del team — e l'unica cosa che paghi",
    intro:
      "La piattaforma è gratuita e open source. L'intelligenza dietro gli agenti viene da un provider LLM che scegli e a cui accedi. Questa pagina lo collega.",
    whichProvider: "🤔 Quale provider?",
    whichProviderP:
      "Tre sono supportati e testati. Scegline uno — potrai cambiarlo più avanti con un paio di comandi.",
    kimi: "(Moonshot Pro) — validato su run di più giorni. Il punto di partenza più semplice.",
    codex: "(OpenAI Plus/Pro) — equilibrio tra qualità e costo.",
    claude:
      "(Anthropic Max) — massima precisione per scoring e scrittura del CV.",
    dedicatedStrong: "Usa un abbonamento dedicato.",
    dedicatedRest:
      "Condividere l'account che usi per l'AI personale consuma due volte la stessa quota settimanale e il team raggiungerà i limiti di rate. Consulta la",
    pricingLink: "pagina dei prezzi",
    pricingAfter: "per il confronto completo.",
    connectIt: "🔌 Collegalo",
    connectP1:
      "Il wizard di setup chiede già il tuo provider ed esegue il login. Se hai eseguito",
    connectP2: "probabilmente hai finito. Per farlo (o rifarlo) a mano:",
    step1: "1. Seleziona il provider",
    step2: "2. Accedi (OAuth device flow)",
    step2P1Strong: "abbonamenti, non API key",
    step2P1Rest:
      ": accedi al tuo account del provider tramite un device-flow nel browser, come fa la loro stessa CLI. Il wizard lo avvia per te; per forzare un login pulito:",
    step2P2:
      "Segui l'URL + codice mostrati a schermo, conferma nel browser e le credenziali vengono salvate dentro il container (mai in git).",
    step3: "3. Verifica",
    switching: "🔄 Cambiare provider più avanti",
    switchingP: "Cambia idea quando vuoi:",
    neverLeavesStrong: "Cosa non lascia mai la tua macchina:",
    neverLeavesRest:
      "le credenziali del provider vivono dentro il tuo container. Noi non le vediamo mai e non vengono mai inviate al cloud o a git.",
  },
  es: {
    title: "Conecta tu proveedor de IA",
    tagline: "El proveedor es el cerebro del equipo — y lo único que pagas",
    intro:
      "La plataforma es gratuita y de código abierto. La inteligencia detrás de los agentes proviene de un proveedor de LLM que eliges y en el que inicias sesión. Esta página lo conecta.",
    whichProvider: "🤔 ¿Qué proveedor?",
    whichProviderP:
      "Tres están soportados y probados. Elige uno — puedes cambiarlo más adelante con un par de comandos.",
    kimi: "(Moonshot Pro) — validado en ejecuciones de varios días. El punto de partida más sencillo.",
    codex: "(OpenAI Plus/Pro) — equilibrio entre calidad y coste.",
    claude:
      "(Anthropic Max) — máxima precisión para la puntuación y la redacción del CV.",
    dedicatedStrong: "Usa una suscripción dedicada.",
    dedicatedRest:
      "Compartir la cuenta que usas para tu IA personal agota la misma cuota semanal dos veces y el equipo alcanzará los límites de tasa. Consulta la",
    pricingLink: "página de precios",
    pricingAfter: "para la comparación completa.",
    connectIt: "🔌 Conéctalo",
    connectP1:
      "El asistente de configuración ya pregunta por tu proveedor y ejecuta el inicio de sesión. Si ejecutaste",
    connectP2:
      "probablemente ya está hecho. Para hacerlo (o rehacerlo) a mano:",
    step1: "1. Selecciona el proveedor",
    step2: "2. Inicia sesión (OAuth device flow)",
    step2P1Strong: "suscripciones, no claves de API",
    step2P1Rest:
      ": inicias sesión en la cuenta de tu proveedor mediante un device-flow del navegador, igual que hace su propia CLI. El asistente lo lanza por ti; para forzar un inicio de sesión limpio:",
    step2P2:
      "Sigue la URL + código mostrados en pantalla, confirma en el navegador y las credenciales se guardan dentro del contenedor (nunca en git).",
    step3: "3. Verifica",
    switching: "🔄 Cambiar de proveedor más adelante",
    switchingP: "Cambia de opinión cuando quieras:",
    neverLeavesStrong: "Lo que nunca sale de tu máquina:",
    neverLeavesRest:
      "las credenciales del proveedor viven dentro de tu contenedor. Nunca las vemos y nunca se envían a la nube ni a git.",
  },
  fr: {
    title: "Connectez votre fournisseur d'IA",
    tagline:
      "Le fournisseur est le cerveau de l'équipe — et la seule chose que vous payez",
    intro:
      "La plateforme est gratuite et open source. L'intelligence derrière les agents provient d'un fournisseur de LLM que vous choisissez et auquel vous vous connectez. Cette page le connecte.",
    whichProvider: "🤔 Quel fournisseur ?",
    whichProviderP:
      "Trois sont pris en charge et testés. Choisissez-en un — vous pourrez en changer plus tard en quelques commandes.",
    kimi: "(Moonshot Pro) — validé sur des exécutions de plusieurs jours. Le point de départ le plus simple.",
    codex: "(OpenAI Plus/Pro) — équilibre entre qualité et coût.",
    claude:
      "(Anthropic Max) — précision maximale pour le scoring et la rédaction du CV.",
    dedicatedStrong: "Utilisez un abonnement dédié.",
    dedicatedRest:
      "Partager le compte que vous utilisez pour votre IA personnelle épuise deux fois le même quota hebdomadaire et l'équipe atteindra les limites de débit. Consultez la",
    pricingLink: "page des tarifs",
    pricingAfter: "pour la comparaison complète.",
    connectIt: "🔌 Connectez-le",
    connectP1:
      "L'assistant de configuration demande déjà votre fournisseur et exécute la connexion. Si vous avez exécuté",
    connectP2:
      "c'est probablement déjà fait. Pour le faire (ou le refaire) à la main :",
    step1: "1. Sélectionnez le fournisseur",
    step2: "2. Connectez-vous (OAuth device flow)",
    step2P1Strong: "des abonnements, pas des clés d'API",
    step2P1Rest:
      " : vous vous connectez au compte de votre fournisseur via un device-flow du navigateur, exactement comme le fait leur propre CLI. L'assistant le lance pour vous ; pour forcer une connexion propre :",
    step2P2:
      "Suivez l'URL + le code affichés à l'écran, confirmez dans le navigateur, et les identifiants sont stockés à l'intérieur du conteneur (jamais dans git).",
    step3: "3. Vérifiez",
    switching: "🔄 Changer de fournisseur plus tard",
    switchingP: "Changez d'avis à tout moment :",
    neverLeavesStrong: "Ce qui ne quitte jamais votre machine :",
    neverLeavesRest:
      "les identifiants du fournisseur vivent à l'intérieur de votre conteneur. Nous ne les voyons jamais, et ils ne sont jamais envoyés vers le cloud ni vers git.",
  },
  de: {
    title: "Verbinde deinen KI-Anbieter",
    tagline:
      "Der Anbieter ist das Gehirn des Teams — und das Einzige, wofür du zahlst",
    intro:
      "Die Plattform ist kostenlos und Open Source. Die Intelligenz hinter den Agenten stammt von einem LLM-Anbieter, den du auswählst und bei dem du dich anmeldest. Diese Seite verbindet ihn.",
    whichProvider: "🤔 Welcher Anbieter?",
    whichProviderP:
      "Drei werden unterstützt und sind getestet. Wähle einen — du kannst später mit ein paar Befehlen wechseln.",
    kimi: "(Moonshot Pro) — validiert über mehrtägige Läufe. Der einfachste Einstiegspunkt.",
    codex: "(OpenAI Plus/Pro) — ausgewogen in Qualität und Kosten.",
    claude:
      "(Anthropic Max) — höchste Präzision für Scoring und Lebenslauf-Erstellung.",
    dedicatedStrong: "Verwende ein eigenes Abonnement.",
    dedicatedRest:
      "Das Teilen des Kontos, das du für deine persönliche KI nutzt, verbraucht dasselbe wöchentliche Kontingent doppelt, und das Team läuft in Rate-Limits. Siehe die",
    pricingLink: "Preisseite",
    pricingAfter: "für den vollständigen Vergleich.",
    connectIt: "🔌 Verbinde ihn",
    connectP1:
      "Der Setup-Assistent fragt bereits nach deinem Anbieter und führt die Anmeldung aus. Wenn du",
    connectP2:
      "ausgeführt hast, bist du wahrscheinlich fertig. Um es (erneut) von Hand zu tun:",
    step1: "1. Anbieter auswählen",
    step2: "2. Anmelden (OAuth Device Flow)",
    step2P1Strong: "Abonnements, keine API-Keys",
    step2P1Rest:
      ": Du meldest dich über einen Browser-Device-Flow bei deinem Anbieter-Konto an, genau wie es deren eigene CLI tut. Der Assistent startet das für dich; um eine saubere Anmeldung zu erzwingen:",
    step2P2:
      "Folge der auf dem Bildschirm angezeigten URL + dem Code, bestätige im Browser, und die Zugangsdaten werden im Container gespeichert (niemals in git).",
    step3: "3. Überprüfen",
    switching: "🔄 Anbieter später wechseln",
    switchingP: "Ändere deine Meinung jederzeit:",
    neverLeavesStrong: "Was deine Maschine niemals verlässt:",
    neverLeavesRest:
      "die Zugangsdaten des Anbieters bleiben in deinem Container. Wir sehen sie nie, und sie werden niemals in die Cloud oder nach git übertragen.",
  },
  hu: {
    title: "Csatlakoztasd az AI-szolgáltatódat",
    tagline:
      "A szolgáltató a csapat agya — és az egyetlen dolog, amiért fizetsz",
    intro:
      "A platform ingyenes és nyílt forráskódú. Az ügynökök mögötti intelligencia egy LLM-szolgáltatótól származik, amelyet te választasz ki, és amelybe bejelentkezel. Ez az oldal köti össze.",
    whichProvider: "🤔 Melyik szolgáltató?",
    whichProviderP:
      "Három támogatott és tesztelt. Válassz egyet — később pár paranccsal válthatsz.",
    kimi: "(Moonshot Pro) — többnapos futtatásokon validálva. A legegyszerűbb kiindulópont.",
    codex: "(OpenAI Plus/Pro) — kiegyensúlyozott minőség és költség.",
    claude:
      "(Anthropic Max) — csúcspontosság a pontozáshoz és az önéletrajz-íráshoz.",
    dedicatedStrong: "Használj dedikált előfizetést.",
    dedicatedRest:
      "Ha a személyes AI-hoz használt fiókot osztod meg, az kétszer meríti ki ugyanazt a heti keretet, és a csapat eléri a sebességkorlátokat. Lásd az",
    pricingLink: "árazási oldalt",
    pricingAfter: "a teljes összehasonlításért.",
    connectIt: "🔌 Csatlakoztasd",
    connectP1:
      "A beállítási varázsló már megkérdezi a szolgáltatódat, és lefuttatja a bejelentkezést. Ha lefuttattad a",
    connectP2:
      "parancsot, valószínűleg készen vagy. Hogy kézzel megtedd (vagy újra megtedd):",
    step1: "1. Válaszd ki a szolgáltatót",
    step2: "2. Jelentkezz be (OAuth device flow)",
    step2P1Strong: "előfizetések, nem API-kulcsok",
    step2P1Rest:
      ": a böngészős device-flow segítségével jelentkezel be a szolgáltatói fiókodba, ugyanúgy, ahogy a saját CLI-jük teszi. A varázsló ezt elindítja helyetted; egy tiszta bejelentkezés kikényszerítéséhez:",
    step2P2:
      "Kövesd a képernyőn megjelenő URL-t + kódot, erősítsd meg a böngészőben, és a hitelesítő adatok a konténeren belül tárolódnak (soha nem a git-ben).",
    step3: "3. Ellenőrzés",
    switching: "🔄 Szolgáltató váltása később",
    switchingP: "Bármikor meggondolhatod magad:",
    neverLeavesStrong: "Ami soha nem hagyja el a gépedet:",
    neverLeavesRest:
      "a szolgáltató hitelesítő adatai a konténereden belül élnek. Mi soha nem látjuk őket, és soha nem kerülnek fel a felhőbe vagy a git-be.",
  },
  pt: {
    title: "Conecte o seu provedor de IA",
    tagline: "O provedor é o cérebro da equipe — e a única coisa que você paga",
    intro:
      "A plataforma é gratuita e de código aberto. A inteligência por trás dos agentes vem de um provedor de LLM que você escolhe e no qual faz login. Esta página o conecta.",
    whichProvider: "🤔 Qual provedor?",
    whichProviderP:
      "Três são suportados e testados. Escolha um — você pode trocar mais tarde com alguns comandos.",
    kimi: "(Moonshot Pro) — validado em execuções de vários dias. O ponto de partida mais simples.",
    codex: "(OpenAI Plus/Pro) — equilíbrio entre qualidade e custo.",
    claude: "(Anthropic Max) — precisão máxima para pontuação e redação de CV.",
    dedicatedStrong: "Use uma assinatura dedicada.",
    dedicatedRest:
      "Compartilhar a conta que você usa para sua IA pessoal esgota a mesma cota semanal duas vezes e a equipe atingirá os limites de taxa. Veja a",
    pricingLink: "página de preços",
    pricingAfter: "para a comparação completa.",
    connectIt: "🔌 Conecte-o",
    connectP1:
      "O assistente de configuração já pergunta pelo seu provedor e executa o login. Se você executou",
    connectP2:
      "provavelmente já terminou. Para fazê-lo (ou refazê-lo) manualmente:",
    step1: "1. Selecione o provedor",
    step2: "2. Faça login (OAuth device flow)",
    step2P1Strong: "assinaturas, não chaves de API",
    step2P1Rest:
      ": você faz login na conta do seu provedor por meio de um device-flow do navegador, da mesma forma que a própria CLI deles. O assistente inicia isso para você; para forçar um login limpo:",
    step2P2:
      "Siga a URL + código exibidos na tela, confirme no navegador, e as credenciais são armazenadas dentro do contêiner (nunca no git).",
    step3: "3. Verifique",
    switching: "🔄 Trocar de provedor mais tarde",
    switchingP: "Mude de ideia a qualquer momento:",
    neverLeavesStrong: "O que nunca sai da sua máquina:",
    neverLeavesRest:
      "as credenciais do provedor vivem dentro do seu contêiner. Nós nunca as vemos, e elas nunca são enviadas para a nuvem ou para o git.",
  },
};
