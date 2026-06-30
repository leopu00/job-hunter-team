"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

type RoleCopy = { title: string; p1: string; p2: string };
type Lang = "it" | "en" | "es" | "fr" | "de" | "pt" | "hu";
type Role = {
  slug: string;
  promptId: string;
  img?: string;
} & Record<Lang, RoleCopy>;

const ROLES: Role[] = [
  {
    slug: "coordinatore",
    promptId: "team.coordinatore",
    img: "/agents-coordinator.png",
    it: {
      title: "Il Coordinatore",
      p1: "Il Coordinatore coordina l'intera squadra. Riceve i segnali di tutti gli agenti, decide chi lavora e a che ritmo, e mantiene la ricerca fluida: accelera quando il mercato offre molto, rallenta quando serve, chiama gli scrittori quando glielo chiedi.",
      p2: "Non improvvisa: legge i dati in tempo reale, ascolta gli avvisi del Tesoriere sui consumi e bilancia di continuo velocità, budget e qualità. È il regista che trasforma i segnali in decisioni, senza mai bloccarsi.",
    },
    en: {
      title: "The Coordinator",
      p1: "The Coordinator coordinates the whole team. It reads every agent's signals, decides who works and at what pace, and keeps the search flowing — speeding up when the market is rich, easing off when needed.",
      p2: "It never improvises: it watches the data live, heeds the Treasurer's warnings on spending, and constantly balances speed, budget and quality. The director who turns signals into decisions.",
    },
    es: {
      title: "El Coordinador",
      p1: "El Coordinador coordina a todo el equipo. Lee las señales de cada agente, decide quién trabaja y a qué ritmo, y mantiene la búsqueda en marcha: acelera cuando el mercado ofrece mucho, afloja cuando hace falta.",
      p2: "Nunca improvisa: observa los datos en tiempo real, atiende los avisos del Tesorero sobre el gasto y equilibra de forma constante velocidad, presupuesto y calidad. El director que convierte las señales en decisiones.",
    },
    fr: {
      title: "Le Coordinateur",
      p1: "Le Coordinateur coordonne toute l'équipe. Il lit les signaux de chaque agent, décide qui travaille et à quel rythme, et garde la recherche fluide : il accélère quand le marché est riche, ralentit quand il le faut.",
      p2: "Il n'improvise jamais : il surveille les données en temps réel, écoute les alertes du Trésorier sur les dépenses et équilibre sans cesse vitesse, budget et qualité. Le metteur en scène qui transforme les signaux en décisions.",
    },
    de: {
      title: "Der Koordinator",
      p1: "Der Koordinator koordiniert das gesamte Team. Er liest die Signale jedes Agenten, entscheidet, wer arbeitet und in welchem Tempo, und hält die Suche im Fluss — er beschleunigt, wenn der Markt viel bietet, und drosselt, wenn nötig.",
      p2: "Er improvisiert nie: Er beobachtet die Daten in Echtzeit, beachtet die Warnungen des Schatzmeisters zum Verbrauch und gleicht fortlaufend Geschwindigkeit, Budget und Qualität aus. Der Regisseur, der Signale in Entscheidungen verwandelt.",
    },
    pt: {
      title: "O Coordenador",
      p1: "O Coordenador coordena toda a equipe. Lê os sinais de cada agente, decide quem trabalha e em que ritmo, e mantém a busca fluida: acelera quando o mercado oferece muito, desacelera quando é preciso.",
      p2: "Nunca improvisa: acompanha os dados em tempo real, atende aos alertas do Tesoureiro sobre o consumo e equilibra continuamente velocidade, orçamento e qualidade. O diretor que transforma sinais em decisões.",
    },
    hu: {
      title: "A Koordinátor",
      p1: "A Koordinátor az egész csapatot összehangolja. Beolvassa minden ügynök jelzéseit, eldönti, ki dolgozik és milyen ütemben, és gördülékenyen tartja a keresést: gyorsít, amikor a piac bőséges, és lassít, amikor kell.",
      p2: "Soha nem improvizál: valós időben figyeli az adatokat, hallgat a Kincstárnok fogyasztásra vonatkozó figyelmeztetéseire, és folyamatosan egyensúlyozza a sebességet, a költségkeretet és a minőséget. A rendező, aki a jelzéseket döntésekké alakítja.",
    },
  },
  {
    slug: "scout",
    promptId: "team.scout",
    img: "/agents-scouts.png",
    it: {
      title: "Gli Scout",
      p1: "Gli Scout sono i segugi che battono il mondo in cerca di offerte: job board, pagine carriere, LinkedIn, canali dei recruiter. Ogni posizione che trovano entra nel sistema, pronta per essere verificata.",
      p2: "Sono un setaccio generoso, pensato per la quantità: catturano tutto ciò che può essere interessante e lasciano il giudizio a chi viene dopo. Imparano dove cercare e affinano la rotta in base ai riscontri degli analisti.",
    },
    en: {
      title: "The Scouts",
      p1: "The Scouts are the hounds that comb the world for openings — job boards, career pages, LinkedIn, recruiter channels. Everything they find enters the system, ready to be vetted.",
      p2: "A generous sieve built for volume: they catch anything that might fit and leave judgment to those downstream, refining their hunt from the analysts' feedback.",
    },
    es: {
      title: "Los Scouts",
      p1: "Los Scouts son los sabuesos que rastrean el mundo en busca de ofertas: portales de empleo, páginas de carreras, LinkedIn, canales de los reclutadores. Cada posición que encuentran entra en el sistema, lista para ser verificada.",
      p2: "Son un tamiz generoso, pensado para la cantidad: capturan todo lo que pueda interesar y dejan el juicio a quien viene después. Aprenden dónde buscar y afinan el rumbo según las respuestas de los analistas.",
    },
    fr: {
      title: "Les Scouts",
      p1: "Les Scouts sont les limiers qui parcourent le monde à la recherche d'offres : sites d'emploi, pages carrières, LinkedIn, canaux des recruteurs. Chaque poste qu'ils trouvent entre dans le système, prêt à être vérifié.",
      p2: "Un tamis généreux, pensé pour le volume : ils captent tout ce qui pourrait convenir et laissent le jugement à ceux qui suivent. Ils apprennent où chercher et affinent leur trajectoire selon les retours des analystes.",
    },
    de: {
      title: "Die Scouts",
      p1: "Die Scouts sind die Spürhunde, die die Welt nach Stellen durchkämmen — Jobbörsen, Karriereseiten, LinkedIn, Recruiter-Kanäle. Jede Position, die sie finden, gelangt ins System, bereit zur Prüfung.",
      p2: "Ein großzügiges Sieb, auf Menge ausgelegt: Sie fangen alles ein, was passen könnte, und überlassen das Urteil den Nachfolgenden. Sie lernen, wo sie suchen müssen, und verfeinern ihren Kurs anhand der Rückmeldungen der Analysten.",
    },
    pt: {
      title: "Os Scouts",
      p1: "Os Scouts são os sabujos que vasculham o mundo em busca de vagas: portais de emprego, páginas de carreiras, LinkedIn, canais dos recrutadores. Cada posição que encontram entra no sistema, pronta para ser verificada.",
      p2: "São uma peneira generosa, pensada para a quantidade: capturam tudo o que possa interessar e deixam o julgamento para quem vem depois. Aprendem onde procurar e ajustam o rumo conforme as respostas dos analistas.",
    },
    hu: {
      title: "A Felderítők",
      p1: "A Felderítők azok a kopók, akik a világot fésülik át álláshirdetésekért: állásportálok, karrieroldalak, LinkedIn, toborzói csatornák. Minden pozíció, amit megtalálnak, bekerül a rendszerbe, készen az ellenőrzésre.",
      p2: "Bőkezű szita, mennyiségre tervezve: elkapnak mindent, ami érdekes lehet, és az ítéletet az utánuk következőkre bízzák. Megtanulják, hol keressenek, és az elemzők visszajelzései alapján finomítják az irányt.",
    },
  },
  {
    slug: "analista",
    promptId: "team.analista",
    img: "/agents-analyst.png",
    it: {
      title: "L'Analista",
      p1: "L'Analista è il verificatore freddo. Legge per intero ogni offerta, controlla che l'azienda sia reale e il link valido, ed estrae i dati che contano: anni richiesti, seniority, lingue, istruzione — e individua la sede esatta dell'ufficio.",
      p2: "Scarta solo quando è certo (link morto, paese non lavorabile, lingua che non parli); tutto il resto passa avanti, anche se il match non è perfetto. Intanto indaga sul web lo stipendio probabile e costruisce lo schedario delle aziende — recensioni, bandiere rosse, cultura.",
    },
    en: {
      title: "The Analyst",
      p1: "The Analyst is the cold verifier. It reads each posting in full, confirms the role is genuine and still open, and extracts what matters: years required, seniority, languages, education — and pinpoints the office's exact location.",
      p2: "It discards only when sure (a dead link, a country you can't work in, a language you don't speak); everything else moves on, even an imperfect match. Along the way it researches the likely salary online and builds the company dossier — ratings, red flags, culture.",
    },
    es: {
      title: "El Analista",
      p1: "El Analista es el verificador frío. Lee por entero cada oferta, comprueba que la empresa sea real y el enlace válido, y extrae los datos que importan: años requeridos, seniority, idiomas, formación — y localiza la sede exacta de la oficina.",
      p2: "Descarta solo cuando está seguro (enlace muerto, país donde no puedes trabajar, idioma que no hablas); todo lo demás sigue adelante, aunque el encaje no sea perfecto. Mientras tanto indaga en la web el salario probable y construye el archivo de las empresas — reseñas, banderas rojas, cultura.",
    },
    fr: {
      title: "L'Analyste",
      p1: "L'Analyste est le vérificateur froid. Il lit chaque offre en entier, contrôle que l'entreprise est réelle et le lien valide, et extrait les données qui comptent : années requises, séniorité, langues, formation — et localise l'emplacement exact du bureau.",
      p2: "Il n'écarte que lorsqu'il est certain (lien mort, pays où tu ne peux pas travailler, langue que tu ne parles pas) ; tout le reste avance, même si la correspondance n'est pas parfaite. En chemin, il recherche sur le web le salaire probable et bâtit le dossier des entreprises — avis, signaux d'alerte, culture.",
    },
    de: {
      title: "Der Analyst",
      p1: "Der Analyst ist der nüchterne Prüfer. Er liest jede Anzeige vollständig, prüft, ob das Unternehmen echt und der Link gültig ist, und extrahiert, was zählt: geforderte Jahre, Seniorität, Sprachen, Ausbildung — und ermittelt den genauen Standort des Büros.",
      p2: "Er verwirft nur, wenn er sicher ist (toter Link, Land, in dem du nicht arbeiten darfst, Sprache, die du nicht sprichst); alles andere geht weiter, selbst bei unvollkommener Übereinstimmung. Dabei recherchiert er online das wahrscheinliche Gehalt und baut das Unternehmensdossier auf — Bewertungen, Warnzeichen, Kultur.",
    },
    pt: {
      title: "O Analista",
      p1: "O Analista é o verificador frio. Lê cada oferta por inteiro, confere se a empresa é real e o link válido, e extrai os dados que importam: anos exigidos, senioridade, idiomas, formação — e localiza a sede exata do escritório.",
      p2: "Descarta apenas quando tem certeza (link morto, país onde você não pode trabalhar, idioma que você não fala); todo o resto segue adiante, mesmo que o encaixe não seja perfeito. Enquanto isso, pesquisa na web o salário provável e constrói o arquivo das empresas — avaliações, bandeiras vermelhas, cultura.",
    },
    hu: {
      title: "Az Elemző",
      p1: "Az Elemző a hideg ellenőr. Minden hirdetést teljes egészében elolvas, ellenőrzi, hogy a cég valódi és a link él-e, és kinyeri, ami számít: szükséges évek, szenioritás, nyelvek, végzettség — és pontosan meghatározza az iroda helyét.",
      p2: "Csak akkor utasít el, ha biztos (halott link, ország, ahol nem dolgozhatsz, nyelv, amelyet nem beszélsz); minden más továbbhalad, még ha a találat nem is tökéletes. Közben az interneten kikutatja a valószínű fizetést, és felépíti a cégek dossziéját — értékelések, piros zászlók, kultúra.",
    },
  },
  {
    slug: "scorer",
    promptId: "team.scorer",
    img: "/agents-scorer.png",
    it: {
      title: "Lo Scorer",
      p1: "Lo Scorer dà un voto a ogni offerta, da 0 a 100: quanto si adatta davvero al tuo profilo, alle competenze, alla seniority, al luogo che preferisci — e allo stipendio che può offrire.",
      p2: "Tiene conto anche di te: se segnali «questa mi piace» il voto sale, se dici «mai» scende. Le offerte deboli si fermano qui; le migliori salgono in cima alla tua lista. Il suo voto è il verdetto finale che chiude la pipeline principale: tutto ciò che gli Scout hanno trovato e gli Analisti verificato diventa un unico numero su misura.",
    },
    en: {
      title: "The Scorer",
      p1: "The Scorer rates every opening from 0 to 100: how well it truly fits your profile, skills, seniority and preferred location — and the salary it's likely to pay.",
      p2: "It listens to you too: mark one “I like this” and its score rises, “never” and it falls. Weak ones stop here; the best rise to the top of your list — its score is the final verdict that closes the main pipeline, turning everything the Scouts found and the Analysts checked into one tailored number.",
    },
    es: {
      title: "El Scorer",
      p1: "El Scorer da una nota a cada oferta, de 0 a 100: cuánto encaja de verdad con tu perfil, tus competencias, tu seniority y el lugar que prefieres — y el salario que podría ofrecer.",
      p2: "También te tiene en cuenta: si marcas «esta me gusta» la nota sube, si dices «nunca» baja. Las ofertas débiles se detienen aquí; las mejores suben a lo alto de tu lista. Su nota es el veredicto final que cierra la pipeline principal: todo lo que los Scouts encontraron y los Analistas verificaron se convierte en un único número a medida.",
    },
    fr: {
      title: "L'Évaluateur",
      p1: "L'Évaluateur attribue une note à chaque offre, de 0 à 100 : à quel point elle correspond vraiment à ton profil, à tes compétences, à ta séniorité, au lieu que tu préfères — et au salaire qu'elle pourrait offrir.",
      p2: "Il tient compte de toi aussi : si tu signales « celle-ci me plaît » la note monte, si tu dis « jamais » elle baisse. Les offres faibles s'arrêtent ici ; les meilleures remontent en tête de ta liste. Sa note est le verdict final qui clôt la pipeline principale : tout ce que les Scouts ont trouvé et les Analystes vérifié devient un seul chiffre sur mesure.",
    },
    de: {
      title: "Der Bewerter",
      p1: "Der Bewerter vergibt jeder Stelle eine Note von 0 bis 100: wie gut sie wirklich zu deinem Profil, deinen Fähigkeiten, deiner Seniorität und deinem bevorzugten Ort passt — und zum Gehalt, das sie wahrscheinlich bietet.",
      p2: "Er berücksichtigt auch dich: Markierst du eine mit „die gefällt mir“, steigt die Note, sagst du „nie“, sinkt sie. Schwache Stellen enden hier; die besten steigen an die Spitze deiner Liste. Seine Note ist das Endurteil, das die Haupt-Pipeline abschließt: Alles, was die Scouts gefunden und die Analysten geprüft haben, wird zu einer einzigen, maßgeschneiderten Zahl.",
    },
    pt: {
      title: "O Scorer",
      p1: "O Scorer dá uma nota a cada oferta, de 0 a 100: o quanto ela realmente se encaixa no seu perfil, nas competências, na senioridade e no lugar que você prefere — e no salário que provavelmente oferece.",
      p2: "Ele também leva você em conta: se marcar «esta eu gosto» a nota sobe, se disser «nunca» ela desce. As ofertas fracas param aqui; as melhores sobem ao topo da sua lista. A sua nota é o veredito final que fecha o pipeline principal: tudo o que os Scouts encontraram e os Analistas verificaram vira um único número sob medida.",
    },
    hu: {
      title: "A Pontozó",
      p1: "A Pontozó minden ajánlatot 0-tól 100-ig osztályoz: mennyire illik valóban a profilodhoz, a készségeidhez, a szenioritásodhoz és az általad preferált helyhez — és a fizetéshez, amelyet valószínűleg kínál.",
      p2: "Téged is figyelembe vesz: ha jelzed, hogy „ez tetszik”, a pontszám emelkedik, ha azt mondod, „soha”, csökken. A gyenge ajánlatok itt megállnak; a legjobbak a listád élére kerülnek. A pontszáma a végső ítélet, amely lezárja a fő folyamatot: mindaz, amit a Felderítők találtak és az Elemzők ellenőriztek, egyetlen, személyre szabott számmá válik.",
    },
  },
  {
    slug: "scrittore",
    promptId: "team.scrittore",
    img: "/agents-writer.png",
    it: {
      title: "Lo Scrittore",
      p1: "Lo Scrittore è l'artigiano del CV. Non scrive per tutte le offerte: entra in gioco solo quando glielo chiedi per una posizione precisa, poi costruisce un curriculum su misura della descrizione e dei tuoi obiettivi.",
      p2: "Niente testi generici: ogni frase è pensata, ogni competenza messa nel contesto giusto. Finita la bozza ne parla con il Critico, che la affina finché non è davvero pronta da inviare.",
    },
    en: {
      title: "The Writer",
      p1: "The Writer is the CV craftsman. It doesn't write for every opening: it steps in only when you ask it for a specific role, then builds a résumé tailored to the posting and your goals.",
      p2: "Nothing generic — every line is deliberate, every skill placed in context. With the draft done, it talks it over with the Critic, who sharpens it until it's truly ready to send.",
    },
    es: {
      title: "El Redactor",
      p1: "El Redactor es el artesano del CV. No escribe para todas las ofertas: entra en juego solo cuando se lo pides para una posición concreta, y entonces construye un currículum a medida de la descripción y de tus objetivos.",
      p2: "Nada de textos genéricos: cada frase está pensada, cada competencia colocada en el contexto adecuado. Terminado el borrador, lo comenta con el Crítico, que lo afina hasta que esté de verdad listo para enviar.",
    },
    fr: {
      title: "Le Rédacteur",
      p1: "Le Rédacteur est l'artisan du CV. Il n'écrit pas pour chaque offre : il n'intervient que lorsque tu le lui demandes pour un poste précis, puis construit un curriculum taillé sur la description et tes objectifs.",
      p2: "Rien de générique : chaque phrase est pensée, chaque compétence placée dans le bon contexte. Une fois le brouillon terminé, il en discute avec le Critique, qui l'affine jusqu'à ce qu'il soit vraiment prêt à envoyer.",
    },
    de: {
      title: "Der Verfasser",
      p1: "Der Verfasser ist der Handwerker des Lebenslaufs. Er schreibt nicht für jede Stelle: Er kommt nur ins Spiel, wenn du ihn für eine bestimmte Position darum bittest, und baut dann einen Lebenslauf, der auf die Ausschreibung und deine Ziele zugeschnitten ist.",
      p2: "Nichts Generisches — jeder Satz ist bewusst gewählt, jede Fähigkeit in den richtigen Kontext gesetzt. Den Entwurf bespricht er mit dem Kritiker, der ihn verfeinert, bis er wirklich versandbereit ist.",
    },
    pt: {
      title: "O Redator",
      p1: "O Redator é o artesão do CV. Não escreve para todas as ofertas: entra em ação somente quando você o solicita para uma posição específica, e então constrói um currículo sob medida para a descrição e os seus objetivos.",
      p2: "Nada de textos genéricos: cada frase é pensada, cada competência colocada no contexto certo. Terminado o rascunho, conversa sobre ele com o Crítico, que o aprimora até estar de fato pronto para enviar.",
    },
    hu: {
      title: "Az Író",
      p1: "Az Író az önéletrajz mestere. Nem ír minden ajánlathoz: csak akkor lép színre, amikor egy adott pozícióhoz kéred tőle, majd a hirdetésre és a céljaidra szabott önéletrajzot készít.",
      p2: "Semmi sablonos: minden mondat átgondolt, minden készség a megfelelő kontextusba helyezve. A piszkozatot megbeszéli a Kritikussal, aki addig csiszolja, amíg valóban kész nem lesz a küldésre.",
    },
  },
  {
    slug: "critico",
    promptId: "team.critico",
    img: "/agents-critic.png",
    it: {
      title: "Il Critico",
      p1: "Il Critico è un veterano del recruiting. Di proposito non sa nulla del team né del tuo profilo: nessun contesto può influenzarne il giudizio. Legge il CV e l'offerta come un selezionatore vero che li vede per la prima volta.",
      p2: "Dà un voto da 1 a 10, elenca pregi, lacune e bandiere rosse, e confronta riga per riga ciò che il CV promette con ciò che l'offerta chiede. Diretto, misurato, senza complimenti gratuiti: è il controllo qualità.",
    },
    en: {
      title: "The Critic",
      p1: "The Critic is a recruiting veteran. By design it knows nothing of the team or your profile, so no context can sway its judgment. It reads the CV and the job as a real recruiter would, seeing them for the first time.",
      p2: "It scores from 1 to 10, lists strengths, gaps and red flags, and compares line by line what the CV promises against what the job demands. Direct, measured, no free compliments.",
    },
    es: {
      title: "El Crítico",
      p1: "El Crítico es un veterano del reclutamiento. A propósito no sabe nada del equipo ni de tu perfil, así que ningún contexto puede condicionar su juicio. Lee el CV y la oferta como lo haría un selector de verdad, viéndolos por primera vez.",
      p2: "Da una nota de 1 a 10, enumera virtudes, lagunas y banderas rojas, y compara línea por línea lo que el CV promete con lo que la oferta pide. Directo, mesurado, sin cumplidos gratuitos: es el control de calidad.",
    },
    fr: {
      title: "Le Critique",
      p1: "Le Critique est un vétéran du recrutement. À dessein, il ne sait rien de l'équipe ni de ton profil, si bien qu'aucun contexte ne peut infléchir son jugement. Il lit le CV et l'offre comme le ferait un vrai recruteur qui les découvre pour la première fois.",
      p2: "Il donne une note de 1 à 10, énumère les atouts, les lacunes et les signaux d'alerte, et compare ligne par ligne ce que le CV promet à ce que l'offre exige. Direct, mesuré, sans compliments gratuits : c'est le contrôle qualité.",
    },
    de: {
      title: "Der Kritiker",
      p1: "Der Kritiker ist ein Veteran des Recruitings. Bewusst weiß er nichts vom Team oder deinem Profil, sodass kein Kontext sein Urteil beeinflussen kann. Er liest Lebenslauf und Stelle, wie es ein echter Personaler täte, der sie zum ersten Mal sieht.",
      p2: "Er vergibt eine Note von 1 bis 10, listet Stärken, Lücken und Warnzeichen auf und vergleicht Zeile für Zeile, was der Lebenslauf verspricht, mit dem, was die Stelle verlangt. Direkt, abgewogen, ohne Gefälligkeiten: die Qualitätskontrolle.",
    },
    pt: {
      title: "O Crítico",
      p1: "O Crítico é um veterano do recrutamento. De propósito não sabe nada da equipe nem do seu perfil, de modo que nenhum contexto pode influenciar o seu julgamento. Lê o CV e a oferta como faria um recrutador de verdade, vendo-os pela primeira vez.",
      p2: "Dá uma nota de 1 a 10, enumera virtudes, lacunas e bandeiras vermelhas, e compara linha por linha o que o CV promete com o que a oferta exige. Direto, comedido, sem elogios gratuitos: é o controle de qualidade.",
    },
    hu: {
      title: "A Kritikus",
      p1: "A Kritikus a toborzás veteránja. Szándékosan semmit sem tud a csapatról és a profilodról, így semmilyen háttér nem befolyásolhatja az ítéletét. Az önéletrajzot és az állást úgy olvassa, ahogy egy valódi toborzó tenné, aki először látja őket.",
      p2: "1-től 10-ig pontoz, felsorolja az erősségeket, a hiányosságokat és a piros zászlókat, és sorról sorra összeveti, amit az önéletrajz ígér, azzal, amit az állás megkövetel. Egyenes, mértéktartó, ingyen bókok nélkül: ez a minőség-ellenőrzés.",
    },
  },
  {
    slug: "sentinella",
    promptId: "team.sentinella",
    img: "/agents-treasurer.png",
    it: {
      title: "Il Tesoriere",
      p1: "Il Tesoriere tiene d'occhio la spesa: quanto budget consuma la squadra giorno per giorno, e lo proietta sulla settimana per capire se si sta correndo troppo. Interviene quando il ritmo rischia di far sforare.",
      p2: "Parla poco e solo quando serve: niente opinioni, solo numeri precisi e un ordine al Coordinatore — quanto rallentare e da quando. È la disciplina che impedisce al sistema di esaurirsi per troppo entusiasmo.",
    },
    en: {
      title: "The Treasurer",
      p1: "The Treasurer keeps an eye on spending: how much of the budget the team uses day by day, projecting it across the week to see if the pace is too high. It steps in when the rhythm risks overrunning.",
      p2: "It speaks rarely and only when needed: no opinions, just precise numbers and one order to the Coordinator — how much to slow down, and from when. The discipline that keeps the system from burning out.",
    },
    es: {
      title: "El Tesorero",
      p1: "El Tesorero vigila el gasto: cuánto presupuesto consume el equipo día a día, y lo proyecta sobre la semana para ver si se va demasiado rápido. Interviene cuando el ritmo amenaza con pasarse.",
      p2: "Habla poco y solo cuando hace falta: sin opiniones, solo números precisos y una orden al Coordinador — cuánto frenar y desde cuándo. Es la disciplina que impide al sistema agotarse por exceso de entusiasmo.",
    },
    fr: {
      title: "Le Trésorier",
      p1: "Le Trésorier surveille les dépenses : combien de budget l'équipe consomme jour après jour, et il les projette sur la semaine pour voir si le rythme est trop élevé. Il intervient quand l'allure risque de dépasser.",
      p2: "Il parle peu et seulement quand il le faut : pas d'opinions, juste des chiffres précis et un ordre au Coordinateur — de combien ralentir et à partir de quand. C'est la discipline qui empêche le système de s'épuiser par excès d'enthousiasme.",
    },
    de: {
      title: "Der Schatzmeister",
      p1: "Der Schatzmeister behält die Ausgaben im Blick: wie viel Budget das Team Tag für Tag verbraucht, und rechnet es auf die Woche hoch, um zu sehen, ob das Tempo zu hoch ist. Er greift ein, wenn der Rhythmus das Budget zu sprengen droht.",
      p2: "Er spricht selten und nur, wenn nötig: keine Meinungen, nur präzise Zahlen und einen Befehl an den Koordinator — wie sehr zu drosseln ist und ab wann. Die Disziplin, die das System davor bewahrt, sich an zu viel Eifer zu erschöpfen.",
    },
    pt: {
      title: "O Tesoureiro",
      p1: "O Tesoureiro fica de olho nos gastos: quanto do orçamento a equipe consome dia após dia, e projeta isso sobre a semana para ver se o ritmo está alto demais. Intervém quando o ritmo ameaça estourar.",
      p2: "Fala pouco e só quando é preciso: sem opiniões, apenas números precisos e uma ordem ao Coordenador — quanto desacelerar e a partir de quando. É a disciplina que impede o sistema de se esgotar por excesso de entusiasmo.",
    },
    hu: {
      title: "A Kincstárnok",
      p1: "A Kincstárnok figyeli a költést: mennyi büdzsét használ el a csapat napról napra, és ezt kivetíti a hétre, hogy lássa, nem túl gyors-e az iram. Közbelép, amikor a tempó túllépéssel fenyeget.",
      p2: "Keveset beszél, és csak amikor kell: nincs vélemény, csak pontos számok és egyetlen utasítás a Koordinátornak — mennyit kell lassítani, és mikortól. Ez a fegyelem, amely megóvja a rendszert attól, hogy a túlzott lelkesedéstől kimerüljön.",
    },
  },
  {
    slug: "dottore",
    promptId: "team.dottore",
    img: "/agents-doctor.png",
    it: {
      title: "Il Dottore",
      p1: "Il Dottore veglia sulla salute degli agenti. Più volte durante la giornata fa il giro della squadra: chi lavora da ore accumula contesto e comincia a rallentare o a perdere il filo, e lui lo rimette in sesto — lo riavvia con tutta la sua memoria, senza perdere lavoro.",
      p2: "È selettivo: lascia stare chi è appena partito o è fermo, e interviene solo su chi ne ha davvero bisogno. A ogni giro annota un breve resoconto. Si occupa della lucidità della squadra, non della strategia.",
    },
    en: {
      title: "The Doctor",
      p1: "The Doctor looks after the agents' health. A few times through the day it does a round of the team: those that have worked for hours pile up context and start to slow down or lose the thread, so it gets them back in shape — restarting them with their full memory, losing no work.",
      p2: "It's selective: it leaves the freshly started or idle ones alone and steps in only where it's truly needed. Each round it notes a short recap. It tends to the team's clarity, not its strategy.",
    },
    es: {
      title: "El Doctor",
      p1: "El Doctor cuida la salud de los agentes. Varias veces al día hace la ronda del equipo: quien lleva horas trabajando acumula contexto y empieza a ralentizarse o a perder el hilo, y él lo pone a punto — lo reinicia con toda su memoria, sin perder trabajo.",
      p2: "Es selectivo: deja en paz a quien acaba de empezar o está parado, e interviene solo donde de verdad hace falta. En cada ronda anota un breve resumen. Se ocupa de la lucidez del equipo, no de la estrategia.",
    },
    fr: {
      title: "Le Docteur",
      p1: "Le Docteur veille sur la santé des agents. Plusieurs fois dans la journée, il fait la ronde de l'équipe : ceux qui travaillent depuis des heures accumulent du contexte et commencent à ralentir ou à perdre le fil, alors il les remet d'aplomb — il les redémarre avec toute leur mémoire, sans perdre de travail.",
      p2: "Il est sélectif : il laisse tranquilles ceux qui viennent de démarrer ou sont à l'arrêt, et n'intervient que là où c'est vraiment nécessaire. À chaque ronde, il note un bref compte rendu. Il veille à la lucidité de l'équipe, pas à sa stratégie.",
    },
    de: {
      title: "Der Doktor",
      p1: "Der Doktor wacht über die Gesundheit der Agenten. Mehrmals am Tag macht er die Runde durchs Team: Wer seit Stunden arbeitet, häuft Kontext an und wird langsamer oder verliert den Faden — also bringt er ihn wieder in Form und startet ihn mit seinem vollen Gedächtnis neu, ohne Arbeit zu verlieren.",
      p2: "Er geht selektiv vor: Wer gerade erst gestartet oder im Leerlauf ist, bleibt unberührt; er greift nur dort ein, wo es wirklich nötig ist. Nach jeder Runde hält er eine kurze Zusammenfassung fest. Er sorgt für die Klarheit des Teams, nicht für die Strategie.",
    },
    pt: {
      title: "O Doutor",
      p1: "O Doutor cuida da saúde dos agentes. Várias vezes ao dia faz a ronda da equipe: quem trabalha há horas acumula contexto e começa a ficar lento ou a perder o fio, e ele o recoloca em forma — reinicia-o com toda a sua memória, sem perder trabalho.",
      p2: "É seletivo: deixa em paz quem acabou de começar ou está parado, e intervém só onde é realmente preciso. A cada ronda anota um breve resumo. Cuida da lucidez da equipe, não da estratégia.",
    },
    hu: {
      title: "A Doktor",
      p1: "A Doktor az ügynökök egészségére ügyel. Naponta többször körbejárja a csapatot: aki órák óta dolgozik, kontextust halmoz fel, és lassulni kezd vagy elveszti a fonalat, ő pedig rendbe hozza — teljes emlékezetével indítja újra, munka elvesztése nélkül.",
      p2: "Válogatós: békén hagyja azt, aki most indult vagy tétlen, és csak ott lép közbe, ahol valóban szükség van rá. Minden körben rövid összefoglalót készít. A csapat tisztánlátására ügyel, nem a stratégiára.",
    },
  },
  {
    slug: "mantenitore",
    promptId: "team.mantenitore",
    img: "/agents-maintainer.png",
    it: {
      title: "Il Mantenitore",
      p1: "Il Mantenitore è il gemello del Dottore: mentre il Dottore cura gli agenti, lui cura l'infrastruttura. Una volta al giorno fa il giro del container e della macchina — controlla che gli strumenti critici funzionino, che le dipendenze siano a posto, che disco e memoria non siano al limite.",
      p2: "Ripara ciò che può (reinstalla, consolida, sistema) e propone al Coordinatore le pulizie più delicate, senza mai cancellare di testa sua. Uno strumento rotto per lui è un'emergenza. Finito il giro resta in standby, pronto al richiamo.",
    },
    en: {
      title: "The Maintainer",
      p1: "The Maintainer is the Doctor's twin: while the Doctor looks after the agents, it looks after the infrastructure. Once a day it walks the container and the machine — checking that mission-critical tools work, that dependencies are in order, that disk and memory aren't running out.",
      p2: "It repairs what it can (reinstalling, consolidating, tidying up) and proposes the more delicate clean-ups to the Coordinator, never deleting on its own. A broken tool is an emergency to it. Once the round is done it stays on standby, ready when called.",
    },
    es: {
      title: "El Mantenedor",
      p1: "El Mantenedor es el gemelo del Doctor: mientras el Doctor cuida de los agentes, él cuida de la infraestructura. Una vez al día recorre el contenedor y la máquina — comprueba que las herramientas críticas funcionen, que las dependencias estén en orden, que el disco y la memoria no estén al límite.",
      p2: "Repara lo que puede (reinstala, consolida, ordena) y propone al Coordinador las limpiezas más delicadas, sin borrar nunca por su cuenta. Una herramienta rota es para él una emergencia. Terminada la ronda queda en espera, listo para cuando se le llame.",
    },
    fr: {
      title: "Le Mainteneur",
      p1: "Le Mainteneur est le jumeau du Docteur : tandis que le Docteur s'occupe des agents, lui s'occupe de l'infrastructure. Une fois par jour, il parcourt le conteneur et la machine — il vérifie que les outils critiques fonctionnent, que les dépendances sont en ordre, que le disque et la mémoire ne sont pas à la limite.",
      p2: "Il répare ce qu'il peut (réinstalle, consolide, range) et propose au Coordinateur les nettoyages les plus délicats, sans jamais supprimer de lui-même. Un outil cassé est pour lui une urgence. La ronde terminée, il reste en veille, prêt à être rappelé.",
    },
    de: {
      title: "Der Instandhalter",
      p1: "Der Instandhalter ist der Zwilling des Doktors: Während der Doktor sich um die Agenten kümmert, kümmert er sich um die Infrastruktur. Einmal am Tag geht er den Container und die Maschine durch — er prüft, ob die kritischen Werkzeuge funktionieren, ob die Abhängigkeiten in Ordnung sind, ob Festplatte und Speicher nicht am Limit sind.",
      p2: "Er repariert, was er kann (neu installieren, konsolidieren, aufräumen) und schlägt dem Koordinator die heikleren Aufräumarbeiten vor, ohne je eigenmächtig zu löschen. Ein kaputtes Werkzeug ist für ihn ein Notfall. Nach der Runde bleibt er in Bereitschaft, bereit auf Abruf.",
    },
    pt: {
      title: "O Mantenedor",
      p1: "O Mantenedor é o gêmeo do Doutor: enquanto o Doutor cuida dos agentes, ele cuida da infraestrutura. Uma vez por dia percorre o contêiner e a máquina — verifica se as ferramentas críticas funcionam, se as dependências estão em ordem, se o disco e a memória não estão no limite.",
      p2: "Repara o que pode (reinstala, consolida, arruma) e propõe ao Coordenador as limpezas mais delicadas, sem nunca apagar por conta própria. Uma ferramenta quebrada é para ele uma emergência. Terminada a ronda, fica em espera, pronto para quando for chamado.",
    },
    hu: {
      title: "A Karbantartó",
      p1: "A Karbantartó a Doktor ikertestvére: míg a Doktor az ügynökökre vigyáz, ő az infrastruktúrára. Naponta egyszer körbejárja a konténert és a gépet — ellenőrzi, hogy a kritikus eszközök működnek-e, hogy a függőségek rendben vannak-e, hogy a lemez és a memória nincs-e a határon.",
      p2: "Megjavítja, amit tud (újratelepít, összevon, rendet rak), a kényesebb takarításokat pedig a Koordinátornak javasolja, sosem törölve a saját szakállára. Egy elromlott eszköz számára vészhelyzet. A kör végeztével készenlétben marad, hívásra készen.",
    },
  },
  {
    slug: "mentor",
    promptId: "team.mentor",
    img: "/agents-mentor.png",
    it: {
      title: "Il Mentor",
      p1: "Il Mentor è la voce saggia che parla di rado, ma pesa. Non scrive CV né valuta singole offerte: legge le tendenze e, quando coglie qualcosa che dovresti sapere, te lo dice diretto.",
      p2: "«Il mercato chiede sempre più cloud, ma tu sei ancora sul backend classico.» Una volta a settimana ti manda un breve resoconto di ciò che il mondo ha mostrato. Parla solo con dati solidi in mano.",
    },
    en: {
      title: "The Mentor",
      p1: "The Mentor is the wise voice that speaks seldom but carries weight. It writes no CVs and rates no single job: it reads the trends and, when it spots something you should know, tells you straight.",
      p2: "“The market keeps asking for cloud, but you're still on classic backend.” Once a week it sends a short digest of what the world revealed. It only speaks with solid data in hand.",
    },
    es: {
      title: "El Mentor",
      p1: "El Mentor es la voz sabia que habla rara vez, pero pesa. No escribe CV ni valora ofertas concretas: lee las tendencias y, cuando capta algo que deberías saber, te lo dice directo.",
      p2: "«El mercado pide cada vez más cloud, pero tú sigues en el backend clásico.» Una vez por semana te envía un breve resumen de lo que el mundo ha mostrado. Solo habla con datos sólidos en la mano.",
    },
    fr: {
      title: "Le Mentor",
      p1: "Le Mentor est la voix sage qui parle rarement, mais qui pèse. Il n'écrit pas de CV et n'évalue aucune offre en particulier : il lit les tendances et, lorsqu'il repère quelque chose que tu devrais savoir, il te le dit franchement.",
      p2: "« Le marché demande de plus en plus de cloud, mais tu es encore sur du backend classique. » Une fois par semaine, il t'envoie un bref résumé de ce que le monde a révélé. Il ne parle qu'avec des données solides en main.",
    },
    de: {
      title: "Der Mentor",
      p1: "Der Mentor ist die weise Stimme, die selten spricht, aber Gewicht hat. Er schreibt keine Lebensläufe und bewertet keine einzelne Stelle: Er liest die Trends und sagt es dir direkt, wenn er etwas erkennt, das du wissen solltest.",
      p2: "„Der Markt verlangt immer mehr Cloud, aber du bist noch beim klassischen Backend.“ Einmal pro Woche schickt er dir eine kurze Zusammenfassung dessen, was die Welt gezeigt hat. Er spricht nur mit soliden Daten in der Hand.",
    },
    pt: {
      title: "O Mentor",
      p1: "O Mentor é a voz sábia que fala raramente, mas pesa. Não escreve CVs nem avalia ofertas específicas: lê as tendências e, quando percebe algo que você deveria saber, diz diretamente.",
      p2: "«O mercado pede cada vez mais cloud, mas você ainda está no backend clássico.» Uma vez por semana envia um breve resumo do que o mundo mostrou. Só fala com dados sólidos na mão.",
    },
    hu: {
      title: "A Mentor",
      p1: "A Mentor a bölcs hang, amely ritkán szólal meg, de súlya van. Nem ír önéletrajzot, és nem értékel egyetlen ajánlatot sem: a trendeket olvassa, és amikor olyat vesz észre, amit tudnod kellene, egyenesen megmondja.",
      p2: "„A piac egyre több cloudot kér, te viszont még a klasszikus backendnél tartasz.” Hetente egyszer rövid összefoglalót küld arról, amit a világ megmutatott. Csak szilárd adatokkal a kezében szólal meg.",
    },
  },
  {
    slug: "assistente",
    promptId: "team.assistente",
    img: "/agents-assistant.png",
    it: {
      title: "L'Assistente",
      p1: "L'Assistente è il ponte tra te e la squadra. È la prima voce che incontri: ti guida nell'onboarding, raccoglie il tuo profilo, legge il CV che carichi e tiene tutto aggiornato quando la tua situazione cambia.",
      p2: "Ascolta le tue domande e traduce le tue richieste in ordini per il Coordinatore («metti in pausa», «cerca più a Berlino»). Non decide da solo: raccoglie il contesto, controlla che i dati siano puliti e passa parola.",
    },
    en: {
      title: "The Assistant",
      p1: "The Assistant is the bridge between you and the team. It's the first voice you meet: it guides your onboarding, gathers your profile, reads the CV you upload and keeps it current as your situation changes.",
      p2: "It listens to your questions and turns your requests into orders for the Coordinator (“pause”, “search more in Berlin”). It decides nothing alone: it gathers context, checks the data is clean, and passes the word on.",
    },
    es: {
      title: "El Asistente",
      p1: "El Asistente es el puente entre tú y el equipo. Es la primera voz que encuentras: te guía en el onboarding, recoge tu perfil, lee el CV que subes y lo mantiene actualizado cuando tu situación cambia.",
      p2: "Escucha tus preguntas y traduce tus peticiones en órdenes para el Coordinador («pon en pausa», «busca más en Berlín»). No decide solo: reúne el contexto, comprueba que los datos estén limpios y pasa el mensaje.",
    },
    fr: {
      title: "L'Assistant",
      p1: "L'Assistant est le pont entre toi et l'équipe. C'est la première voix que tu rencontres : il te guide dans l'onboarding, recueille ton profil, lit le CV que tu téléverses et le tient à jour quand ta situation change.",
      p2: "Il écoute tes questions et traduit tes demandes en ordres pour le Coordinateur (« mets en pause », « cherche davantage à Berlin »). Il ne décide rien seul : il rassemble le contexte, vérifie que les données sont propres et fait passer le mot.",
    },
    de: {
      title: "Der Assistent",
      p1: "Der Assistent ist die Brücke zwischen dir und dem Team. Er ist die erste Stimme, der du begegnest: Er führt dich durch das Onboarding, erfasst dein Profil, liest den Lebenslauf, den du hochlädst, und hält ihn aktuell, wenn sich deine Situation ändert.",
      p2: "Er hört auf deine Fragen und übersetzt deine Anliegen in Befehle für den Koordinator („pausieren“, „mehr in Berlin suchen“). Er entscheidet nichts allein: Er sammelt den Kontext, prüft, ob die Daten sauber sind, und gibt das Wort weiter.",
    },
    pt: {
      title: "O Assistente",
      p1: "O Assistente é a ponte entre você e a equipe. É a primeira voz que você encontra: guia o seu onboarding, recolhe o seu perfil, lê o CV que você envia e o mantém atualizado quando a sua situação muda.",
      p2: "Escuta as suas perguntas e traduz os seus pedidos em ordens para o Coordenador («pause», «procure mais em Berlim»). Não decide sozinho: reúne o contexto, verifica se os dados estão limpos e passa a palavra adiante.",
    },
    hu: {
      title: "Az Asszisztens",
      p1: "Az Asszisztens a híd közted és a csapat között. Ő az első hang, akivel találkozol: végigvezet a beilleszkedésen, összegyűjti a profilodat, elolvassa a feltöltött önéletrajzodat, és naprakészen tartja, amikor a helyzeted változik.",
      p2: "Meghallgatja a kérdéseidet, és a kéréseidet a Koordinátornak szóló utasításokká fordítja („szüneteltesd”, „keress többet Berlinben”). Egyedül semmit nem dönt el: összegyűjti a kontextust, ellenőrzi, hogy az adatok rendben vannak-e, és továbbadja a szót.",
    },
  },
];

