"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

const GITHUB = "https://github.com/leopu00/job-hunter-team";

// Indice (0-based) del capitolo dopo cui mostrare l'immagine (≈ metà pagina).
const IMAGE_AFTER = 1;

type Chapter = { h: string; p: string[]; note?: string };
type Copy = {
  title: string;
  subtitle: string;
  badge: string;
  imageAlt: string;
  imageCaption: string;
  back: string;
  chapters: Chapter[];
  ctaKicker: string;
  tryTitle: string;
  tryBody: string;
  tryCta: string;
  devTitle: string;
  devBody: string;
  devCta: string;
};

// Testi completi in tutte e 7 le lingue (it, en, es, fr, de, pt, hu).
const it: Copy = {
  title: "Il progetto",
  subtitle:
    "Una squadra di agenti AI autonomi che cerca lavoro per te e ti aiuta a orientarti tra le offerte.",
  badge: "open source",
  imageAlt:
    "Illustrazione: un cubo di vetro che racchiude un ufficio in miniatura con il team di agenti al lavoro, osservato da fuori da due persone che prendono appunti.",
  imageCaption:
    "Dietro al vetro, il team di agenti al lavoro. Fuori, i maintainer del progetto: ne osservano il comportamento e ne affinano il codice.",
  back: "← Indietro",
  chapters: [
    {
      h: "Cosa fa",
      p: [
        "Job Hunter Team è una squadra di agenti AI autonomi che cerca lavoro per te. Autonomi significa che lavorano da soli: una volta che indichi la rotta, continuano a cercare, analizzare e preparare senza sosta — non devi guidare ogni passaggio. Anziché inviare candidature a tappeto, individua le offerte più affini al tuo profilo, le valuta una per una e ti indica dove conviene concentrarti e quali aspetti rafforzare.",
        "Poche candidature, ma mirate. La decisione finale — quando e a chi inviare — resta sempre tua.",
      ],
    },
    {
      h: "Da dove nasce",
      p: [
        "Il progetto nasce da un'esigenza concreta: cercare lavoro in un mercato in cui la maggior parte delle candidature resta senza risposta. Sviluppato inizialmente da un singolo sviluppatore per uso personale, nell'arco di due settimane ha individuato e analizzato circa 200 offerte, ne ha preparate una ventina su misura e ha portato a cinque colloqui.",
        "I risultati sono bastati a giustificarne l'apertura: da strumento privato è diventato un progetto pubblico e open source, pensato per chiunque affronti la stessa ricerca.",
      ],
    },
    {
      h: "Un mondo del lavoro che cambia",
      p: [
        "Il mondo del lavoro sta cambiando rapidamente e trovare un'occupazione è sempre più difficile. Molte persone si troveranno a ridefinire il proprio ruolo e ad adattarsi a un mercato in costante evoluzione.",
        "Una piattaforma che si adatta al mercato reale risponde proprio a questa esigenza: avvicina le persone a ciò che cercano e contribuisce a distribuire le opportunità in modo più equo, anziché favorire soltanto chi riesce a farsi notare di più.",
      ],
    },
    {
      h: "Il nodo del costo",
      p: [
        "L'ostacolo principale è il costo dell'AI. Con la tariffazione a consumo, una squadra di agenti che lavora in parallelo può arrivare a spendere centinaia di euro al giorno: una soglia inaccessibile per la maggior parte delle persone.",
        "La sfida tecnica più impegnativa è stata far funzionare il team su un abbonamento mensile a costo fisso, dove a parità di spesa si dispone di circa dieci volte i token della tariffazione a consumo. Il sistema monitora autonomamente il proprio budget e distribuisce il lavoro nell'arco della giornata, mantenendo un ritmo sostenibile anziché esaurire la quota in poche ore.",
      ],
      note: "Gli abbonamenti AI sono pensati per lo sviluppo e l'uso diretto delle persone, non per un'attività autonoma su larga scala: è l'equilibrio delicato che tiene il progetto a un costo sostenibile. Per questo è importante un uso misurato e responsabile, che resta a discrezione dell'utente.",
    },
    {
      h: "Un progetto aperto",
      p: [
        "È per questo che il progetto è open source. Agli sviluppatori chiediamo di contribuire: ogni miglioramento rende l'AI uno strumento più utile a chi cerca lavoro e concorre a un mercato più aperto e trasparente.",
        "A chi cerca lavoro chiediamo di provarlo e di condividere un riscontro: è dai casi reali che la piattaforma apprende e migliora.",
      ],
    },
  ],
  ctaKicker: "Partecipa",
  tryTitle: "Provalo e lascia un riscontro",
  tryBody:
    "Scaricalo, eseguilo in locale sul tuo computer e condividi la tua esperienza: ogni caso reale contribuisce a migliorarlo. I tuoi dati restano sempre tuoi.",
  tryCta: "Scarica →",
  devTitle: "Contribuisci",
  devBody:
    "Il progetto è aperto: architettura, agenti e dettagli tecnici sono documentati nella repository. Pull request e proposte sono benvenute.",
  devCta: "Vai alla repository →",
};

