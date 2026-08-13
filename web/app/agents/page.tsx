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
      title: "Lo Scout",
      p1: "Lo Scout è il segugio che perlustra il web in cerca di offerte: job board, pagine carriere, LinkedIn, canali dei recruiter. Ogni posizione che trova entra nel sistema, pronta per essere verificata.",
      p2: "È un setaccio generoso, pensato per la quantità: cattura tutto ciò che può essere interessante e lascia il giudizio all'Analista. Impara dove cercare e affina la rotta in base ai suoi riscontri.",
    },
    en: {
      title: "The Scout",
      p1: "The Scout is the hound that scours the web for openings — job boards, career pages, LinkedIn, recruiter channels. Everything it finds enters the system, ready to be vetted.",
      p2: "A generous sieve built for volume: it catches anything that might fit and leaves the judgment to the Analyst. It learns where to look and sharpens its course based on that feedback.",
    },
    es: {
      title: "El Scout",
      p1: "El Scout es el sabueso que rastrea la web en busca de ofertas: portales de empleo, páginas de carreras, LinkedIn, canales de los reclutadores. Cada posición que encuentra entra en el sistema, lista para ser verificada.",
      p2: "Es un tamiz generoso, pensado para la cantidad: captura todo lo que pueda interesar y deja el juicio al Analista. Aprende dónde buscar y afina el rumbo según sus respuestas.",
    },
    fr: {
      title: "Le Scout",
      p1: "Le Scout est le limier qui parcourt le web à la recherche d'offres : sites d'emploi, pages carrières, LinkedIn, canaux des recruteurs. Chaque poste qu'il trouve entre dans le système, prêt à être vérifié.",
      p2: "Un tamis généreux, pensé pour le volume : il capte tout ce qui pourrait convenir et laisse le jugement à l'Analyste. Il apprend où chercher et affine sa trajectoire selon ses retours.",
    },
    de: {
      title: "Der Scout",
      p1: "Der Scout ist der Spürhund, der das Web nach Stellen durchkämmt — Jobbörsen, Karriereseiten, LinkedIn, Recruiter-Kanäle. Jede Position, die er findet, gelangt ins System, bereit zur Prüfung.",
      p2: "Ein großzügiges Sieb, auf Menge ausgelegt: Er fängt alles ein, was passen könnte, und überlässt das Urteil dem Analysten. Er lernt, wo er suchen muss, und verfeinert seinen Kurs anhand von dessen Rückmeldungen.",
    },
    pt: {
      title: "O Scout",
      p1: "O Scout é o sabujo que vasculha a web em busca de vagas: portais de emprego, páginas de carreiras, LinkedIn, canais dos recrutadores. Cada posição que encontra entra no sistema, pronta para ser verificada.",
      p2: "É uma peneira generosa, pensada para a quantidade: captura tudo o que possa interessar e deixa o julgamento ao Analista. Aprende onde procurar e ajusta o rumo conforme o retorno dele.",
    },
    hu: {
      title: "A Felderítő",
      p1: "A Felderítő az a kopó, aki a webet fésüli át álláshirdetésekért: állásportálok, karrieroldalak, LinkedIn, toborzói csatornák. Minden pozíció, amit megtalál, bekerül a rendszerbe, készen az ellenőrzésre.",
      p2: "Bőkezű szita, mennyiségre tervezve: elkap mindent, ami érdekes lehet, és az ítéletet az Elemzőre bízza. Megtanulja, hol keressen, és annak visszajelzései alapján finomítja az irányt.",
    },
  },
  {
    slug: "analista",
    promptId: "team.analista",
    img: "/agents-analyst.png",
    it: {
      title: "L'Analista",
      p1: "L'Analista è chi verifica e approfondisce le posizioni trovate dallo Scout. Prende ogni offerta ancora grezza, controlla che sia valida e ne estrae i dati che contano, trasformandola in una scheda completa e affidabile.",
      p2: "Non si ferma a ciò che c'è scritto nell'annuncio: indaga sul web le informazioni che mancano — a partire dallo stipendio probabile — e aggiunge a ogni posizione il contesto utile a giudicarla. Così, quando tocca allo Scorer, non resta altro da cercare: bastano il tuo profilo e i dati raccolti per dare un voto.",
    },
    en: {
      title: "The Analyst",
      p1: "The Analyst is the one who verifies and deepens the positions the Scout found. It takes each still-raw opening, checks that it's valid and pulls out the data that matters, turning it into a complete, reliable profile.",
      p2: "It doesn't stop at what the ad says: it researches the missing pieces online — starting with the likely salary — and adds to every position the context needed to judge it. So when it's the Scorer's turn, there's nothing left to look up: your profile and the gathered data are enough to give a score.",
    },
    es: {
      title: "El Analista",
      p1: "El Analista es quien verifica y profundiza las posiciones que encontró el Scout. Toma cada oferta aún en bruto, comprueba que sea válida y extrae los datos que importan, convirtiéndola en una ficha completa y fiable.",
      p2: "No se queda con lo que dice el anuncio: investiga en la web lo que falta —empezando por el salario probable— y añade a cada posición el contexto necesario para juzgarla. Así, cuando le toca al Scorer, no queda nada por buscar: bastan tu perfil y los datos reunidos para dar una nota.",
    },
    fr: {
      title: "L'Analyste",
      p1: "L'Analyste est celui qui vérifie et approfondit les positions trouvées par le Scout. Il prend chaque offre encore brute, s'assure qu'elle est valide et en extrait les données qui comptent, la transformant en une fiche complète et fiable.",
      p2: "Il ne s'arrête pas à ce que dit l'annonce : il recherche sur le web ce qui manque — à commencer par le salaire probable — et ajoute à chaque position le contexte utile pour la juger. Ainsi, quand vient le tour de l'Évaluateur, il n'y a plus rien à chercher : ton profil et les données réunies suffisent à donner une note.",
    },
    de: {
      title: "Der Analyst",
      p1: "Der Analyst ist derjenige, der die vom Scout gefundenen Stellen prüft und vertieft. Er nimmt jede noch rohe Anzeige, stellt sicher, dass sie gültig ist, und zieht die Daten heraus, die zählen — und macht daraus ein vollständiges, verlässliches Profil.",
      p2: "Er bleibt nicht bei dem, was in der Anzeige steht: Er recherchiert im Web, was fehlt — angefangen beim wahrscheinlichen Gehalt — und ergänzt jede Stelle um den Kontext, der zur Beurteilung nötig ist. Wenn dann der Bewerter an der Reihe ist, gibt es nichts mehr nachzuschlagen: Dein Profil und die gesammelten Daten genügen, um eine Note zu vergeben.",
    },
    pt: {
      title: "O Analista",
      p1: "O Analista é quem verifica e aprofunda as posições encontradas pelo Scout. Pega cada oferta ainda bruta, confere que seja válida e extrai os dados que importam, transformando-a numa ficha completa e confiável.",
      p2: "Não fica no que diz o anúncio: pesquisa na web o que falta — a começar pelo salário provável — e acrescenta a cada posição o contexto necessário para julgá-la. Assim, quando chega a vez do Scorer, não resta nada a procurar: bastam o seu perfil e os dados reunidos para dar uma nota.",
    },
    hu: {
      title: "Az Elemző",
      p1: "Az Elemző az, aki ellenőrzi és elmélyíti a Felderítő által talált pozíciókat. Fogja az egyes, még nyers hirdetéseket, meggyőződik róla, hogy érvényesek, és kiszedi a fontos adatokat, teljes és megbízható adatlappá alakítva őket.",
      p2: "Nem áll meg annál, ami a hirdetésben szerepel: a hiányzó információknak — kezdve a valószínű fizetéssel — utánanéz a weben, és minden pozícióhoz hozzáadja a megítéléséhez szükséges kontextust. Így mire a Pontozóra kerül a sor, nincs már mit keresni: elég összevetnie az adatokat a profiloddal, és megszülethet a pontszám.",
    },
  },
  {
    slug: "scorer",
    promptId: "team.scorer",
    img: "/agents-scorer.png",
    it: {
      title: "Lo Scorer",
      p1: "Lo Scorer dà a ogni offerta un voto da 0 a 100: quanto si avvicina davvero a ciò che cerchi. Non guarda solo profilo, competenze, luogo e stipendio, ma anche i tuoi obiettivi e le tue ambizioni — il lavoro che vorresti davvero. Il suo compito è trovare, tra tutte, le posizioni più vicine a quello che desideri.",
      p2: "Impara dai tuoi riscontri: «questa mi piace» o «questa mai» diventano preferenze per le offerte che valuterà in futuro. Il riscontro non cambia il punteggio già assegnato all'offerta votata; per aggiornarlo serve una rivalutazione esplicita.",
    },
    en: {
      title: "The Scorer",
      p1: "The Scorer gives every opening a score from 0 to 100: how close it really is to what you're after. It weighs not just your profile, skills, location and salary, but also your goals and ambitions — the job you'd truly want. Its task is to find, among them all, the positions closest to what you're looking for.",
      p2: "It learns from your feedback: “I like this” or “never” becomes preference context for openings it evaluates in the future. Feedback never changes the score already assigned to the opening you voted on; updating it requires an explicit re-evaluation.",
    },
    es: {
      title: "El Scorer",
      p1: "El Scorer da a cada oferta una nota de 0 a 100: cuánto se acerca de verdad a lo que buscas. No mira solo tu perfil, tus competencias, el lugar y el salario, sino también tus objetivos y tus ambiciones — el trabajo que de verdad querrías. Su tarea es encontrar, entre todas, las posiciones más cercanas a lo que deseas.",
      p2: "Aprende de tus valoraciones: «esta me gusta» o «esta nunca» se convierte en contexto de preferencia para las ofertas que evaluará en el futuro. La valoración nunca cambia la nota ya asignada a la oferta votada; actualizarla requiere una reevaluación explícita.",
    },
    fr: {
      title: "L'Évaluateur",
      p1: "L'Évaluateur attribue à chaque offre une note de 0 à 100 : à quel point elle se rapproche vraiment de ce que tu cherches. Il ne regarde pas seulement ton profil, tes compétences, le lieu et le salaire, mais aussi tes objectifs et tes ambitions — le travail que tu voudrais vraiment. Sa tâche est de trouver, parmi toutes, les positions les plus proches de ce que tu désires.",
      p2: "Il apprend de tes retours : « celle-ci me plaît » ou « jamais » devient un contexte de préférence pour les offres qu'il évaluera à l'avenir. Le retour ne change jamais la note déjà attribuée à l'offre jugée ; sa mise à jour exige une réévaluation explicite.",
    },
    de: {
      title: "Der Bewerter",
      p1: "Der Bewerter gibt jeder Stelle eine Note von 0 bis 100: wie nah sie wirklich an dem ist, was du suchst. Er betrachtet nicht nur dein Profil, deine Fähigkeiten, den Ort und das Gehalt, sondern auch deine Ziele und Ambitionen — den Job, den du dir wirklich wünschst. Seine Aufgabe ist es, unter allen die Stellen zu finden, die dem am nächsten kommen, was du willst.",
      p2: "Er lernt aus deinen Rückmeldungen: „die gefällt mir“ oder „nie“ wird zum Präferenzkontext für Stellen, die er künftig bewertet. Die Rückmeldung ändert niemals die bereits vergebene Note der bewerteten Stelle; dafür ist eine ausdrückliche Neubewertung nötig.",
    },
    pt: {
      title: "O Scorer",
      p1: "O Scorer dá a cada oferta uma nota de 0 a 100: o quanto ela realmente se aproxima do que você procura. Não olha só o seu perfil, as competências, o lugar e o salário, mas também os seus objetivos e ambições — o trabalho que você realmente gostaria. A sua tarefa é encontrar, entre todas, as posições mais próximas do que você deseja.",
      p2: "Aprende com os seus retornos: «esta eu gosto» ou «esta nunca» torna-se contexto de preferência para as ofertas que avaliará no futuro. O retorno nunca altera a nota já atribuída à oferta avaliada; para a atualizar é necessária uma reavaliação explícita.",
    },
    hu: {
      title: "A Pontozó",
      p1: "A Pontozó minden ajánlatnak 0-tól 100-ig ad pontszámot: mennyire áll közel valójában ahhoz, amit keresel. Nemcsak a profilodat, a készségeidet, a helyet és a fizetést nézi, hanem a céljaidat és az ambícióidat is — azt a munkát, amelyet igazán szeretnél. A feladata, hogy mind közül megtalálja azokat a pozíciókat, amelyek a legközelebb állnak ahhoz, amit szeretnél.",
      p2: "Tanul a visszajelzéseidből: az „ez tetszik” vagy „soha” preferenciakontextussá válik a jövőben értékelt pozíciókhoz. A visszajelzés soha nem módosítja a már értékelt ajánlat pontszámát; ehhez kifejezett újraértékelés kell.",
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
      p1: "Il Dottore veglia sulla salute degli agenti. Più volte al giorno fa il giro della squadra: chi lavora da ore si stanca e inizia a rallentare o a perdere il filo, e lui lo rimette in sesto.",
      p2: "È selettivo: interviene solo su chi ne ha davvero bisogno. A ogni giro annota un breve resoconto, e si occupa della lucidità della squadra.",
    },
    en: {
      title: "The Doctor",
      p1: "The Doctor looks after the agents' health. A few times a day it does a round of the team: those that have worked for hours get tired and start to slow down or lose the thread, so it gets them back in shape.",
      p2: "It's selective: it steps in only where it's truly needed. Each round it notes a short recap, and it tends to the team's clarity.",
    },
    es: {
      title: "El Doctor",
      p1: "El Doctor cuida la salud de los agentes. Varias veces al día hace la ronda del equipo: quien lleva horas trabajando se cansa y empieza a ralentizarse o a perder el hilo, y él lo pone a punto.",
      p2: "Es selectivo: interviene solo donde de verdad hace falta. En cada ronda anota un breve resumen, y se ocupa de la lucidez del equipo.",
    },
    fr: {
      title: "Le Docteur",
      p1: "Le Docteur veille sur la santé des agents. Plusieurs fois par jour, il fait la ronde de l'équipe : ceux qui travaillent depuis des heures se fatiguent et commencent à ralentir ou à perdre le fil, alors il les remet d'aplomb.",
      p2: "Il est sélectif : il n'intervient que là où c'est vraiment nécessaire. À chaque ronde, il note un bref compte rendu, et il veille à la lucidité de l'équipe.",
    },
    de: {
      title: "Der Doktor",
      p1: "Der Doktor wacht über die Gesundheit der Agenten. Mehrmals am Tag macht er die Runde durchs Team: Wer seit Stunden arbeitet, ermüdet und wird langsamer oder verliert den Faden, also bringt er ihn wieder in Form.",
      p2: "Er geht selektiv vor: Er greift nur dort ein, wo es wirklich nötig ist. Nach jeder Runde hält er eine kurze Zusammenfassung fest und sorgt für die Klarheit des Teams.",
    },
    pt: {
      title: "O Doutor",
      p1: "O Doutor cuida da saúde dos agentes. Várias vezes ao dia faz a ronda da equipe: quem trabalha há horas se cansa e começa a ficar lento ou a perder o fio, e ele o recoloca em forma.",
      p2: "É seletivo: intervém só onde é realmente preciso. A cada ronda anota um breve resumo, e cuida da lucidez da equipe.",
    },
    hu: {
      title: "A Doktor",
      p1: "A Doktor az ügynökök egészségére ügyel. Naponta többször körbejárja a csapatot: aki órák óta dolgozik, elfárad, és lassulni kezd vagy elveszti a fonalat, ő pedig rendbe hozza.",
      p2: "Válogatós: csak ott lép közbe, ahol valóban szükség van rá. Minden körben rövid összefoglalót készít, és a csapat tisztánlátására ügyel.",
    },
  },
  {
    slug: "mantenitore",
    promptId: "team.mantenitore",
    img: "/agents-maintainer.png",
    it: {
      title: "Il Mantenitore",
      p1: "Il Mantenitore cura l'infrastruttura del team. Una volta al giorno fa un giro di controllo: verifica che il contenitore su cui gira il team sia in buona salute, che tutti gli strumenti siano a posto e che non si sia accumulato disordine — spazio che si riempie, file di troppo.",
      p2: "Ripara ciò che può — reinstalla, consolida, sistema — e propone al Coordinatore le pulizie più delicate, senza mai cancellare di testa sua. Uno strumento rotto, per lui, è un'emergenza.",
    },
    en: {
      title: "The Maintainer",
      p1: "The Maintainer looks after the team's infrastructure. Once a day it does a check-up round: it makes sure the container the team runs on is healthy, that every tool is in order and that no clutter has built up — space filling up, stray files.",
      p2: "It repairs what it can — reinstalling, consolidating, tidying up — and proposes the more delicate clean-ups to the Coordinator, never deleting on its own. A broken tool, to it, is an emergency.",
    },
    es: {
      title: "El Mantenedor",
      p1: "El Mantenedor cuida la infraestructura del equipo. Una vez al día hace una ronda de control: comprueba que el contenedor en el que corre el equipo esté sano, que todas las herramientas estén en orden y que no se haya acumulado desorden — espacio que se llena, archivos de más.",
      p2: "Repara lo que puede — reinstala, consolida, ordena — y propone al Coordinador las limpiezas más delicadas, sin borrar nunca por su cuenta. Una herramienta rota, para él, es una emergencia.",
    },
    fr: {
      title: "Le Mainteneur",
      p1: "Le Mainteneur s'occupe de l'infrastructure de l'équipe. Une fois par jour, il fait une ronde de contrôle : il vérifie que le conteneur sur lequel tourne l'équipe est en bonne santé, que tous les outils sont en ordre et qu'aucun désordre ne s'est accumulé — espace qui se remplit, fichiers en trop.",
      p2: "Il répare ce qu'il peut — réinstalle, consolide, range — et propose au Coordinateur les nettoyages les plus délicats, sans jamais supprimer de lui-même. Un outil cassé, pour lui, est une urgence.",
    },
    de: {
      title: "Der Instandhalter",
      p1: "Der Instandhalter kümmert sich um die Infrastruktur des Teams. Einmal am Tag macht er eine Kontrollrunde: Er stellt sicher, dass der Container, auf dem das Team läuft, gesund ist, dass alle Werkzeuge in Ordnung sind und dass sich keine Unordnung angesammelt hat — Speicher, der sich füllt, überflüssige Dateien.",
      p2: "Er repariert, was er kann — neu installieren, konsolidieren, aufräumen — und schlägt dem Koordinator die heikleren Aufräumarbeiten vor, ohne je eigenmächtig zu löschen. Ein kaputtes Werkzeug ist für ihn ein Notfall.",
    },
    pt: {
      title: "O Mantenedor",
      p1: "O Mantenedor cuida da infraestrutura da equipe. Uma vez por dia faz uma ronda de controle: verifica se o contêiner em que a equipe roda está saudável, se todas as ferramentas estão em ordem e se não se acumulou desordem — espaço que enche, arquivos a mais.",
      p2: "Repara o que pode — reinstala, consolida, arruma — e propõe ao Coordenador as limpezas mais delicadas, sem nunca apagar por conta própria. Uma ferramenta quebrada, para ele, é uma emergência.",
    },
    hu: {
      title: "A Karbantartó",
      p1: "A Karbantartó a csapat infrastruktúrájára ügyel. Naponta egyszer ellenőrző kört tesz: megnézi, hogy a konténer, amelyen a csapat fut, egészséges-e, hogy minden eszköz rendben van-e, és hogy nem gyűlt-e fel rendetlenség — telítődő hely, fölösleges fájlok.",
      p2: "Megjavítja, amit tud — újratelepít, összevon, rendet rak —, a kényesebb takarításokat pedig a Koordinátornak javasolja, sosem törölve a saját szakállára. Egy elromlott eszköz számára vészhelyzet.",
    },
  },
  {
    slug: "mentor",
    promptId: "team.mentor",
    img: "/agents-mentor.png",
    it: {
      title: "Il Mentor",
      p1: "Il Mentor è la voce che ti aiuta a scegliere la direzione giusta. Osserva come si muove il mercato e ti restituisce il quadro: cosa offri tu e cosa chiede il mercato, quali lacune conviene colmare, perché certe candidature non vanno a segno.",
      p2: "Ti manda un breve resoconto quando ha raccolto abbastanza dati, o quando glielo chiedi tu — niente opinioni vaghe, solo ciò che le tendenze dicono davvero.",
    },
    en: {
      title: "The Mentor",
      p1: "The Mentor is the voice that helps you choose the right direction. It watches how the market moves and gives you the picture: what you offer versus what the market wants, which gaps are worth closing, why some applications don't land.",
      p2: "It sends you a short recap once it has gathered enough data, or whenever you ask — no vague opinions, just what the trends actually show.",
    },
    es: {
      title: "El Mentor",
      p1: "El Mentor es la voz que te ayuda a elegir la dirección correcta. Observa cómo se mueve el mercado y te devuelve el panorama: lo que ofreces tú frente a lo que pide el mercado, qué lagunas conviene cerrar, por qué algunas candidaturas no cuajan.",
      p2: "Te envía un breve resumen cuando ha reunido suficientes datos, o cuando se lo pides — nada de opiniones vagas, solo lo que las tendencias dicen de verdad.",
    },
    fr: {
      title: "Le Mentor",
      p1: "Le Mentor est la voix qui t'aide à choisir la bonne direction. Il observe comment le marché évolue et te renvoie le tableau : ce que tu offres face à ce que le marché demande, quelles lacunes il vaut la peine de combler, pourquoi certaines candidatures n'aboutissent pas.",
      p2: "Il t'envoie un bref résumé quand il a réuni assez de données, ou quand tu le lui demandes — pas d'opinions vagues, seulement ce que les tendances montrent vraiment.",
    },
    de: {
      title: "Der Mentor",
      p1: "Der Mentor ist die Stimme, die dir hilft, die richtige Richtung zu wählen. Er beobachtet, wie sich der Markt bewegt, und gibt dir das Gesamtbild: was du bietest im Vergleich zu dem, was der Markt verlangt, welche Lücken sich zu schließen lohnen, warum manche Bewerbungen nicht ankommen.",
      p2: "Er schickt dir eine kurze Zusammenfassung, wenn er genug Daten gesammelt hat, oder wann immer du ihn darum bittest — keine vagen Meinungen, nur das, was die Trends wirklich zeigen.",
    },
    pt: {
      title: "O Mentor",
      p1: "O Mentor é a voz que te ajuda a escolher a direção certa. Observa como o mercado se move e te devolve o panorama: o que você oferece em comparação com o que o mercado pede, quais lacunas vale a pena preencher, por que algumas candidaturas não vingam.",
      p2: "Envia um breve resumo quando reuniu dados suficientes, ou quando você pede — nada de opiniões vagas, apenas o que as tendências realmente mostram.",
    },
    hu: {
      title: "A Mentor",
      p1: "A Mentor az a hang, amely segít a helyes irány kiválasztásában. Figyeli, hogyan mozog a piac, és megmutatja a képet: mit kínálsz te, és mit kér a piac, mely hiányosságokat érdemes pótolni, miért nem célba érnek egyes jelentkezések.",
      p2: "Rövid összefoglalót küld, amikor elég adatot gyűjtött össze, vagy amikor te kéred — semmi ködös vélemény, csak az, amit a trendek valóban mutatnak.",
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
      "Insieme trasformano la ricerca di lavoro da compito solitario e frustrante a campagna strutturata e veloce, in cui non sei più solo.",
    back: "← Torna alla home",
  },
  en: {
    title: "The Team",
    subtitle:
      "Behind Job Hunter Team there isn't a single assistant, but a team of specialized, autonomous AI agents. Each has one job, and does it well.",
    closing:
      "Together they turn the job hunt from a lonely, draining chore into a structured, fast campaign in which you're no longer alone.",
    back: "← Back to home",
  },
  es: {
    title: "El Equipo",
    subtitle:
      "Detrás de Job Hunter Team no hay un solo asistente, sino un equipo de agentes de IA especializados. Cada uno tiene una tarea, y la hace bien.",
    closing:
      "Juntos transforman la búsqueda de empleo de una tarea solitaria y frustrante en una campaña estructurada y rápida en la que ya no estás solo.",
    back: "← Volver al inicio",
  },
  fr: {
    title: "L'Équipe",
    subtitle:
      "Derrière Job Hunter Team, il n'y a pas un seul assistant, mais une équipe d'agents IA spécialisés. Chacun a une mission, et il l'accomplit bien.",
    closing:
      "Ensemble, ils transforment la recherche d'emploi d'une tâche solitaire et épuisante en une campagne structurée et rapide où tu n'es plus seul.",
    back: "← Retour à l'accueil",
  },
  de: {
    title: "Das Team",
    subtitle:
      "Hinter Job Hunter Team steht nicht ein einzelner Assistent, sondern ein Team spezialisierter KI-Agenten. Jeder hat eine Aufgabe und erledigt sie gut.",
    closing:
      "Gemeinsam verwandeln sie die Jobsuche von einer einsamen, zermürbenden Pflicht in eine strukturierte, schnelle Kampagne, in der du nicht mehr allein bist.",
    back: "← Zurück zur Startseite",
  },
  pt: {
    title: "A Equipe",
    subtitle:
      "Por trás do Job Hunter Team não há um único assistente, mas uma equipe de agentes de IA especializados. Cada um tem uma tarefa, e a faz bem.",
    closing:
      "Juntos transformam a busca de emprego de uma tarefa solitária e frustrante em uma campanha estruturada e rápida em que você já não está sozinho.",
    back: "← Voltar ao início",
  },
  hu: {
    title: "A Csapat",
    subtitle:
      "A Job Hunter Team mögött nem egyetlen asszisztens áll, hanem szakosodott MI-ügynökök csapata. Mindegyiknek egy feladata van, és azt jól végzi.",
    closing:
      "Együtt a magányos és frusztráló feladatból strukturált és gyors kampánnyá alakítják az álláskeresést, amelyben már nem vagy egyedül.",
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
      <main className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto">
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