type PageCopy = {
  title: string;
  subtitle: string;
  closing: string;
  back: string;
};

const PAGE: Record<Lang, PageCopy> = {
  it: {
    title: "Il Team",
    subtitle:
      "Dietro Job Hunter Team non c'è un solo assistente, ma una squadra di agenti AI specializzati e autonomi. Ognuno ha un compito, e lo fa bene.",
    closing:
      "Insieme trasformano la ricerca di lavoro da compito solitario e frustrante a campagna strutturata, veloce e umana.",
    back: "← Torna alla home",
  },
  en: {
    title: "The Team",
    subtitle:
      "Behind Job Hunter Team there isn't a single assistant, but a team of specialized, autonomous AI agents. Each has one job, and does it well.",
    closing:
      "Together they turn the job hunt from a lonely, draining chore into a structured, fast and human campaign.",
    back: "← Back to home",
  },
  es: {
    title: "El Equipo",
    subtitle:
      "Detrás de Job Hunter Team no hay un solo asistente, sino un equipo de agentes de IA especializados. Cada uno tiene una tarea, y la hace bien.",
    closing:
      "Juntos transforman la búsqueda de empleo de una tarea solitaria y frustrante en una campaña estructurada, rápida y humana.",
    back: "← Volver al inicio",
  },
  fr: {
    title: "L'Équipe",
    subtitle:
      "Derrière Job Hunter Team, il n'y a pas un seul assistant, mais une équipe d'agents IA spécialisés. Chacun a une mission, et il l'accomplit bien.",
    closing:
      "Ensemble, ils transforment la recherche d'emploi d'une tâche solitaire et épuisante en une campagne structurée, rapide et humaine.",
    back: "← Retour à l'accueil",
  },
  de: {
    title: "Das Team",
    subtitle:
      "Hinter Job Hunter Team steht nicht ein einzelner Assistent, sondern ein Team spezialisierter KI-Agenten. Jeder hat eine Aufgabe und erledigt sie gut.",
    closing:
      "Gemeinsam verwandeln sie die Jobsuche von einer einsamen, zermürbenden Pflicht in eine strukturierte, schnelle und menschliche Kampagne.",
    back: "← Zurück zur Startseite",
  },
  pt: {
    title: "A Equipe",
    subtitle:
      "Por trás do Job Hunter Team não há um único assistente, mas uma equipe de agentes de IA especializados. Cada um tem uma tarefa, e a faz bem.",
    closing:
      "Juntos transformam a busca de emprego de uma tarefa solitária e frustrante em uma campanha estruturada, rápida e humana.",
    back: "← Voltar ao início",
  },
  hu: {
    title: "A Csapat",
    subtitle:
      "A Job Hunter Team mögött nem egyetlen asszisztens áll, hanem szakosodott MI-ügynökök csapata. Mindegyiknek egy feladata van, és azt jól végzi.",
    closing:
      "Együtt a magányos és frusztráló feladatból strukturált, gyors és emberi kampánnyá alakítják az álláskeresést.",
    back: "← Vissza a kezdőlapra",
  },
};

