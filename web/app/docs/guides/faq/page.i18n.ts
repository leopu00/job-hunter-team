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
    a1: "The platform itself is free and open source (MIT). You only pay the AI provider you choose — Kimi, Claude or Codex. A base plan is enough to start; a higher tier gives better results. The team never charges you anything.",
    q2: "Why a subscription and not a pay-per-use API key?",
    a2: "The team works around the clock. With a pay-per-token API, a single week of searching would cost hundreds or thousands of euros. A subscription is a fixed, predictable monthly fee — no meter running, no surprise bill.",
    q3: "Do I need to know how to code?",
    a3: "No. You paste one command into the terminal and a wizard handles the rest — no coding involved. A desktop app (Windows, macOS, Linux) is on its way to make it even simpler.",
    q4: "Where does my data go?",
    a4: "Everything runs on your own machine (or your own VPS, under your own account): positions, CVs and your profile stay local. Cloud sync is optional — it only exists so you can reach your data from another device.",
    q5: "Does the team apply to jobs for me?",
    a5: "No. It prepares tailored CVs and cover letters and brings them to “ready to send”, but you always send them yourself. Nothing is ever submitted in your name.",
    q6: "Which provider should I choose?",
    a6: "Kimi is the most affordable and a great starting point; Claude is the most precise, best for scoring and writing; Codex is the most complete. You can switch between them anytime without redoing your profile. See the Pricing page for details.",
    q7: "What kind of jobs does it look for?",
    a7: "Job boards, career pages, LinkedIn, recruiter channels. Every position gets a 0–100 score for how close it is to your profile, your skills and the goals you set.",
    q8: "Where does the team need to run?",
    a8: "On a computer that stays on: your own, a dedicated one, or a small cloud server (a VPS, ~€6–10/mo). It needs to stay awake to keep working while you do other things.",
    q9: "Do I need a credit card to try it?",
    a9: "Not for us — the platform is free. You only need the subscription to the AI provider you pick.",
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
    a1: "La piattaforma è gratuita e open source (MIT). Paghi solo il provider AI che scegli — Kimi, Claude o Codex. Per partire basta un piano base; una fascia più alta dà risultati migliori. Il team non ti fattura mai nulla.",
    q2: "Perché un abbonamento e non una chiave API a consumo?",
    a2: "Il team lavora senza sosta. Con un'API a pagamento a token, una sola settimana di ricerca costerebbe centinaia o migliaia di euro. L'abbonamento è una quota mensile fissa e prevedibile — nessun contatore, nessuna bolletta a sorpresa.",
    q3: "Devo saper programmare?",
    a3: "No. Incolli un comando nel terminale e un wizard fa il resto — niente codice. È in arrivo anche l'app desktop (Windows, macOS, Linux), che renderà tutto ancora più semplice.",
    q4: "Dove finiscono i miei dati?",
    a4: "Tutto gira sul tuo computer (o sul tuo VPS, sotto il tuo account): posizioni, CV e profilo restano in locale. La sincronizzazione cloud è opzionale — serve solo a raggiungere i tuoi dati da un altro dispositivo.",
    q5: "Il team fa domanda al posto mio?",
    a5: "No. Prepara CV e lettere su misura e li porta a «pronti da inviare», ma l'invio lo fai sempre tu. Niente viene mai mandato a tuo nome.",
    q6: "Quale provider scelgo?",
    a6: "Kimi è il più economico e un ottimo punto di partenza; Claude è il più preciso, ideale per valutare e scrivere; Codex è il più completo. Puoi passare dall'uno all'altro quando vuoi, senza rifare il profilo. Vedi la pagina Prezzi per i dettagli.",
    q7: "Che tipo di offerte cerca?",
    a7: "Job board, pagine carriere, LinkedIn, canali dei recruiter. Ogni posizione riceve un punteggio 0–100 su quanto è vicina al tuo profilo, alle tue competenze e agli obiettivi che imposti.",
    q8: "Dove deve girare il team?",
    a8: "Su un computer sempre acceso: il tuo, uno dedicato, o un piccolo server cloud (un VPS, ~€6–10/mese). Deve restare acceso per continuare a lavorare mentre tu fai altro.",
    q9: "Serve una carta di credito per provarlo?",
    a9: "Non a noi — la piattaforma è gratuita. Ti serve solo l'abbonamento al provider AI che scegli.",
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
    a1: "La plataforma en sí es gratuita y de código abierto (MIT). Solo pagas el proveedor de IA que elijas — Kimi, Claude o Codex. Para empezar basta un plan base; un nivel superior da mejores resultados. El equipo nunca te cobra nada.",
    q2: "¿Por qué una suscripción y no una clave API de pago por uso?",
    a2: "El equipo trabaja sin descanso. Con una API de pago por token, una sola semana de búsqueda costaría cientos o miles de euros. Una suscripción es una cuota mensual fija y predecible — sin contador en marcha, sin factura sorpresa.",
    q3: "¿Necesito saber programar?",
    a3: "No. Pegas un comando en la terminal y un asistente se encarga del resto — sin programar nada. La app de escritorio (Windows, macOS, Linux) está en camino y lo hará aún más sencillo.",
    q4: "¿A dónde van mis datos?",
    a4: "Todo se ejecuta en tu propia máquina (o en tu propio VPS, bajo tu propia cuenta): las posiciones, los CV y tu perfil se quedan en local. La sincronización en la nube es opcional — solo existe para que puedas acceder a tus datos desde otro dispositivo.",
    q5: "¿El equipo se postula a las ofertas por mí?",
    a5: "No. Prepara CV y cartas de presentación a medida y los deja «listos para enviar», pero el envío siempre lo haces tú. Nunca se manda nada en tu nombre.",
    q6: "¿Qué proveedor debería elegir?",
    a6: "Kimi es el más económico y un excelente punto de partida; Claude es el más preciso, ideal para puntuar y escribir; Codex es el más completo. Puedes cambiar entre ellos en cualquier momento sin rehacer tu perfil. Consulta la página de Precios para más detalles.",
    q7: "¿Qué tipo de ofertas busca?",
    a7: "Portales de empleo, páginas de carreras, LinkedIn, canales de reclutadores. Cada posición recibe una puntuación de 0–100 según lo cerca que está de tu perfil, tus competencias y los objetivos que definas.",
    q8: "¿Dónde tiene que ejecutarse el equipo?",
    a8: "En un ordenador que se mantenga encendido: el tuyo, uno dedicado, o un pequeño servidor en la nube (un VPS, ~€6–10/mes). Necesita permanecer activo para seguir trabajando mientras tú haces otras cosas.",
    q9: "¿Necesito una tarjeta de crédito para probarlo?",
    a9: "Para nosotros no — la plataforma es gratuita. Solo necesitas la suscripción al proveedor de IA que elijas.",
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
    a1: "La plateforme elle-même est gratuite et open source (MIT). Vous payez uniquement le fournisseur d’IA que vous choisissez — Kimi, Claude ou Codex. Une formule de base suffit pour démarrer ; un niveau supérieur donne de meilleurs résultats. L’équipe ne vous facture jamais rien.",
    q2: "Pourquoi un abonnement et non une clé API à l’usage ?",
    a2: "L’équipe travaille sans relâche. Avec une API facturée au token, une seule semaine de recherche coûterait des centaines, voire des milliers d’euros. Un abonnement est un forfait mensuel fixe et prévisible — pas de compteur qui tourne, pas de facture surprise.",
    q3: "Dois-je savoir programmer ?",
    a3: "Non. Vous collez une commande dans le terminal et un assistant se charge du reste — aucun code à écrire. L’application de bureau (Windows, macOS, Linux) arrive bientôt et rendra tout encore plus simple.",
    q4: "Où vont mes données ?",
    a4: "Tout s’exécute sur votre propre machine (ou sur votre propre VPS, sous votre propre compte) : les postes, les CV et votre profil restent en local. La synchronisation cloud est facultative — elle existe uniquement pour que vous puissiez accéder à vos données depuis un autre appareil.",
    q5: "L’équipe postule aux offres à ma place ?",
    a5: "Non. Elle prépare des CV et des lettres de motivation sur mesure et les amène à l’état « prêt à envoyer », mais c’est toujours vous qui les envoyez. Rien n’est jamais soumis en votre nom.",
    q6: "Quel fournisseur choisir ?",
    a6: "Kimi est le plus abordable et un excellent point de départ ; Claude est le plus précis, idéal pour l’évaluation et la rédaction ; Codex est le plus complet. Vous pouvez passer de l’un à l’autre à tout moment, sans refaire votre profil. Consultez la page Tarifs pour les détails.",
    q7: "Quel type d’offres recherche-t-elle ?",
    a7: "Job boards, pages carrières, LinkedIn, canaux de recruteurs. Chaque poste reçoit un score de 0 à 100 indiquant à quel point il correspond à votre profil, à vos compétences et aux objectifs que vous fixez.",
    q8: "Où l’équipe doit-elle tourner ?",
    a8: "Sur un ordinateur qui reste allumé : le vôtre, un ordinateur dédié, ou un petit serveur cloud (un VPS, ~€6–10/mois). Il doit rester éveillé pour continuer à travailler pendant que vous faites autre chose.",
    q9: "Ai-je besoin d’une carte de crédit pour l’essayer ?",
    a9: "Pas pour nous — la plateforme est gratuite. Vous avez seulement besoin de l’abonnement au fournisseur d’IA que vous choisissez.",
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
    a1: "Die Plattform selbst ist kostenlos und quelloffen (MIT). Du zahlst nur den KI-Anbieter, den du wählst — Kimi, Claude oder Codex. Zum Start genügt ein Basistarif; eine höhere Klasse liefert bessere Ergebnisse. Das Team stellt dir nie etwas in Rechnung.",
    q2: "Warum ein Abo und kein API-Schlüssel nach Verbrauch?",
    a2: "Das Team arbeitet rund um die Uhr. Mit einer nach Tokens abgerechneten API würde eine einzige Woche Suche Hunderte oder Tausende Euro kosten. Ein Abo ist eine feste, planbare Monatsgebühr — kein laufender Zähler, keine böse Überraschung auf der Rechnung.",
    q3: "Muss ich programmieren können?",
    a3: "Nein. Du fügst einen Befehl ins Terminal ein und ein Assistent erledigt den Rest — ganz ohne Programmieren. Die Desktop-App (Windows, macOS, Linux) ist unterwegs und macht es noch einfacher.",
    q4: "Wo landen meine Daten?",
    a4: "Alles läuft auf deinem eigenen Rechner (oder deinem eigenen VPS, unter deinem eigenen Konto): Positionen, Lebensläufe und dein Profil bleiben lokal. Die Cloud-Synchronisierung ist optional — sie existiert nur, damit du von einem anderen Gerät aus an deine Daten kommst.",
    q5: "Bewirbt sich das Team für mich?",
    a5: "Nein. Es erstellt maßgeschneiderte Lebensläufe und Anschreiben und bringt sie in den Zustand „bereit zum Versenden“, aber du versendest sie immer selbst. Nichts wird jemals in deinem Namen abgeschickt.",
    q6: "Welchen Anbieter soll ich wählen?",
    a6: "Kimi ist am günstigsten und ein toller Einstieg; Claude ist am präzisesten, ideal zum Bewerten und Schreiben; Codex ist am umfassendsten. Du kannst jederzeit zwischen ihnen wechseln, ohne dein Profil neu anzulegen. Details findest du auf der Preisseite.",
    q7: "Nach welcher Art von Stellen sucht es?",
    a7: "Jobbörsen, Karriereseiten, LinkedIn, Recruiter-Kanäle. Jede Position bekommt eine Bewertung von 0–100, wie nah sie an deinem Profil, deinen Fähigkeiten und den von dir gesetzten Zielen ist.",
    q8: "Wo muss das Team laufen?",
    a8: "Auf einem Computer, der eingeschaltet bleibt: deinem eigenen, einem dedizierten oder einem kleinen Cloud-Server (einem VPS, ~€6–10/Monat). Er muss wach bleiben, um weiterzuarbeiten, während du anderes tust.",
    q9: "Brauche ich eine Kreditkarte, um es auszuprobieren?",
    a9: "Bei uns nicht — die Plattform ist kostenlos. Du brauchst nur das Abo bei dem KI-Anbieter, den du auswählst.",
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
    a1: "Maga a platform ingyenes és nyílt forráskódú (MIT). Csak a választott AI-szolgáltatóért fizetsz — Kimi, Claude vagy Codex. A kezdéshez egy alapcsomag is elég; a magasabb kategória jobb eredményeket ad. A csapat soha semmit nem számláz neked.",
    q2: "Miért előfizetés, és nem használatalapú API-kulcs?",
    a2: "A csapat éjjel-nappal dolgozik. Egy tokenalapú, fizetős API-val egyetlen hét keresés több száz vagy több ezer euróba kerülne. Az előfizetés fix, kiszámítható havidíj — nincs ketyegő óra, nincs meglepetésszámla.",
    q3: "Kell tudnom programozni?",
    a3: "Nem. Beillesztesz egy parancsot a terminálba, és egy varázsló elintézi a többit — programozás nélkül. Az asztali alkalmazás (Windows, macOS, Linux) már úton van, és még egyszerűbbé teszi majd.",
    q4: "Hová kerülnek az adataim?",
    a4: "Minden a saját gépeden fut (vagy a saját VPS-eden, a saját fiókod alatt): a pozíciók, az önéletrajzok és a profilod helyben maradnak. A felhős szinkronizálás opcionális — csak azért létezik, hogy egy másik eszközről is elérd az adataidat.",
    q5: "A csapat helyettem jelentkezik az állásokra?",
    a5: "Nem. Testreszabott önéletrajzokat és motivációs leveleket készít, és „küldésre kész“ állapotba hozza őket, de a küldést mindig te végzed. Semmit nem adnak be a nevedben.",
    q6: "Melyik szolgáltatót válasszam?",
    a6: "A Kimi a legolcsóbb, és remek kiindulópont; a Claude a legpontosabb, a legjobb pontozáshoz és íráshoz; a Codex a legteljesebb. Bármikor válthatsz közöttük anélkül, hogy újra kellene csinálnod a profilod. A részletekért lásd az Árak oldalt.",
    q7: "Milyen állásokat keres?",
    a7: "Álláshirdető oldalak, karrieroldalak, LinkedIn, toborzói csatornák. Minden pozíció kap egy 0–100 pontszámot arról, mennyire áll közel a profilodhoz, a készségeidhez és az általad kitűzött célokhoz.",
    q8: "Hol kell futnia a csapatnak?",
    a8: "Egy olyan gépen, ami bekapcsolva marad: a sajátodon, egy dedikáltan, vagy egy kis felhőszerveren (egy VPS-en, ~€6–10/hó). Ébren kell maradnia, hogy folyamatosan dolgozzon, míg te mással foglalkozol.",
    q9: "Kell bankkártya a kipróbáláshoz?",
    a9: "Hozzánk nem — a platform ingyenes. Csak a választott AI-szolgáltató előfizetésére van szükséged.",
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
    a1: "A plataforma em si é gratuita e open source (MIT). Pagas apenas o fornecedor de IA que escolheres — Kimi, Claude ou Codex. Para começar chega um plano base; um nível superior dá melhores resultados. A equipa nunca te cobra nada.",
    q2: "Porquê uma subscrição e não uma chave de API paga por utilização?",
    a2: "A equipa trabalha 24 horas por dia. Com uma API paga por token, uma única semana de procura custaria centenas ou milhares de euros. Uma subscrição é uma mensalidade fixa e previsível — sem contador a correr, sem fatura surpresa.",
    q3: "Preciso de saber programar?",
    a3: "Não. Descarregas a app de ambiente de trabalho (Windows, macOS, Linux) e um assistente trata do resto. Se fores técnico, podes conduzi-la a partir da linha de comandos, mas não é obrigatório.",
    q4: "Para onde vão os meus dados?",
    a4: "Tudo corre na tua própria máquina (ou no teu próprio VPS, sob a tua própria conta): posições, CV e o teu perfil ficam em local. A sincronização na cloud é opcional — existe apenas para conseguires chegar aos teus dados a partir de outro dispositivo.",
    q5: "A equipa candidata-se às ofertas por mim?",
    a5: "Não. Prepara CV e cartas de apresentação à medida e deixa-os «prontos a enviar», mas és sempre tu que os envias. Nunca nada é enviado em teu nome.",
    q6: "Que fornecedor devo escolher?",
    a6: "O Kimi é o mais barato e um ótimo ponto de partida; o Claude é o mais preciso, ideal para pontuar e escrever; o Codex é o mais completo. Podes alternar entre eles quando quiseres, sem refazer o perfil. Consulta a página de Preços para mais detalhes.",
    q7: "Que tipo de ofertas procura?",
    a7: "Portais de emprego, páginas de carreiras, LinkedIn, canais de recrutadores. Cada posição recebe uma pontuação de 0–100 consoante o quão perto está do teu perfil, das tuas competências e dos objetivos que defines.",
    q8: "Onde é que a equipa tem de correr?",
    a8: "Num computador que fique sempre ligado: o teu, um dedicado, ou um pequeno servidor na nuvem (um VPS, ~€6–10/mês). Tem de se manter ligado para continuar a trabalhar enquanto fazes outras coisas.",
    q9: "Preciso de um cartão de crédito para experimentar?",
    a9: "Para nós não — a plataforma é gratuita. Só precisas da subscrição do fornecedor de IA que escolheres.",
    q10: "Está pronto? É estável?",
    a10: "Está em beta: a equipa funciona de ponta a ponta, mas a instalação ainda tem algumas arestas. Se quiseres ajudar a dar-lhe forma, vê «Tornar-se beta tester».",
    stillStrong: "Ainda tens alguma pergunta?",
    stillRest: " Pergunta à comunidade nas ",
    githubMore: "os docs no GitHub",
  },
};