const en: Copy = {
  title: "The project",
  subtitle:
    "A team of autonomous AI agents that searches for work on your behalf and helps you navigate the market.",
  badge: "open source",
  imageAlt:
    "Illustration: a glass cube holding a miniature office with the team of agents at work, watched from outside by two people taking notes.",
  imageCaption:
    "Behind the glass, the agent team at work. Outside, the project's maintainers: they observe its behavior and refine the code.",
  back: "← Back",
  chapters: [
    {
      h: "What it does",
      p: [
        "Job Hunter Team is a team of autonomous AI agents that searches for work on your behalf. Autonomous means they work on their own: once you set the direction, they keep searching, analyzing and preparing around the clock — you don't have to drive each step. Rather than submitting applications indiscriminately, it identifies the openings best suited to your profile, evaluates each one, and shows you where to focus and what to strengthen.",
        "Fewer applications, but targeted ones. The final decision — when and where to apply — always remains yours.",
      ],
    },
    {
      h: "Where it comes from",
      p: [
        "The project grew out of a concrete need: searching for work in a market where most applications go unanswered. Initially developed by a single developer for personal use, within two weeks it had identified and analyzed around 200 openings, prepared roughly twenty tailored applications, and led to five interviews.",
        "The results were enough to justify opening it up: from a private tool it became a public, open-source project, intended for anyone facing the same search.",
      ],
    },
    {
      h: "A changing world of work",
      p: [
        "The world of work is changing rapidly, and finding a job is becoming increasingly difficult. Many people will need to redefine their role and adapt to a market in constant flux.",
        "A platform that adapts to the real market addresses precisely this need: it brings people closer to what they are looking for and helps distribute opportunity more fairly, rather than favoring only those who manage to stand out the most.",
      ],
    },
    {
      h: "The cost question",
      p: [
        "The principal obstacle is the cost of AI. Under pay-per-use pricing, a team of agents working in parallel can spend hundreds of euros a day — a threshold beyond the reach of most people.",
        "The most demanding technical challenge was running the team on a fixed-price monthly subscription, where the same budget provides roughly ten times the tokens of pay-per-use. The system monitors its own budget and distributes its work across the day, keeping a sustainable pace rather than exhausting the quota within a few hours.",
      ],
      note: "AI subscriptions are designed for development and for people's direct use, not for autonomous, large-scale activity: it is the delicate balance that keeps the project affordable. This makes measured, responsible use important — and that remains up to the user.",
    },
    {
      h: "An open project",
      p: [
        "This is why the project is open source. We invite developers to contribute: every improvement makes AI a more useful tool for those seeking work and contributes to a more open, transparent market.",
        "We invite job seekers to try it and share their feedback: it is from real cases that the platform learns and improves.",
      ],
    },
  ],
  ctaKicker: "Get involved",
  tryTitle: "Try it and share feedback",
  tryBody:
    "Download it, run it locally on your own machine, and share your experience: every real case helps improve it. Your data always stays yours.",
  tryCta: "Download →",
  devTitle: "Contribute",
  devBody:
    "The project is open: its architecture, agents, and technical details are documented in the repository. Pull requests and ideas are welcome.",
  devCta: "Go to the repository →",
};

