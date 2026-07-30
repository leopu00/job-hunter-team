// Dizionario di `page.tsx` (EN e IT autorati, le altre lingue con fallback dichiarato su EN).
//
// Le chiavi sono LOCALI a questa guida: lo stesso nome può valere tutt'altro
// altrove, quindi non vanno accorpate in un dizionario comune. Il tipo su
// `T` fa pretendere al compilatore ogni lingua dichiarata: una voce a cui
// ne manca una non compila, invece di mostrare l'inglese all'utente
// sbagliato.
import type { Locale } from "@/i18n/config";

export type PrivacyCopy = {
  title: string;
  tagline: string;
  intro: string;
  h1: string;
  p1: string;
  h2: string;
  p2: string;
  h3: string;
  p3: string;
  h4: string;
  p4: string;
  h5: string;
  p5: string;
  h6: string;
  p6: string;
  h7: string;
  p7: string;
  closing: string;
  githubMore: string;
};

// EN + IT autorati; le altre lingue arrivano dai traduttori (fallback su EN
// finché non presenti) — stesso pattern delle altre guide.
export const T: Partial<Record<Locale, PrivacyCopy>> = {
  en: {
    title: "Privacy & security",
    tagline: "Your data stays yours",
    intro:
      "Job Hunter Team runs on your own computer. Here's plainly — no jargon — what that means for your data, your CVs and your keys.",
    h1: "It runs on your machine",
    p1: "By default everything lives locally: the positions found, your CVs, your profile. The team works from files on your own disk (or your own server) — nothing is forced through a cloud you don't control.",
    h2: "The cloud is optional",
    p2: "Online sync exists only so you can reach your data from another device, and it's your choice to turn on or off. If you'd rather stay fully offline, Job Hunter Team works entirely on your local files.",
    h3: "Your keys and passwords stay with you",
    p3: "Your credentials — provider logins, app passwords — are encrypted on your computer with strong encryption (AES-256), and the key to unlock them lives in your operating system's secure store (Keychain on macOS, Credential Manager on Windows, the secret service on Linux). They don't leave your machine.",
    h4: "No hidden tracking",
    p4: "Job Hunter Team doesn't send your usage to us or to third parties. There's no analytics beacon phoning home — any activity log stays local, on your machine.",
    h5: "Walled off from the rest of your computer",
    p5: "Each agent runs inside an isolated container that can only see two folders: your Job Hunter Team data and your documents (the CVs). The rest of your computer stays invisible to it.",
    h6: "Open and verifiable",
    p6: "Job Hunter Team is open source — anyone can read the code and check how it handles your data. And the sensitive actions (managing the team, your configuration, your personal data) happen only from the app on your machine, never from a public web panel.",
    h7: "Cookies: only what the site needs",
    p7: "This website uses no advertising or tracking cookies. Beyond the login session it keeps small technical cookies for your own choices: the language of the interface, whether you have already seen the welcome wizard, and — if you try the demo — which sample profile you picked and the verdicts you give while exploring it. Demo verdicts live in that cookie and nowhere else: nothing is written to any database, and leaving the demo deletes them.",
    closing:
      "🔒 In short: your job hunt, your CVs and your keys stay on your computer. The cloud is an option you control, not a requirement.",
    githubMore: "the docs on GitHub",
  },
  it: {
    title: "Privacy e sicurezza",
    tagline: "I tuoi dati restano tuoi",
    intro:
      "Job Hunter Team gira sul tuo computer. Ecco, senza gerghi, cosa significa per i tuoi dati, i tuoi CV e le tue chiavi.",
    h1: "Gira sulla tua macchina",
    p1: "Di default tutto resta in locale: le posizioni trovate, i tuoi CV, il tuo profilo. Il team lavora su file che stanno sul tuo disco (o sul tuo server) — niente passa per forza da un cloud che non controlli.",
    h2: "Il cloud è opzionale",
    p2: "La sincronizzazione online serve solo a raggiungere i tuoi dati da un altro dispositivo, e sei tu a decidere se attivarla o no. Se preferisci restare del tutto offline, Job Hunter Team funziona interamente sui tuoi file locali.",
    h3: "Le tue chiavi e password restano con te",
    p3: "Le tue credenziali — accessi ai provider, app-password — sono cifrate sul tuo computer con crittografia forte (AES-256), e la chiave per sbloccarle vive nel portachiavi sicuro del tuo sistema operativo (Keychain su macOS, Gestione credenziali su Windows, il secret service su Linux). Non lasciano la tua macchina.",
    h4: "Nessun tracciamento nascosto",
    p4: "Job Hunter Team non invia il tuo utilizzo a noi né a terzi. Non c'è nessun beacon di analytics che «telefona a casa» — l'eventuale registro delle attività resta in locale, sulla tua macchina.",
    h5: "Isolato dal resto del computer",
    p5: "Ogni agente gira dentro un contenitore isolato che vede solo due cartelle: i dati di Job Hunter Team e i tuoi documenti (i CV). Tutto il resto del computer gli resta invisibile.",
    h6: "Aperto e verificabile",
    p6: "Job Hunter Team è open source — chiunque può leggere il codice e controllare come tratta i tuoi dati. E le azioni sensibili (gestione del team, configurazione, dati personali) avvengono solo dall'app sulla tua macchina, mai da un pannello web pubblico.",
    h7: "Cookie: solo quelli che servono al sito",
    p7: "Questo sito non usa cookie pubblicitari né di tracciamento. Oltre alla sessione di login conserva piccoli cookie tecnici per le tue scelte: la lingua dell'interfaccia, se hai già visto la procedura di benvenuto e — se provi la demo — quale profilo d'esempio hai scelto e i giudizi che dai mentre la esplori. I giudizi della demo vivono lì dentro e da nessun'altra parte: non viene scritto niente su nessun database, e uscendo dalla demo vengono cancellati.",
    closing:
      "🔒 In sintesi: la tua ricerca di lavoro, i tuoi CV e le tue chiavi restano sul tuo computer. Il cloud è un'opzione che controlli tu, non un obbligo.",
    githubMore: "i docs su GitHub",
  },
  es: {
    title: "Privacidad y seguridad",
    tagline: "Tus datos siguen siendo tuyos",
    intro:
      "Job Hunter Team se ejecuta en tu propio ordenador. Aquí tienes, sin tecnicismos, qué significa eso para tus datos, tus CV y tus claves.",
    h1: "Se ejecuta en tu máquina",
    p1: "Por defecto todo se queda en local: las posiciones encontradas, tus CV, tu perfil. El equipo trabaja sobre archivos que están en tu propio disco (o en tu propio servidor) — nada pasa a la fuerza por una nube que no controlas.",
    h2: "La nube es opcional",
    p2: "La sincronización online existe solo para que puedas llegar a tus datos desde otro dispositivo, y eres tú quien decide si activarla o no. Si prefieres quedarte totalmente offline, Job Hunter Team funciona por completo con tus archivos locales.",
    h3: "Tus claves y contraseñas se quedan contigo",
    p3: "Tus credenciales — accesos a los proveedores, contraseñas de aplicación — se cifran en tu ordenador con cifrado fuerte (AES-256), y la clave para desbloquearlas vive en el almacén seguro de tu sistema operativo (Keychain en macOS, Credential Manager en Windows, el secret service en Linux). No salen de tu máquina.",
    h4: "Sin seguimiento oculto",
    p4: "Job Hunter Team no envía tu uso ni a nosotros ni a terceros. No hay ningún beacon de analítica que «llame a casa» — el posible registro de actividad se queda en local, en tu máquina.",
    h5: "Aislado del resto de tu ordenador",
    p5: "Cada agente se ejecuta dentro de un contenedor aislado que solo puede ver dos carpetas: los datos de Job Hunter Team y tus documentos (los CV). Todo el resto de tu ordenador le queda invisible.",
    h6: "Abierto y verificable",
    p6: "Job Hunter Team es open source — cualquiera puede leer el código y comprobar cómo trata tus datos. Y las acciones sensibles (gestionar el equipo, tu configuración, tus datos personales) suceden solo desde la app en tu máquina, nunca desde un panel web público.",
    h7: "Cookies: solo las que el sitio necesita",
    p7: "Esta web no usa cookies publicitarias ni de seguimiento. Además de la sesión de acceso guarda pequeñas cookies técnicas para tus propias elecciones: el idioma de la interfaz, si ya has visto el asistente de bienvenida y —si pruebas la demo— qué perfil de ejemplo elegiste y las valoraciones que das mientras la exploras. Las valoraciones de la demo viven en esa cookie y en ningún otro sitio: no se escribe nada en ninguna base de datos, y al salir de la demo se borran.",
    closing:
      "🔒 En resumen: tu búsqueda de trabajo, tus CV y tus claves se quedan en tu ordenador. La nube es una opción que controlas tú, no una obligación.",
    githubMore: "los docs en GitHub",
  },
  fr: {
    title: "Confidentialité et sécurité",
    tagline: "Vos données restent les vôtres",
    intro:
      "Job Hunter Team fonctionne sur votre propre ordinateur. Voici, en clair et sans jargon, ce que cela signifie pour vos données, vos CV et vos clés.",
    h1: "Il tourne sur votre machine",
    p1: "Par défaut, tout reste en local : les postes trouvés, vos CV, votre profil. L’équipe travaille sur des fichiers qui se trouvent sur votre propre disque (ou sur votre propre serveur) — rien ne passe de force par un cloud que vous ne contrôlez pas.",
    h2: "Le cloud est facultatif",
    p2: "La synchronisation en ligne n’existe que pour vous permettre d’accéder à vos données depuis un autre appareil, et c’est vous qui choisissez de l’activer ou non. Si vous préférez rester entièrement hors ligne, Job Hunter Team fonctionne intégralement sur vos fichiers locaux.",
    h3: "Vos clés et vos mots de passe restent avec vous",
    p3: "Vos identifiants — connexions aux fournisseurs, mots de passe d’application — sont chiffrés sur votre ordinateur avec un chiffrement fort (AES-256), et la clé qui permet de les déverrouiller réside dans le coffre sécurisé de votre système d’exploitation (Keychain sur macOS, Credential Manager sur Windows, le secret service sur Linux). Ils ne quittent pas votre machine.",
    h4: "Aucun pistage caché",
    p4: "Job Hunter Team n’envoie votre utilisation ni à nous ni à des tiers. Il n’y a aucune balise d’analytics qui « téléphone à la maison » — l’éventuel journal d’activité reste en local, sur votre machine.",
    h5: "Isolé du reste de votre ordinateur",
    p5: "Chaque agent s’exécute dans un conteneur isolé qui ne peut voir que deux dossiers : vos données Job Hunter Team et vos documents (les CV). Le reste de votre ordinateur lui reste invisible.",
    h6: "Ouvert et vérifiable",
    p6: "Job Hunter Team est open source — n’importe qui peut lire le code et vérifier comment il traite vos données. Et les actions sensibles (gestion de l’équipe, votre configuration, vos données personnelles) ne se font que depuis l’application sur votre machine, jamais depuis un panneau web public.",
    h7: "Cookies : uniquement ce dont le site a besoin",
    p7: "Ce site n’utilise aucun cookie publicitaire ni de pistage. Au-delà de la session de connexion, il conserve de petits cookies techniques pour vos propres choix : la langue de l’interface, le fait que vous ayez déjà vu l’assistant de bienvenue et — si vous essayez la démo — le profil d’exemple que vous avez choisi ainsi que les avis que vous donnez en l’explorant. Les avis de la démo vivent dans ce cookie et nulle part ailleurs : rien n’est écrit dans une base de données, et quitter la démo les supprime.",
    closing:
      "🔒 En résumé : votre recherche d’emploi, vos CV et vos clés restent sur votre ordinateur. Le cloud est une option que vous contrôlez, pas une obligation.",
    githubMore: "les docs sur GitHub",
  },
  de: {
    title: "Datenschutz & Sicherheit",
    tagline: "Deine Daten bleiben deine",
    intro:
      "Job Hunter Team läuft auf deinem eigenen Computer. Hier erklären wir dir klar — ganz ohne Fachjargon — was das für deine Daten, deine Lebensläufe und deine Schlüssel bedeutet.",
    h1: "Es läuft auf deiner Maschine",
    p1: "Standardmäßig bleibt alles lokal: die gefundenen Stellen, deine Lebensläufe, dein Profil. Das Team arbeitet mit Dateien, die auf deiner eigenen Festplatte (oder deinem eigenen Server) liegen — nichts wird zwangsweise durch eine Cloud geleitet, die du nicht kontrollierst.",
    h2: "Die Cloud ist optional",
    p2: "Die Online-Synchronisierung gibt es nur, damit du von einem anderen Gerät auf deine Daten zugreifen kannst, und es ist deine Entscheidung, sie ein- oder auszuschalten. Wenn du lieber komplett offline bleibst, funktioniert Job Hunter Team vollständig mit deinen lokalen Dateien.",
    h3: "Deine Schlüssel und Passwörter bleiben bei dir",
    p3: "Deine Zugangsdaten — Provider-Logins, App-Passwörter — werden auf deinem Computer mit starker Verschlüsselung (AES-256) verschlüsselt, und der Schlüssel zum Entsperren liegt im sicheren Speicher deines Betriebssystems (Keychain auf macOS, Credential Manager auf Windows, der secret service auf Linux). Sie verlassen deine Maschine nicht.",
    h4: "Kein verstecktes Tracking",
    p4: "Job Hunter Team sendet deine Nutzung weder an uns noch an Dritte. Es gibt kein Analytics-Beacon, das „nach Hause telefoniert“ — ein eventuelles Aktivitätsprotokoll bleibt lokal, auf deiner Maschine.",
    h5: "Abgeschottet vom Rest deines Computers",
    p5: "Jeder Agent läuft in einem isolierten Container, der nur zwei Ordner sehen kann: deine Job-Hunter-Team-Daten und deine Dokumente (die Lebensläufe). Der Rest deines Computers bleibt für ihn unsichtbar.",
    h6: "Offen und überprüfbar",
    p6: "Job Hunter Team ist Open Source — jeder kann den Code lesen und überprüfen, wie er mit deinen Daten umgeht. Und die sensiblen Aktionen (Verwaltung des Teams, deine Konfiguration, deine persönlichen Daten) passieren nur über die App auf deiner Maschine, niemals über ein öffentliches Web-Panel.",
    h7: "Cookies: nur das, was die Seite braucht",
    p7: "Diese Website verwendet keine Werbe- oder Tracking-Cookies. Über die Anmeldesitzung hinaus speichert sie nur kleine technische Cookies für deine eigenen Entscheidungen: die Sprache der Oberfläche, ob du den Willkommensassistenten schon gesehen hast, und — falls du die Demo ausprobierst — welches Beispielprofil du gewählt hast sowie die Bewertungen, die du beim Erkunden abgibst. Die Demo-Bewertungen leben in diesem Cookie und sonst nirgendwo: es wird nichts in eine Datenbank geschrieben, und beim Verlassen der Demo werden sie gelöscht.",
    closing:
      "🔒 Kurz gesagt: deine Jobsuche, deine Lebensläufe und deine Schlüssel bleiben auf deinem Computer. Die Cloud ist eine Option, die du kontrollierst, kein Muss.",
    githubMore: "die Docs auf GitHub",
  },
  hu: {
    title: "Adatvédelem és biztonság",
    tagline: "Az adataid a tieid maradnak",
    intro:
      "A Job Hunter Team a saját számítógépeden fut. Íme, szakzsargon nélkül, hogy ez mit jelent az adataid, az önéletrajzaid és a kulcsaid szempontjából.",
    h1: "A saját gépeden fut",
    p1: "Alapból minden helyben marad: a megtalált pozíciók, az önéletrajzaid, a profilod. A csapat a saját lemezeden (vagy a saját szervereden) lévő fájlokból dolgozik — semmi sem megy át kényszerből egy olyan felhőn, amelyet nem te felügyelsz.",
    h2: "A felhő opcionális",
    p2: "Az online szinkronizálás csak azért létezik, hogy egy másik eszközről is elérd az adataidat, és te döntöd el, hogy bekapcsolod-e vagy sem. Ha inkább teljesen offline szeretnél maradni, a Job Hunter Team teljes egészében a helyi fájljaidon működik.",
    h3: "A kulcsaid és jelszavaid nálad maradnak",
    p3: "A hitelesítő adataidat — a szolgáltatói belépéseket, app-jelszavakat — erős titkosítással (AES-256) titkosítjuk a számítógépeden, és a feloldásukhoz szükséges kulcs az operációs rendszered biztonságos tárolójában él (Keychain macOS-en, Credential Manager Windowson, a secret service Linuxon). Nem hagyják el a gépedet.",
    h4: "Semmi rejtett nyomkövetés",
    p4: "A Job Hunter Team nem küldi el a használati adataidat sem nekünk, sem harmadik feleknek. Nincs semmilyen analitikai jeladó, amely „hazatelefonálna“ — az esetleges tevékenységnapló helyben marad, a saját gépeden.",
    h5: "Elszigetelve a számítógéped többi részétől",
    p5: "Minden ügynök egy elszigetelt konténerben fut, amely csak két mappát lát: a Job Hunter Team adatait és a dokumentumaidat (az önéletrajzokat). A számítógéped összes többi része láthatatlan marad számára.",
    h6: "Nyílt és ellenőrizhető",
    p6: "A Job Hunter Team nyílt forráskódú — bárki elolvashatja a kódot, és ellenőrizheti, hogyan kezeli az adataidat. Az érzékeny műveletek pedig (a csapat kezelése, a konfigurációd, a személyes adataid) csak a gépeden lévő alkalmazásból történnek, soha nem egy nyilvános webes panelről.",
    h7: "Sütik: csak amire az oldalnak szüksége van",
    p7: "Ez a webhely nem használ hirdetési vagy nyomkövető sütiket. A bejelentkezési munkameneten túl csak apró technikai sütiket tárol a saját döntéseidhez: a felület nyelvét, hogy láttad-e már az üdvözlő varázslót, és — ha kipróbálod a demót — hogy melyik mintaprofilt választottad, valamint az értékeléseket, amelyeket böngészés közben adsz. A demó értékelései ebben a sütiben élnek és sehol máshol: semmi sem kerül adatbázisba, és a demóból kilépve törlődnek.",
    closing:
      "🔒 Röviden: az álláskeresésed, az önéletrajzaid és a kulcsaid a számítógépeden maradnak. A felhő egy általad felügyelt lehetőség, nem kötelezettség.",
    githubMore: "a dokumentáció a GitHubon",
  },
  pt: {
    title: "Privacidade e segurança",
    tagline: "Os teus dados continuam a ser teus",
    intro:
      "O Job Hunter Team corre no teu próprio computador. Aqui fica, sem termos técnicos, o que isso significa para os teus dados, os teus CV e as tuas chaves.",
    h1: "Corre na tua máquina",
    p1: "Por predefinição fica tudo em local: as posições encontradas, os teus CV, o teu perfil. A equipa trabalha sobre ficheiros que estão no teu próprio disco (ou no teu próprio servidor) — nada passa obrigatoriamente por uma cloud que não controlas.",
    h2: "A cloud é opcional",
    p2: "A sincronização online existe apenas para conseguires chegar aos teus dados a partir de outro dispositivo, e és tu que decides se a ligas ou não. Se preferires ficar totalmente offline, o Job Hunter Team funciona inteiramente sobre os teus ficheiros locais.",
    h3: "As tuas chaves e palavras-passe ficam contigo",
    p3: "As tuas credenciais — acessos aos fornecedores, palavras-passe de aplicação — são cifradas no teu computador com encriptação forte (AES-256), e a chave para as desbloquear vive no cofre seguro do teu sistema operativo (Keychain no macOS, Credential Manager no Windows, o secret service no Linux). Não saem da tua máquina.",
    h4: "Sem rastreio escondido",
    p4: "O Job Hunter Team não envia a tua utilização para nós nem para terceiros. Não há nenhum beacon de analytics a «telefonar para casa» — o eventual registo de atividade fica em local, na tua máquina.",
    h5: "Isolado do resto do computador",
    p5: "Cada agente corre dentro de um contentor isolado que só consegue ver duas pastas: os dados do Job Hunter Team e os teus documentos (os CV). Todo o resto do computador permanece invisível para ele.",
    h6: "Aberto e verificável",
    p6: "O Job Hunter Team é open source — qualquer pessoa pode ler o código e verificar como trata os teus dados. E as ações sensíveis (gestão da equipa, a tua configuração, os teus dados pessoais) acontecem apenas a partir da app na tua máquina, nunca a partir de um painel web público.",
    h7: "Cookies: apenas os que o site precisa",
    p7: "Este site não usa cookies publicitários nem de rastreio. Para além da sessão de início de sessão, guarda pequenos cookies técnicos para as tuas próprias escolhas: o idioma da interface, se já viste o assistente de boas-vindas e — se experimentares a demonstração — que perfil de exemplo escolheste e as avaliações que dás enquanto a exploras. As avaliações da demonstração vivem nesse cookie e em mais lado nenhum: nada é escrito em nenhuma base de dados, e ao sair da demonstração são apagadas.",
    closing:
      "🔒 Em resumo: a tua procura de emprego, os teus CV e as tuas chaves ficam no teu computador. A cloud é uma opção que controlas tu, não uma obrigação.",
    githubMore: "os docs no GitHub",
  },
};
