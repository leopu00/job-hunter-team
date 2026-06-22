import type { Locale } from "@/i18n/config";
import { getRequestLocale } from "@/lib/request-locale";
import {
  DocHeader,
  Callout,
  H2,
  H3,
  P,
  UL,
  LI,
  Code,
  Pre,
  GitHubMore,
  repoTree,
} from "../../DocKit";

const T: Record<
  Locale,
  {
    title: string;
    tagline: string;
    intro: string;
    flowH2: string;
    flowP: string;
    flowPre: string;
    calloutScoreStrong: string;
    calloutScoreRest: string;
    whereH2: string;
    webH3: string;
    webP: string;
    webLi1: string;
    webLi2: string;
    webLi3: string;
    webLi4: string;
    termH3: string;
    termPre: string;
    loginH2: string;
    loginP1: string;
    loginP2Strong: string;
    loginP2Rest: string;
    withSignupStrong: string;
    withSignupRest1: string;
    withSignupRest2: string;
    withoutStrong: string;
    withoutRest1: string;
    withoutRest2: string;
    readOnlyStrong: string;
    readOnlyRest1: string;
    readOnlyRest2: string;
    outputH2: string;
    outputRest1: string;
    outputReady: string;
    outputRest2: string;
    githubMore: string;
  }
> = {
  en: {
    title: "Your dashboard & results",
    tagline: "Where the team's work shows up — and how to read it",
    intro:
      "Once the team is running it produces a steady stream of positions, each verified and scored against your profile. This page explains what you see and how the numbers work.",
    flowH2: "🔄 How a position flows",
    flowP:
      "Every job moves through the pipeline before it reaches you. The score is the key signal:",
    flowPre: `🕵️  Scout    finds a position           → new
🔬  Analyst  verifies the role + company → checked
💯  Scorer   scores it 0–100 vs you      → scored
              ├─ score < 40  → set aside
              └─ score ≥ 50  → handed to the Writer
✍️  Writer   drafts a tailored CV + letter
⚖️  Critic   blind-reviews it (3 rounds)  → ready
👤  You      review and decide what to send`,
    calloutScoreStrong: "The score is a compatibility estimate, not a verdict.",
    calloutScoreRest:
      "It ranks how well a posting matches your profile — you stay the judge of what's worth pursuing. Nothing is ever submitted on your behalf.",
    whereH2: "🖥️ Where to read it",
    webH3: "The web dashboard",
    webP: "From a browser you get the full picture:",
    webLi1: "Every position found, with its match score.",
    webLi2: "The map of opportunities by city and country.",
    webLi3: "The status of each application.",
    webLi4: "The team's activity and current spending.",
    termH3: "The terminal, if you prefer",
    termPre: `jht positions list        # all positions in the local DB
jht positions show 42     # detail of one position
jht positions dashboard   # a TTY-friendly view
jht stats                 # found / scored / applied counts`,
    loginH2: "🔐 Login is optional",
    loginP1:
      "Signing up lets you reach your data from any device — but it's not required. You can keep ",
    loginP2Strong: "everything on your own computer",
    loginP2Rest: ", no cloud involved:",
    withSignupStrong: "With sign-up",
    withSignupRest1: " — local data mirrors to the cloud; open ",
    withSignupRest2:
      " from any browser, share with a mentor. Your CVs stay local; only metadata syncs.",
    withoutStrong: "Without",
    withoutRest1: " — fully local. The dashboard lives at ",
    withoutRest2: ", nothing external is touched.",
    readOnlyStrong: "read-only",
    readOnlyRest1: "🌐 On the public site the dashboard is ",
    readOnlyRest2:
      " for safety. Anything that changes your team or your data happens from the desktop app or the CLI, on your machine.",
    outputH2: "📄 The output you act on",
    outputRest1:
      "Approved applications land as ready-to-send packages (CV + cover letter) in your ",
    outputReady: '"Ready to submit"',
    outputRest2:
      " documents folder, marked %READY%. You open, review and send them yourself.",
    githubMore: "the docs on GitHub",
  },
  it: {
    title: "La tua dashboard e i risultati",
    tagline: "Dove appare il lavoro del team — e come leggerlo",
    intro:
      "Una volta avviato, il team produce un flusso costante di posizioni, ciascuna verificata e valutata rispetto al tuo profilo. Questa pagina spiega cosa vedi e come funzionano i numeri.",
    flowH2: "🔄 Come scorre una posizione",
    flowP:
      "Ogni offerta attraversa la pipeline prima di arrivare a te. Il punteggio è il segnale chiave:",
    flowPre: `🕵️  Scout    trova una posizione         → new
🔬  Analista verifica ruolo + azienda    → checked
💯  Scorer   la valuta 0–100 vs te       → scored
              ├─ score < 40  → messa da parte
              └─ score ≥ 50  → passata allo Scrittore
✍️  Scrittore prepara CV + lettera su misura
⚖️  Critico  la rivede alla cieca (3 round) → ready
👤  Tu       rivedi e decidi cosa inviare`,
    calloutScoreStrong:
      "Il punteggio è una stima di compatibilità, non un verdetto.",
    calloutScoreRest:
      "Indica quanto un annuncio corrisponde al tuo profilo — sei tu a decidere cosa vale la pena perseguire. Nulla viene mai inviato a tuo nome.",
    whereH2: "🖥️ Dove leggerlo",
    webH3: "La dashboard web",
    webP: "Da un browser hai il quadro completo:",
    webLi1: "Ogni posizione trovata, con il suo punteggio di compatibilità.",
    webLi2: "La mappa delle opportunità per città e Paese.",
    webLi3: "Lo stato di ciascuna candidatura.",
    webLi4: "L'attività del team e la spesa attuale.",
    termH3: "Il terminale, se preferisci",
    termPre: `jht positions list        # tutte le posizioni nel DB locale
jht positions show 42     # dettaglio di una posizione
jht positions dashboard   # una vista per il terminale
jht stats                 # conteggi trovate / valutate / candidate`,
    loginH2: "🔐 Il login è facoltativo",
    loginP1:
      "Registrarti ti permette di raggiungere i tuoi dati da qualsiasi dispositivo — ma non è obbligatorio. Puoi tenere ",
    loginP2Strong: "tutto sul tuo computer",
    loginP2Rest: ", senza alcun cloud:",
    withSignupStrong: "Con la registrazione",
    withSignupRest1: " — i dati locali si rispecchiano nel cloud; apri ",
    withSignupRest2:
      " da qualsiasi browser, condividi con un mentore. I tuoi CV restano in locale; si sincronizzano solo i metadati.",
    withoutStrong: "Senza",
    withoutRest1: " — tutto in locale. La dashboard è su ",
    withoutRest2: ", nulla di esterno viene toccato.",
    readOnlyStrong: "in sola lettura",
    readOnlyRest1: "🌐 Sul sito pubblico la dashboard è ",
    readOnlyRest2:
      " per sicurezza. Tutto ciò che modifica il tuo team o i tuoi dati avviene dall'app desktop o dalla CLI, sulla tua macchina.",
    outputH2: "📄 Il risultato su cui agisci",
    outputRest1:
      "Le candidature approvate arrivano come pacchetti pronti all'invio (CV + lettera di presentazione) nella tua cartella documenti ",
    outputReady: '"Pronto da inviare"',
    outputRest2:
      ", contrassegnati come %READY%. Li apri, li rivedi e li invii tu stesso.",
    githubMore: "i docs su GitHub",
  },
  es: {
    title: "Tu panel y resultados",
    tagline: "Dónde aparece el trabajo del equipo — y cómo leerlo",
    intro:
      "Una vez en marcha, el equipo produce un flujo constante de posiciones, cada una verificada y puntuada según tu perfil. Esta página explica qué ves y cómo funcionan los números.",
    flowH2: "🔄 Cómo fluye una posición",
    flowP:
      "Cada oferta pasa por el pipeline antes de llegarte. La puntuación es la señal clave:",
    flowPre: `🕵️  Scout    encuentra una posición      → new
🔬  Analista verifica el puesto + empresa → checked
💯  Scorer   la puntúa 0–100 vs ti       → scored
              ├─ score < 40  → apartada
              └─ score ≥ 50  → pasada al Redactor
✍️  Redactor redacta un CV + carta a medida
⚖️  Crítico  la revisa a ciegas (3 rondas) → ready
👤  Tú       revisas y decides qué enviar`,
    calloutScoreStrong:
      "La puntuación es una estimación de compatibilidad, no un veredicto.",
    calloutScoreRest:
      "Indica cómo de bien encaja un anuncio con tu perfil — tú sigues siendo quien decide qué vale la pena perseguir. Nunca se envía nada en tu nombre.",
    whereH2: "🖥️ Dónde leerlo",
    webH3: "El panel web",
    webP: "Desde un navegador tienes la imagen completa:",
    webLi1: "Cada posición encontrada, con su puntuación de compatibilidad.",
    webLi2: "El mapa de oportunidades por ciudad y país.",
    webLi3: "El estado de cada candidatura.",
    webLi4: "La actividad del equipo y el gasto actual.",
    termH3: "La terminal, si lo prefieres",
    termPre: `jht positions list        # todas las posiciones en la BD local
jht positions show 42     # detalle de una posición
jht positions dashboard   # una vista para terminal
jht stats                 # recuentos de encontradas / puntuadas / aplicadas`,
    loginH2: "🔐 El inicio de sesión es opcional",
    loginP1:
      "Registrarte te permite acceder a tus datos desde cualquier dispositivo — pero no es obligatorio. Puedes mantener ",
    loginP2Strong: "todo en tu propio ordenador",
    loginP2Rest: ", sin nube alguna:",
    withSignupStrong: "Con registro",
    withSignupRest1: " — los datos locales se reflejan en la nube; abre ",
    withSignupRest2:
      " desde cualquier navegador, comparte con un mentor. Tus CV permanecen en local; solo se sincronizan los metadatos.",
    withoutStrong: "Sin registro",
    withoutRest1: " — totalmente local. El panel reside en ",
    withoutRest2: ", no se toca nada externo.",
    readOnlyStrong: "de solo lectura",
    readOnlyRest1: "🌐 En el sitio público el panel es ",
    readOnlyRest2:
      " por seguridad. Todo lo que cambia tu equipo o tus datos ocurre desde la app de escritorio o la CLI, en tu máquina.",
    outputH2: "📄 El resultado sobre el que actúas",
    outputRest1:
      "Las candidaturas aprobadas llegan como paquetes listos para enviar (CV + carta de presentación) en tu carpeta de documentos ",
    outputReady: '"Listo para enviar"',
    outputRest2:
      ", marcados como %READY%. Tú los abres, los revisas y los envías.",
    githubMore: "los docs en GitHub",
  },
  fr: {
    title: "Votre tableau de bord et vos résultats",
    tagline: "Où apparaît le travail de l'équipe — et comment le lire",
    intro:
      "Une fois lancée, l'équipe produit un flux constant de postes, chacun vérifié et noté par rapport à votre profil. Cette page explique ce que vous voyez et comment fonctionnent les chiffres.",
    flowH2: "🔄 Comment circule un poste",
    flowP:
      "Chaque offre traverse le pipeline avant de vous parvenir. Le score est le signal clé :",
    flowPre: `🕵️  Scout    trouve un poste             → new
🔬  Analyste vérifie le rôle + l'entreprise → checked
💯  Scorer   le note 0–100 vs vous       → scored
              ├─ score < 40  → mis de côté
              └─ score ≥ 50  → transmis au Rédacteur
✍️  Rédacteur rédige un CV + une lettre sur mesure
⚖️  Critique le relit à l'aveugle (3 tours) → ready
👤  Vous     relisez et décidez quoi envoyer`,
    calloutScoreStrong:
      "Le score est une estimation de compatibilité, pas un verdict.",
    calloutScoreRest:
      "Il indique à quel point une annonce correspond à votre profil — c'est vous qui restez juge de ce qui vaut la peine d'être poursuivi. Rien n'est jamais envoyé en votre nom.",
    whereH2: "🖥️ Où le lire",
    webH3: "Le tableau de bord web",
    webP: "Depuis un navigateur, vous avez la vue d'ensemble :",
    webLi1: "Chaque poste trouvé, avec son score de compatibilité.",
    webLi2: "La carte des opportunités par ville et par pays.",
    webLi3: "Le statut de chaque candidature.",
    webLi4: "L'activité de l'équipe et les dépenses actuelles.",
    termH3: "Le terminal, si vous préférez",
    termPre: `jht positions list        # tous les postes dans la BD locale
jht positions show 42     # détail d'un poste
jht positions dashboard   # une vue adaptée au terminal
jht stats                 # nombres trouvés / notés / postulés`,
    loginH2: "🔐 La connexion est facultative",
    loginP1:
      "S'inscrire vous permet d'accéder à vos données depuis n'importe quel appareil — mais ce n'est pas obligatoire. Vous pouvez tout garder ",
    loginP2Strong: "sur votre propre ordinateur",
    loginP2Rest: ", sans aucun cloud :",
    withSignupStrong: "Avec inscription",
    withSignupRest1:
      " — les données locales se reflètent dans le cloud ; ouvrez ",
    withSignupRest2:
      " depuis n'importe quel navigateur, partagez avec un mentor. Vos CV restent en local ; seules les métadonnées se synchronisent.",
    withoutStrong: "Sans inscription",
    withoutRest1: " — entièrement local. Le tableau de bord se trouve sur ",
    withoutRest2: ", rien d'externe n'est touché.",
    readOnlyStrong: "en lecture seule",
    readOnlyRest1: "🌐 Sur le site public, le tableau de bord est ",
    readOnlyRest2:
      " par sécurité. Tout ce qui modifie votre équipe ou vos données se fait depuis l'application de bureau ou la CLI, sur votre machine.",
    outputH2: "📄 Le résultat sur lequel vous agissez",
    outputRest1:
      "Les candidatures approuvées arrivent sous forme de dossiers prêts à envoyer (CV + lettre de motivation) dans votre dossier de documents ",
    outputReady: "« Prêt à envoyer »",
    outputRest2:
      ", marqués %READY%. Vous les ouvrez, les relisez et les envoyez vous-même.",
    githubMore: "les docs sur GitHub",
  },
  de: {
    title: "Dein Dashboard & deine Ergebnisse",
    tagline: "Wo die Arbeit des Teams erscheint — und wie du sie liest",
    intro:
      "Sobald das Team läuft, produziert es einen stetigen Strom an Stellen, jede gegen dein Profil geprüft und bewertet. Diese Seite erklärt, was du siehst und wie die Zahlen funktionieren.",
    flowH2: "🔄 Wie eine Stelle durchläuft",
    flowP:
      "Jede Stelle durchläuft die Pipeline, bevor sie dich erreicht. Der Score ist das entscheidende Signal:",
    flowPre: `🕵️  Scout    findet eine Stelle          → new
🔬  Analyst  prüft Rolle + Unternehmen   → checked
💯  Scorer   bewertet sie 0–100 vs. dir  → scored
              ├─ score < 40  → beiseitegelegt
              └─ score ≥ 50  → an den Schreiber übergeben
✍️  Schreiber entwirft einen passenden Lebenslauf + Brief
⚖️  Kritiker prüft sie blind (3 Runden)  → ready
👤  Du       prüfst und entscheidest, was du sendest`,
    calloutScoreStrong:
      "Der Score ist eine Kompatibilitätsschätzung, kein Urteil.",
    calloutScoreRest:
      "Er bewertet, wie gut eine Anzeige zu deinem Profil passt — du bleibst der Richter darüber, was sich zu verfolgen lohnt. Nichts wird je in deinem Namen abgeschickt.",
    whereH2: "🖥️ Wo du es liest",
    webH3: "Das Web-Dashboard",
    webP: "Im Browser bekommst du das vollständige Bild:",
    webLi1: "Jede gefundene Stelle, mit ihrem Match-Score.",
    webLi2: "Die Karte der Möglichkeiten nach Stadt und Land.",
    webLi3: "Der Status jeder Bewerbung.",
    webLi4: "Die Aktivität des Teams und die aktuellen Ausgaben.",
    termH3: "Das Terminal, falls du es vorziehst",
    termPre: `jht positions list        # alle Stellen in der lokalen DB
jht positions show 42     # Detail einer Stelle
jht positions dashboard   # eine TTY-freundliche Ansicht
jht stats                 # Zähler gefunden / bewertet / beworben`,
    loginH2: "🔐 Das Anmelden ist optional",
    loginP1:
      "Mit einer Registrierung erreichst du deine Daten von jedem Gerät — aber sie ist nicht erforderlich. Du kannst ",
    loginP2Strong: "alles auf deinem eigenen Computer",
    loginP2Rest: " behalten, ganz ohne Cloud:",
    withSignupStrong: "Mit Registrierung",
    withSignupRest1: " — lokale Daten spiegeln in die Cloud; öffne ",
    withSignupRest2:
      " in jedem Browser, teile mit einem Mentor. Deine Lebensläufe bleiben lokal; nur Metadaten werden synchronisiert.",
    withoutStrong: "Ohne",
    withoutRest1: " — vollständig lokal. Das Dashboard liegt unter ",
    withoutRest2: ", nichts Externes wird berührt.",
    readOnlyStrong: "schreibgeschützt",
    readOnlyRest1:
      "🌐 Auf der öffentlichen Seite ist das Dashboard zur Sicherheit ",
    readOnlyRest2:
      ". Alles, was dein Team oder deine Daten ändert, geschieht über die Desktop-App oder die CLI, auf deinem Rechner.",
    outputH2: "📄 Das Ergebnis, auf das du reagierst",
    outputRest1:
      "Genehmigte Bewerbungen landen als versandfertige Pakete (Lebenslauf + Anschreiben) in deinem Dokumentenordner ",
    outputReady: "„Bereit zum Absenden“",
    outputRest2:
      ", markiert mit %READY%. Du öffnest, prüfst und versendest sie selbst.",
    githubMore: "die Docs auf GitHub",
  },
  hu: {
    title: "Az irányítópultod és az eredmények",
    tagline: "Ahol a csapat munkája megjelenik — és hogyan olvasd",
    intro:
      "Amint a csapat elindul, pozíciók folyamatos áramát állítja elő, mindegyiket ellenőrizve és a profilodhoz pontozva. Ez az oldal elmagyarázza, mit látsz és hogyan működnek a számok.",
    flowH2: "🔄 Hogyan halad egy pozíció",
    flowP:
      "Minden állás végighalad a folyamaton, mielőtt hozzád érne. A pontszám a kulcsjelzés:",
    flowPre: `🕵️  Felderítő talál egy pozíciót          → new
🔬  Elemző   ellenőrzi a szerepet + céget  → checked
💯  Pontozó  0–100-ra pontozza hozzád képest → scored
              ├─ score < 40  → félretéve
              └─ score ≥ 50  → átadva az Írónak
✍️  Író      személyre szabott önéletrajzot + levelet ír
⚖️  Kritikus vakon átnézi (3 kör)          → ready
👤  Te       átnézed és eldöntöd, mit küldj`,
    calloutScoreStrong: "A pontszám kompatibilitási becslés, nem ítélet.",
    calloutScoreRest:
      "Azt mutatja, mennyire illik egy hirdetés a profilodhoz — te maradsz a bíró afelett, mit érdemes követni. Soha semmit nem küldünk el a nevedben.",
    whereH2: "🖥️ Hol olvasd",
    webH3: "A webes irányítópult",
    webP: "Böngészőből a teljes képet kapod:",
    webLi1: "Minden megtalált pozíció, az illeszkedési pontszámával.",
    webLi2: "A lehetőségek térképe város és ország szerint.",
    webLi3: "Minden jelentkezés állapota.",
    webLi4: "A csapat tevékenysége és az aktuális kiadások.",
    termH3: "A terminál, ha azt szereted",
    termPre: `jht positions list        # minden pozíció a helyi adatbázisban
jht positions show 42     # egy pozíció részletei
jht positions dashboard   # terminálbarát nézet
jht stats                 # talált / pontozott / jelentkezett darabszámok`,
    loginH2: "🔐 A bejelentkezés opcionális",
    loginP1:
      "A regisztrációval bármely eszközről eléred az adataidat — de nem kötelező. Mindent megtarthatsz ",
    loginP2Strong: "a saját számítógépeden",
    loginP2Rest: ", felhő nélkül:",
    withSignupStrong: "Regisztrációval",
    withSignupRest1: " — a helyi adatok tükröződnek a felhőbe; nyisd meg a ",
    withSignupRest2:
      " címet bármely böngészőből, oszd meg egy mentorral. Az önéletrajzaid helyben maradnak; csak a metaadatok szinkronizálódnak.",
    withoutStrong: "Regisztráció nélkül",
    withoutRest1: " — teljesen helyi. Az irányítópult itt él: ",
    withoutRest2: ", semmi külsőhöz nem nyúl.",
    readOnlyStrong: "csak olvasható",
    readOnlyRest1: "🌐 A nyilvános oldalon az irányítópult biztonsági okból ",
    readOnlyRest2:
      ". Minden, ami a csapatodat vagy az adataidat módosítja, az asztali alkalmazásból vagy a CLI-ből történik, a saját gépeden.",
    outputH2: "📄 Az eredmény, amire reagálsz",
    outputRest1:
      "A jóváhagyott jelentkezések küldésre kész csomagokként (önéletrajz + kísérőlevél) érkeznek a ",
    outputReady: "„Küldésre kész”",
    outputRest2:
      " dokumentummappádba, %READY% megjelöléssel. Te nyitod meg, nézed át és küldöd el őket.",
    githubMore: "a dokumentáció a GitHubon",
  },
  pt: {
    title: "O teu painel e resultados",
    tagline: "Onde o trabalho da equipa aparece — e como o ler",
    intro:
      "Assim que a equipa está em funcionamento, produz um fluxo constante de posições, cada uma verificada e pontuada em relação ao teu perfil. Esta página explica o que vês e como os números funcionam.",
    flowH2: "🔄 Como flui uma posição",
    flowP:
      "Cada vaga passa pelo pipeline antes de chegar até ti. A pontuação é o sinal-chave:",
    flowPre: `🕵️  Scout    encontra uma posição        → new
🔬  Analista verifica o cargo + empresa  → checked
💯  Scorer   pontua-a 0–100 vs ti        → scored
              ├─ score < 40  → posta de lado
              └─ score ≥ 50  → entregue ao Redator
✍️  Redator  redige um CV + carta à medida
⚖️  Crítico  revê-a às cegas (3 rondas)   → ready
👤  Tu       revês e decides o que enviar`,
    calloutScoreStrong:
      "A pontuação é uma estimativa de compatibilidade, não um veredicto.",
    calloutScoreRest:
      "Indica o quão bem um anúncio corresponde ao teu perfil — continuas a ser tu a decidir o que vale a pena perseguir. Nada é jamais enviado em teu nome.",
    whereH2: "🖥️ Onde o ler",
    webH3: "O painel web",
    webP: "A partir de um navegador, tens o quadro completo:",
    webLi1: "Cada posição encontrada, com a sua pontuação de compatibilidade.",
    webLi2: "O mapa de oportunidades por cidade e país.",
    webLi3: "O estado de cada candidatura.",
    webLi4: "A atividade da equipa e a despesa atual.",
    termH3: "O terminal, se preferires",
    termPre: `jht positions list        # todas as posições na BD local
jht positions show 42     # detalhe de uma posição
jht positions dashboard   # uma vista adaptada ao terminal
jht stats                 # contagens encontradas / pontuadas / candidatadas`,
    loginH2: "🔐 O início de sessão é opcional",
    loginP1:
      "Registares-te permite-te aceder aos teus dados a partir de qualquer dispositivo — mas não é obrigatório. Podes manter ",
    loginP2Strong: "tudo no teu próprio computador",
    loginP2Rest: ", sem qualquer nuvem:",
    withSignupStrong: "Com registo",
    withSignupRest1: " — os dados locais espelham-se na nuvem; abre ",
    withSignupRest2:
      " a partir de qualquer navegador, partilha com um mentor. Os teus CV ficam em local; só os metadados sincronizam.",
    withoutStrong: "Sem registo",
    withoutRest1: " — totalmente local. O painel vive em ",
    withoutRest2: ", nada externo é tocado.",
    readOnlyStrong: "apenas de leitura",
    readOnlyRest1: "🌐 No site público o painel é ",
    readOnlyRest2:
      " por segurança. Tudo o que altera a tua equipa ou os teus dados acontece a partir da app de ambiente de trabalho ou da CLI, na tua máquina.",
    outputH2: "📄 O resultado sobre o qual ages",
    outputRest1:
      "As candidaturas aprovadas chegam como pacotes prontos a enviar (CV + carta de apresentação) na tua pasta de documentos ",
    outputReady: '"Pronto a enviar"',
    outputRest2:
      ", marcadas como %READY%. Abre-las, revê-las e envia-las tu mesmo.",
    githubMore: "os docs no GitHub",
  },
};