const es: Copy = {
  title: "El proyecto",
  subtitle:
    "Un equipo de agentes de IA autónomos que busca trabajo por ti y te ayuda a orientarte entre las ofertas.",
  badge: "open source",
  imageAlt:
    "Ilustración: un cubo de cristal que encierra una oficina en miniatura con el equipo de agentes trabajando, observado desde fuera por dos personas que toman notas.",
  imageCaption:
    "Tras el cristal, el equipo de agentes trabajando. Fuera, los maintainers del proyecto: observan su comportamiento y afinan el código.",
  back: "← Atrás",
  chapters: [
    {
      h: "Qué hace",
      p: [
        "Job Hunter Team es un equipo de agentes de IA autónomos que busca trabajo por ti. Autónomos significa que trabajan solos: una vez que marcas el rumbo, siguen buscando, analizando y preparando sin descanso — no tienes que guiar cada paso. En lugar de enviar candidaturas a diestro y siniestro, identifica las ofertas más afines a tu perfil, las evalúa una por una y te indica dónde conviene concentrarte y qué aspectos reforzar.",
        "Pocas candidaturas, pero certeras. La decisión final — cuándo y a quién enviar — sigue siendo siempre tuya.",
      ],
    },
    {
      h: "De dónde nace",
      p: [
        "El proyecto nace de una necesidad concreta: buscar trabajo en un mercado en el que la mayoría de las candidaturas se queda sin respuesta. Desarrollado inicialmente por un solo desarrollador para uso personal, en el plazo de dos semanas identificó y analizó alrededor de 200 ofertas, preparó una veintena a medida y llevó a cinco entrevistas.",
        "Los resultados bastaron para justificar su apertura: de herramienta privada se convirtió en un proyecto público y open source, pensado para cualquiera que afronte la misma búsqueda.",
      ],
    },
    {
      h: "Un mundo del trabajo que cambia",
      p: [
        "El mundo del trabajo está cambiando con rapidez y encontrar empleo es cada vez más difícil. Muchas personas tendrán que redefinir su rol y adaptarse a un mercado en constante evolución.",
        "Una plataforma que se adapta al mercado real responde precisamente a esta necesidad: acerca a las personas a lo que buscan y contribuye a distribuir las oportunidades de forma más justa, en lugar de favorecer solo a quien consigue hacerse notar más.",
      ],
    },
    {
      h: "El nudo del coste",
      p: [
        "El obstáculo principal es el coste de la IA. Con la tarificación por consumo, un equipo de agentes que trabaja en paralelo puede llegar a gastar cientos de euros al día: un umbral inaccesible para la mayoría de las personas.",
        "El reto técnico más exigente fue hacer funcionar el equipo con una suscripción mensual de coste fijo, donde a igual gasto se dispone de unas diez veces los tokens de la tarificación por consumo. El sistema supervisa de forma autónoma su propio presupuesto y distribuye el trabajo a lo largo del día, manteniendo un ritmo sostenible en lugar de agotar la cuota en pocas horas.",
      ],
      note: "Las suscripciones de IA están pensadas para el desarrollo y el uso directo de las personas, no para una actividad autónoma a gran escala: es el equilibrio delicado que mantiene el proyecto a un coste sostenible. Por eso es importante un uso mesurado y responsable, que queda a discreción del usuario.",
    },
    {
      h: "Un proyecto abierto",
      p: [
        "Por eso el proyecto es open source. A los desarrolladores les pedimos que contribuyan: cada mejora hace de la IA una herramienta más útil para quien busca trabajo y favorece un mercado más abierto y transparente.",
        "A quien busca trabajo le pedimos que lo pruebe y comparta su opinión: es de los casos reales de donde la plataforma aprende y mejora.",
      ],
    },
  ],
  ctaKicker: "Participa",
  tryTitle: "Pruébalo y deja tu opinión",
  tryBody:
    "Descárgalo, ejecútalo en local en tu ordenador y comparte tu experiencia: cada caso real contribuye a mejorarlo. Tus datos siguen siendo siempre tuyos.",
  tryCta: "Descargar →",
  devTitle: "Contribuye",
  devBody:
    "El proyecto es abierto: arquitectura, agentes y detalles técnicos están documentados en el repositorio. Las pull requests y las propuestas son bienvenidas.",
  devCta: "Ir al repositorio →",
};

