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
      p2: "Non improvvisa: legge i dati in tempo reale, ascolta gli avvisi della Sentinella sui consumi e bilancia di continuo velocità, budget e qualità. È il regista che trasforma i segnali in decisioni, senza mai bloccarsi.",
    },
    en: {
      title: "The Coordinator",
      p1: "The Coordinator coordinates the whole team. It reads every agent's signals, decides who works and at what pace, and keeps the search flowing — speeding up when the market is rich, easing off when needed.",
      p2: "It never improvises: it watches the data live, heeds the Sentinel's warnings on spending, and constantly balances speed, budget and quality. The director who turns signals into decisions.",
    },
    es: {
      title: "El Coordinador",
      p1: "El Coordinador coordina a todo el equipo. Lee las señales de cada agente, decide quién trabaja y a qué ritmo, y mantiene la búsqueda en marcha: acelera cuando el mercado ofrece mucho, afloja cuando hace falta.",
      p2: "Nunca improvisa: observa los datos en tiempo real, atiende los avisos del Centinela sobre el gasto y equilibra de forma constante velocidad, presupuesto y calidad. El director que convierte las señales en decisiones.",
    },
    fr: {
      title: "Le Coordinateur",
      p1: "Le Coordinateur coordonne toute l'équipe. Il lit les signaux de chaque agent, décide qui travaille et à quel rythme, et garde la recherche fluide : il accélère quand le marché est riche, ralentit quand il le faut.",
      p2: "Il n'improvise jamais : il surveille les données en temps réel, écoute les alertes de la Sentinelle sur les dépenses et équilibre sans cesse vitesse, budget et qualité. Le metteur en scène qui transforme les signaux en décisions.",
    },
    de: {
      title: "Der Koordinator",
      p1: "Der Koordinator koordiniert das gesamte Team. Er liest die Signale jedes Agenten, entscheidet, wer arbeitet und in welchem Tempo, und hält die Suche im Fluss — er beschleunigt, wenn der Markt viel bietet, und drosselt, wenn nötig.",
      p2: "Er improvisiert nie: Er beobachtet die Daten in Echtzeit, beachtet die Warnungen des Wächters zum Verbrauch und gleicht fortlaufend Geschwindigkeit, Budget und Qualität aus. Der Regisseur, der Signale in Entscheidungen verwandelt.",
    },
    pt: {
      title: "O Coordenador",
      p1: "O Coordenador coordena toda a equipe. Lê os sinais de cada agente, decide quem trabalha e em que ritmo, e mantém a busca fluida: acelera quando o mercado oferece muito, desacelera quando é preciso.",
      p2: "Nunca improvisa: acompanha os dados em tempo real, atende aos alertas da Sentinela sobre o consumo e equilibra continuamente velocidade, orçamento e qualidade. O diretor que transforma sinais em decisões.",
    },
    hu: {
      title: "A Koordinátor",
      p1: "A Koordinátor az egész csapatot összehangolja. Beolvassa minden ügynök jelzéseit, eldönti, ki dolgozik és milyen ütemben, és gördülékenyen tartja a keresést: gyorsít, amikor a piac bőséges, és lassít, amikor kell.",
      p2: "Soha nem improvizál: valós időben figyeli az adatokat, hallgat az Őrszem fogyasztásra vonatkozó figyelmeztetéseire, és folyamatosan egyensúlyozza a sebességet, a költségkeretet és a minőséget. A rendező, aki a jelzéseket döntésekké alakítja.",
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
    it: {
      title: "L'Analista",
      p1: "L'Analista è il verificatore freddo. Legge per intero ogni offerta, controlla che l'azienda sia reale e il link valido, ed estrae i dati che contano: anni richiesti, seniority, lingue, istruzione.",
      p2: "Scarta solo quando è certo (link morto, paese non lavorabile, lingua che non parli); tutto il resto passa avanti, anche se il match non è perfetto. Intanto costruisce lo schedario delle aziende — recensioni, bandiere rosse, cultura.",
    },
    en: {
      title: "The Analyst",
      p1: "The Analyst is the cold verifier. It reads each posting in full, checks the company is real and the link alive, and extracts what matters: years required, seniority, languages, education.",
      p2: "It discards only when sure; everything else moves on, even an imperfect match. Along the way it builds the company dossier — ratings, red flags, culture.",
    },
    es: {
      title: "El Analista",
      p1: "El Analista es el verificador frío. Lee por entero cada oferta, comprueba que la empresa sea real y el enlace válido, y extrae los datos que importan: años requeridos, seniority, idiomas, formación.",
      p2: "Descarta solo cuando está seguro (enlace muerto, país donde no puedes trabajar, idioma que no hablas); todo lo demás sigue adelante, aunque el encaje no sea perfecto. Mientras tanto construye el archivo de las empresas — reseñas, banderas rojas, cultura.",
    },
    fr: {
      title: "L'Analyste",
      p1: "L'Analyste est le vérificateur froid. Il lit chaque offre en entier, contrôle que l'entreprise est réelle et le lien valide, et extrait les données qui comptent : années requises, séniorité, langues, formation.",
      p2: "Il n'écarte que lorsqu'il est certain (lien mort, pays où tu ne peux pas travailler, langue que tu ne parles pas) ; tout le reste avance, même si la correspondance n'est pas parfaite. En chemin, il bâtit le dossier des entreprises — avis, signaux d'alerte, culture.",
    },
    de: {
      title: "Der Analyst",
      p1: "Der Analyst ist der nüchterne Prüfer. Er liest jede Anzeige vollständig, prüft, ob das Unternehmen echt und der Link gültig ist, und extrahiert, was zählt: geforderte Jahre, Seniorität, Sprachen, Ausbildung.",
      p2: "Er verwirft nur, wenn er sicher ist (toter Link, Land, in dem du nicht arbeiten darfst, Sprache, die du nicht sprichst); alles andere geht weiter, selbst bei unvollkommener Übereinstimmung. Dabei baut er das Unternehmensdossier auf — Bewertungen, Warnzeichen, Kultur.",
    },
    pt: {
      title: "O Analista",
      p1: "O Analista é o verificador frio. Lê cada oferta por inteiro, confere se a empresa é real e o link válido, e extrai os dados que importam: anos exigidos, senioridade, idiomas, formação.",
      p2: "Descarta apenas quando tem certeza (link morto, país onde você não pode trabalhar, idioma que você não fala); todo o resto segue adiante, mesmo que o encaixe não seja perfeito. Enquanto isso, constrói o arquivo das empresas — avaliações, bandeiras vermelhas, cultura.",
    },
    hu: {
      title: "Az Elemző",
      p1: "Az Elemző a hideg ellenőr. Minden hirdetést teljes egészében elolvas, ellenőrzi, hogy a cég valódi és a link él-e, és kinyeri, ami számít: szükséges évek, szenioritás, nyelvek, végzettség.",
      p2: "Csak akkor utasít el, ha biztos (halott link, ország, ahol nem dolgozhatsz, nyelv, amelyet nem beszélsz); minden más továbbhalad, még ha a találat nem is tökéletes. Közben felépíti a cégek dossziéját — értékelések, piros zászlók, kultúra.",
    },
  },
  {
    slug: "scorer",
    promptId: "team.scorer",
    it: {
      title: "Lo Scorer",
      p1: "Lo Scorer dà un voto a ogni offerta, da 0 a 100: quanto si adatta davvero al tuo profilo, alle competenze, alla seniority, al luogo che preferisci. Una formula che pesa tecnologia, esperienza, geografia e stipendio.",
      p2: "Tiene conto anche di te: se segnali «questa mi piace» il voto sale, se dici «mai» scende. Le offerte deboli si fermano qui; le migliori entrano nella lista pronta, in attesa che tu chieda il CV.",
    },
    en: {
      title: "The Scorer",
      p1: "The Scorer rates every opening from 0 to 100: how well it truly fits your profile, skills, seniority and preferred location — weighing technology, experience, geography and pay.",
      p2: "It listens to you too: mark one “I like this” and its score rises, “never” and it falls. Weak ones stop here; the best join the ready list, waiting for you to ask for a CV.",
    },
    es: {
      title: "El Scorer",
      p1: "El Scorer da una nota a cada oferta, de 0 a 100: cuánto encaja de verdad con tu perfil, tus competencias, tu seniority y el lugar que prefieres. Una fórmula que pondera tecnología, experiencia, geografía y salario.",
      p2: "También te tiene en cuenta: si marcas «esta me gusta» la nota sube, si dices «nunca» baja. Las ofertas débiles se detienen aquí; las mejores entran en la lista lista para usar, a la espera de que pidas el CV.",
    },
    fr: {
      title: "L'Évaluateur",
      p1: "L'Évaluateur attribue une note à chaque offre, de 0 à 100 : à quel point elle correspond vraiment à ton profil, à tes compétences, à ta séniorité, au lieu que tu préfères. Une formule qui pèse technologie, expérience, géographie et salaire.",
      p2: "Il tient compte de toi aussi : si tu signales « celle-ci me plaît » la note monte, si tu dis « jamais » elle baisse. Les offres faibles s'arrêtent ici ; les meilleures entrent dans la liste prête, en attendant que tu demandes le CV.",
    },
    de: {
      title: "Der Bewerter",
      p1: "Der Bewerter vergibt jeder Stelle eine Note von 0 bis 100: wie gut sie wirklich zu deinem Profil, deinen Fähigkeiten, deiner Seniorität und deinem bevorzugten Ort passt. Eine Formel, die Technologie, Erfahrung, Geografie und Gehalt gewichtet.",
      p2: "Er berücksichtigt auch dich: Markierst du eine mit „die gefällt mir“, steigt die Note, sagst du „nie“, sinkt sie. Schwache Stellen enden hier; die besten kommen auf die fertige Liste und warten darauf, dass du einen Lebenslauf anforderst.",
    },
    pt: {
      title: "O Scorer",
      p1: "O Scorer dá uma nota a cada oferta, de 0 a 100: o quanto ela realmente se encaixa no seu perfil, nas competências, na senioridade e no lugar que você prefere. Uma fórmula que pondera tecnologia, experiência, geografia e salário.",
      p2: "Ele também leva você em conta: se marcar «esta eu gosto» a nota sobe, se disser «nunca» ela desce. As ofertas fracas param aqui; as melhores entram na lista pronta, à espera de que você peça o CV.",
    },
    hu: {
      title: "A Pontozó",
      p1: "A Pontozó minden ajánlatot 0-tól 100-ig osztályoz: mennyire illik valóban a profilodhoz, a készségeidhez, a szenioritásodhoz és az általad preferált helyhez. Egy képlet, amely súlyozza a technológiát, a tapasztalatot, a földrajzot és a fizetést.",
      p2: "Téged is figyelembe vesz: ha jelzed, hogy „ez tetszik”, a pontszám emelkedik, ha azt mondod, „soha”, csökken. A gyenge ajánlatok itt megállnak; a legjobbak bekerülnek a kész listába, és arra várnak, hogy önéletrajzot kérj.",
    },
  },
  {
    slug: "scrittore",
    promptId: "team.scrittore",
    it: {
      title: "Lo Scrittore",
      p1: "Lo Scrittore è l'artigiano del CV. Non scrive per tutte le offerte: aspetta che tu clicchi «Scrivi CV» per una posizione precisa, poi costruisce un curriculum su misura della descrizione e dei tuoi obiettivi.",
      p2: "Niente testi generici: ogni frase è pensata, ogni competenza messa nel contesto giusto. Finita la bozza la passa al Critico per più giri di revisione, finché non è davvero pronta da inviare.",
    },
    en: {
      title: "The Writer",
      p1: "The Writer is the CV craftsman. It doesn't write for every opening: it waits for you to click “Write CV” on a specific role, then builds a résumé tailored to the posting and your goals.",
      p2: "Nothing generic — every line is deliberate, every skill placed in context. It hands the draft to the Critic for several review rounds, until it's truly ready to send.",
    },
    es: {
      title: "El Redactor",
      p1: "El Redactor es el artesano del CV. No escribe para todas las ofertas: espera a que pulses «Escribir CV» para una posición concreta, y entonces construye un currículum a medida de la descripción y de tus objetivos.",
      p2: "Nada de textos genéricos: cada frase está pensada, cada competencia colocada en el contexto adecuado. Terminado el borrador, lo pasa al Crítico para varias rondas de revisión, hasta que esté de verdad listo para enviar.",
    },
    fr: {
      title: "Le Rédacteur",
      p1: "Le Rédacteur est l'artisan du CV. Il n'écrit pas pour chaque offre : il attend que tu cliques sur « Rédiger le CV » pour un poste précis, puis construit un curriculum taillé sur la description et tes objectifs.",
      p2: "Rien de générique : chaque phrase est pensée, chaque compétence placée dans le bon contexte. Une fois le brouillon terminé, il le passe au Critique pour plusieurs tours de révision, jusqu'à ce qu'il soit vraiment prêt à envoyer.",
    },
    de: {
      title: "Der Verfasser",
      p1: "Der Verfasser ist der Handwerker des Lebenslaufs. Er schreibt nicht für jede Stelle: Er wartet, bis du bei einer bestimmten Position auf „Lebenslauf schreiben“ klickst, und baut dann einen Lebenslauf, der auf die Ausschreibung und deine Ziele zugeschnitten ist.",
      p2: "Nichts Generisches — jeder Satz ist bewusst gewählt, jede Fähigkeit in den richtigen Kontext gesetzt. Den Entwurf übergibt er dem Kritiker für mehrere Überarbeitungsrunden, bis er wirklich versandbereit ist.",
    },
    pt: {
      title: "O Redator",
      p1: "O Redator é o artesão do CV. Não escreve para todas as ofertas: espera que você clique em «Escrever CV» para uma posição específica, e então constrói um currículo sob medida para a descrição e os seus objetivos.",
      p2: "Nada de textos genéricos: cada frase é pensada, cada competência colocada no contexto certo. Terminado o rascunho, passa-o ao Crítico para várias rodadas de revisão, até estar de fato pronto para enviar.",
    },
    hu: {
      title: "Az Író",
      p1: "Az Író az önéletrajz mestere. Nem ír minden ajánlathoz: megvárja, amíg egy adott pozíciónál az „Önéletrajz írása” gombra kattintasz, majd a hirdetésre és a céljaidra szabott önéletrajzot készít.",
      p2: "Semmi sablonos: minden mondat átgondolt, minden készség a megfelelő kontextusba helyezve. A piszkozatot átadja a Kritikusnak több körös felülvizsgálatra, amíg valóban kész nem lesz a küldésre.",
    },
  },
  {
    slug: "critico",
    promptId: "team.critico",
    it: {
      title: "Il Critico",
      p1: "Il Critico è un veterano del recruiting, e lavora alla cieca: vede solo il CV e l'offerta, nulla del tuo profilo o della tua storia. Lo legge come lo leggerebbe un selezionatore vero, per la prima volta.",
      p2: "Dà un voto da 1 a 10, elenca pregi, lacune e bandiere rosse, e confronta riga per riga ciò che il CV promette con ciò che l'offerta chiede. Diretto, misurato, senza complimenti gratuiti: è il controllo qualità.",
    },
    en: {
      title: "The Critic",
      p1: "The Critic is a recruiting veteran, working blind: it sees only the CV and the job, nothing of your profile or history. It reads it as a real recruiter would, for the first time.",
      p2: "It scores from 1 to 10, lists strengths, gaps and red flags, and compares line by line what the CV promises against what the job demands. Direct, measured, no free compliments.",
    },
    es: {
      title: "El Crítico",
      p1: "El Crítico es un veterano del reclutamiento y trabaja a ciegas: solo ve el CV y la oferta, nada de tu perfil ni de tu historia. Lo lee como lo leería un selector de verdad, por primera vez.",
      p2: "Da una nota de 1 a 10, enumera virtudes, lagunas y banderas rojas, y compara línea por línea lo que el CV promete con lo que la oferta pide. Directo, mesurado, sin cumplidos gratuitos: es el control de calidad.",
    },
    fr: {
      title: "Le Critique",
      p1: "Le Critique est un vétéran du recrutement, et il travaille à l'aveugle : il ne voit que le CV et l'offre, rien de ton profil ni de ton histoire. Il le lit comme le ferait un vrai recruteur, pour la première fois.",
      p2: "Il donne une note de 1 à 10, énumère les atouts, les lacunes et les signaux d'alerte, et compare ligne par ligne ce que le CV promet à ce que l'offre exige. Direct, mesuré, sans compliments gratuits : c'est le contrôle qualité.",
    },
    de: {
      title: "Der Kritiker",
      p1: "Der Kritiker ist ein Veteran des Recruitings und arbeitet blind: Er sieht nur den Lebenslauf und die Stelle, nichts von deinem Profil oder deiner Geschichte. Er liest ihn, wie es ein echter Personaler täte, zum ersten Mal.",
      p2: "Er vergibt eine Note von 1 bis 10, listet Stärken, Lücken und Warnzeichen auf und vergleicht Zeile für Zeile, was der Lebenslauf verspricht, mit dem, was die Stelle verlangt. Direkt, abgewogen, ohne Gefälligkeiten: die Qualitätskontrolle.",
    },
    pt: {
      title: "O Crítico",
      p1: "O Crítico é um veterano do recrutamento, e trabalha às cegas: vê apenas o CV e a oferta, nada do seu perfil ou da sua história. Lê-o como o leria um recrutador de verdade, pela primeira vez.",
      p2: "Dá uma nota de 1 a 10, enumera virtudes, lacunas e bandeiras vermelhas, e compara linha por linha o que o CV promete com o que a oferta exige. Direto, comedido, sem elogios gratuitos: é o controle de qualidade.",
    },
    hu: {
      title: "A Kritikus",
      p1: "A Kritikus a toborzás veteránja, és vakon dolgozik: csak az önéletrajzot és az állást látja, semmit a profilodból vagy a történetedből. Úgy olvassa, ahogy egy valódi toborzó tenné, először.",
      p2: "1-től 10-ig pontoz, felsorolja az erősségeket, a hiányosságokat és a piros zászlókat, és sorról sorra összeveti, amit az önéletrajz ígér, azzal, amit az állás megkövetel. Egyenes, mértéktartó, ingyen bókok nélkül: ez a minőség-ellenőrzés.",
    },
  },
  {
    slug: "sentinella",
    promptId: "team.sentinella",
    it: {
      title: "La Sentinella",
      p1: "La Sentinella sorveglia i consumi. Legge in tempo reale quanta energia brucia la squadra, nella finestra breve e nella riserva della settimana, e interviene quando si va troppo veloci.",
      p2: "Parla poco e solo quando serve: niente opinioni, solo numeri precisi e un ordine al Coordinatore — quanto rallentare e da quando. È la disciplina che impedisce al sistema di esaurirsi per troppo entusiasmo.",
    },
    en: {
      title: "The Sentinel",
      p1: "The Sentinel watches the spend. It reads how fast the team burns energy — in the short window and the weekly reserve — and steps in when it runs too hot.",
      p2: "It speaks rarely and only when needed: no opinions, just precise numbers and one order to the Coordinator — how much to slow down, and from when. The discipline that keeps the system from burning out.",
    },
    es: {
      title: "El Centinela",
      p1: "El Centinela vigila el consumo. Lee en tiempo real cuánta energía quema el equipo, en la ventana corta y en la reserva de la semana, e interviene cuando se va demasiado rápido.",
      p2: "Habla poco y solo cuando hace falta: sin opiniones, solo números precisos y una orden al Coordinador — cuánto frenar y desde cuándo. Es la disciplina que impide al sistema agotarse por exceso de entusiasmo.",
    },
    fr: {
      title: "La Sentinelle",
      p1: "La Sentinelle surveille les dépenses. Elle lit en temps réel combien d'énergie l'équipe consomme, dans la fenêtre courte et dans la réserve de la semaine, et intervient quand on va trop vite.",
      p2: "Elle parle peu et seulement quand il le faut : pas d'opinions, juste des chiffres précis et un ordre au Coordinateur — de combien ralentir et à partir de quand. C'est la discipline qui empêche le système de s'épuiser par excès d'enthousiasme.",
    },
    de: {
      title: "Der Wächter",
      p1: "Der Wächter überwacht den Verbrauch. Er liest in Echtzeit, wie viel Energie das Team verbraucht — im kurzen Fenster und in der Wochenreserve — und greift ein, wenn es zu schnell läuft.",
      p2: "Er spricht selten und nur, wenn nötig: keine Meinungen, nur präzise Zahlen und einen Befehl an den Koordinator — wie sehr zu drosseln ist und ab wann. Die Disziplin, die das System davor bewahrt, sich an zu viel Eifer zu erschöpfen.",
    },
    pt: {
      title: "A Sentinela",
      p1: "A Sentinela vigia o consumo. Lê em tempo real quanta energia a equipe queima, na janela curta e na reserva da semana, e intervém quando se vai rápido demais.",
      p2: "Fala pouco e só quando é preciso: sem opiniões, apenas números precisos e uma ordem ao Coordenador — quanto desacelerar e a partir de quando. É a disciplina que impede o sistema de se esgotar por excesso de entusiasmo.",
    },
    hu: {
      title: "Az Őrszem",
      p1: "Az Őrszem a fogyasztást figyeli. Valós időben olvassa, mennyi energiát éget el a csapat, a rövid ablakban és a heti tartalékban, és közbelép, amikor túl gyorsan halad.",
      p2: "Keveset beszél, és csak amikor kell: nincs vélemény, csak pontos számok és egyetlen utasítás a Koordinátornak — mennyit kell lassítani, és mikortól. Ez a fegyelem, amely megóvja a rendszert attól, hogy a túlzott lelkesedéstől kimerüljön.",
    },
  },
  {
    slug: "dottore",
    promptId: "team.dottore",
    it: {
      title: "Il Dottore",
      p1: "Il Dottore fa il giro ogni mezz'ora e chiede a ogni agente «come stai?». Se ne trova uno bloccato o addormentato, lo rimette in piedi in pochi secondi, con tutto il contesto, senza perdere lavoro.",
      p2: "Una volta al giorno rinfresca la memoria all'intera squadra; ogni settimana fa le pulizie — libera la cache, controlla gli strumenti, rimuove ciò che è scaduto. Salute e manutenzione, non strategia.",
    },
    en: {
      title: "The Doctor",
      p1: "The Doctor does the rounds every half hour, asking each agent “how are you?”. If one is stuck or asleep, it revives it in seconds, with full context, losing no work.",
      p2: "Once a day it refreshes the whole team's memory; each week it cleans house — clearing caches, auditing tools, removing what's expired. Health and upkeep, not strategy.",
    },
    es: {
      title: "El Doctor",
      p1: "El Doctor hace la ronda cada media hora y pregunta a cada agente «¿cómo estás?». Si encuentra a uno bloqueado o dormido, lo pone en pie en pocos segundos, con todo el contexto, sin perder trabajo.",
      p2: "Una vez al día refresca la memoria de todo el equipo; cada semana hace la limpieza — libera la caché, revisa las herramientas, elimina lo que ha caducado. Salud y mantenimiento, no estrategia.",
    },
    fr: {
      title: "Le Docteur",
      p1: "Le Docteur fait la ronde toutes les demi-heures et demande à chaque agent « comment vas-tu ? ». S'il en trouve un bloqué ou endormi, il le remet sur pied en quelques secondes, avec tout le contexte, sans perdre de travail.",
      p2: "Une fois par jour, il rafraîchit la mémoire de toute l'équipe ; chaque semaine, il fait le ménage — il vide le cache, contrôle les outils, retire ce qui a expiré. Santé et entretien, pas stratégie.",
    },
    de: {
      title: "Der Doktor",
      p1: "Der Doktor macht alle halbe Stunde die Runde und fragt jeden Agenten „wie geht es dir?“. Findet er einen blockiert oder eingeschlafen vor, bringt er ihn in Sekunden wieder auf die Beine, mit vollem Kontext, ohne Arbeit zu verlieren.",
      p2: "Einmal am Tag frischt er das Gedächtnis des gesamten Teams auf; jede Woche macht er sauber — er leert den Cache, prüft die Werkzeuge, entfernt Abgelaufenes. Gesundheit und Wartung, nicht Strategie.",
    },
    pt: {
      title: "O Doutor",
      p1: "O Doutor faz a ronda a cada meia hora e pergunta a cada agente «como você está?». Se encontra um bloqueado ou adormecido, coloca-o de pé em poucos segundos, com todo o contexto, sem perder trabalho.",
      p2: "Uma vez por dia refresca a memória de toda a equipe; a cada semana faz a limpeza — libera o cache, verifica as ferramentas, remove o que expirou. Saúde e manutenção, não estratégia.",
    },
    hu: {
      title: "A Doktor",
      p1: "A Doktor félóránként körbejár, és megkérdezi minden ügynöktől: „hogy vagy?”. Ha valamelyiket elakadva vagy alva találja, másodpercek alatt talpra állítja, teljes kontextussal, munka elvesztése nélkül.",
      p2: "Naponta egyszer felfrissíti az egész csapat memóriáját; hetente nagytakarítást tart — kiüríti a gyorsítótárat, ellenőrzi az eszközöket, eltávolítja, ami lejárt. Egészség és karbantartás, nem stratégia.",
    },
  },
  {
    slug: "mentor",
    promptId: "team.mentor",
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
      "Dietro Job Hunter Team non c'è un solo assistente, ma una squadra di agenti AI specializzati. Ognuno ha un compito, e lo fa bene.",
    closing:
      "Insieme trasformano la ricerca di lavoro da compito solitario e frustrante a campagna strutturata, veloce e umana.",
    back: "← Torna alla home",
  },
  en: {
    title: "The Team",
    subtitle:
      "Behind Job Hunter Team there isn't a single assistant, but a team of specialized AI agents. Each has one job, and does it well.",
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