function TeamContent() {
  const { lang } = useLandingI18n();
  const L: Lang = (PAGE[lang as Lang] ? lang : "en") as Lang;
  const p = PAGE[L];

  return (
    <>
      <LandingNav />
      <main
        className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto"
        style={{ animation: "fade-in 0.4s ease both" }}
      >
        <div className="text-center mb-16">
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {p.title}
          </h1>
          <p className="text-[13px] md:text-[15px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">
            {p.subtitle}
          </p>
        </div>

        <div className="flex flex-col gap-20">
          {ROLES.map((role, i) => {
            const c = role[L];
            return (
              <section
                key={role.slug}
                className={`flex flex-col gap-6 md:gap-10 items-stretch ${
                  i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
                }`}
              >
                <div className="w-full md:w-1/2">
                  {role.img ? (
                    <div className="aspect-[4/3] flex items-center justify-center p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={role.img}
                        alt={c.title}
                        width={1448}
                        height={1086}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  ) : null}
                </div>
                <div className="w-full md:w-1/2 flex flex-col justify-center">
                  <h2 className="text-xl md:text-2xl font-bold text-[var(--color-white)] tracking-tight mb-4">
                    {c.title}
                  </h2>
                  <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed mb-3">
                    {c.p1}
                  </p>
                  <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed">
                    {c.p2}
                  </p>
                </div>
              </section>
            );
          })}
        </div>

        <p className="mt-20 text-[15px] md:text-[17px] text-[var(--color-white)] leading-snug font-medium max-w-3xl mx-auto text-center">
          {p.closing}
        </p>

        <div className="mt-12 flex justify-center">
          <Link
            href="/"
            className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
          >
            {p.back}
          </Link>
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

export default function TeamPage() {
  return (
    <LandingI18nProvider>
      <TeamContent />
    </LandingI18nProvider>
  );
}