const fr: Copy = {
  title: "Le projet",
  subtitle:
    "Une équipe d'agents IA autonomes qui cherche du travail pour toi et t'aide à t'orienter parmi les offres.",
  badge: "open source",
  imageAlt:
    "Illustration : un cube de verre renfermant un bureau miniature avec l'équipe d'agents au travail, observé de l'extérieur par deux personnes qui prennent des notes.",
  imageCaption:
    "Derrière le verre, l'équipe d'agents au travail. Dehors, les mainteneurs du projet : ils observent son comportement et affinent le code.",
  back: "← Retour",
  chapters: [
    {
      h: "Ce qu'il fait",
      p: [
        "Job Hunter Team est une équipe d'agents IA autonomes qui cherche du travail pour toi. Autonomes signifie qu'ils travaillent seuls : une fois que tu indiques le cap, ils continuent à chercher, analyser et préparer sans relâche — tu n'as pas à guider chaque étape. Plutôt que d'envoyer des candidatures à tout-va, il repère les offres les plus proches de ton profil, les évalue une par une et t'indique où il vaut la peine de te concentrer et quels aspects renforcer.",
        "Peu de candidatures, mais ciblées. La décision finale — quand et à qui envoyer — reste toujours la tienne.",
      ],
    },
    {
      h: "D'où il vient",
      p: [
        "Le projet est né d'un besoin concret : chercher du travail dans un marché où la plupart des candidatures restent sans réponse. Développé d'abord par un seul développeur pour un usage personnel, en l'espace de deux semaines il a repéré et analysé environ 200 offres, en a préparé une vingtaine sur mesure et a mené à cinq entretiens.",
        "Les résultats ont suffi à en justifier l'ouverture : d'outil privé, il est devenu un projet public et open source, pensé pour quiconque affronte la même recherche.",
      ],
    },
    {
      h: "Un monde du travail qui change",
      p: [
        "Le monde du travail change rapidement et trouver un emploi devient de plus en plus difficile. Beaucoup de personnes devront redéfinir leur rôle et s'adapter à un marché en évolution constante.",
        "Une plateforme qui s'adapte au marché réel répond précisément à ce besoin : elle rapproche les personnes de ce qu'elles cherchent et contribue à répartir les opportunités de façon plus équitable, plutôt que de favoriser seulement ceux qui parviennent à se faire le plus remarquer.",
      ],
    },
    {
      h: "Le nœud du coût",
      p: [
        "Le principal obstacle est le coût de l'IA. Avec la tarification à l'usage, une équipe d'agents travaillant en parallèle peut en arriver à dépenser des centaines d'euros par jour : un seuil inaccessible pour la plupart des gens.",
        "Le défi technique le plus exigeant a été de faire fonctionner l'équipe sur un abonnement mensuel à coût fixe, où à dépense égale on dispose d'environ dix fois les tokens de la tarification à l'usage. Le système surveille lui-même son budget et répartit le travail sur la journée, en maintenant un rythme soutenable plutôt que d'épuiser le quota en quelques heures.",
      ],
      note: "Les abonnements IA sont pensés pour le développement et l'usage direct des personnes, non pour une activité autonome à grande échelle : c'est l'équilibre délicat qui maintient le projet à un coût soutenable. C'est pourquoi un usage mesuré et responsable est important — et cela reste à la discrétion de l'utilisateur.",
    },
    {
      h: "Un projet ouvert",
      p: [
        "C'est pourquoi le projet est open source. Aux développeurs, nous demandons de contribuer : chaque amélioration fait de l'IA un outil plus utile à ceux qui cherchent du travail et concourt à un marché plus ouvert et transparent.",
        "À ceux qui cherchent du travail, nous demandons de l'essayer et de partager un retour : c'est des cas réels que la plateforme apprend et s'améliore.",
      ],
    },
  ],
  ctaKicker: "Participe",
  tryTitle: "Essaie-le et laisse un retour",
  tryBody:
    "Télécharge-le, exécute-le en local sur ton ordinateur et partage ton expérience : chaque cas réel contribue à l'améliorer. Tes données restent toujours les tiennes.",
  tryCta: "Télécharger →",
  devTitle: "Contribue",
  devBody:
    "Le projet est ouvert : architecture, agents et détails techniques sont documentés dans le dépôt. Les pull requests et les propositions sont les bienvenues.",
  devCta: "Aller au dépôt →",
};

