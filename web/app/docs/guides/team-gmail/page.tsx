import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getRequestLocale } from "@/lib/request-locale";

// Guida: creare la Gmail DEDICATA del team + app-password così il team può
// leggerla via IMAP. Complementa /docs/guides/email-forwarding (il "perché" +
// l'inoltro automatico). i18n: EN + IT autorati, le altre lingue fanno
// fallback su EN (vedi mappa T in fondo) — pattern uguale alle altre guide.

const TITLE_CLS =
  "text-[15px] font-bold text-[var(--color-white)] mt-10 mb-3 flex items-center gap-2";
const P_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed mb-3";
const LI_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed";
const LINK_CLS =
  "text-[var(--color-white)] underline underline-offset-2 hover:text-[var(--color-green)] transition-colors break-all";

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 pl-3 border-l-2 border-[var(--color-green)] text-[12px] text-[var(--color-muted)] leading-relaxed">
      {children}
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLS}>
      {children}
    </a>
  );
}

const TWOSV = "https://myaccount.google.com/signinoptions/twosv";
const APPPW = "https://myaccount.google.com/apppasswords";
const GMX = "https://signup.gmx.com";

type Strings = {
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
      <Ext href={TWOSV}>{TWOSV}</Ext> and turn it on (Google will ask for a phone
      number once, to send a verification code).
    </>
  ),
  s2Callout: (
    <>
      If the app-password page later shows{" "}
      <em>“The setting you are looking for is not available for your account”</em>{" "}
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
    <>Give it a name (e.g. <code>JHT</code>) and click <strong>Create</strong>.</>,
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
      In Gmail: <strong>⚙️ Settings → See all settings → Forwarding and
      POP/IMAP → Enable IMAP → Save</strong>. This lets the team read the inbox.
    </>
  ),

  s5Title: "5. Connect it in the app",
  s5Body: (
    <>
      In the desktop app’s email step (or later from the Home → Email panel),
      enter the <strong>Gmail address</strong> and the <strong>app
      password</strong>, tick “this is a dedicated inbox”, and press{" "}
      <strong>Verify connection</strong>. The app does a quick round-trip
      (sign in, send a test code, read it back) to confirm everything works,
      then saves the credentials locally on your computer.
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
    <>Create an account at <Ext href={GMX}>{GMX}</Ext>.</>,
    <>
      Enable IMAP: <strong>Settings → POP3 &amp; IMAP → tick “Enable access via
      POP3 and IMAP” → Save</strong> (it’s off by default).
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
  pageSubtitle: "Crea una casella dedicata che il team può leggere — passo per passo.",
  intro: (
    <>
      Il team può leggere una casella email dedicata e trasformare i job alert
      che inoltri lì in opportunità con un punteggio. Questa guida ti accompagna
      nella creazione di una <strong>Gmail dedicata</strong> per il team e
      dell’<strong>app-password</strong> che serve per collegarla. Per il perché
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
      passaggi attiva. Apri <Ext href={TWOSV}>{TWOSV}</Ext> e attivala (Google ti
      chiederà una volta un numero di telefono per inviare un codice).
    </>
  ),
  s2Callout: (
    <>
      Se più avanti la pagina delle app-password mostra{" "}
      <em>“The setting you are looking for is not available for your account”</em>{" "}
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
    <>Dai un nome (es. <code>JHT</code>) e clicca <strong>Crea</strong>.</>,
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
      In Gmail: <strong>⚙️ Impostazioni → Visualizza tutte le impostazioni →
      Inoltro e POP/IMAP → Attiva IMAP → Salva</strong>. Così il team può
      leggere la casella.
    </>
  ),

  s5Title: "5. Collegala nell’app",
  s5Body: (
    <>
      Nello step email dell’app desktop (o dopo dal pannello Home → Email),
      inserisci l’<strong>indirizzo Gmail</strong> e l’<strong>app-password</strong>,
      spunta “è una casella dedicata” e premi <strong>Verifica connessione</strong>.
      L’app fa un giro veloce (accesso, invio di un codice di prova, rilettura)
      per confermare che tutto funzioni, poi salva le credenziali in locale sul
      tuo computer.
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
    <>Crea un account su <Ext href={GMX}>{GMX}</Ext>.</>,
    <>
      Attiva IMAP: <strong>Impostazioni → POP3 e IMAP → spunta “Abilita accesso
      via POP3 e IMAP” → Salva</strong> (è spento di default).
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

// EN + IT autorati; le altre lingue fanno fallback su EN (verranno tradotte in
// un secondo momento, come per gli altri capitoli i18n).
const T: Record<Locale, Strings> = {
  en: EN,
  it: IT,
  es: EN,
  fr: EN,
  de: EN,
  hu: EN,
  pt: EN,
};

export default async function TeamGmailGuidePage() {
  const locale = await getRequestLocale();
  const t = T[locale] ?? T.en;

  return (
    <div>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-3">
          <Link
            href="/"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.bcHome}
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <Link
            href="/docs"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.bcDocs}
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">
            {t.bcThis}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          {t.pageTitle}
        </h1>
        <p className="text-[var(--color-dim)] text-[10px] mt-2">
          {t.pageSubtitle}
        </p>
        <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
          {t.intro}
        </p>
      </div>

      <Callout>{t.calloutOptional}</Callout>

      <h2 className={TITLE_CLS}>{t.s1Title}</h2>
      <p className={P_CLS}>{t.s1Body}</p>

      <h2 className={TITLE_CLS}>{t.s2Title}</h2>
      <p className={P_CLS}>{t.s2Body}</p>
      <Callout>{t.s2Callout}</Callout>

      <h2 className={TITLE_CLS}>{t.s3Title}</h2>
      <p className={P_CLS}>{t.s3Body}</p>
      <ol className="list-decimal pl-5 space-y-1.5 mb-3">
        {t.s3Steps.map((step, i) => (
          <li key={i} className={LI_CLS}>
            {step}
          </li>
        ))}
      </ol>

      <h2 className={TITLE_CLS}>{t.s4Title}</h2>
      <p className={P_CLS}>{t.s4Body}</p>

      <h2 className={TITLE_CLS}>{t.s5Title}</h2>
      <p className={P_CLS}>{t.s5Body}</p>

      <h2 className={TITLE_CLS}>{t.gmxTitle}</h2>
      <p className={P_CLS}>{t.gmxBody}</p>
      <ol className="list-decimal pl-5 space-y-1.5 mb-3">
        {t.gmxSteps.map((step, i) => (
          <li key={i} className={LI_CLS}>
            {step}
          </li>
        ))}
      </ol>

      <Callout>{t.forwardNote}</Callout>
    </div>
  );
}
