// Dizionario di `page.tsx`.
//
// Le chiavi sono LOCALI a questa guida: lo stesso nome può valere tutt'altro
// altrove, quindi non vanno accorpate in un dizionario comune. Il tipo su
// `T` fa pretendere al compilatore ogni lingua dichiarata: una voce a cui
// ne manca una non compila, invece di mostrare l'inglese all'utente
// sbagliato.
import type { Locale } from "@/i18n/config";

export type BetaCopy = {
  title: string;
  tagline: string;
  intro: string;
  whyH: string;
  whyP: string;
  whoH: string;
  whoLead: string;
  who1: string;
  who2: string;
  who3: string;
  whoNoTech: string;
  getH: string;
  get1: string;
  get2: string;
  get3: string;
  get4: string;
  askH: string;
  ask1: string;
  ask2: string;
  ask3: string;
  ask4: string;
  ask5: string;
  applyH: string;
  applyLead: string;
  aq1: string;
  aq2: string;
  aq3: string;
  aq4: string;
  aq5: string;
  aq6: string;
  applyCta: string;
  applyNote: string;
  expectH: string;
  expectLead: string;
  exp1: string;
  exp2: string;
  exp3: string;
  expectClose: string;
  githubMore: string;
};

export const T: Record<Locale, BetaCopy> = {
  en: {
    title: "Becoming a beta tester",
    tagline: "Run the team on your real job hunt — and tell us what breaks",
    intro:
      "Job Hunter Team is in active beta. We're looking for a small group of real job-seekers willing to run the team against their actual search and tell us what works and what doesn't.",
    whyH: "Why your test matters",
    whyP: "Most of what we can say about Job Hunter Team today comes from a handful of profiles. The question everyone asks is “does it work for my role, on my provider, at my budget?” — and you running it on your real job hunt is how we find out.",
    whoH: "Who we're looking for",
    whoLead: "You're a good fit if:",
    who1: "You're actively looking for a job (or about to start) — the team needs a real pipeline to work on.",
    who2: "You can afford at least one supported subscription. Kimi (~€40/mo) is the easiest entry point.",
    who3: "You're willing to report back honestly — what worked, what didn't, what was confusing.",
    whoNoTech:
      "No technical background required. One copy-pasted command in the terminal installs everything, and the team's Assistant walks you through anything you don't understand. A one-click desktop app is on its way. If you can follow on-screen steps, you can run it.",
    getH: "What you get",
    get1: "Direct support from the maintainer.",
    get2: "Early access to features before they ship.",
    get3: "Your results published as a case study on the site — anonymized if you prefer.",
    get4: "A real say in what gets built next.",
    askH: "What we ask in return",
    ask1: "Use it for your real job search for at least two weeks.",
    ask2: "Share your numbers at the end: offers analyzed, CVs sent, interviews.",
    ask3: "Report everything that confused, broke or surprised you.",
    ask4: "Be available for a 30-minute call at the end of the test.",
    ask5: "No cherry-picking — tell us about the failures too. They matter as much as the wins.",
    applyH: "How to apply",
    applyLead:
      "Open an issue on GitHub titled “Beta tester application — [your handle]” and answer:",
    aq1: "What role or industry are you searching in?",
    aq2: "Where are you based (country / remote)?",
    aq3: "Which subscription do you have or plan to get?",
    aq4: "How much time per week can you commit?",
    aq5: "Anything specific about your profile we should know? (feedback from outside tech is especially welcome)",
    aq6: "Anything else we should know?",
    applyCta: "Apply on GitHub",
    applyNote: "We reply within a few days.",
    expectH: "What to expect today",
    expectLead: "Before you sign up, set your expectations honestly:",
    exp1: "The team runs end to end — pipeline, dashboard, CLI and Telegram all work. The desktop app is on its way.",
    exp2: "The onboarding wizard still has rough edges — expect to ask for help once or twice.",
    exp3: "At first launch your operating system may warn about an “unverified app”. Job Hunter Team is open source — you can right-click → Open (macOS) or Run anyway (Windows), or build it from source.",
    expectClose:
      "If “rough edges” doesn't scare you, you're exactly the kind of beta tester we need.",
    githubMore: "the docs on GitHub",
  },
  it: {
    title: "Diventare beta tester",
    tagline:
      "Fai girare il team sulla tua ricerca di lavoro vera — e dicci cosa si rompe",
    intro:
      "Job Hunter Team è in beta attiva. Cerchiamo un piccolo gruppo di persone che stanno davvero cercando lavoro e sono disposte a far girare il team sulla loro ricerca reale e raccontarci cosa funziona e cosa no.",
    whyH: "Perché il tuo test conta",
    whyP: "Quasi tutto ciò che oggi possiamo dire su Job Hunter Team viene da una manciata di profili. La domanda che si fanno tutti è «funziona per il mio ruolo, sul mio provider, col mio budget?» — e sei tu, facendolo girare sulla tua ricerca vera, a darci la risposta.",
    whoH: "Chi cerchiamo",
    whoLead: "Fai al caso nostro se:",
    who1: "Stai cercando lavoro attivamente (o stai per iniziare) — al team serve una pipeline reale su cui lavorare.",
    who2: "Puoi permetterti almeno un abbonamento supportato. Kimi (~€40/mese) è il punto d'ingresso più semplice.",
    who3: "Sei disposto a darci un riscontro onesto — cosa ha funzionato, cosa no, cosa era poco chiaro.",
    whoNoTech:
      "Non serve alcuna competenza tecnica. Un comando copia-incollato nel terminale installa tutto, e l'Assistente del team ti guida in tutto ciò che non capisci. È in arrivo anche l'app desktop con installazione a un clic. Se sai seguire i passaggi a schermo, sai usarlo.",
    getH: "Cosa ottieni",
    get1: "Supporto diretto dal maintainer.",
    get2: "Accesso in anteprima alle nuove funzioni.",
    get3: "I tuoi risultati pubblicati come case study sul sito — anonimizzati se preferisci.",
    get4: "Voce in capitolo su cosa costruiamo dopo.",
    askH: "Cosa chiediamo in cambio",
    ask1: "Usalo per la tua ricerca di lavoro vera per almeno due settimane.",
    ask2: "Condividi i tuoi numeri alla fine: offerte analizzate, CV inviati, colloqui.",
    ask3: "Segnala tutto ciò che ti ha confuso, si è rotto o ti ha sorpreso.",
    ask4: "Sii disponibile per una chiamata di 30 minuti a fine test.",
    ask5: "Niente cherry-picking — raccontaci anche i fallimenti. Contano quanto i successi.",
    applyH: "Come candidarti",
    applyLead:
      "Apri una issue su GitHub con titolo «Beta tester application — [il tuo handle]» e rispondi a:",
    aq1: "In quale ruolo o settore stai cercando?",
    aq2: "Dove sei (Paese / remoto)?",
    aq3: "Quale abbonamento hai o pensi di prendere?",
    aq4: "Quanto tempo a settimana puoi dedicarci?",
    aq5: "Qualcosa di specifico sul tuo profilo che dovremmo sapere? (i riscontri da fuori dal mondo tech sono particolarmente graditi)",
    aq6: "Altro che dovremmo sapere?",
    applyCta: "Candidati su GitHub",
    applyNote: "Rispondiamo entro qualche giorno.",
    expectH: "Cosa aspettarti oggi",
    expectLead: "Prima di iscriverti, mettiamo le aspettative in chiaro:",
    exp1: "Il team funziona dall'inizio alla fine — pipeline, dashboard, CLI e Telegram funzionano tutti. L'app desktop è in arrivo.",
    exp2: "Il wizard di onboarding ha ancora qualche spigolo — mettiti in conto di chiedere aiuto una o due volte.",
    exp3: "Al primo avvio il tuo sistema operativo potrebbe avvisarti di un'«app non verificata». Job Hunter Team è open source — puoi fare clic destro → Apri (macOS) o Esegui comunque (Windows), oppure compilarlo dai sorgenti.",
    expectClose:
      "Se «qualche spigolo» non ti spaventa, sei esattamente il beta tester che ci serve.",
    githubMore: "i docs su GitHub",
  },
  es: {
    title: "Convertirse en beta tester",
    tagline:
      "Pon el equipo a trabajar en tu búsqueda de empleo real — y cuéntanos qué se rompe",
    intro:
      "Job Hunter Team está en beta activa. Buscamos un pequeño grupo de personas que estén buscando trabajo de verdad y estén dispuestas a poner el equipo a trabajar en su búsqueda real y contarnos qué funciona y qué no.",
    whyH: "Por qué tu prueba importa",
    whyP: "Casi todo lo que hoy podemos decir sobre Job Hunter Team viene de un puñado de perfiles. La pregunta que se hace todo el mundo es «¿funciona para mi puesto, con mi proveedor, con mi presupuesto?» — y eres tú, poniéndolo a trabajar en tu búsqueda real, quien nos da la respuesta.",
    whoH: "A quién buscamos",
    whoLead: "Encajas bien si:",
    who1: "Estás buscando trabajo activamente (o estás a punto de empezar) — el equipo necesita una pipeline real sobre la que trabajar.",
    who2: "Puedes permitirte al menos una suscripción compatible. Kimi (~€40/mes) es el punto de entrada más sencillo.",
    who3: "Estás dispuesto a darnos una opinión honesta — qué funcionó, qué no, qué resultaba confuso.",
    whoNoTech:
      "No hace falta ningún conocimiento técnico. Job Hunter Team funciona desde una app de escritorio: la instalación es un clic, y el Asistente del equipo te guía en todo lo que no entiendas. Si sabes instalar una app normal y seguir los pasos en pantalla, sabes usarlo.",
    getH: "Qué obtienes",
    get1: "Soporte directo del mantenedor.",
    get2: "Acceso anticipado a las nuevas funciones.",
    get3: "Tus resultados publicados como case study en el sitio — anonimizados si lo prefieres.",
    get4: "Voz y voto sobre qué construimos después.",
    askH: "Qué pedimos a cambio",
    ask1: "Úsalo en tu búsqueda de empleo real durante al menos dos semanas.",
    ask2: "Comparte tus números al final: ofertas analizadas, CV enviados, entrevistas.",
    ask3: "Avísanos de todo lo que te haya confundido, se haya roto o te haya sorprendido.",
    ask4: "Ten disponibilidad para una llamada de 30 minutos al final de la prueba.",
    ask5: "Nada de cherry-picking — cuéntanos también los fracasos. Importan tanto como los éxitos.",
    applyH: "Cómo apuntarte",
    applyLead:
      "Abre una issue en GitHub con el título «Beta tester application — [your handle]» (con tu nombre de usuario) y responde a:",
    aq1: "¿En qué puesto o sector estás buscando?",
    aq2: "¿Dónde estás (país / remoto)?",
    aq3: "¿Qué suscripción tienes o piensas contratar?",
    aq4: "¿Cuánto tiempo a la semana puedes dedicarle?",
    aq5: "¿Algo específico de tu perfil que deberíamos saber? (el feedback de fuera del mundo tech es especialmente bienvenido)",
    aq6: "¿Algo más que deberíamos saber?",
    applyCta: "Apúntate en GitHub",
    applyNote: "Respondemos en unos días.",
    expectH: "Qué esperar a día de hoy",
    expectLead: "Antes de apuntarte, dejemos claras las expectativas:",
    exp1: "El equipo funciona de principio a fin — pipeline, dashboard, CLI, Telegram y app de escritorio: todo funciona.",
    exp2: "El asistente de onboarding todavía tiene algunas asperezas — cuenta con que tendrás que pedir ayuda una o dos veces.",
    exp3: "En el primer arranque, tu sistema operativo puede avisarte de una «app no verificada». Job Hunter Team es open source — puedes hacer clic derecho → Abrir (macOS) o Ejecutar de todas formas (Windows), o bien compilarlo desde el código fuente.",
    expectClose:
      "Si «algunas asperezas» no te asustan, eres exactamente el beta tester que necesitamos.",
    githubMore: "los docs en GitHub",
  },
  fr: {
    title: "Devenir bêta testeur",
    tagline:
      "Faites tourner l’équipe sur votre vraie recherche d’emploi — et dites-nous ce qui casse",
    intro:
      "Job Hunter Team est en bêta active. Nous recherchons un petit groupe de personnes qui cherchent vraiment un emploi, prêtes à faire tourner l’équipe sur leur recherche réelle et à nous raconter ce qui fonctionne et ce qui ne fonctionne pas.",
    whyH: "Pourquoi votre test compte",
    whyP: "Presque tout ce que nous pouvons dire aujourd’hui sur Job Hunter Team vient d’une poignée de profils. La question que tout le monde se pose est « est-ce que ça fonctionne pour mon métier, chez mon fournisseur, avec mon budget ? » — et c’est vous, en le faisant tourner sur votre vraie recherche, qui nous donnez la réponse.",
    whoH: "Qui nous recherchons",
    whoLead: "Vous êtes la bonne personne si :",
    who1: "Vous cherchez activement un emploi (ou vous êtes sur le point de commencer) — l’équipe a besoin d’un vrai pipeline sur lequel travailler.",
    who2: "Vous pouvez vous permettre au moins l’un des abonnements pris en charge. Kimi (~40 €/mois) est le point d’entrée le plus simple.",
    who3: "Vous acceptez de nous faire un retour honnête — ce qui a fonctionné, ce qui n’a pas fonctionné, ce qui n’était pas clair.",
    whoNoTech:
      "Aucune compétence technique n’est requise. Job Hunter Team tourne depuis une application de bureau : l’installation se fait en un clic, et l’Assistant de l’équipe vous guide pour tout ce que vous ne comprenez pas. Si vous savez installer une application normale et suivre les étapes à l’écran, vous savez l’utiliser.",
    getH: "Ce que vous obtenez",
    get1: "Un support direct du mainteneur.",
    get2: "Un accès en avant-première aux nouvelles fonctionnalités.",
    get3: "Vos résultats publiés comme case study sur le site — anonymisés si vous préférez.",
    get4: "Une vraie voix au chapitre sur ce que nous construisons ensuite.",
    askH: "Ce que nous demandons en échange",
    ask1: "Utilisez-le pour votre vraie recherche d’emploi pendant au moins deux semaines.",
    ask2: "Partagez vos chiffres à la fin : offres analysées, CV envoyés, entretiens.",
    ask3: "Signalez tout ce qui vous a dérouté, s’est cassé ou vous a surpris.",
    ask4: "Soyez disponible pour un appel de 30 minutes à la fin du test.",
    ask5: "Pas de cherry-picking — racontez-nous aussi les échecs. Ils comptent autant que les réussites.",
    applyH: "Comment postuler",
    applyLead:
      "Ouvrez une issue sur GitHub intitulée « Beta tester application — [your handle] » et répondez à ces questions :",
    aq1: "Dans quel métier ou quel secteur cherchez-vous ?",
    aq2: "Où êtes-vous (pays / télétravail) ?",
    aq3: "Quel abonnement avez-vous ou prévoyez-vous de prendre ?",
    aq4: "Combien de temps par semaine pouvez-vous y consacrer ?",
    aq5: "Quelque chose de spécifique sur votre profil que nous devrions savoir ? (les retours hors du monde tech sont particulièrement bienvenus)",
    aq6: "Autre chose que nous devrions savoir ?",
    applyCta: "Postulez sur GitHub",
    applyNote: "Nous répondons sous quelques jours.",
    expectH: "À quoi vous attendre aujourd’hui",
    expectLead:
      "Avant de vous inscrire, soyons honnêtes sur ce qui vous attend :",
    exp1: "L’équipe fonctionne de bout en bout — pipeline, dashboard, CLI, Telegram et application de bureau, tout fonctionne.",
    exp2: "L’assistant d’installation a encore quelques aspérités — attendez-vous à devoir demander de l’aide une fois ou deux.",
    exp3: "Au premier lancement, votre système d’exploitation pourrait vous avertir d’une « app non vérifiée ». Job Hunter Team est open source — vous pouvez faire clic droit → Ouvrir (macOS) ou Exécuter quand même (Windows), ou encore le compiler depuis les sources.",
    expectClose:
      "Si « quelques aspérités » ne vous font pas peur, vous êtes exactement le bêta testeur qu’il nous faut.",
    githubMore: "les docs sur GitHub",
  },
  de: {
    title: "Beta-Tester werden",
    tagline:
      "Lass das Team auf deiner echten Jobsuche laufen — und sag uns, was kaputtgeht",
    intro:
      "Job Hunter Team ist in aktiver Beta. Wir suchen eine kleine Gruppe von Leuten, die wirklich auf Jobsuche sind und bereit sind, das Team auf ihrer echten Suche laufen zu lassen und uns zu erzählen, was funktioniert und was nicht.",
    whyH: "Warum dein Test zählt",
    whyP: "Fast alles, was wir heute über Job Hunter Team sagen können, stammt von einer Handvoll Profilen. Die Frage, die sich alle stellen, ist „funktioniert es für meine Rolle, bei meinem Anbieter, mit meinem Budget?“ — und du gibst uns die Antwort, indem du es auf deiner echten Jobsuche laufen lässt.",
    whoH: "Wen wir suchen",
    whoLead: "Du passt zu uns, wenn:",
    who1: "Du bist aktiv auf Jobsuche (oder stehst kurz davor) — das Team braucht eine echte Pipeline, an der es arbeiten kann.",
    who2: "Du kannst dir mindestens eines der unterstützten Abos leisten. Kimi (~€40/Monat) ist der einfachste Einstieg.",
    who3: "Du bist bereit, uns ehrlich Rückmeldung zu geben — was funktioniert hat, was nicht, was unklar war.",
    whoNoTech:
      "Technische Vorkenntnisse sind nicht nötig. Job Hunter Team läuft über eine Desktop-App: Die Installation ist ein Klick, und der Assistent des Teams führt dich durch alles, was du nicht verstehst. Wenn du eine normale App installieren und den Schritten auf dem Bildschirm folgen kannst, kannst du es bedienen.",
    getH: "Was du bekommst",
    get1: "Direkter Support vom Maintainer.",
    get2: "Früher Zugang zu neuen Funktionen.",
    get3: "Deine Ergebnisse werden als Fallstudie auf der Website veröffentlicht — auf Wunsch anonymisiert.",
    get4: "Mitspracherecht dabei, was wir als Nächstes bauen.",
    askH: "Worum wir dich im Gegenzug bitten",
    ask1: "Nutze es mindestens zwei Wochen lang für deine echte Jobsuche.",
    ask2: "Teile am Ende deine Zahlen: analysierte Stellen, verschickte Lebensläufe, Vorstellungsgespräche.",
    ask3: "Melde alles, was dich verwirrt hat, kaputtgegangen ist oder dich überrascht hat.",
    ask4: "Sei am Ende des Tests für ein 30-minütiges Gespräch verfügbar.",
    ask5: "Kein Cherry-Picking — erzähl uns auch von den Misserfolgen. Sie zählen genauso wie die Erfolge.",
    applyH: "So bewirbst du dich",
    applyLead:
      "Eröffne ein Issue auf GitHub mit dem Titel „Beta tester application — [dein Handle]“ und beantworte Folgendes:",
    aq1: "In welcher Rolle oder Branche suchst du?",
    aq2: "Wo bist du ansässig (Land / remote)?",
    aq3: "Welches Abo hast du oder willst du dir zulegen?",
    aq4: "Wie viel Zeit pro Woche kannst du dafür aufbringen?",
    aq5: "Gibt es etwas Bestimmtes an deinem Profil, das wir wissen sollten? (Feedback von außerhalb der Tech-Welt ist besonders willkommen)",
    aq6: "Sonst noch etwas, das wir wissen sollten?",
    applyCta: "Bewirb dich auf GitHub",
    applyNote: "Wir antworten innerhalb weniger Tage.",
    expectH: "Was dich heute erwartet",
    expectLead: "Bevor du dich anmeldest, stellen wir die Erwartungen klar:",
    exp1: "Das Team funktioniert von Anfang bis Ende — Pipeline, Dashboard, CLI, Telegram und Desktop-App laufen alle.",
    exp2: "Der Onboarding-Assistent hat noch ein paar Ecken und Kanten — stell dich darauf ein, ein- oder zweimal um Hilfe zu bitten.",
    exp3: "Beim ersten Start warnt dich dein Betriebssystem möglicherweise vor einer „nicht verifizierten App“. Job Hunter Team ist Open Source — du kannst Rechtsklick → Öffnen (macOS) oder Trotzdem ausführen (Windows) wählen, oder es aus dem Quellcode bauen.",
    expectClose:
      "Wenn dich „ein paar Ecken und Kanten“ nicht abschrecken, bist du genau der Beta-Tester, den wir brauchen.",
    githubMore: "die Docs auf GitHub",
  },
  pt: {
    title: "Tornar-se beta tester",
    tagline:
      "Põe a equipa a correr na tua procura de emprego real — e diz-nos o que se parte",
    intro:
      "O Job Hunter Team está em beta ativa. Procuramos um pequeno grupo de pessoas que estão mesmo à procura de emprego e dispostas a pôr a equipa a correr na sua procura real e a contar-nos o que funciona e o que não.",
    whyH: "Porque é que o teu teste conta",
    whyP: "Quase tudo o que hoje podemos dizer sobre o Job Hunter Team vem de um punhado de perfis. A pergunta que toda a gente faz é «funciona para a minha função, no meu fornecedor, com o meu orçamento?» — e és tu, ao pô-lo a correr na tua procura real, que nos dás a resposta.",
    whoH: "Quem procuramos",
    whoLead: "És a pessoa certa se:",
    who1: "Estás ativamente à procura de emprego (ou prestes a começar) — a equipa precisa de um pipeline real para trabalhar.",
    who2: "Podes pagar pelo menos uma subscrição suportada. O Kimi (~€40/mês) é o ponto de entrada mais simples.",
    who3: "Estás disposto a dar-nos um feedback honesto — o que funcionou, o que não, o que era pouco claro.",
    whoNoTech:
      "Não é precisa nenhuma competência técnica. O Job Hunter Team corre a partir de uma app de ambiente de trabalho: a instalação é um clique, e o Assistente da equipa guia-te em tudo o que não perceberes. Se sabes instalar uma app normal e seguir os passos no ecrã, sabes usá-lo.",
    getH: "O que recebes",
    get1: "Suporte direto do maintainer.",
    get2: "Acesso antecipado às novas funcionalidades.",
    get3: "Os teus resultados publicados como case study no site — anonimizados, se preferires.",
    get4: "Uma palavra a dizer sobre o que construímos a seguir.",
    askH: "O que pedimos em troca",
    ask1: "Usa-o na tua procura de emprego real durante pelo menos duas semanas.",
    ask2: "Partilha os teus números no fim: ofertas analisadas, CV enviados, entrevistas.",
    ask3: "Reporta tudo o que te confundiu, se partiu ou te surpreendeu.",
    ask4: "Fica disponível para uma chamada de 30 minutos no fim do teste.",
    ask5: "Nada de cherry-picking — conta-nos também os falhanços. Contam tanto como os sucessos.",
    applyH: "Como te candidatares",
    applyLead:
      "Abre uma issue no GitHub com o título «Beta tester application — [o teu handle]» e responde a:",
    aq1: "Em que função ou setor estás à procura?",
    aq2: "Onde estás (país / remoto)?",
    aq3: "Que subscrição tens ou tencionas ter?",
    aq4: "Quanto tempo por semana lhe podes dedicar?",
    aq5: "Algo específico sobre o teu perfil que devamos saber? (o feedback de fora do mundo tech é especialmente bem-vindo)",
    aq6: "Mais alguma coisa que devamos saber?",
    applyCta: "Candidata-te no GitHub",
    applyNote: "Respondemos dentro de poucos dias.",
    expectH: "O que esperar hoje",
    expectLead: "Antes de te inscreveres, vamos deixar as expectativas claras:",
    exp1: "A equipa funciona de ponta a ponta — pipeline, dashboard, CLI, Telegram e a app de ambiente de trabalho funcionam todos.",
    exp2: "O assistente de configuração inicial ainda tem algumas arestas — prepara-te para pedir ajuda uma ou duas vezes.",
    exp3: "No primeiro arranque, o teu sistema operativo pode avisar-te de uma «app não verificada». O Job Hunter Team é open source — podes fazer clique direito → Abrir (macOS) ou Executar mesmo assim (Windows), ou compilá-lo a partir do código-fonte.",
    expectClose:
      "Se «algumas arestas» não te assustam, és exatamente o beta tester de que precisamos.",
    githubMore: "os docs no GitHub",
  },
  hu: {
    title: "Béta tesztelővé válás",
    tagline:
      "Futtasd a csapatot a valódi álláskeresésedre — és mondd el, mi romlik el",
    intro:
      "A Job Hunter Team aktív bétában van. Olyan emberek kis csoportját keressük, akik épp tényleg állást keresnek, és hajlandók a csapatot a valódi keresésükre futtatni, majd elmondani, mi működik és mi nem.",
    whyH: "Miért számít a teszted",
    whyP: "Szinte minden, amit ma a Job Hunter Teamről mondani tudunk, egy maroknyi profilból származik. A kérdés, amit mindenki feltesz: „működik ez az én munkakörömben, az én szolgáltatómmal, az én büdzsémből?” — és a választ te adod meg nekünk azzal, hogy a valódi álláskeresésedre futtatod.",
    whoH: "Kit keresünk",
    whoLead: "Téged keresünk, ha:",
    who1: "Aktívan keresel állást (vagy hamarosan elkezded) — a csapatnak valódi pipeline-ra van szüksége, amin dolgozhat.",
    who2: "Meg tudsz engedni magadnak legalább egy támogatott előfizetést. A Kimi (~40 €/hó) a legegyszerűbb belépési pont.",
    who3: "Hajlandó vagy őszinte visszajelzést adni — mi működött, mi nem, mi volt zavaros.",
    whoNoTech:
      "Semmiféle technikai tudás nem kell. A Job Hunter Team egy asztali alkalmazásból fut: a telepítés egyetlen kattintás, és a csapat Asszisztense végigvezet mindenen, amit nem értesz. Ha fel tudsz telepíteni egy átlagos alkalmazást, és követni tudod a képernyőn megjelenő lépéseket, akkor ezt is tudod használni.",
    getH: "Mit kapsz",
    get1: "Közvetlen támogatás a projekt karbantartójától.",
    get2: "Korai hozzáférés az új funkciókhoz.",
    get3: "Az eredményeid esettanulmányként közzétéve az oldalon — anonimizálva, ha úgy szeretnéd.",
    get4: "Valódi beleszólás abba, hogy mit építünk legközelebb.",
    askH: "Mit kérünk cserébe",
    ask1: "Használd a valódi álláskeresésedre legalább két héten át.",
    ask2: "A végén oszd meg velünk a számaidat: elemzett álláshirdetések, elküldött önéletrajzok, interjúk.",
    ask3: "Jelezz mindent, ami összezavart, elromlott vagy meglepett.",
    ask4: "A teszt végén legyél elérhető egy 30 perces hívásra.",
    ask5: "Semmi mazsolázgatás — meséld el nekünk a kudarcokat is. Ugyanannyit számítanak, mint a sikerek.",
    applyH: "Hogyan jelentkezz",
    applyLead:
      "Nyiss egy issue-t a GitHubon „Beta tester application — [your handle]” címmel, és válaszolj az alábbi kérdésekre:",
    aq1: "Milyen munkakörben vagy iparágban keresel?",
    aq2: "Hol élsz (ország / remote)?",
    aq3: "Melyik előfizetésed van meg, vagy melyiket tervezed beszerezni?",
    aq4: "Hetente mennyi időt tudsz rászánni?",
    aq5: "Van valami sajátosság a profilodban, amiről tudnunk kellene? (a tech világon kívülről érkező visszajelzéseknek különösen örülünk)",
    aq6: "Bármi más, amit tudnunk kellene?",
    applyCta: "Jelentkezz a GitHubon",
    applyNote: "Néhány napon belül válaszolunk.",
    expectH: "Mire számíts ma",
    expectLead: "Mielőtt jelentkezel, tisztázzuk az elvárásokat:",
    exp1: "A csapat elejétől a végéig működik — a pipeline, a dashboard, a CLI, a Telegram és az asztali app mind működik.",
    exp2: "A beállítási varázslónak még vannak érdes pontjai — számíts rá, hogy egyszer-kétszer segítséget kell majd kérned.",
    exp3: "Az első indításkor az operációs rendszered „nem ellenőrzött alkalmazás” figyelmeztetést dobhat. A Job Hunter Team open source — használhatod a jobb klikk → Megnyitás (macOS) vagy a Futtatás mindenképp (Windows) lehetőséget, vagy lefordíthatod forrásból.",
    expectClose:
      "Ha az „érdes pontok” nem riasztanak el, pontosan az a béta tesztelő vagy, akire szükségünk van.",
    githubMore: "a dokumentáció a GitHubon",
  },
};