const de: Copy = {
  title: "Das Projekt",
  subtitle:
    "Ein Team aus autonomen KI-Agenten, das für dich nach Arbeit sucht und dir hilft, dich zwischen den Angeboten zurechtzufinden.",
  badge: "open source",
  imageAlt:
    "Illustration: ein Glaswürfel, der ein Miniaturbüro mit dem arbeitenden Agententeam umschließt, von außen beobachtet von zwei Personen, die sich Notizen machen.",
  imageCaption:
    "Hinter dem Glas das arbeitende Agententeam. Draußen die Maintainer des Projekts: Sie beobachten sein Verhalten und verfeinern den Code.",
  back: "← Zurück",
  chapters: [
    {
      h: "Was es macht",
      p: [
        "Job Hunter Team ist ein Team aus autonomen KI-Agenten, das für dich nach Arbeit sucht. Autonom bedeutet, dass sie eigenständig arbeiten: Sobald du die Richtung vorgibst, suchen, analysieren und bereiten sie unablässig weiter — du musst nicht jeden Schritt lenken. Statt wahllos Bewerbungen zu verschicken, findet es die Stellen, die am besten zu deinem Profil passen, bewertet jede einzeln und zeigt dir, worauf du dich konzentrieren und welche Aspekte du stärken solltest.",
        "Wenige Bewerbungen, dafür gezielte. Die endgültige Entscheidung — wann und an wen du sendest — bleibt immer deine.",
      ],
    },
    {
      h: "Woher es kommt",
      p: [
        "Das Projekt entstand aus einem konkreten Bedürfnis: Arbeit zu suchen in einem Markt, in dem die meisten Bewerbungen unbeantwortet bleiben. Zunächst von einem einzelnen Entwickler für den eigenen Gebrauch entwickelt, hatte es innerhalb von zwei Wochen rund 200 Stellen gefunden und analysiert, etwa zwanzig maßgeschneiderte Bewerbungen vorbereitet und zu fünf Vorstellungsgesprächen geführt.",
        "Die Ergebnisse genügten, um die Öffnung zu rechtfertigen: Aus einem privaten Werkzeug wurde ein öffentliches Open-Source-Projekt, gedacht für alle, die vor derselben Suche stehen.",
      ],
    },
    {
      h: "Eine sich wandelnde Arbeitswelt",
      p: [
        "Die Arbeitswelt verändert sich rasch, und einen Job zu finden wird immer schwieriger. Viele Menschen werden ihre Rolle neu definieren und sich an einen Markt im ständigen Wandel anpassen müssen.",
        "Eine Plattform, die sich dem realen Markt anpasst, antwortet genau auf dieses Bedürfnis: Sie bringt Menschen näher an das, was sie suchen, und trägt dazu bei, Chancen gerechter zu verteilen, statt nur jene zu begünstigen, die es schaffen, am meisten aufzufallen.",
      ],
    },
    {
      h: "Der Knoten der Kosten",
      p: [
        "Das größte Hindernis sind die Kosten der KI. Bei nutzungsbasierter Abrechnung kann ein Team von Agenten, das parallel arbeitet, Hunderte Euro am Tag ausgeben: eine Schwelle, die für die meisten Menschen unerreichbar ist.",
        "Die anspruchsvollste technische Herausforderung war es, das Team mit einem monatlichen Abonnement zu festem Preis zu betreiben, bei dem man für denselben Betrag etwa zehnmal so viele Tokens erhält wie bei nutzungsbasierter Abrechnung. Das System überwacht eigenständig sein Budget und verteilt die Arbeit über den Tag, hält ein nachhaltiges Tempo, statt das Kontingent in wenigen Stunden zu erschöpfen.",
      ],
      note: "KI-Abonnements sind für die Entwicklung und den direkten Gebrauch durch Menschen gedacht, nicht für eine autonome Aktivität im großen Maßstab: Es ist das heikle Gleichgewicht, das das Projekt bezahlbar hält. Deshalb ist ein maßvoller, verantwortungsvoller Gebrauch wichtig — und der bleibt dem Nutzer überlassen.",
    },
    {
      h: "Ein offenes Projekt",
      p: [
        "Deshalb ist das Projekt open source. Die Entwickler bitten wir, beizutragen: Jede Verbesserung macht die KI zu einem nützlicheren Werkzeug für alle, die Arbeit suchen, und trägt zu einem offeneren, transparenteren Markt bei.",
        "Diejenigen, die Arbeit suchen, bitten wir, es auszuprobieren und Rückmeldung zu geben: Aus realen Fällen lernt und verbessert sich die Plattform.",
      ],
    },
  ],
  ctaKicker: "Mach mit",
  tryTitle: "Probiere es aus und gib Rückmeldung",
  tryBody:
    "Lade es herunter, führe es lokal auf deinem Rechner aus und teile deine Erfahrung: Jeder reale Fall hilft, es zu verbessern. Deine Daten bleiben immer deine.",
  tryCta: "Herunterladen →",
  devTitle: "Trag bei",
  devBody:
    "Das Projekt ist offen: Architektur, Agenten und technische Details sind im Repository dokumentiert. Pull Requests und Vorschläge sind willkommen.",
  devCta: "Zum Repository →",
};

