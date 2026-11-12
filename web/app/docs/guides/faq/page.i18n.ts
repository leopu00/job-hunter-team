// Dizionario di `page.tsx`.
//
// Le chiavi sono LOCALI a questa guida: lo stesso nome può valere tutt'altro
// altrove, quindi non vanno accorpate in un dizionario comune. Il tipo su
// `T` fa pretendere al compilatore ogni lingua dichiarata: una voce a cui
// ne manca una non compila, invece di mostrare l'inglese all'utente
// sbagliato.
import type { Locale } from "@/i18n/config";

export type FaqCopy = {
  title: string;
  tagline: string;
  intro: string;
  q1: string;
  a1: string;
  q2: string;
  a2: string;
  q3: string;
  a3: string;
  q4: string;
  a4: string;
  q5: string;
  a5: string;
  q6: string;
  a6: string;
  q7: string;
  a7: string;
  q8: string;
  a8: string;
  q9: string;
  a9: string;
  q10: string;
  a10: string;
  stillStrong: string;
  stillRest: string;
  githubMore: string;
};

export const T: Record<Locale, FaqCopy> = {
  en: {
    title: "FAQ",
    tagline: "Quick answers before you start",
    intro:
      "The most common questions people ask before installing Job Hunter Team — costs, your data, providers, and what the team does (and doesn't do).",
    q1: "How much does Job Hunter Team cost?",
    a1: "The platform itself is free and open source (MIT). You only pay the AI provider you choose — a Codex subscription, or GLM paid per call with an API key. A base plan is enough to start; a higher tier gives better results. The team never charges you anything.",
    q2: "Subscription or API key?",
    a2: "Both work. Codex runs on your subscription: a fixed monthly fee, and the team paces itself inside its usage windows — the recommended way for a team that works around the clock. GLM runs on an API key paid per call (measured: about 0.10 USD per scored position): set a daily ceiling and the team pauses when it reaches it.",
    q3: "Do I need to know how to code?",
    a3: "No. You paste one command into the terminal and a wizard handles the rest — no coding involved. On a Mac with Apple silicon there is also a desktop app that makes it even simpler.",
    q4: "Where does my data go?",
    a4: "Everything runs on your own machine (or your own VPS, under your own account): positions, CVs and your profile stay local. Cloud sync is optional — it only exists so you can reach your data from another device.",
    q5: "Does the team apply to jobs for me?",
    a5: "No. It prepares tailored CVs and cover letters and brings them to “ready to send”, but you always send them yourself. Nothing is ever submitted in your name.",
    q6: "Which provider should I choose?",
    a6: "Codex, with your ChatGPT subscription: proven over a one-month autonomous run. If you prefer to pay per call, GLM with an API key works too (set from the command line). See the Pricing page for details.",
    q7: "What kind of jobs does it look for?",
    a7: "Job boards, career pages, LinkedIn, recruiter channels. Every position gets a 0–100 score for how close it is to your profile, your skills and the goals you set.",
    q8: "Where does the team need to run?",
    a8: "On a computer that stays on: your own, a dedicated one, or a small cloud server (a VPS, ~€6–10/mo). It needs to stay awake to keep working while you do other things.",
    q9: "Do I need a credit card to try it?",
    a9: "Not for us — the platform is free. You only need the AI provider: a subscription or an API key.",
    q10: "Is it ready? Is it stable?",
    a10: "It's in beta: the team works end to end, but the installation still has some rough edges. If you'd like to help shape it, see “Becoming a beta tester”.",
    stillStrong: "Still have a question?",
    stillRest: " Ask the community on ",
    githubMore: "the docs on GitHub",
  },
  it: {
    title: "Domande frequenti",
    tagline: "Risposte veloci prima di iniziare",
    intro:
      "Le domande più comuni prima di installare Job Hunter Team — costi, i tuoi dati, i provider e cosa fa (e non fa) il team.",
    q1: "Quanto costa Job Hunter Team?",
    a1: "La piattaforma è gratuita e open source (MIT). Paghi solo il provider AI che scegli — un abbonamento Codex, oppure GLM a consumo con una chiave API. Per partire basta un piano base; una fascia più alta dà risultati migliori. Il team non ti fattura mai nulla.",
    q2: "Abbonamento o chiave API?",
    a2: "Vanno bene tutti e due. Codex usa il tuo abbonamento: una cifra fissa al mese, e la squadra si regola dentro le sue finestre d'uso — il modo consigliato per un team che lavora giorno e notte. GLM usa una chiave API a consumo (misurato: circa 0,10 USD per posizione valutata): imposti un tetto giornaliero e la squadra si ferma quando lo raggiunge.",
    q3: "Devo saper programmare?",
    a3: "No. Incolli un comando nel terminale e un wizard fa il resto — niente codice. Su un Mac con Apple silicon c'è anche l'app desktop, che rende tutto ancora più semplice.",
    q4: "Dove finiscono i miei dati?",
    a4: "Tutto gira sul tuo computer (o sul tuo VPS, sotto il tuo account): posizioni, CV e profilo restano in locale. La sincronizzazione cloud è opzionale — serve solo a raggiungere i tuoi dati da un altro dispositivo.",
    q5: "Il team fa domanda al posto mio?",
    a5: "No. Prepara CV e lettere su misura e li porta a «pronti da inviare», ma l'invio lo fai sempre tu. Niente viene mai mandato a tuo nome.",
    q6: "Quale provider scelgo?",
    a6: "Codex, con il tuo abbonamento ChatGPT: provato in un mese di lavoro autonomo. Se preferisci pagare a consumo, funziona anche GLM con una chiave API (si imposta dalla riga di comando). Trovi i dettagli nella pagina Prezzi.",
    q7: "Che tipo di offerte cerca?",
    a7: "Job board, pagine carriere, LinkedIn, canali dei recruiter. Ogni posizione riceve un punteggio 0–100 su quanto è vicina al tuo profilo, alle tue competenze e agli obiettivi che imposti.",
    q8: "Dove deve girare il team?",
    a8: "Su un computer sempre acceso: il tuo, uno dedicato, o un piccolo server cloud (un VPS, ~€6–10/mese). Deve restare acceso per continuare a lavorare mentre tu fai altro.",
    q9: "Serve una carta di credito per provarlo?",
    a9: "Non a noi — la piattaforma è gratuita. Ti serve solo il provider AI: un abbonamento o una chiave API.",
    q10: "È pronto? È stabile?",
    a10: "È in beta: il team funziona dall'inizio alla fine, ma l'installazione ha ancora qualche spigolo. Se vuoi contribuire a migliorarlo, vedi «Diventare beta tester».",
    stillStrong: "Hai ancora una domanda?",
    stillRest: " Chiedi alla community su ",
    githubMore: "i docs su GitHub",
  },
  es: {
    title: "Preguntas frecuentes",
    tagline: "Respuestas rápidas antes de empezar",
    intro:
      "Las preguntas más comunes antes de instalar Job Hunter Team — costes, tus datos, los proveedores y qué hace (y qué no hace) el equipo.",
    q1: "¿Cuánto cuesta Job Hunter Team?",
    a1: "La plataforma en sí es gratuita y de código abierto (MIT). Solo pagas el proveedor de IA que elijas — una suscripción a Codex, o GLM de pago por uso con una clave de API. Para empezar basta un plan base; un nivel superior da mejores resultados. El equipo nunca te cobra nada.",
    q2: "¿Suscripción o clave de API?",
    a2: "Las dos sirven. Codex usa tu suscripción: una cuota fija al mes, y el equipo se regula dentro de sus ventanas de uso — la forma recomendada para un equipo que trabaja día y noche. GLM usa una clave de API de pago por uso (medido: unos 0,10 USD por posición puntuada): pones un tope diario y el equipo se pausa al alcanzarlo.",
    q3: "¿Necesito saber programar?",
    a3: "No. Pegas un comando en la terminal y un asistente se encarga del resto — sin programar nada. En un Mac con Apple silicon también hay una app de escritorio que lo hace aún más sencillo.",
    q4: "¿A dónde van mis datos?",
    a4: "Todo se ejecuta en tu propia máquina (o en tu propio VPS, bajo tu propia cuenta): las posiciones, los CV y tu perfil se quedan en local. La sincronización en la nube es opcional — solo existe para que puedas acceder a tus datos desde otro dispositivo.",
    q5: "¿El equipo se postula a las ofertas por mí?",
    a5: "No. Prepara CV y cartas de presentación a medida y los deja «listos para enviar», pero el envío siempre lo haces tú. Nunca se manda nada en tu nombre.",
    q6: "¿Qué proveedor debería elegir?",
    a6: "Codex, con tu suscripción de ChatGPT: probado en un mes de trabajo autónomo. Si prefieres pagar por uso, también funciona GLM con una clave de API (se configura desde la línea de comandos). Los detalles están en la página de Precios.",
    q7: "¿Qué tipo de ofertas busca?",
    a7: "Portales de empleo, páginas de carreras, LinkedIn, canales de reclutadores. Cada posición recibe una puntuación de 0–100 según lo cerca que está de tu perfil, tus competencias y los objetivos que definas.",
    q8: "¿Dónde tiene que ejecutarse el equipo?",
    a8: "En un ordenador que se mantenga encendido: el tuyo, uno dedicado, o un pequeño servidor en la nube (un VPS, ~€6–10/mes). Necesita permanecer activo para seguir trabajando mientras tú haces otras cosas.",
    q9: "¿Necesito una tarjeta de crédito para probarlo?",
    a9: "Para nosotros no — la plataforma es gratuita. Solo necesitas el proveedor de IA: una suscripción o una clave de API.",
    q10: "¿Está listo? ¿Es estable?",
    a10: "Está en beta: el equipo funciona de principio a fin, pero la instalación todavía tiene algunas asperezas. Si quieres ayudar a darle forma, consulta «Convertirse en beta tester».",
    stillStrong: "¿Todavía tienes una pregunta?",
    stillRest: " Pregunta a la comunidad en ",
    githubMore: "los docs en GitHub",
  },
  fr: {
    title: "Foire aux questions",
    tagline: "Des réponses rapides avant de commencer",
    intro:
      "Les questions les plus courantes avant d’installer Job Hunter Team — les coûts, vos données, les fournisseurs et ce que l’équipe fait (et ne fait pas).",
    q1: "Combien coûte Job Hunter Team ?",
    a1: "La plateforme elle-même est gratuite et open source (MIT). Vous payez uniquement le fournisseur d’IA que vous choisissez — un abonnement Codex, ou GLM payé à l’usage avec une clé d’API. Une formule de base suffit pour démarrer ; un niveau supérieur donne de meilleurs résultats. L’équipe ne vous facture jamais rien.",
    q2: "Abonnement ou clé d’API ?",
    a2: "Les deux fonctionnent. Codex utilise votre abonnement : un montant fixe par mois, et l’équipe se règle dans ses fenêtres d’usage — la façon recommandée pour une équipe qui travaille jour et nuit. GLM utilise une clé d’API payée à l’usage (mesuré : environ 0,10 USD par poste évalué) : vous fixez un plafond journalier et l’équipe se met en pause quand elle l’atteint.",
    q3: "Dois-je savoir programmer ?",
    a3: "Non. Vous collez une commande dans le terminal et un assistant se charge du reste — aucun code à écrire. Sur un Mac Apple silicon, il existe aussi une application de bureau qui rend tout encore plus simple.",
    q4: "Où vont mes données ?",
    a4: "Tout s’exécute sur votre propre machine (ou sur votre propre VPS, sous votre propre compte) : les postes, les CV et votre profil restent en local. La synchronisation cloud est facultative — elle existe uniquement pour que vous puissiez accéder à vos données depuis un autre appareil.",
    q5: "L’équipe postule aux offres à ma place ?",
    a5: "Non. Elle prépare des CV et des lettres de motivation sur mesure et les amène à l’état « prêt à envoyer », mais c’est toujours vous qui les envoyez. Rien n’est jamais soumis en votre nom.",
    q6: "Quel fournisseur choisir ?",
    a6: "Codex, avec votre abonnement ChatGPT : éprouvé sur un mois de travail autonome. Si vous préférez payer à l’usage, GLM avec une clé d’API fonctionne aussi (configuré en ligne de commande). Les détails sont sur la page Tarifs.",
    q7: "Quel type d’offres recherche-t-elle ?",
    a7: "Job boards, pages carrières, LinkedIn, canaux de recruteurs. Chaque poste reçoit un score de 0 à 100 indiquant à quel point il correspond à votre profil, à vos compétences et aux objectifs que vous fixez.",
    q8: "Où l’équipe doit-elle tourner ?",
    a8: "Sur un ordinateur qui reste allumé : le vôtre, un ordinateur dédié, ou un petit serveur cloud (un VPS, ~€6–10/mois). Il doit rester éveillé pour continuer à travailler pendant que vous faites autre chose.",
    q9: "Ai-je besoin d’une carte de crédit pour l’essayer ?",
    a9: "Pas pour nous — la plateforme est gratuite. Vous avez seulement besoin de le fournisseur d’IA : un abonnement ou une clé d’API.",
    q10: "Est-ce prêt ? Est-ce stable ?",
    a10: "C’est en bêta : l’équipe fonctionne de bout en bout, mais l’installation présente encore quelques aspérités. Si vous souhaitez contribuer à la façonner, voyez « Devenir bêta testeur ».",
    stillStrong: "Vous avez encore une question ?",
    stillRest: " Posez-la à la communauté sur ",
    githubMore: "les docs sur GitHub",
  },
  de: {
    title: "Häufige Fragen",
    tagline: "Schnelle Antworten, bevor du loslegst",
    intro:
      "Die häufigsten Fragen, bevor man Job Hunter Team installiert — Kosten, deine Daten, die Anbieter und was das Team tut (und was nicht).",
    q1: "Was kostet Job Hunter Team?",
    a1: "Die Plattform selbst ist kostenlos und quelloffen (MIT). Du zahlst nur den KI-Anbieter, den du wählst — ein Codex-Abo oder GLM nach Verbrauch mit einem API-Key. Zum Start genügt ein Basistarif; eine höhere Klasse liefert bessere Ergebnisse. Das Team stellt dir nie etwas in Rechnung.",
    q2: "Abo oder API-Key?",
    a2: "Beides geht. Codex nutzt dein Abo: ein fester Monatsbetrag, und das Team regelt sich innerhalb seiner Nutzungsfenster — der empfohlene Weg für ein Team, das rund um die Uhr arbeitet. GLM läuft mit einem API-Key nach Verbrauch (gemessen: etwa 0,10 USD pro bewerteter Stelle): Du setzt ein Tageslimit, und das Team pausiert, wenn es erreicht ist.",
    q3: "Muss ich programmieren können?",
    a3: "Nein. Du fügst einen Befehl ins Terminal ein und ein Assistent erledigt den Rest — ganz ohne Programmieren. Auf einem Mac mit Apple silicon gibt es außerdem eine Desktop-App, die es noch einfacher macht.",
    q4: "Wo landen meine Daten?",
    a4: "Alles läuft auf deinem eigenen Rechner (oder deinem eigenen VPS, unter deinem eigenen Konto): Positionen, Lebensläufe und dein Profil bleiben lokal. Die Cloud-Synchronisierung ist optional — sie existiert nur, damit du von einem anderen Gerät aus an deine Daten kommst.",
    q5: "Bewirbt sich das Team für mich?",
    a5: "Nein. Es erstellt maßgeschneiderte Lebensläufe und Anschreiben und bringt sie in den Zustand „bereit zum Versenden“, aber du versendest sie immer selbst. Nichts wird jemals in deinem Namen abgeschickt.",
    q6: "Welchen Anbieter soll ich wählen?",
    a6: "Codex mit deinem ChatGPT-Abo: erprobt in einem Monat autonomer Arbeit. Wenn du lieber nach Verbrauch zahlst, geht auch GLM mit einem API-Key (über die Kommandozeile eingerichtet). Details auf der Preisseite.",
    q7: "Nach welcher Art von Stellen sucht es?",
    a7: "Jobbörsen, Karriereseiten, LinkedIn, Recruiter-Kanäle. Jede Position bekommt eine Bewertung von 0–100, wie nah sie an deinem Profil, deinen Fähigkeiten und den von dir gesetzten Zielen ist.",
    q8: "Wo muss das Team laufen?",
    a8: "Auf einem Computer, der eingeschaltet bleibt: deinem eigenen, einem dedizierten oder einem kleinen Cloud-Server (einem VPS, ~€6–10/Monat). Er muss wach bleiben, um weiterzuarbeiten, während du anderes tust.",
    q9: "Brauche ich eine Kreditkarte, um es auszuprobieren?",
    a9: "Bei uns nicht — die Plattform ist kostenlos. Du brauchst nur den KI-Anbieter: ein Abo oder einen API-Key.",
    q10: "Ist es fertig? Ist es stabil?",
    a10: "Es ist in der Beta: Das Team funktioniert von Anfang bis Ende, aber die Installation hat noch ein paar Ecken und Kanten. Wenn du mithelfen möchtest, es zu formen, siehe „Beta-Tester werden“.",
    stillStrong: "Hast du noch eine Frage?",
    stillRest: " Frag die Community auf ",
    githubMore: "die Docs auf GitHub",
  },
  hu: {
    title: "GYIK",
    tagline: "Gyors válaszok, mielőtt belevágsz",
    intro:
      "A leggyakoribb kérdések, amiket az emberek a Job Hunter Team telepítése előtt feltesznek — költségek, az adataid, a szolgáltatók, és hogy mit csinál (és mit nem) a csapat.",
    q1: "Mennyibe kerül a Job Hunter Team?",
    a1: "Maga a platform ingyenes és nyílt forráskódú (MIT). Csak a választott AI-szolgáltatóért fizetsz — egy Codex-előfizetésért, vagy GLM használatáért API-kulccsal, használat szerint. A kezdéshez egy alapcsomag is elég; a magasabb kategória jobb eredményeket ad. A csapat soha semmit nem számláz neked.",
    q2: "Előfizetés vagy API-kulcs?",
    a2: "Mindkettő működik. A Codex az előfizetésedet használja: fix havi díj, és a csapat a használati ablakain belül szabályozza magát — ez az ajánlott mód egy éjjel-nappal dolgozó csapathoz. A GLM használat szerint fizetett API-kulccsal fut (mérve: kb. 0,10 USD egy értékelt pozícióra): beállítasz egy napi plafont, és a csapat szünetel, amikor eléri.",
    q3: "Kell tudnom programozni?",
    a3: "Nem. Beillesztesz egy parancsot a terminálba, és egy varázsló elintézi a többit — programozás nélkül. Apple silicon Macen asztali alkalmazás is van, ami még egyszerűbbé teszi.",
    q4: "Hová kerülnek az adataim?",
    a4: "Minden a saját gépeden fut (vagy a saját VPS-eden, a saját fiókod alatt): a pozíciók, az önéletrajzok és a profilod helyben maradnak. A felhős szinkronizálás opcionális — csak azért létezik, hogy egy másik eszközről is elérd az adataidat.",
    q5: "A csapat helyettem jelentkezik az állásokra?",
    a5: "Nem. Testreszabott önéletrajzokat és motivációs leveleket készít, és „küldésre kész“ állapotba hozza őket, de a küldést mindig te végzed. Semmit nem adnak be a nevedben.",
    q6: "Melyik szolgáltatót válasszam?",
    a6: "A Codex, a ChatGPT-előfizetéseddel: egy hónapnyi önálló munkán bizonyított. Ha inkább használat szerint fizetnél, a GLM API-kulccsal is működik (parancssorból állítható be). A részletek az Árak oldalon.",
    q7: "Milyen állásokat keres?",
    a7: "Álláshirdető oldalak, karrieroldalak, LinkedIn, toborzói csatornák. Minden pozíció kap egy 0–100 pontszámot arról, mennyire áll közel a profilodhoz, a készségeidhez és az általad kitűzött célokhoz.",
    q8: "Hol kell futnia a csapatnak?",
    a8: "Egy olyan gépen, ami bekapcsolva marad: a sajátodon, egy dedikáltan, vagy egy kis felhőszerveren (egy VPS-en, ~€6–10/hó). Ébren kell maradnia, hogy folyamatosan dolgozzon, míg te mással foglalkozol.",
    q9: "Kell bankkártya a kipróbáláshoz?",
    a9: "Hozzánk nem — a platform ingyenes. Csak az AI-szolgáltatóra: egy előfizetésre vagy egy API-kulcsra van szükséged.",
    q10: "Kész van már? Stabil?",
    a10: "Béta állapotban van: a csapat elejétől a végéig működik, de a telepítésnek még vannak érdes pontjai. Ha szeretnél segíteni a formálásában, lásd a „Béta tesztelővé válás“ részt.",
    stillStrong: "Van még kérdésed?",
    stillRest: " Kérdezd a közösséget itt: ",
    githubMore: "a dokumentáció a GitHubon",
  },
  pt: {
    title: "Perguntas frequentes",
    tagline: "Respostas rápidas antes de começares",
    intro:
      "As perguntas mais comuns antes de descarregar o Job Hunter Team — custos, os teus dados, os fornecedores e o que a equipa faz (e não faz).",
    q1: "Quanto custa o Job Hunter Team?",
    a1: "A plataforma em si é gratuita e open source (MIT). Pagas apenas o fornecedor de IA que escolheres — uma subscrição Codex, ou GLM pago por uso com uma chave de API. Para começar chega um plano base; um nível superior dá melhores resultados. A equipa nunca te cobra nada.",
    q2: "Subscrição ou chave de API?",
    a2: "As duas servem. O Codex usa a tua subscrição: um valor fixo por mês, e a equipa regula-se dentro das suas janelas de uso — a forma recomendada para uma equipa que trabalha dia e noite. GLM usa uma chave de API paga por uso (medido: cerca de 0,10 USD por vaga avaliada): defines um teto diário e a equipa pausa quando o atinge.",
    q3: "Preciso de saber programar?",
    a3: "Não. Descarregas a app de ambiente de trabalho (macOS com Apple silicon) e um assistente trata do resto. Se fores técnico, podes conduzi-la a partir da linha de comandos, mas não é obrigatório.",
    q4: "Para onde vão os meus dados?",
    a4: "Tudo corre na tua própria máquina (ou no teu próprio VPS, sob a tua própria conta): posições, CV e o teu perfil ficam em local. A sincronização na cloud é opcional — existe apenas para conseguires chegar aos teus dados a partir de outro dispositivo.",
    q5: "A equipa candidata-se às ofertas por mim?",
    a5: "Não. Prepara CV e cartas de apresentação à medida e deixa-os «prontos a enviar», mas és sempre tu que os envias. Nunca nada é enviado em teu nome.",
    q6: "Que fornecedor devo escolher?",
    a6: "Codex, com a tua subscrição ChatGPT: provado num mês de trabalho autónomo. Se preferires pagar por uso, também funciona GLM com uma chave de API (configurado pela linha de comandos). Os detalhes estão na página de Preços.",
    q7: "Que tipo de ofertas procura?",
    a7: "Portais de emprego, páginas de carreiras, LinkedIn, canais de recrutadores. Cada posição recebe uma pontuação de 0–100 consoante o quão perto está do teu perfil, das tuas competências e dos objetivos que defines.",
    q8: "Onde é que a equipa tem de correr?",
    a8: "Num computador que fique sempre ligado: o teu, um dedicado, ou um pequeno servidor na nuvem (um VPS, ~€6–10/mês). Tem de se manter ligado para continuar a trabalhar enquanto fazes outras coisas.",
    q9: "Preciso de um cartão de crédito para experimentar?",
    a9: "Para nós não — a plataforma é gratuita. Só precisas do fornecedor de IA: uma subscrição ou uma chave de API.",
    q10: "Está pronto? É estável?",
    a10: "Está em beta: a equipa funciona de ponta a ponta, mas a instalação ainda tem algumas arestas. Se quiseres ajudar a dar-lhe forma, vê «Tornar-se beta tester».",
    stillStrong: "Ainda tens alguma pergunta?",
    stillRest: " Pergunta à comunidade nas ",
    githubMore: "os docs no GitHub",
  },
};