export default async function DashboardAndResultsPage() {
  const locale = await getRequestLocale();
  const t = T[locale];

  const [readyBefore, readyAfter] = t.outputRest2.split("%READY%");

  return (
    <div>
      <DocHeader emoji="📊" title={t.title} tagline={t.tagline}>
        {t.intro}
      </DocHeader>

      <H2>{t.flowH2}</H2>
      <P>{t.flowP}</P>
      <Pre>{t.flowPre}</Pre>
      <Callout>
        🎯 <strong>{t.calloutScoreStrong}</strong> {t.calloutScoreRest}
      </Callout>

      <H2>{t.whereH2}</H2>

      <H3>{t.webH3}</H3>
      <P>{t.webP}</P>
      <UL>
        <LI>{t.webLi1}</LI>
        <LI>{t.webLi2}</LI>
        <LI>{t.webLi3}</LI>
        <LI>{t.webLi4}</LI>
      </UL>

      <H3>{t.termH3}</H3>
      <Pre>{t.termPre}</Pre>

      <H2>{t.loginH2}</H2>
      <P>
        {t.loginP1}
        <strong>{t.loginP2Strong}</strong>
        {t.loginP2Rest}
      </P>
      <UL>
        <LI>
          <strong>{t.withSignupStrong}</strong>
          {t.withSignupRest1}
          <Code>jobhunterteam.ai</Code>
          {t.withSignupRest2}
        </LI>
        <LI>
          <strong>{t.withoutStrong}</strong>
          {t.withoutRest1}
          <Code>localhost:3000</Code>
          {t.withoutRest2}
        </LI>
      </UL>
      <Callout>
        {t.readOnlyRest1}
        <strong>{t.readOnlyStrong}</strong>
        {t.readOnlyRest2}
      </Callout>

      <H2>{t.outputH2}</H2>
      <P>
        {t.outputRest1}
        <Code>Job Hunter Team</Code>
        {readyBefore}
        <strong>{t.outputReady}</strong>
        {readyAfter}
      </P>

      <GitHubMore href={repoTree("docs")}>{t.githubMore}</GitHubMore>
    </div>
  );
}