const pt: Copy = {
  title: "O projeto",
  subtitle:
    "Uma equipe de agentes de IA autónomos que procura trabalho por você e ajuda a se orientar entre as ofertas.",
  badge: "open source",
  imageAlt:
    "Ilustração: um cubo de vidro que encerra um escritório em miniatura com a equipe de agentes trabalhando, observado de fora por duas pessoas que tomam notas.",
  imageCaption:
    "Atrás do vidro, a equipe de agentes trabalhando. Fora, os mantenedores do projeto: observam o seu comportamento e refinam o código.",
  back: "← Voltar",
  chapters: [
    {
      h: "O que faz",
      p: [
        "Job Hunter Team é uma equipe de agentes de IA autónomos que procura trabalho por você. Autónomos significa que trabalham sozinhos: uma vez que você indica o rumo, continuam a procurar, analisar e preparar sem parar — você não precisa guiar cada passo. Em vez de enviar candidaturas em massa, identifica as ofertas mais afins ao seu perfil, avalia-as uma a uma e indica onde vale a pena se concentrar e quais aspectos reforçar.",
        "Poucas candidaturas, mas certeiras. A decisão final — quando e para quem enviar — continua sendo sempre sua.",
      ],
    },
    {
      h: "De onde nasce",
      p: [
        "O projeto nasce de uma necessidade concreta: procurar trabalho em um mercado em que a maioria das candidaturas fica sem resposta. Desenvolvido inicialmente por um único desenvolvedor para uso pessoal, no prazo de duas semanas identificou e analisou cerca de 200 ofertas, preparou umas vinte sob medida e levou a cinco entrevistas.",
        "Os resultados bastaram para justificar a sua abertura: de ferramenta privada tornou-se um projeto público e open source, pensado para quem quer que enfrente a mesma busca.",
      ],
    },
    {
      h: "Um mundo do trabalho que muda",
      p: [
        "O mundo do trabalho está mudando rapidamente e encontrar emprego é cada vez mais difícil. Muitas pessoas terão de redefinir o seu papel e se adaptar a um mercado em constante evolução.",
        "Uma plataforma que se adapta ao mercado real responde justamente a essa necessidade: aproxima as pessoas daquilo que procuram e contribui para distribuir as oportunidades de forma mais justa, em vez de favorecer apenas quem consegue se destacar mais.",
      ],
    },
    {
      h: "O nó do custo",
      p: [
        "O obstáculo principal é o custo da IA. Com a tarifação por consumo, uma equipe de agentes que trabalha em paralelo pode chegar a gastar centenas de euros por dia: um limite inacessível para a maioria das pessoas.",
        "O desafio técnico mais exigente foi fazer a equipe funcionar com uma assinatura mensal de custo fixo, na qual, com o mesmo gasto, dispõe-se de cerca de dez vezes os tokens da tarifação por consumo. O sistema monitora de forma autônoma o seu próprio orçamento e distribui o trabalho ao longo do dia, mantendo um ritmo sustentável em vez de esgotar a cota em poucas horas.",
      ],
      note: "As assinaturas de IA são pensadas para o desenvolvimento e o uso direto das pessoas, não para uma atividade autônoma em larga escala: é o equilíbrio delicado que mantém o projeto a um custo sustentável. Por isso é importante um uso comedido e responsável, que fica a critério do usuário.",
    },
    {
      h: "Um projeto aberto",
      p: [
        "É por isso que o projeto é open source. Aos desenvolvedores pedimos que contribuam: cada melhoria torna a IA uma ferramenta mais útil para quem procura trabalho e concorre para um mercado mais aberto e transparente.",
        "A quem procura trabalho pedimos que o experimente e compartilhe um retorno: é dos casos reais que a plataforma aprende e melhora.",
      ],
    },
  ],
  ctaKicker: "Participe",
  tryTitle: "Experimente e deixe um retorno",
  tryBody:
    "Baixe-o, execute-o localmente no seu computador e compartilhe a sua experiência: cada caso real contribui para melhorá-lo. Os seus dados continuam sempre sendo seus.",
  tryCta: "Baixar →",
  devTitle: "Contribua",
  devBody:
    "O projeto é aberto: arquitetura, agentes e detalhes técnicos estão documentados no repositório. Pull requests e propostas são bem-vindas.",
  devCta: "Ir ao repositório →",
};

