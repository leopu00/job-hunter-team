// Dizionario di `page.tsx` (guida: la Gmail dedicata del team).
//
// Le chiavi sono LOCALI a questa guida: lo stesso nome può valere tutt'altro
// altrove, quindi non vanno accorpate in un dizionario comune.
// `Record<Locale, Strings>` fa pretendere al compilatore tutte e sette le
// lingue: EN e IT sono autorati, le altre fanno fallback dichiarato su EN
// nella mappa `T` in fondo.
//
// Il file è `.tsx` e non `.ts` perché le voci contengono JSX. `Ext`,
// `LINK_CLS` e i tre link a Google/GMX vivono qui perché sono usati solo
// dalle voci del dizionario, mai dalla pagina.
import Link from "next/link";
import type { Locale } from "@/i18n/config";

export const LINK_CLS =
  "text-[var(--color-white)] underline underline-offset-2 hover:text-[var(--color-green)] transition-colors break-all";

export function Ext({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_CLS}
    >
      {children}
    </a>
  );
}

export const TWOSV = "https://myaccount.google.com/signinoptions/twosv";
export const APPPW = "https://myaccount.google.com/apppasswords";
export const GMX = "https://signup.gmx.com";

// L'app desktop non è ancora scaricabile (in arrivo per macOS/Windows/Linux):
// i passaggi della guida che la citano si applicano al suo arrivo.
export const DESKTOP_SOON: Record<string, string> = {
  it: "Nota: l'app desktop citata in questa guida non è ancora scaricabile — è in arrivo per macOS, Windows e Linux.",
  en: "Note: the desktop app mentioned in this guide isn't downloadable yet — it's coming to macOS, Windows and Linux.",
  es: "Nota: la app de escritorio mencionada en esta guía aún no se puede descargar — llegará a macOS, Windows y Linux.",
  fr: "Remarque : l'application de bureau mentionnée dans ce guide n'est pas encore téléchargeable — elle arrive sur macOS, Windows et Linux.",
  de: "Hinweis: Die in dieser Anleitung erwähnte Desktop-App ist noch nicht herunterladbar — sie kommt für macOS, Windows und Linux.",
  hu: "Megjegyzés: az útmutatóban említett asztali app még nem tölthető le — hamarosan érkezik macOS-re, Windowsra és Linuxra.",
  pt: "Nota: a app de ambiente de trabalho mencionada neste guia ainda não pode ser descarregada — está a chegar a macOS, Windows e Linux.",
};

export type Strings = {
  bcHome: string;
  bcDocs: string;
  bcThis: string;
  pageTitle: string;
  pageSubtitle: string;
  intro: React.ReactNode;
  calloutOptional: React.ReactNode;

  s1Title: string;
  s1Body: React.ReactNode;

  s2Title: string;
  s2Body: React.ReactNode;
  s2Callout: React.ReactNode;

  s3Title: string;
  s3Body: React.ReactNode;
  s3Steps: React.ReactNode[];

  s4Title: string;
  s4Body: React.ReactNode;

  s5Title: string;
  s5Body: React.ReactNode;

  gmxTitle: string;
  gmxBody: React.ReactNode;
  gmxSteps: React.ReactNode[];

  forwardNote: React.ReactNode;
};