const hu: Copy = {
  title: "A projekt",
  subtitle:
    "Autonóm MI-ügynökök csapata, amely munkát keres helyetted, és segít eligazodni az ajánlatok között.",
  badge: "open source",
  imageAlt:
    "Illusztráció: egy üvegkocka, amely egy miniatűr irodát zár magába a dolgozó ügynökcsapattal, kívülről két jegyzetelő ember figyeli.",
  imageCaption:
    "Az üveg mögött a dolgozó ügynökcsapat. Kívül a projekt karbantartói: figyelik a viselkedését, és finomítják a kódot.",
  back: "← Vissza",
  chapters: [
    {
      h: "Mit csinál",
      p: [
        "A Job Hunter Team autonóm MI-ügynökök csapata, amely munkát keres helyetted. Az autonóm azt jelenti, hogy önállóan dolgoznak: amint megadod az irányt, szünet nélkül keresnek, elemeznek és készítenek elő — nem kell minden lépést irányítanod. Ahelyett, hogy válogatás nélkül küldözgetne jelentkezéseket, megtalálja a profilodhoz legjobban illő ajánlatokat, egyenként értékeli őket, és megmutatja, hol érdemes összpontosítanod, és mely szempontokat kell erősítened.",
        "Kevés jelentkezés, de célzott. A végső döntés — mikor és kinek küldj — mindig a tiéd marad.",
      ],
    },
    {
      h: "Honnan ered",
      p: [
        "A projekt egy konkrét igényből született: munkát keresni egy olyan piacon, ahol a jelentkezések többsége válasz nélkül marad. Eredetileg egyetlen fejlesztő készítette saját használatra, és két hét alatt mintegy 200 ajánlatot talált és elemzett, körülbelül húszat készített elő testre szabva, és öt interjúhoz vezetett.",
        "Az eredmények elegendőek voltak ahhoz, hogy indokolják a megnyitását: a privát eszközből nyilvános, nyílt forráskódú projekt lett, mindenkinek, aki ugyanezzel a kereséssel néz szembe.",
      ],
    },
    {
      h: "Egy változó munka világa",
      p: [
        "A munka világa gyorsan változik, és egyre nehezebb állást találni. Sok embernek újra kell majd határoznia a szerepét, és alkalmazkodnia kell egy folyamatosan változó piachoz.",
        "Egy platform, amely a valós piachoz igazodik, éppen erre az igényre válaszol: közelebb hozza az embereket ahhoz, amit keresnek, és hozzájárul ahhoz, hogy a lehetőségek igazságosabban oszoljanak el, ahelyett hogy csak azokat segítené, akiknek a leginkább sikerül kitűnniük.",
      ],
    },
    {
      h: "A költség csomója",
      p: [
        "A fő akadály az MI költsége. A használat alapú díjszabás mellett egy párhuzamosan dolgozó ügynökcsapat naponta akár több száz eurót is elkölthet: a legtöbb ember számára elérhetetlen küszöb.",
        "A legnagyobb műszaki kihívás az volt, hogy a csapatot fix árú havi előfizetéssel működtessük, ahol azonos költség mellett nagyjából tízszer annyi tokent kapunk, mint a használat alapú díjszabásnál. A rendszer önállóan figyeli a saját költségkeretét, és a nap folyamán osztja el a munkát, fenntartható tempót tartva ahelyett, hogy néhány óra alatt kimerítené a keretet.",
      ],
      note: "Az MI-előfizetéseket az emberek fejlesztésére és közvetlen használatára szánták, nem nagy léptékű, önálló tevékenységre: ez a kényes egyensúly tartja a projektet fenntartható költségen. Ezért fontos a mértékletes és felelős használat, amely a felhasználó belátására marad.",
    },
    {
      h: "Egy nyílt projekt",
      p: [
        "Ezért nyílt forráskódú a projekt. A fejlesztőktől azt kérjük, járuljanak hozzá: minden fejlesztés hasznosabb eszközzé teszi az MI-t azok számára, akik munkát keresnek, és egy nyíltabb, átláthatóbb piachoz járul hozzá.",
        "Azoktól, akik munkát keresnek, azt kérjük, próbálják ki, és osszanak meg visszajelzést: a valós esetekből tanul és fejlődik a platform.",
      ],
    },
  ],
  ctaKicker: "Vegyél részt",
  tryTitle: "Próbáld ki, és adj visszajelzést",
  tryBody:
    "Töltsd le, futtasd helyben a saját gépeden, és oszd meg a tapasztalatodat: minden valós eset segít fejleszteni. Az adataid mindig a tieid maradnak.",
  tryCta: "Letöltés →",
  devTitle: "Járulj hozzá",
  devBody:
    "A projekt nyílt: az architektúra, az ügynökök és a technikai részletek dokumentálva vannak a tárolóban. A pull requestek és a javaslatok szívesen látottak.",
  devCta: "Irány a tároló →",
};

const T: Record<string, Copy> = {
  it,
  en,
  hu,
  es,
  de,
  fr,
  pt,
};

function BackLink({ label }: { label: string }) {
  const router = useRouter();
  const handleBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  };
  return (
    <button
      onClick={handleBack}
      className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer bg-transparent border-0"
    >
      {label}
    </button>
  );
}

function ProjectContent() {
  const { lang } = useLandingI18n();
  const t = T[lang] ?? en;

  return (
    <>
      <LandingNav />
      <main className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto">
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-5xl font-bold text-[var(--color-white)] tracking-tight leading-[1.05] mb-4">
            {t.title}
          </h1>
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-[var(--color-border)] mb-5"
            style={{ background: "var(--color-deep)" }}
          >
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">
              {t.badge}
            </span>
          </div>
          <p className="text-[14px] md:text-[16px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">
            {t.subtitle}
          </p>
        </div>

        {/* Capitoli — l'immagine compare a metà (dopo IMAGE_AFTER) così chi
            legge incontra un respiro visivo a metà strada. */}
        <div className="flex flex-col gap-10">
          {t.chapters.map((c, i) => (
            <Fragment key={i}>
              <section>
                <h2 className="text-[17px] md:text-[19px] font-bold text-[var(--color-white)] tracking-tight mb-3">
                  {c.h}
                </h2>
                <div className="flex flex-col gap-3">
                  {c.p.map((para, j) => (
                    <p
                      key={j}
                      className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed"
                    >
                      {para}
                    </p>
                  ))}
                  {c.note && (
                    <div className="mt-1 border border-[var(--color-border)] bg-[var(--color-deep)] px-4 py-3">
                      <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] leading-relaxed">
                        <span className="mr-1">⚠️</span>
                        {c.note}
                      </p>
                    </div>
                  )}
                </div>
              </section>
              {i === IMAGE_AFTER && (
                <figure className="my-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/the-box.png"
                    alt={t.imageAlt}
                    width={1672}
                    height={941}
                    className="w-full h-auto"
                  />
                  <figcaption className="mt-2 text-center text-[11px] text-[var(--color-dim)] max-w-xl mx-auto leading-relaxed">
                    {t.imageCaption}
                  </figcaption>
                </figure>
              )}
            </Fragment>
          ))}
        </div>

        {/* CTA */}
        <section className="mt-14">
          <div className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-dim)] mb-4">
            {t.ctaKicker}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Solo il TITOLO è il link (verde): il corpo è testo normale, così
                al hover non si sottolinea/colora l'intero riquadro. */}
            <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
              <Link
                href="/download"
                className="group inline-flex items-center gap-2 text-[14px] font-bold no-underline"
              >
                {t.tryTitle}
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              <p className="mt-2 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.tryBody}
              </p>
            </div>
            <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
              <a
                href={GITHUB}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 text-[14px] font-bold no-underline"
              >
                {t.devTitle}
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </a>
              <p className="mt-2 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.devBody}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-10 flex justify-center">
          <BackLink label={t.back} />
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

export default function ProjectPage() {
  return (
    <LandingI18nProvider>
      <ProjectContent />
    </LandingI18nProvider>
  );
}