const EN: Strings = {
  bcHome: "Home",
  bcDocs: "Docs",
  bcThis: "Set up the team's Gmail",
  pageTitle: "Set up the team's Gmail",
  pageSubtitle: "Create a dedicated inbox the team can read — step by step.",
  intro: (
    <>
      The team can read a dedicated email inbox and turn the job alerts you
      forward there into scored opportunities. This guide walks through creating
      a <strong>dedicated Gmail</strong> for the team and the{" "}
      <strong>app password</strong> it needs to connect. For why it helps and
      how to auto-forward your alerts, see{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Email Forwarding
      </Link>
      .
    </>
  ),
  calloutOptional: (
    <>
      <strong>Optional.</strong> You can skip this during setup and add it later
      from the desktop app. Without it, the team still finds jobs on the web —
      it just gets fewer, lower-signal leads. In a hurry or no phone to hand?
      Jump to <em>“No phone? Use GMX instead”</em> below.
    </>
  ),

  s1Title: "1. Create a dedicated Gmail",
  s1Body: (
    <>
      Make a <strong>brand-new, free Gmail just for the team</strong> — not your
      personal inbox. A dedicated address keeps your job hunt separate and means
      the team only ever sees what you forward to it. Pick something like{" "}
      <code>yourname.jht@gmail.com</code>.
    </>
  ),

  s2Title: "2. Turn on 2-Step Verification",
  s2Body: (
    <>
      Gmail only allows an “app password” once 2-Step Verification is on. Open{" "}
      <Ext href={TWOSV}>{TWOSV}</Ext> and turn it on (Google will ask for a
      phone number once, to send a verification code).
    </>
  ),
  s2Callout: (
    <>
      If the app-password page later shows{" "}
      <em>
        “The setting you are looking for is not available for your account”
      </em>{" "}
      with a little broken robot, it means 2-Step Verification isn’t on yet —
      finish this step first.
    </>
  ),

  s3Title: "3. Create the app password",
  s3Body: (
    <>
      Open <Ext href={APPPW}>{APPPW}</Ext> and create one:
    </>
  ),
  s3Steps: [
    <>
      Give it a name (e.g. <code>JHT</code>) and click <strong>Create</strong>.
    </>,
    <>
      Google shows a <strong>16-character code</strong> (four groups of four).
      Copy it.
    </>,
    <>
      Paste that code into the app’s <strong>App password</strong> field — not
      your normal Gmail login password. Spaces don’t matter.
    </>,
  ],

  s4Title: "4. Enable IMAP in Gmail",
  s4Body: (
    <>
      In Gmail:{" "}
      <strong>
        ⚙️ Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP →
        Save
      </strong>
      . This lets the team read the inbox.
    </>
  ),

  s5Title: "5. Connect it in the app",
  s5Body: (
    <>
      In the desktop app’s onboarding email step, enter the{" "}
      <strong>Gmail address</strong> and the <strong>app password</strong>, tick
      “this is a dedicated inbox”, and press <strong>Verify connection</strong>{" "}
      — the app does a quick round-trip (sign in, send a test code, read it
      back) to confirm it works. You can also add or change it later from the{" "}
      <strong>Home → Email</strong> panel, where you simply enter the address
      and app password and press <strong>Save</strong>. Either way, the
      credentials are saved locally on your computer.
    </>
  ),

  gmxTitle: "No phone? Use GMX instead",
  gmxBody: (
    <>
      Don’t want to give Google a phone number? <strong>GMX</strong> is a free
      provider that accepts your normal password (no 2-Step Verification, no app
      password):
    </>
  ),
  gmxSteps: [
    <>
      Create an account at <Ext href={GMX}>{GMX}</Ext>.
    </>,
    <>
      Enable IMAP:{" "}
      <strong>
        Settings → POP3 &amp; IMAP → tick “Enable access via POP3 and IMAP” →
        Save
      </strong>{" "}
      (it’s off by default).
    </>,
    <>
      In the app, use your <code>name@gmx.com</code> address and your{" "}
      <strong>normal password</strong> (the “App password” field accepts it).
    </>,
  ],

  forwardNote: (
    <>
      Done? Next, set up auto-forwarding so your job alerts land in this inbox —
      see{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Email Forwarding
      </Link>
      .
    </>
  ),
};

const IT: Strings = {
  bcHome: "Home",
  bcDocs: "Docs",
  bcThis: "Configura la Gmail del team",
  pageTitle: "Configura la Gmail del team",
  pageSubtitle:
    "Crea una casella dedicata che il team può leggere — passo per passo.",
  intro: (
    <>
      Il team può leggere una casella email dedicata e trasformare i job alert
      che inoltri lì in opportunità con un punteggio. Questa guida ti accompagna
      nella creazione di una <strong>Gmail dedicata</strong> per il team e dell’
      <strong>app-password</strong> che serve per collegarla. Per il perché
      conviene e come inoltrare in automatico gli avvisi, vedi{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Inoltro email
      </Link>
      .
    </>
  ),
  calloutOptional: (
    <>
      <strong>Opzionale.</strong> Puoi saltarla durante il setup e aggiungerla
      dopo dall’app desktop. Senza, il team trova comunque lavoro sul web — solo
      con lead meno mirati. Di fretta o senza telefono a portata? Vai a{" "}
      <em>“Niente telefono? Usa GMX”</em> più sotto.
    </>
  ),

  s1Title: "1. Crea una Gmail dedicata",
  s1Body: (
    <>
      Crea una <strong>Gmail nuova e gratuita solo per il team</strong> — non la
      tua casella personale. Un indirizzo dedicato tiene separata la ricerca di
      lavoro e fa sì che il team veda solo ciò che gli inoltri. Scegli qualcosa
      tipo <code>tuonome.jht@gmail.com</code>.
    </>
  ),

  s2Title: "2. Attiva la verifica in 2 passaggi",
  s2Body: (
    <>
      Gmail permette di creare un’“app-password” solo con la verifica in 2
      passaggi attiva. Apri <Ext href={TWOSV}>{TWOSV}</Ext> e attivala (Google
      ti chiederà una volta un numero di telefono per inviare un codice).
    </>
  ),
  s2Callout: (
    <>
      Se più avanti la pagina delle app-password mostra{" "}
      <em>
        “The setting you are looking for is not available for your account”
      </em>{" "}
      con un robottino rotto, significa che la verifica in 2 passaggi non è
      ancora attiva — completa prima questo passo.
    </>
  ),

  s3Title: "3. Crea l’app-password",
  s3Body: (
    <>
      Apri <Ext href={APPPW}>{APPPW}</Ext> e creane una:
    </>
  ),
  s3Steps: [
    <>
      Dai un nome (es. <code>JHT</code>) e clicca <strong>Crea</strong>.
    </>,
    <>
      Google mostra un <strong>codice di 16 caratteri</strong> (quattro gruppi
      da quattro). Copialo.
    </>,
    <>
      Incolla quel codice nel campo <strong>App password</strong> dell’app — non
      la password normale di Gmail. Gli spazi non contano.
    </>,
  ],

  s4Title: "4. Abilita IMAP in Gmail",
  s4Body: (
    <>
      In Gmail:{" "}
      <strong>
        ⚙️ Impostazioni → Visualizza tutte le impostazioni → Inoltro e POP/IMAP
        → Attiva IMAP → Salva
      </strong>
      . Così il team può leggere la casella.
    </>
  ),

  s5Title: "5. Collegala nell’app",
  s5Body: (
    <>
      Nello step email di onboarding dell’app desktop, inserisci l’
      <strong>indirizzo Gmail</strong> e l’<strong>app-password</strong>, spunta
      “è una casella dedicata” e premi <strong>Verifica connessione</strong>:
      l’app fa un giro veloce (accesso, invio di un codice di prova, rilettura)
      per confermare che funzioni. Puoi anche aggiungerla o modificarla più
      tardi dal pannello <strong>Home → Email</strong>, dove basta inserire
      indirizzo e app-password e premere <strong>Salva</strong>. In entrambi i
      casi le credenziali restano in locale sul tuo computer.
    </>
  ),

  gmxTitle: "Niente telefono? Usa GMX",
  gmxBody: (
    <>
      Non vuoi dare un numero di telefono a Google? <strong>GMX</strong> è un
      provider gratuito che accetta la password normale (niente verifica in 2
      passaggi, niente app-password):
    </>
  ),
  gmxSteps: [
    <>
      Crea un account su <Ext href={GMX}>{GMX}</Ext>.
    </>,
    <>
      Attiva IMAP:{" "}
      <strong>
        Impostazioni → POP3 e IMAP → spunta “Abilita accesso via POP3 e IMAP” →
        Salva
      </strong>{" "}
      (è spento di default).
    </>,
    <>
      Nell’app usa l’indirizzo <code>nome@gmx.com</code> e la tua{" "}
      <strong>password normale</strong> (il campo “App password” la accetta).
    </>,
  ],

  forwardNote: (
    <>
      Fatto? Ora imposta l’inoltro automatico così i tuoi job alert arrivano in
      questa casella — vedi{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Inoltro email
      </Link>
      .
    </>
  ),
};

const ES: Strings = {
  bcHome: "Home",
  bcDocs: "Docs",
  bcThis: "Configura el Gmail del equipo",
  pageTitle: "Configura el Gmail del equipo",
  pageSubtitle:
    "Crea un buzón dedicado que el equipo pueda leer — paso a paso.",
  intro: (
    <>
      El equipo puede leer un buzón de correo dedicado y convertir las alertas
      de empleo que reenvías allí en oportunidades con una puntuación. Esta guía
      te acompaña en la creación de un <strong>Gmail dedicado</strong> para el
      equipo y de la <strong>contraseña de aplicación</strong> que necesita para
      conectarse. Para saber por qué conviene y cómo reenviar las alertas de
      forma automática, consulta{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Reenvío de correo
      </Link>
      .
    </>
  ),
  calloutOptional: (
    <>
      <strong>Opcional.</strong> Puedes omitirlo durante la configuración y
      añadirlo más tarde desde la app de escritorio. Sin él, el equipo encuentra
      igualmente empleo en la web — solo que con menos leads y menos relevantes.
      ¿Con prisa o sin teléfono a mano? Ve a <em>“¿Sin teléfono? Usa GMX”</em>{" "}
      más abajo.
    </>
  ),

  s1Title: "1. Crea un Gmail dedicado",
  s1Body: (
    <>
      Crea un <strong>Gmail nuevo y gratuito solo para el equipo</strong> — no
      tu buzón personal. Una dirección dedicada mantiene separada tu búsqueda de
      empleo y hace que el equipo solo vea lo que le reenvías. Elige algo como{" "}
      <code>tunombre.jht@gmail.com</code>.
    </>
  ),

  s2Title: "2. Activa la verificación en dos pasos",
  s2Body: (
    <>
      Gmail solo permite crear una “contraseña de aplicación” con la
      verificación en dos pasos activada. Abre <Ext href={TWOSV}>{TWOSV}</Ext> y
      actívala (Google te pedirá una vez un número de teléfono para enviarte un
      código de verificación).
    </>
  ),
  s2Callout: (
    <>
      Si más adelante la página de contraseñas de aplicación muestra{" "}
      <em>
        “The setting you are looking for is not available for your account”
      </em>{" "}
      con un pequeño robot roto, significa que la verificación en dos pasos
      todavía no está activada — completa antes este paso.
    </>
  ),

  s3Title: "3. Crea la contraseña de aplicación",
  s3Body: (
    <>
      Abre <Ext href={APPPW}>{APPPW}</Ext> y crea una:
    </>
  ),
  s3Steps: [
    <>
      Ponle un nombre (p. ej. <code>JHT</code>) y haz clic en{" "}
      <strong>Crear</strong>.
    </>,
    <>
      Google muestra un <strong>código de 16 caracteres</strong> (cuatro grupos
      de cuatro). Cópialo.
    </>,
    <>
      Pega ese código en el campo <strong>App password</strong> de la app — no
      la contraseña normal de acceso a Gmail. Los espacios no importan.
    </>,
  ],

  s4Title: "4. Habilita IMAP en Gmail",
  s4Body: (
    <>
      En Gmail:{" "}
      <strong>
        ⚙️ Configuración → Ver toda la configuración → Reenvío y correo POP/IMAP
        → Habilitar IMAP → Guardar
      </strong>
      . Así el equipo puede leer el buzón.
    </>
  ),

  s5Title: "5. Conéctalo en la app",
  s5Body: (
    <>
      En el paso de correo del onboarding de la app de escritorio, introduce la{" "}
      <strong>dirección de Gmail</strong> y la{" "}
      <strong>contraseña de aplicación</strong>, marca “es un buzón dedicado” y
      pulsa <strong>Verificar conexión</strong>: la app hace un recorrido rápido
      (inicia sesión, envía un código de prueba, lo vuelve a leer) para
      confirmar que funciona. También puedes añadirla o cambiarla más tarde
      desde el panel <strong>Home → Email</strong>, donde solo introduces la
      dirección y la contraseña de aplicación y pulsas <strong>Guardar</strong>.
      En ambos casos las credenciales se guardan en local en tu ordenador.
    </>
  ),

  gmxTitle: "¿Sin teléfono? Usa GMX",
  gmxBody: (
    <>
      ¿No quieres darle un número de teléfono a Google? <strong>GMX</strong> es
      un proveedor gratuito que acepta tu contraseña normal (sin verificación en
      dos pasos, sin contraseña de aplicación):
    </>
  ),
  gmxSteps: [
    <>
      Crea una cuenta en <Ext href={GMX}>{GMX}</Ext>.
    </>,
    <>
      Habilita IMAP:{" "}
      <strong>
        Configuración → POP3 e IMAP → marca “Habilitar acceso vía POP3 e IMAP” →
        Guardar
      </strong>{" "}
      (está desactivado de forma predeterminada).
    </>,
    <>
      En la app usa tu dirección <code>nombre@gmx.com</code> y tu{" "}
      <strong>contraseña normal</strong> (el campo “App password” la acepta).
    </>,
  ],

  forwardNote: (
    <>
      ¿Listo? Ahora configura el reenvío automático para que tus alertas de
      empleo lleguen a este buzón — consulta{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Reenvío de correo
      </Link>
      .
    </>
  ),
};

const FR: Strings = {
  bcHome: "Home",
  bcDocs: "Docs",
  bcThis: "Configurer la Gmail de l’équipe",
  pageTitle: "Configurer la Gmail de l’équipe",
  pageSubtitle:
    "Créez une boîte de réception dédiée que l’équipe peut lire — étape par étape.",
  intro: (
    <>
      L’équipe peut lire une boîte de réception dédiée et transformer les
      alertes emploi que vous y transférez en opportunités notées. Ce guide vous
      accompagne dans la création d’une <strong>Gmail dédiée</strong> pour
      l’équipe et du <strong>mot de passe d’application</strong> nécessaire pour
      la connecter. Pour comprendre l’intérêt et savoir comment transférer
      automatiquement vos alertes, voir{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Transfert d’emails
      </Link>
      .
    </>
  ),
  calloutOptional: (
    <>
      <strong>Facultatif.</strong> Vous pouvez sauter cette étape lors de la
      configuration et l’ajouter plus tard depuis l’application de bureau. Sans
      elle, l’équipe trouve quand même des offres sur le web — simplement avec
      des pistes moins nombreuses et moins ciblées. Pressé ou sans téléphone
      sous la main ? Passez à <em>“Pas de téléphone ? Utilisez GMX”</em> plus
      bas.
    </>
  ),

  s1Title: "1. Créer une Gmail dédiée",
  s1Body: (
    <>
      Créez une{" "}
      <strong>Gmail toute neuve et gratuite, rien que pour l’équipe</strong> —
      pas votre boîte personnelle. Une adresse dédiée garde votre recherche
      d’emploi à part et fait en sorte que l’équipe ne voie que ce que vous lui
      transférez. Choisissez quelque chose comme{" "}
      <code>votrenom.jht@gmail.com</code>.
    </>
  ),

  s2Title: "2. Activer la validation en deux étapes",
  s2Body: (
    <>
      Gmail n’autorise la création d’un « mot de passe d’application » qu’une
      fois la validation en deux étapes activée. Ouvrez{" "}
      <Ext href={TWOSV}>{TWOSV}</Ext> et activez-la (Google vous demandera une
      fois un numéro de téléphone pour envoyer un code de vérification).
    </>
  ),
  s2Callout: (
    <>
      Si, plus tard, la page des mots de passe d’application affiche{" "}
      <em>
        “The setting you are looking for is not available for your account”
      </em>{" "}
      avec un petit robot cassé, cela veut dire que la validation en deux étapes
      n’est pas encore activée — terminez d’abord cette étape.
    </>
  ),

  s3Title: "3. Créer le mot de passe d’application",
  s3Body: (
    <>
      Ouvrez <Ext href={APPPW}>{APPPW}</Ext> et créez-en un :
    </>
  ),
  s3Steps: [
    <>
      Donnez-lui un nom (ex. <code>JHT</code>) et cliquez sur{" "}
      <strong>Créer</strong>.
    </>,
    <>
      Google affiche un <strong>code de 16 caractères</strong> (quatre groupes
      de quatre). Copiez-le.
    </>,
    <>
      Collez ce code dans le champ <strong>Mot de passe d’application</strong>{" "}
      de l’application — pas votre mot de passe habituel de connexion Gmail. Les
      espaces n’ont pas d’importance.
    </>,
  ],

  s4Title: "4. Activer IMAP dans Gmail",
  s4Body: (
    <>
      Dans Gmail :{" "}
      <strong>
        ⚙️ Paramètres → Voir tous les paramètres → Transfert et POP/IMAP →
        Activer IMAP → Enregistrer
      </strong>
      . Cela permet à l’équipe de lire la boîte de réception.
    </>
  ),

  s5Title: "5. La connecter dans l’application",
  s5Body: (
    <>
      Dans l’étape email de l’onboarding de l’application de bureau, saisissez
      l’<strong>adresse Gmail</strong> et le{" "}
      <strong>mot de passe d’application</strong>, cochez « c’est une boîte
      dédiée » et appuyez sur <strong>Vérifier la connexion</strong> :
      l’application effectue un aller-retour rapide (connexion, envoi d’un code
      de test, relecture) pour confirmer que tout fonctionne. Vous pouvez aussi
      l’ajouter ou la modifier plus tard depuis le panneau{" "}
      <strong>Home → Email</strong>, où il suffit de saisir l’adresse et le mot
      de passe d’application et d’appuyer sur <strong>Enregistrer</strong>. Dans
      les deux cas, les identifiants restent en local sur votre ordinateur.
    </>
  ),

  gmxTitle: "Pas de téléphone ? Utilisez GMX",
  gmxBody: (
    <>
      Vous ne voulez pas donner de numéro de téléphone à Google ?{" "}
      <strong>GMX</strong> est un fournisseur gratuit qui accepte votre mot de
      passe habituel (pas de validation en deux étapes, pas de mot de passe
      d’application) :
    </>
  ),
  gmxSteps: [
    <>
      Créez un compte sur <Ext href={GMX}>{GMX}</Ext>.
    </>,
    <>
      Activez IMAP :{" "}
      <strong>
        Paramètres → POP3 et IMAP → cochez « Activer l’accès via POP3 et IMAP »
        → Enregistrer
      </strong>{" "}
      (c’est désactivé par défaut).
    </>,
    <>
      Dans l’application, utilisez votre adresse <code>nom@gmx.com</code> et
      votre <strong>mot de passe habituel</strong> (le champ « Mot de passe
      d’application » l’accepte).
    </>,
  ],

  forwardNote: (
    <>
      Terminé ? Configurez maintenant le transfert automatique pour que vos
      alertes emploi arrivent dans cette boîte — voir{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Transfert d’emails
      </Link>
      .
    </>
  ),
};

const DE: Strings = {
  bcHome: "Home",
  bcDocs: "Docs",
  bcThis: "Die Gmail des Teams einrichten",
  pageTitle: "Die Gmail des Teams einrichten",
  pageSubtitle:
    "Erstelle ein dediziertes Postfach, das das Team lesen kann — Schritt für Schritt.",
  intro: (
    <>
      Das Team kann ein dediziertes E-Mail-Postfach lesen und die Job-Alerts,
      die du dorthin weiterleitest, in bewertete Chancen verwandeln. Diese
      Anleitung führt dich durch das Erstellen einer{" "}
      <strong>dedizierten Gmail</strong> für das Team und des{" "}
      <strong>App-Passworts</strong>, das es zum Verbinden braucht. Warum das
      hilft und wie du deine Alerts automatisch weiterleitest, findest du unter{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        E-Mail-Weiterleitung
      </Link>
      .
    </>
  ),
  calloutOptional: (
    <>
      <strong>Optional.</strong> Du kannst das beim Setup überspringen und
      später aus der Desktop-App hinzufügen. Ohne findet das Team trotzdem Jobs
      im Web — es bekommt nur weniger und schwächere Leads. In Eile oder kein
      Handy zur Hand? Springe unten zu{" "}
      <em>“Kein Handy? Nimm stattdessen GMX”</em>.
    </>
  ),

  s1Title: "1. Eine dedizierte Gmail erstellen",
  s1Body: (
    <>
      Erstelle eine{" "}
      <strong>brandneue, kostenlose Gmail nur für das Team</strong> — nicht dein
      persönliches Postfach. Eine dedizierte Adresse hält deine Jobsuche
      getrennt und sorgt dafür, dass das Team immer nur das sieht, was du ihm
      weiterleitest. Wähle etwas wie <code>deinname.jht@gmail.com</code>.
    </>
  ),

  s2Title: "2. Bestätigung in zwei Schritten aktivieren",
  s2Body: (
    <>
      Gmail erlaubt ein „App-Passwort“ erst, wenn die Bestätigung in zwei
      Schritten aktiv ist. Öffne <Ext href={TWOSV}>{TWOSV}</Ext> und aktiviere
      sie (Google fragt einmal nach einer Telefonnummer, um einen
      Bestätigungscode zu senden).
    </>
  ),
  s2Callout: (
    <>
      Wenn die App-Passwort-Seite später{" "}
      <em>
        “The setting you are looking for is not available for your account”
      </em>{" "}
      mit einem kleinen kaputten Roboter zeigt, bedeutet das, dass die
      Bestätigung in zwei Schritten noch nicht aktiv ist — schließe zuerst
      diesen Schritt ab.
    </>
  ),

  s3Title: "3. Das App-Passwort erstellen",
  s3Body: (
    <>
      Öffne <Ext href={APPPW}>{APPPW}</Ext> und erstelle eines:
    </>
  ),
  s3Steps: [
    <>
      Gib ihm einen Namen (z. B. <code>JHT</code>) und klicke auf{" "}
      <strong>Erstellen</strong>.
    </>,
    <>
      Google zeigt einen <strong>16-stelligen Code</strong> (vier
      Vierergruppen). Kopiere ihn.
    </>,
    <>
      Füge diesen Code in das Feld <strong>App-Passwort</strong> der App ein —
      nicht dein normales Gmail-Login-Passwort. Leerzeichen spielen keine Rolle.
    </>,
  ],

  s4Title: "4. IMAP in Gmail aktivieren",
  s4Body: (
    <>
      In Gmail:{" "}
      <strong>
        ⚙️ Einstellungen → Alle Einstellungen aufrufen → Weiterleitung und
        POP/IMAP → IMAP aktivieren → Änderungen speichern
      </strong>
      . So kann das Team das Postfach lesen.
    </>
  ),

  s5Title: "5. In der App verbinden",
  s5Body: (
    <>
      Gib im Onboarding-E-Mail-Schritt der Desktop-App die{" "}
      <strong>Gmail-Adresse</strong> und das <strong>App-Passwort</strong> ein,
      hake „das ist ein dediziertes Postfach“ an und drücke auf{" "}
      <strong>Verbindung prüfen</strong> — die App macht einen schnellen
      Durchlauf (Anmelden, einen Testcode senden, ihn zurücklesen), um zu
      bestätigen, dass alles funktioniert. Du kannst es auch später über das
      Panel <strong>Home → E-Mail</strong> hinzufügen oder ändern, wo du einfach
      Adresse und App-Passwort eingibst und auf <strong>Speichern</strong>{" "}
      drückst. In beiden Fällen bleiben die Zugangsdaten lokal auf deinem
      Computer.
    </>
  ),

  gmxTitle: "Kein Handy? Nimm stattdessen GMX",
  gmxBody: (
    <>
      Du willst Google keine Telefonnummer geben? <strong>GMX</strong> ist ein
      kostenloser Anbieter, der dein normales Passwort akzeptiert (keine
      Bestätigung in zwei Schritten, kein App-Passwort):
    </>
  ),
  gmxSteps: [
    <>
      Erstelle ein Konto bei <Ext href={GMX}>{GMX}</Ext>.
    </>,
    <>
      Aktiviere IMAP:{" "}
      <strong>
        Einstellungen → POP3 &amp; IMAP → „Zugriff über POP3 und IMAP erlauben“
        anhaken → Speichern
      </strong>{" "}
      (standardmäßig ausgeschaltet).
    </>,
    <>
      Nutze in der App deine <code>name@gmx.com</code>-Adresse und dein{" "}
      <strong>normales Passwort</strong> (das Feld „App-Passwort“ akzeptiert
      es).
    </>,
  ],

  forwardNote: (
    <>
      Fertig? Richte als Nächstes die automatische Weiterleitung ein, damit
      deine Job-Alerts in diesem Postfach landen — siehe{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        E-Mail-Weiterleitung
      </Link>
      .
    </>
  ),
};

const HU: Strings = {
  bcHome: "Home",
  bcDocs: "Docs",
  bcThis: "A csapat Gmail-fiókjának beállítása",
  pageTitle: "A csapat Gmail-fiókjának beállítása",
  pageSubtitle:
    "Hozz létre egy dedikált postafiókot, amelyet a csapat olvasni tud — lépésről lépésre.",
  intro: (
    <>
      A csapat képes olvasni egy dedikált e-mail postafiókot, és az oda
      továbbított állásértesítőket pontozott lehetőségekké alakítani. Ez az
      útmutató végigvezet egy <strong>dedikált Gmail</strong> létrehozásán a
      csapat számára, valamint az <strong>alkalmazásjelszó</strong> beállításán,
      amelyre a csatlakozáshoz szüksége van. Hogy miért hasznos, és hogyan
      továbbíthatod automatikusan az értesítőidet, lásd:{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        E-mail továbbítás
      </Link>
      .
    </>
  ),
  calloutOptional: (
    <>
      <strong>Opcionális.</strong> A beállítás során átugorhatod, és később
      hozzáadhatod az asztali alkalmazásból. Enélkül is talál a csapat állásokat
      a weben — csak kevesebb és gyengébb jelértékű lehetőséget kap. Sietsz,
      vagy nincs kéznél telefon? Ugorj a lenti{" "}
      <em>“Nincs telefon? Használj inkább GMX-et”</em> részhez.
    </>
  ),

  s1Title: "1. Dedikált Gmail létrehozása",
  s1Body: (
    <>
      Hozz létre egy{" "}
      <strong>vadonatúj, ingyenes Gmailt kizárólag a csapatnak</strong> — ne a
      személyes postafiókodat. Egy dedikált cím elkülönítve tartja az
      álláskeresésedet, és biztosítja, hogy a csapat mindig csak azt lássa, amit
      továbbítasz neki. Válassz valami ilyesmit: <code>nev.jht@gmail.com</code>.
    </>
  ),

  s2Title: "2. Kétlépcsős azonosítás bekapcsolása",
  s2Body: (
    <>
      A Gmail csak akkor engedélyezi az „alkalmazásjelszót”, ha a kétlépcsős
      azonosítás be van kapcsolva. Nyisd meg a <Ext href={TWOSV}>{TWOSV}</Ext>{" "}
      oldalt, és kapcsold be (a Google egyszer kérni fog egy telefonszámot, hogy
      elküldjön egy ellenőrző kódot).
    </>
  ),
  s2Callout: (
    <>
      Ha az alkalmazásjelszó oldala később ezt mutatja:{" "}
      <em>
        “The setting you are looking for is not available for your account”
      </em>{" "}
      egy kis törött robottal, az azt jelenti, hogy a kétlépcsős azonosítás még
      nincs bekapcsolva — előbb fejezd be ezt a lépést.
    </>
  ),

  s3Title: "3. Az alkalmazásjelszó létrehozása",
  s3Body: (
    <>
      Nyisd meg a <Ext href={APPPW}>{APPPW}</Ext> oldalt, és hozz létre egyet:
    </>
  ),
  s3Steps: [
    <>
      Adj neki nevet (pl. <code>JHT</code>), és kattints a{" "}
      <strong>Létrehozás</strong> gombra.
    </>,
    <>
      A Google megjelenít egy <strong>16 karakteres kódot</strong> (négy darab
      négyes csoport). Másold ki.
    </>,
    <>
      Illeszd be ezt a kódot az alkalmazás <strong>Alkalmazásjelszó</strong>{" "}
      mezőjébe — ne a szokásos Gmail bejelentkezési jelszavadat. A szóközök nem
      számítanak.
    </>,
  ],

  s4Title: "4. IMAP engedélyezése a Gmailben",
  s4Body: (
    <>
      A Gmailben:{" "}
      <strong>
        ⚙️ Beállítások → Az összes beállítás megjelenítése → Továbbítás és
        POP/IMAP → IMAP engedélyezése → Módosítások mentése
      </strong>
      . Így tudja a csapat olvasni a postafiókot.
    </>
  ),

  s5Title: "5. Összekapcsolás az alkalmazásban",
  s5Body: (
    <>
      Az asztali alkalmazás onboarding e-mail lépésénél add meg a{" "}
      <strong>Gmail-címet</strong> és az <strong>alkalmazásjelszót</strong>,
      pipáld be, hogy „ez egy dedikált postafiók“, majd nyomd meg a{" "}
      <strong>Kapcsolat ellenőrzése</strong> gombot — az alkalmazás egy gyors
      kört tesz (bejelentkezés, tesztkód küldése, visszaolvasása), hogy
      megerősítse, minden működik. Később a <strong>Home → E-mail</strong>
      panelből is hozzáadhatod vagy módosíthatod, ahol csak megadod a címet és
      az alkalmazásjelszót, és megnyomod a <strong>Mentés</strong> gombot.
      Mindkét esetben a hitelesítő adatok helyben, a számítógépeden maradnak.
    </>
  ),

  gmxTitle: "Nincs telefon? Használj inkább GMX-et",
  gmxBody: (
    <>
      Nem akarsz telefonszámot megadni a Google-nak? A <strong>GMX</strong> egy
      ingyenes szolgáltató, amely elfogadja a szokásos jelszavadat (nincs
      kétlépcsős azonosítás, nincs alkalmazásjelszó):
    </>
  ),
  gmxSteps: [
    <>
      Hozz létre egy fiókot itt: <Ext href={GMX}>{GMX}</Ext>.
    </>,
    <>
      Engedélyezd az IMAP-ot:{" "}
      <strong>
        Beállítások → POP3 és IMAP → pipáld be a „Hozzáférés engedélyezése POP3
        és IMAP útján” lehetőséget → Mentés
      </strong>{" "}
      (alapból ki van kapcsolva).
    </>,
    <>
      Az alkalmazásban használd a <code>nev@gmx.com</code> címedet és a{" "}
      <strong>szokásos jelszavadat</strong> (az „Alkalmazásjelszó” mező
      elfogadja).
    </>,
  ],

  forwardNote: (
    <>
      Kész? Ezután állítsd be az automatikus továbbítást, hogy az
      állásértesítőid ebbe a postafiókba érkezzenek — lásd:{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        E-mail továbbítás
      </Link>
      .
    </>
  ),
};

const PT: Strings = {
  bcHome: "Home",
  bcDocs: "Docs",
  bcThis: "Configura a Gmail da equipa",
  pageTitle: "Configura a Gmail da equipa",
  pageSubtitle:
    "Cria uma caixa de correio dedicada que a equipa possa ler — passo a passo.",
  intro: (
    <>
      A equipa pode ler uma caixa de correio dedicada e transformar os alertas
      de emprego que reencaminhas para lá em oportunidades com pontuação. Este
      guia acompanha-te na criação de uma <strong>Gmail dedicada</strong> para a
      equipa e da <strong>palavra-passe de app</strong> de que ela precisa para
      se ligar. Para perceberes porque ajuda e como reencaminhar os teus alertas
      em automático, vê{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Reencaminhamento de email
      </Link>
      .
    </>
  ),
  calloutOptional: (
    <>
      <strong>Opcional.</strong> Podes saltar isto durante a configuração e
      adicioná-lo depois a partir da app de computador. Sem isto, a equipa
      continua a encontrar empregos na web — apenas recebe menos leads e com
      menos sinal. Com pressa ou sem telemóvel à mão? Salta para{" "}
      <em>“Sem telemóvel? Usa o GMX”</em> mais abaixo.
    </>
  ),

  s1Title: "1. Criar uma Gmail dedicada",
  s1Body: (
    <>
      Cria uma <strong>Gmail nova e gratuita só para a equipa</strong> — não a
      tua caixa de correio pessoal. Um endereço dedicado mantém a tua procura de
      emprego separada e faz com que a equipa veja apenas aquilo que lhe
      reencaminhas. Escolhe algo como <code>oteunome.jht@gmail.com</code>.
    </>
  ),

  s2Title: "2. Ativar a verificação em 2 passos",
  s2Body: (
    <>
      A Gmail só permite criar uma “palavra-passe de app” com a verificação em 2
      passos ativa. Abre <Ext href={TWOSV}>{TWOSV}</Ext> e ativa-a (o Google vai
      pedir-te uma vez um número de telemóvel, para enviar um código de
      verificação).
    </>
  ),
  s2Callout: (
    <>
      Se mais tarde a página das palavras-passe de app mostrar{" "}
      <em>
        “The setting you are looking for is not available for your account”
      </em>{" "}
      com um robôzinho partido, significa que a verificação em 2 passos ainda
      não está ativa — completa primeiro este passo.
    </>
  ),

  s3Title: "3. Criar a palavra-passe de app",
  s3Body: (
    <>
      Abre <Ext href={APPPW}>{APPPW}</Ext> e cria uma:
    </>
  ),
  s3Steps: [
    <>
      Dá-lhe um nome (ex. <code>JHT</code>) e clica em <strong>Criar</strong>.
    </>,
    <>
      O Google mostra um <strong>código de 16 caracteres</strong> (quatro grupos
      de quatro). Copia-o.
    </>,
    <>
      Cola esse código no campo <strong>App password</strong> da app — não a
      palavra-passe normal de acesso à Gmail. Os espaços não contam.
    </>,
  ],

  s4Title: "4. Ativar o IMAP na Gmail",
  s4Body: (
    <>
      Na Gmail:{" "}
      <strong>
        ⚙️ Definições → Ver todas as definições → Reencaminhamento e POP/IMAP →
        Ativar IMAP → Guardar
      </strong>
      . Assim a equipa pode ler a caixa de correio.
    </>
  ),

  s5Title: "5. Ligá-la na app",
  s5Body: (
    <>
      No passo do email do onboarding da app de computador, introduz o{" "}
      <strong>endereço Gmail</strong> e a <strong>palavra-passe de app</strong>,
      assinala “é uma caixa de correio dedicada” e carrega em{" "}
      <strong>Verificar ligação</strong>: a app faz uma volta rápida (iniciar
      sessão, enviar um código de teste, voltar a lê-lo) para confirmar que está
      tudo a funcionar. Também podes adicioná-la ou alterá-la mais tarde no
      painel <strong>Home → Email</strong>, onde basta introduzir o endereço e a
      palavra-passe de app e carregar em <strong>Guardar</strong>. Em qualquer
      dos casos, as credenciais ficam guardadas localmente no teu computador.
    </>
  ),

  gmxTitle: "Sem telemóvel? Usa o GMX",
  gmxBody: (
    <>
      Não queres dar um número de telemóvel ao Google? O <strong>GMX</strong> é
      um fornecedor gratuito que aceita a palavra-passe normal (sem verificação
      em 2 passos, sem palavra-passe de app):
    </>
  ),
  gmxSteps: [
    <>
      Cria uma conta em <Ext href={GMX}>{GMX}</Ext>.
    </>,
    <>
      Ativa o IMAP:{" "}
      <strong>
        Definições → POP3 e IMAP → assinala “Ativar acesso via POP3 e IMAP” →
        Guardar
      </strong>{" "}
      (está desativado por predefinição).
    </>,
    <>
      Na app, usa o endereço <code>nome@gmx.com</code> e a tua{" "}
      <strong>palavra-passe normal</strong> (o campo “App password” aceita-a).
    </>,
  ],

  forwardNote: (
    <>
      Feito? A seguir, configura o reencaminhamento automático para que os teus
      alertas de emprego cheguem a esta caixa de correio — vê{" "}
      <Link href="/docs/guides/email-forwarding" className={LINK_CLS}>
        Reencaminhamento de email
      </Link>
      .
    </>
  ),
};

export const T: Record<Locale, Strings> = {
  en: EN,
  it: IT,
  es: ES,
  fr: FR,
  de: DE,
  hu: HU,
  pt: PT,
};
