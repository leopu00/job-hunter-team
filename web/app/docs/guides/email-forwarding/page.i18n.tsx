// Dizionario di `page.tsx`.
//
// Le chiavi sono LOCALI a questa guida: lo stesso nome può valere
// tutt'altro altrove, quindi non vanno accorpate in un dizionario comune.
// `Record<Locale, Strings>` fa pretendere al compilatore tutte e sette le
// lingue: una voce a cui ne manca una non compila, invece di mostrare
// l'inglese all'utente sbagliato.
//
// Il file è `.tsx` e non `.ts` perché le voci contengono JSX. `CODE_CLS`
// vive qui perché è il dizionario a usarlo (70 volte); il gemello in
// `DocKit.tsx` non è importabile da qui — quel modulo è `"use client"` e
// questa pagina è un server component.
import type { Locale } from "@/i18n/config";

export const CODE_CLS =
  "px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-white)] text-[11px] font-mono";

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
  bcEmail: string;
  pageTitle: string;
  pageSubtitle: string;
  intro: React.ReactNode;
  calloutOptional: React.ReactNode;
  calloutScreens: React.ReactNode;

  whyTitle: string;
  whyIntro: React.ReactNode;
  whyAccuracy: React.ReactNode;
  whyTokens: React.ReactNode;
  whyTailored: React.ReactNode;
  whyAnyPlatform: React.ReactNode;
  whySource: React.ReactNode;
  calloutLinkedin: React.ReactNode;

  stepsTitle: string;
  stepsCode: string;

  step1Title: string;
  step1Body: React.ReactNode;
  step1Callout: React.ReactNode;

  step2Title: string;
  step2Body: React.ReactNode;
  tblField: string;
  tblWhatToPut: string;
  rowEmailLabel: React.ReactNode;
  rowEmailValue: React.ReactNode;
  rowPwLabel: React.ReactNode;
  rowPwValue: React.ReactNode;
  step2Local: React.ReactNode;
  step2Callout: React.ReactNode;
  step2Button: React.ReactNode;

  step3Title: string;
  step3Body: React.ReactNode;
  liSubtitle: string;
  li1: React.ReactNode;
  li2: React.ReactNode;
  li3: React.ReactNode;
  li4: React.ReactNode;
  gmailSubtitle: string;
  gmail1: React.ReactNode;
  gmail2: React.ReactNode;
  outlookSubtitle: string;
  outlookBody: React.ReactNode;
  anySubtitle: string;
  anyBody: React.ReactNode;
  anyCallout: React.ReactNode;

  usesTitle: string;
  usesStartOfDay: React.ReactNode;
  usesBalance: React.ReactNode;
  usesResult: React.ReactNode;
  usesCallout: React.ReactNode;

  verifyTitle: string;
  verifyBody: React.ReactNode;
  verifyIfNothing: string;
  tblSymptom: string;
  tblCause: string;
  tblFix: string;
  v1s: React.ReactNode;
  v1c: string;
  v1f: React.ReactNode;
  v2s: React.ReactNode;
  v2c: string;
  v2f: React.ReactNode;
  v3s: React.ReactNode;
  v3c: string;
  v3f: string;
  v4s: string;
  v4c: string;
  v4f: React.ReactNode;

  privacyTitle: string;
  privacy1: React.ReactNode;
  privacy2: React.ReactNode;
  privacy3: string;

  graphicsTitle: string;
  graphicsBody: React.ReactNode;
  tblHash: string;
  tblExpected: string;
  tblPath: string;
  g1: React.ReactNode;
  g2: React.ReactNode;
  g3: React.ReactNode;
  g4: React.ReactNode;
  g5: React.ReactNode;

  allDocs: string;
  privacyPolicy: string;
};

export const T: Record<Locale, Strings> = {
  en: {
    bcHome: "Home",
    bcDocs: "Docs",
    bcEmail: "Email Forwarding",
    pageTitle: "📧 Email Forwarding",
    pageSubtitle: "Feed the team your job alerts",
    intro: (
      <>
        Give the team a <strong>dedicated email address</strong> and
        auto-forward your job-alert notifications to it. The Captain and the
        Scouts read that inbox at the start of every working day and turn the
        alerts into scored positions — without getting lost on the open web.
      </>
    ),
    calloutOptional: (
      <>
        ✅ <strong>Optional, but strongly recommended.</strong> The team works
        fine without it (the Scouts search the web on their own), but it is{" "}
        <strong>noticeably less efficient</strong>. If you set up forwarding,
        you decide what reaches the team; if you don&apos;t, the team has to
        figure it out alone.
      </>
    ),
    calloutScreens: (
      <>
        📸 <strong>Missing screenshots:</strong> this guide doesn&apos;t have
        screenshots of the steps yet. The placeholders are listed at the bottom
        under <em>Graphic materials</em>.
      </>
    ),
    whyTitle: "💡 Why it makes the team better",
    whyIntro: (
      <>
        A job alert that <em>you</em> configured is already filtered to what you
        want: the right role, the right city, the right seniority. When that
        alert lands in the team inbox, the Scouts get a{" "}
        <strong>pre-qualified lead</strong> instead of guessing keywords on the
        open web. Concretely:
      </>
    ),
    whyAccuracy: (
      <>
        🎯 <strong>Higher accuracy</strong> — the position matches your real
        intent (your alert filters), not a Scout&apos;s best guess.
      </>
    ),
    whyTokens: (
      <>
        💸 <strong>Less token waste</strong> — no broad web crawling, no
        fighting login walls. The Scout reads a link the platform already vetted
        for you.
      </>
    ),
    whyTailored: (
      <>
        🧩 <strong>More tailored over time</strong> — tune your alert filters
        and the team&apos;s input changes with you.
      </>
    ),
    whyAnyPlatform: (
      <>
        🌍 <strong>Any platform, not just LinkedIn</strong> — forward alerts
        from LinkedIn, Glassdoor, Indeed <strong>and</strong> any
        local/country/city-specific job board that emails you. If it sends a
        notification, the team can read it.
      </>
    ),
    whySource: (
      <>
        Every position the team creates is tagged with its{" "}
        <strong>source</strong> (e.g.{" "}
        <code className={CODE_CLS}>linkedin-email</code> vs a web search), so
        you can see on the dashboard how the email-sourced ones compare.
      </>
    ),
    calloutLinkedin: (
      <>
        🔗 <strong>LinkedIn is the single highest-value setup.</strong>{" "}
        Configure your search filters on LinkedIn, save them as a{" "}
        <strong>Job Alert</strong>, enable <strong>email notifications</strong>,
        then forward those emails to the team. This one source alone makes the
        Scouts dramatically more effective.
      </>
    ),
    stepsTitle: "🗺️ The three steps",
    stepsCode: `1. Create a dedicated inbox for the team   →  e.g. yourname.jht@gmail.com
2. Share it with the team (desktop app)    →  email + app-password, saved locally
3. Auto-forward your job alerts into it    →  from LinkedIn + any platform`,
    step1Title: "1️⃣ Create a dedicated inbox",
    step1Body: (
      <>
        Make a <strong>fresh, separate</strong> email address that the team will
        read — don&apos;t give it your personal inbox. A free Gmail account
        works well (the team defaults to{" "}
        <code className={CODE_CLS}>imap.gmail.com</code>). Keep it dedicated to
        job alerts only: everything that lands there is treated as a potential
        lead.
      </>
    ),
    step1Callout: (
      <>
        🔒 <strong>Why dedicated:</strong> the team reads this inbox over IMAP.
        A separate address means it never touches your personal mail, and you
        can revoke access any time by changing one password.
      </>
    ),
    step2Title: "2️⃣ Share the inbox with the team (desktop app)",
    step2Body: (
      <>
        In the <strong>JHT desktop app</strong>, open{" "}
        <strong>Settings → Team email</strong> and enter:
      </>
    ),
    tblField: "Field",
    tblWhatToPut: "What to put",
    rowEmailLabel: <strong>Email address</strong>,
    rowEmailValue: (
      <>
        the dedicated inbox, e.g.{" "}
        <code className={CODE_CLS}>yourname.jht@gmail.com</code>
      </>
    ),
    rowPwLabel: <strong>App password</strong>,
    rowPwValue: (
      <>
        an <strong>app-specific password</strong>, not your login password
      </>
    ),
    step2Local: (
      <>
        The desktop app saves these <strong>locally</strong> (in the team&apos;s{" "}
        <code className={CODE_CLS}>credentials/</code> folder on the machine
        that runs the team) — they are <strong>never</strong> sent to the cloud.
      </>
    ),
    step2Callout: (
      <>
        🔑 <strong>App password (Gmail):</strong> enable 2-Step Verification,
        then create an <em>App password</em> (Google Account → Security → App
        passwords) and paste that. It&apos;s a 16-character token you can revoke
        independently, so the team never holds your real password. Other
        providers (Outlook, Fastmail, …) have the same concept — look for
        &quot;app password&quot; or &quot;IMAP access token&quot;.
      </>
    ),
    step2Button: (
      <>
        The <strong>&quot;How to set up forwarding&quot;</strong> button in that
        window brings you back to this guide.
      </>
    ),
    step3Title: "3️⃣ Auto-forward your job alerts",
    step3Body: (
      <>
        This is the part that lives in <strong>your</strong> mailbox. You create
        rules that forward job-alert emails into the dedicated inbox. Set up as
        many sources as you like.
      </>
    ),
    liSubtitle: "🔗 LinkedIn (most recommended)",
    li1: (
      <>Run the search you care about on LinkedIn (role, location, filters).</>
    ),
    li2: (
      <>
        Save it as a <strong>Job Alert</strong> and set the frequency (daily is
        a good default).
      </>
    ),
    li3: (
      <>
        Make sure <strong>email notifications</strong> are on for that alert
        (Settings → Communications → Email → Jobs).
      </>
    ),
    li4: (
      <>
        In your personal mailbox, add a <strong>filter/rule</strong>: when the
        sender is <code className={CODE_CLS}>jobs-listings@linkedin.com</code>{" "}
        (or <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>),{" "}
        <strong>forward</strong> to your dedicated team inbox.
      </>
    ),
    gmailSubtitle: "📨 Gmail (forwarding rule)",
    gmail1: (
      <>
        <strong>
          Settings → Forwarding and POP/IMAP → Add a forwarding address
        </strong>{" "}
        → your team inbox, and confirm it.
      </>
    ),
    gmail2: (
      <>
        <strong>Settings → Filters → Create a new filter</strong> → match the
        alert senders (e.g.{" "}
        <code className={CODE_CLS}>
          from:(linkedin.com OR glassdoor.com OR indeed.com)
        </code>
        ), then <strong>Forward it to</strong> your team inbox.
      </>
    ),
    outlookSubtitle: "📨 Outlook / others",
    outlookBody: (
      <>
        Use <strong>Rules</strong> (Outlook) or your provider&apos;s equivalent:{" "}
        <em>if sender contains the job-board domain → forward to</em> the team
        inbox.
      </>
    ),
    anySubtitle: "🌍 Any other platform (local / country / niche boards)",
    anyBody: (
      <>
        Same recipe for <strong>every</strong> site that emails you job
        notifications — national boards, city portals, niche communities.
        Subscribe to their alerts, then forward those emails to the team inbox.
        The team reads the <strong>whole</strong> dedicated inbox, so new
        platforms work without any extra configuration on the team side.
      </>
    ),
    anyCallout: (
      <>
        💡 <strong>Tip:</strong> because the inbox is dedicated, you can forward{" "}
        <em>broadly</em> and let the team sort it out — you don&apos;t need a
        perfect filter on your side.
      </>
    ),
    usesTitle: "🤖 How the team uses it",
    usesStartOfDay: (
      <>
        🌅 <strong>Start of day</strong> — the Captain and the Scouts check the
        team inbox first thing in the working window, before any web search.
        Overnight alerts are already waiting.
      </>
    ),
    usesBalance: (
      <>
        🧮 <strong>The Captain balances the load</strong> — if a reasonable
        number of alerts arrived, the team reads them all (more signal is
        better). If a <em>flood</em> arrives (say hundreds in one day), the
        Captain picks the <strong>most salient</strong> ones and pushes those
        through, so the goal is always met:{" "}
        <strong>new positions reach a score</strong>, not just pile up
        un-scored.
      </>
    ),
    usesResult: (
      <>
        📊 <strong>You see the result</strong> — the positions show up on your
        dashboard, scored, tagged with their email source.
      </>
    ),
    usesCallout: (
      <>
        🎯{" "}
        <strong>
          The team&apos;s target is the score, not the cover letter.
        </strong>{" "}
        CV/cover-letter writing stays on-demand (you click when you want it).
        Forwarding good alerts means more of the <em>right</em> positions get
        scored within the team&apos;s budget.
      </>
    ),
    verifyTitle: "✅ Verify it's working",
    verifyBody: (
      <>
        After you&apos;ve set up forwarding and entered the credentials, the
        team confirms access at the next start-of-day check. You can also watch
        your dashboard: within a working window you should start seeing
        positions whose source is an <code className={CODE_CLS}>*-email</code>{" "}
        tag.
      </>
    ),
    verifyIfNothing: "If nothing shows up:",
    tblSymptom: "Symptom",
    tblCause: "Likely cause",
    tblFix: "Fix",
    v1s: (
      <>
        No <code className={CODE_CLS}>*-email</code> positions appear
      </>
    ),
    v1c: "credentials not saved / wrong",
    v1f: (
      <>
        re-enter email + <strong>app password</strong> in the desktop app
      </>
    ),
    v2s: <>&quot;Login failed&quot; in the team logs</>,
    v2c: "using login password, not app password",
    v2f: (
      <>
        create an <strong>app-specific password</strong> and use that
      </>
    ),
    v3s: <>Alerts arrive but aren&apos;t forwarded</>,
    v3c: "mailbox rule not matching",
    v3f: "check the sender address in your forwarding filter",
    v4s: "Inbox empty",
    v4c: "alerts not enabled at the source",
    v4f: (
      <>
        turn on <strong>email notifications</strong> for your LinkedIn/board
        alerts
      </>
    ),
    privacyTitle: "🔒 Privacy & security",
    privacy1: (
      <>
        The credentials are stored <strong>locally</strong>, with the team —{" "}
        <strong>never</strong> uploaded to the cloud.
      </>
    ),
    privacy2: (
      <>
        Use a <strong>dedicated inbox</strong> and an{" "}
        <strong>app-specific password</strong> so the team never holds your
        personal mail or your real login.
      </>
    ),
    privacy3:
      "Revoke any time: delete the app password (the team simply stops reading) or change it in the desktop app.",
    graphicsTitle: "🖼️ Graphic materials",
    graphicsBody: (
      <>
        This guide is user-facing but <strong>has no screenshots yet</strong>.
        Placeholders to fill in:
      </>
    ),
    tblHash: "#",
    tblExpected: "Expected screenshot",
    tblPath: "Target path",
    g1: (
      <>
        Desktop <strong>Settings → Team email</strong> form (email +
        app-password + &quot;How to set up forwarding&quot; button)
      </>
    ),
    g2: (
      <>
        Gmail <strong>App password</strong> creation screen
      </>
    ),
    g3: (
      <>
        LinkedIn <strong>Job Alert</strong> with email notifications on
      </>
    ),
    g4: (
      <>
        Gmail <strong>forwarding filter</strong> forwarding alerts to the team
        inbox
      </>
    ),
    g5: (
      <>
        Dashboard showing positions tagged with an{" "}
        <code className={CODE_CLS}>*-email</code> source
      </>
    ),
    allDocs: "All docs",
    privacyPolicy: "Privacy Policy",
  },

  it: {
    bcHome: "Home",
    bcDocs: "Docs",
    bcEmail: "Inoltro email",
    pageTitle: "📧 Inoltro email",
    pageSubtitle: "Dai al team i tuoi job alert",
    intro: (
      <>
        Dai al team un <strong>indirizzo email dedicato</strong> e inoltra
        automaticamente le notifiche dei tuoi job alert. Il Capitano e gli Scout
        leggono quella casella all&apos;inizio di ogni giornata lavorativa e
        trasformano gli alert in posizioni con un punteggio — senza perdersi nel
        web aperto.
      </>
    ),
    calloutOptional: (
      <>
        ✅ <strong>Facoltativo, ma fortemente consigliato.</strong> Il team
        funziona anche senza (gli Scout cercano sul web da soli), ma è{" "}
        <strong>nettamente meno efficiente</strong>. Se configuri
        l&apos;inoltro, decidi tu cosa arriva al team; se non lo fai, il team
        deve capirlo da solo.
      </>
    ),
    calloutScreens: (
      <>
        📸 <strong>Screenshot mancanti:</strong> questa guida non ha ancora gli
        screenshot dei passaggi. I segnaposto sono elencati in fondo sotto{" "}
        <em>Materiali grafici</em>.
      </>
    ),
    whyTitle: "💡 Perché rende il team migliore",
    whyIntro: (
      <>
        Un job alert che hai configurato <em>tu</em> è già filtrato su ciò che
        vuoi: il ruolo giusto, la città giusta, la seniority giusta. Quando
        quell&apos;alert arriva nella casella del team, gli Scout ottengono un{" "}
        <strong>lead pre-qualificato</strong> invece di tirare a indovinare con
        le keyword sul web aperto. Nel concreto:
      </>
    ),
    whyAccuracy: (
      <>
        🎯 <strong>Maggiore precisione</strong> — la posizione corrisponde alla
        tua reale intenzione (i filtri del tuo alert), non al miglior tentativo
        di uno Scout.
      </>
    ),
    whyTokens: (
      <>
        💸 <strong>Meno spreco di token</strong> — niente crawling esteso del
        web, niente lotte coi muri di login. Lo Scout legge un link che la
        piattaforma ha già vagliato per te.
      </>
    ),
    whyTailored: (
      <>
        🧩 <strong>Sempre più su misura nel tempo</strong> — affina i filtri del
        tuo alert e l&apos;input del team cambia con te.
      </>
    ),
    whyAnyPlatform: (
      <>
        🌍 <strong>Qualsiasi piattaforma, non solo LinkedIn</strong> — inoltra
        gli alert da LinkedIn, Glassdoor, Indeed <strong>e</strong> qualsiasi
        job board locale/nazionale/cittadino che ti invia email. Se manda una
        notifica, il team può leggerla.
      </>
    ),
    whySource: (
      <>
        Ogni posizione creata dal team è etichettata con la sua{" "}
        <strong>sorgente</strong> (es.{" "}
        <code className={CODE_CLS}>linkedin-email</code> rispetto a una ricerca
        web), così puoi vedere sulla dashboard come si comportano quelle
        provenienti da email.
      </>
    ),
    calloutLinkedin: (
      <>
        🔗{" "}
        <strong>LinkedIn è la singola configurazione di maggior valore.</strong>{" "}
        Imposta i filtri di ricerca su LinkedIn, salvali come{" "}
        <strong>Job Alert</strong>, attiva le <strong>notifiche email</strong>,
        poi inoltra quelle email al team. Questa sola sorgente rende gli Scout
        enormemente più efficaci.
      </>
    ),
    stepsTitle: "🗺️ I tre passaggi",
    stepsCode: `1. Crea una casella dedicata per il team       →  es. tuonome.jht@gmail.com
2. Condividila con il team (app desktop)       →  email + app-password, salvate in locale
3. Inoltra qui i tuoi job alert in automatico  →  da LinkedIn e da qualsiasi piattaforma`,
    step1Title: "1️⃣ Crea una casella dedicata",
    step1Body: (
      <>
        Crea un indirizzo email <strong>nuovo e separato</strong> che il team
        leggerà — non dargli la tua casella personale. Un account Gmail gratuito
        va benissimo (il team usa di default{" "}
        <code className={CODE_CLS}>imap.gmail.com</code>). Tienilo dedicato solo
        ai job alert: tutto ciò che vi arriva è trattato come un potenziale
        lead.
      </>
    ),
    step1Callout: (
      <>
        🔒 <strong>Perché dedicata:</strong> il team legge questa casella via
        IMAP. Un indirizzo separato significa che non tocca mai la tua posta
        personale, e puoi revocare l&apos;accesso in qualsiasi momento cambiando
        una sola password.
      </>
    ),
    step2Title: "2️⃣ Condividi la casella con il team (app desktop)",
    step2Body: (
      <>
        Nell&apos;<strong>app desktop JHT</strong>, apri{" "}
        <strong>Impostazioni → Email del team</strong> e inserisci:
      </>
    ),
    tblField: "Campo",
    tblWhatToPut: "Cosa inserire",
    rowEmailLabel: <strong>Indirizzo email</strong>,
    rowEmailValue: (
      <>
        la casella dedicata, es.{" "}
        <code className={CODE_CLS}>yourname.jht@gmail.com</code>
      </>
    ),
    rowPwLabel: <strong>Password per app</strong>,
    rowPwValue: (
      <>
        una <strong>password specifica per l&apos;app</strong>, non la tua
        password di accesso
      </>
    ),
    step2Local: (
      <>
        L&apos;app desktop salva questi dati <strong>in locale</strong> (nella
        cartella <code className={CODE_CLS}>credentials/</code> del team, sulla
        macchina che esegue il team) — <strong>non</strong> vengono mai inviati
        al cloud.
      </>
    ),
    step2Callout: (
      <>
        🔑 <strong>Password per app (Gmail):</strong> attiva la Verifica in due
        passaggi, poi crea una <em>Password per app</em> (Account Google →
        Sicurezza → Password per le app) e incollala. È un token di 16 caratteri
        che puoi revocare in modo indipendente, così il team non conserva mai la
        tua vera password. Altri provider (Outlook, Fastmail, …) hanno lo stesso
        concetto — cerca &quot;password per app&quot; o &quot;token di accesso
        IMAP&quot;.
      </>
    ),
    step2Button: (
      <>
        Il pulsante <strong>&quot;Come configurare l&apos;inoltro&quot;</strong>{" "}
        in quella finestra ti riporta a questa guida.
      </>
    ),
    step3Title: "3️⃣ Inoltra automaticamente i tuoi job alert",
    step3Body: (
      <>
        Questa è la parte che vive nella <strong>tua</strong> casella. Crei
        delle regole che inoltrano le email dei job alert nella casella
        dedicata. Configura tutte le sorgenti che vuoi.
      </>
    ),
    liSubtitle: "🔗 LinkedIn (il più consigliato)",
    li1: (
      <>
        Esegui la ricerca che ti interessa su LinkedIn (ruolo, località,
        filtri).
      </>
    ),
    li2: (
      <>
        Salvala come <strong>Job Alert</strong> e imposta la frequenza
        (giornaliera è un buon default).
      </>
    ),
    li3: (
      <>
        Assicurati che le <strong>notifiche email</strong> siano attive per
        quell&apos;alert (Impostazioni → Comunicazioni → Email → Offerte di
        lavoro).
      </>
    ),
    li4: (
      <>
        Nella tua casella personale, aggiungi un <strong>filtro/regola</strong>:
        quando il mittente è{" "}
        <code className={CODE_CLS}>jobs-listings@linkedin.com</code> (o{" "}
        <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>),{" "}
        <strong>inoltra</strong> alla tua casella dedicata del team.
      </>
    ),
    gmailSubtitle: "📨 Gmail (regola di inoltro)",
    gmail1: (
      <>
        <strong>
          Impostazioni → Inoltro e POP/IMAP → Aggiungi un indirizzo di inoltro
        </strong>{" "}
        → la tua casella del team, e confermalo.
      </>
    ),
    gmail2: (
      <>
        <strong>Impostazioni → Filtri → Crea un nuovo filtro</strong> → fai
        corrispondere i mittenti degli alert (es.{" "}
        <code className={CODE_CLS}>
          from:(linkedin.com OR glassdoor.com OR indeed.com)
        </code>
        ), poi <strong>Inoltralo a</strong> la tua casella del team.
      </>
    ),
    outlookSubtitle: "📨 Outlook / altri",
    outlookBody: (
      <>
        Usa le <strong>Regole</strong> (Outlook) o l&apos;equivalente del tuo
        provider:{" "}
        <em>se il mittente contiene il dominio della job board → inoltra a</em>{" "}
        la casella del team.
      </>
    ),
    anySubtitle:
      "🌍 Qualsiasi altra piattaforma (board locali / nazionali / di nicchia)",
    anyBody: (
      <>
        Stessa ricetta per <strong>ogni</strong> sito che ti invia notifiche di
        lavoro via email — board nazionali, portali cittadini, community di
        nicchia. Iscriviti ai loro alert, poi inoltra quelle email alla casella
        del team. Il team legge <strong>l&apos;intera</strong> casella dedicata,
        quindi le nuove piattaforme funzionano senza alcuna configurazione
        aggiuntiva lato team.
      </>
    ),
    anyCallout: (
      <>
        💡 <strong>Suggerimento:</strong> poiché la casella è dedicata, puoi
        inoltrare in modo <em>ampio</em> e lasciare che sia il team a fare
        ordine — non ti serve un filtro perfetto dalla tua parte.
      </>
    ),
    usesTitle: "🤖 Come lo usa il team",
    usesStartOfDay: (
      <>
        🌅 <strong>Inizio giornata</strong> — il Capitano e gli Scout
        controllano la casella del team per prima cosa nella finestra
        lavorativa, prima di qualsiasi ricerca web. Gli alert notturni sono già
        in attesa.
      </>
    ),
    usesBalance: (
      <>
        🧮 <strong>Il Capitano bilancia il carico</strong> — se è arrivato un
        numero ragionevole di alert, il team li legge tutti (più segnale è
        meglio). Se arriva un <em>diluvio</em> (diciamo centinaia in un giorno),
        il Capitano sceglie quelli <strong>più salienti</strong> e li manda
        avanti, così l&apos;obiettivo è sempre raggiunto:{" "}
        <strong>le nuove posizioni arrivano a un punteggio</strong>, non si
        accumulano solo senza valutazione.
      </>
    ),
    usesResult: (
      <>
        📊 <strong>Tu vedi il risultato</strong> — le posizioni compaiono sulla
        tua dashboard, con un punteggio, etichettate con la loro sorgente email.
      </>
    ),
    usesCallout: (
      <>
        🎯{" "}
        <strong>
          L&apos;obiettivo del team è il punteggio, non la lettera di
          presentazione.
        </strong>{" "}
        La scrittura di CV/lettere di presentazione resta on-demand (clicchi
        quando vuoi). Inoltrare buoni alert significa che più posizioni{" "}
        <em>giuste</em> vengono valutate nel budget del team.
      </>
    ),
    verifyTitle: "✅ Verifica che funzioni",
    verifyBody: (
      <>
        Dopo aver configurato l&apos;inoltro e inserito le credenziali, il team
        conferma l&apos;accesso al controllo di inizio giornata successivo. Puoi
        anche tenere d&apos;occhio la dashboard: entro una finestra lavorativa
        dovresti iniziare a vedere posizioni con sorgente etichettata{" "}
        <code className={CODE_CLS}>*-email</code>.
      </>
    ),
    verifyIfNothing: "Se non compare nulla:",
    tblSymptom: "Sintomo",
    tblCause: "Causa probabile",
    tblFix: "Soluzione",
    v1s: (
      <>
        Non compare nessuna posizione <code className={CODE_CLS}>*-email</code>
      </>
    ),
    v1c: "credenziali non salvate / errate",
    v1f: (
      <>
        reinserisci email + <strong>password per app</strong> nell&apos;app
        desktop
      </>
    ),
    v2s: <>&quot;Login failed&quot; nei log del team</>,
    v2c: "stai usando la password di accesso, non la password per app",
    v2f: (
      <>
        crea una <strong>password specifica per l&apos;app</strong> e usa quella
      </>
    ),
    v3s: <>Gli alert arrivano ma non vengono inoltrati</>,
    v3c: "la regola della casella non corrisponde",
    v3f: "controlla l'indirizzo del mittente nel tuo filtro di inoltro",
    v4s: "Casella vuota",
    v4c: "alert non attivati alla sorgente",
    v4f: (
      <>
        attiva le <strong>notifiche email</strong> per i tuoi alert
        LinkedIn/board
      </>
    ),
    privacyTitle: "🔒 Privacy e sicurezza",
    privacy1: (
      <>
        Le credenziali sono memorizzate <strong>in locale</strong>, con il team
        — <strong>mai</strong> caricate sul cloud.
      </>
    ),
    privacy2: (
      <>
        Usa una <strong>casella dedicata</strong> e una{" "}
        <strong>password specifica per l&apos;app</strong>, così il team non
        conserva mai la tua posta personale né il tuo vero accesso.
      </>
    ),
    privacy3:
      "Revoca in qualsiasi momento: elimina la password per app (il team smette semplicemente di leggere) oppure cambiala nell'app desktop.",
    graphicsTitle: "🖼️ Materiali grafici",
    graphicsBody: (
      <>
        Questa guida è rivolta all&apos;utente ma{" "}
        <strong>non ha ancora screenshot</strong>. Segnaposto da compilare:
      </>
    ),
    tblHash: "#",
    tblExpected: "Screenshot atteso",
    tblPath: "Percorso di destinazione",
    g1: (
      <>
        Modulo desktop <strong>Impostazioni → Email del team</strong> (email +
        password per app + pulsante &quot;Come configurare l&apos;inoltro&quot;)
      </>
    ),
    g2: (
      <>
        Schermata di creazione della <strong>Password per app</strong> di Gmail
      </>
    ),
    g3: (
      <>
        <strong>Job Alert</strong> di LinkedIn con le notifiche email attive
      </>
    ),
    g4: (
      <>
        <strong>Filtro di inoltro</strong> di Gmail che inoltra gli alert alla
        casella del team
      </>
    ),
    g5: (
      <>
        Dashboard che mostra posizioni etichettate con sorgente{" "}
        <code className={CODE_CLS}>*-email</code>
      </>
    ),
    allDocs: "Tutti i docs",
    privacyPolicy: "Informativa sulla privacy",
  },

  es: {
    bcHome: "Inicio",
    bcDocs: "Docs",
    bcEmail: "Reenvío de correo",
    pageTitle: "📧 Reenvío de correo",
    pageSubtitle: "Da al equipo tus alertas de empleo",
    intro: (
      <>
        Da al equipo una <strong>dirección de correo dedicada</strong> y reenvía
        automáticamente las notificaciones de tus alertas de empleo. El Capitán
        y los Scouts leen ese buzón al inicio de cada jornada laboral y
        convierten las alertas en posiciones con puntuación — sin perderse en la
        web abierta.
      </>
    ),
    calloutOptional: (
      <>
        ✅ <strong>Opcional, pero muy recomendado.</strong> El equipo funciona
        bien sin ello (los Scouts buscan en la web por su cuenta), pero es{" "}
        <strong>notablemente menos eficiente</strong>. Si configuras el reenvío,
        tú decides qué llega al equipo; si no lo haces, el equipo tiene que
        averiguarlo solo.
      </>
    ),
    calloutScreens: (
      <>
        📸 <strong>Faltan capturas:</strong> esta guía aún no tiene capturas de
        los pasos. Los marcadores de posición se enumeran al final en{" "}
        <em>Materiales gráficos</em>.
      </>
    ),
    whyTitle: "💡 Por qué mejora al equipo",
    whyIntro: (
      <>
        Una alerta de empleo que <em>tú</em> configuraste ya está filtrada según
        lo que quieres: el rol adecuado, la ciudad adecuada, la seniority
        adecuada. Cuando esa alerta llega al buzón del equipo, los Scouts
        obtienen un <strong>lead precalificado</strong> en lugar de adivinar
        palabras clave en la web abierta. En concreto:
      </>
    ),
    whyAccuracy: (
      <>
        🎯 <strong>Mayor precisión</strong> — la posición coincide con tu
        intención real (los filtros de tu alerta), no con la mejor conjetura de
        un Scout.
      </>
    ),
    whyTokens: (
      <>
        💸 <strong>Menos desperdicio de tokens</strong> — sin rastreo amplio de
        la web, sin pelear con muros de inicio de sesión. El Scout lee un enlace
        que la plataforma ya verificó por ti.
      </>
    ),
    whyTailored: (
      <>
        🧩 <strong>Más a medida con el tiempo</strong> — ajusta los filtros de
        tu alerta y la entrada del equipo cambia contigo.
      </>
    ),
    whyAnyPlatform: (
      <>
        🌍 <strong>Cualquier plataforma, no solo LinkedIn</strong> — reenvía
        alertas de LinkedIn, Glassdoor, Indeed <strong>y</strong> cualquier
        portal de empleo local/nacional/de ciudad que te envíe correos. Si manda
        una notificación, el equipo puede leerla.
      </>
    ),
    whySource: (
      <>
        Cada posición que crea el equipo se etiqueta con su{" "}
        <strong>fuente</strong> (p. ej.{" "}
        <code className={CODE_CLS}>linkedin-email</code> frente a una búsqueda
        web), para que veas en el panel cómo se comparan las que provienen de
        correo.
      </>
    ),
    calloutLinkedin: (
      <>
        🔗{" "}
        <strong>
          LinkedIn es la configuración de mayor valor por sí sola.
        </strong>{" "}
        Configura tus filtros de búsqueda en LinkedIn, guárdalos como{" "}
        <strong>Job Alert</strong>, activa las{" "}
        <strong>notificaciones por correo</strong> y luego reenvía esos correos
        al equipo. Esta única fuente hace que los Scouts sean drásticamente más
        eficaces.
      </>
    ),
    stepsTitle: "🗺️ Los tres pasos",
    stepsCode: `1. Crea un buzón dedicado para el equipo            →  p. ej. tunombre.jht@gmail.com
2. Compártelo con el equipo (app de escritorio)     →  email + contraseña de app, guardados en local
3. Reenvía ahí tus alertas de empleo en automático  →  desde LinkedIn y cualquier plataforma`,
    step1Title: "1️⃣ Crea un buzón dedicado",
    step1Body: (
      <>
        Crea una dirección de correo <strong>nueva y separada</strong> que el
        equipo leerá — no le des tu buzón personal. Una cuenta gratuita de Gmail
        funciona bien (el equipo usa por defecto{" "}
        <code className={CODE_CLS}>imap.gmail.com</code>). Mantenla dedicada
        solo a las alertas de empleo: todo lo que llega ahí se trata como un
        posible lead.
      </>
    ),
    step1Callout: (
      <>
        🔒 <strong>Por qué dedicada:</strong> el equipo lee este buzón por IMAP.
        Una dirección separada significa que nunca toca tu correo personal, y
        puedes revocar el acceso en cualquier momento cambiando una sola
        contraseña.
      </>
    ),
    step2Title: "2️⃣ Comparte el buzón con el equipo (app de escritorio)",
    step2Body: (
      <>
        En la <strong>app de escritorio JHT</strong>, abre{" "}
        <strong>Ajustes → Correo del equipo</strong> e introduce:
      </>
    ),
    tblField: "Campo",
    tblWhatToPut: "Qué poner",
    rowEmailLabel: <strong>Dirección de correo</strong>,
    rowEmailValue: (
      <>
        el buzón dedicado, p. ej.{" "}
        <code className={CODE_CLS}>yourname.jht@gmail.com</code>
      </>
    ),
    rowPwLabel: <strong>Contraseña de aplicación</strong>,
    rowPwValue: (
      <>
        una <strong>contraseña específica de aplicación</strong>, no tu
        contraseña de inicio de sesión
      </>
    ),
    step2Local: (
      <>
        La app de escritorio guarda estos datos <strong>localmente</strong> (en
        la carpeta <code className={CODE_CLS}>credentials/</code> del equipo, en
        la máquina que ejecuta el equipo) — <strong>nunca</strong> se envían a
        la nube.
      </>
    ),
    step2Callout: (
      <>
        🔑 <strong>Contraseña de aplicación (Gmail):</strong> activa la
        Verificación en dos pasos, luego crea una{" "}
        <em>Contraseña de aplicación</em> (Cuenta de Google → Seguridad →
        Contraseñas de aplicaciones) y pégala. Es un token de 16 caracteres que
        puedes revocar de forma independiente, así el equipo nunca guarda tu
        contraseña real. Otros proveedores (Outlook, Fastmail, …) tienen el
        mismo concepto — busca &quot;contraseña de aplicación&quot; o
        &quot;token de acceso IMAP&quot;.
      </>
    ),
    step2Button: (
      <>
        El botón <strong>&quot;Cómo configurar el reenvío&quot;</strong> en esa
        ventana te trae de vuelta a esta guía.
      </>
    ),
    step3Title: "3️⃣ Reenvía automáticamente tus alertas de empleo",
    step3Body: (
      <>
        Esta es la parte que vive en <strong>tu</strong> buzón. Creas reglas que
        reenvían los correos de alertas de empleo al buzón dedicado. Configura
        tantas fuentes como quieras.
      </>
    ),
    liSubtitle: "🔗 LinkedIn (lo más recomendado)",
    li1: (
      <>
        Ejecuta la búsqueda que te interesa en LinkedIn (rol, ubicación,
        filtros).
      </>
    ),
    li2: (
      <>
        Guárdala como <strong>Job Alert</strong> y establece la frecuencia
        (diaria es un buen valor por defecto).
      </>
    ),
    li3: (
      <>
        Asegúrate de que las <strong>notificaciones por correo</strong> estén
        activadas para esa alerta (Ajustes → Comunicaciones → Correo → Empleos).
      </>
    ),
    li4: (
      <>
        En tu buzón personal, añade un <strong>filtro/regla</strong>: cuando el
        remitente sea{" "}
        <code className={CODE_CLS}>jobs-listings@linkedin.com</code> (o{" "}
        <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>),{" "}
        <strong>reenvía</strong> a tu buzón dedicado del equipo.
      </>
    ),
    gmailSubtitle: "📨 Gmail (regla de reenvío)",
    gmail1: (
      <>
        <strong>
          Ajustes → Reenvío y correo POP/IMAP → Añadir una dirección de reenvío
        </strong>{" "}
        → el buzón de tu equipo, y confírmalo.
      </>
    ),
    gmail2: (
      <>
        <strong>Ajustes → Filtros → Crear un filtro nuevo</strong> → haz
        coincidir los remitentes de las alertas (p. ej.{" "}
        <code className={CODE_CLS}>
          from:(linkedin.com OR glassdoor.com OR indeed.com)
        </code>
        ), luego <strong>Reenviarlo a</strong> el buzón de tu equipo.
      </>
    ),
    outlookSubtitle: "📨 Outlook / otros",
    outlookBody: (
      <>
        Usa <strong>Reglas</strong> (Outlook) o el equivalente de tu proveedor:{" "}
        <em>
          si el remitente contiene el dominio del portal de empleo → reenviar a
        </em>{" "}
        el buzón del equipo.
      </>
    ),
    anySubtitle:
      "🌍 Cualquier otra plataforma (portales locales / nacionales / de nicho)",
    anyBody: (
      <>
        La misma receta para <strong>cada</strong> sitio que te envíe
        notificaciones de empleo por correo — portales nacionales, portales de
        ciudad, comunidades de nicho. Suscríbete a sus alertas y luego reenvía
        esos correos al buzón del equipo. El equipo lee <strong>todo</strong> el
        buzón dedicado, así que las nuevas plataformas funcionan sin ninguna
        configuración adicional por parte del equipo.
      </>
    ),
    anyCallout: (
      <>
        💡 <strong>Consejo:</strong> como el buzón es dedicado, puedes reenviar
        de forma <em>amplia</em> y dejar que el equipo lo ordene — no necesitas
        un filtro perfecto por tu parte.
      </>
    ),
    usesTitle: "🤖 Cómo lo usa el equipo",
    usesStartOfDay: (
      <>
        🌅 <strong>Inicio de la jornada</strong> — el Capitán y los Scouts
        revisan el buzón del equipo lo primero en la ventana laboral, antes de
        cualquier búsqueda web. Las alertas nocturnas ya están esperando.
      </>
    ),
    usesBalance: (
      <>
        🧮 <strong>El Capitán equilibra la carga</strong> — si llegó un número
        razonable de alertas, el equipo las lee todas (más señal es mejor). Si
        llega una <em>avalancha</em> (digamos cientos en un día), el Capitán
        elige las <strong>más relevantes</strong> y las impulsa, de modo que el
        objetivo siempre se cumple:{" "}
        <strong>las nuevas posiciones llegan a una puntuación</strong>, no solo
        se acumulan sin evaluar.
      </>
    ),
    usesResult: (
      <>
        📊 <strong>Tú ves el resultado</strong> — las posiciones aparecen en tu
        panel, con puntuación, etiquetadas con su fuente de correo.
      </>
    ),
    usesCallout: (
      <>
        🎯{" "}
        <strong>
          El objetivo del equipo es la puntuación, no la carta de presentación.
        </strong>{" "}
        La redacción de CV/cartas de presentación sigue siendo bajo demanda
        (haces clic cuando lo quieres). Reenviar buenas alertas significa que
        más posiciones <em>adecuadas</em> se puntúan dentro del presupuesto del
        equipo.
      </>
    ),
    verifyTitle: "✅ Verifica que funciona",
    verifyBody: (
      <>
        Después de configurar el reenvío e introducir las credenciales, el
        equipo confirma el acceso en la siguiente comprobación de inicio de
        jornada. También puedes mirar tu panel: dentro de una ventana laboral
        deberías empezar a ver posiciones cuya fuente sea una etiqueta{" "}
        <code className={CODE_CLS}>*-email</code>.
      </>
    ),
    verifyIfNothing: "Si no aparece nada:",
    tblSymptom: "Síntoma",
    tblCause: "Causa probable",
    tblFix: "Solución",
    v1s: (
      <>
        No aparece ninguna posición <code className={CODE_CLS}>*-email</code>
      </>
    ),
    v1c: "credenciales no guardadas / incorrectas",
    v1f: (
      <>
        vuelve a introducir el correo + la{" "}
        <strong>contraseña de aplicación</strong> en la app de escritorio
      </>
    ),
    v2s: <>&quot;Login failed&quot; en los logs del equipo</>,
    v2c: "usas la contraseña de inicio de sesión, no la de aplicación",
    v2f: (
      <>
        crea una <strong>contraseña específica de aplicación</strong> y usa esa
      </>
    ),
    v3s: <>Las alertas llegan pero no se reenvían</>,
    v3c: "la regla del buzón no coincide",
    v3f: "comprueba la dirección del remitente en tu filtro de reenvío",
    v4s: "Buzón vacío",
    v4c: "alertas no activadas en la fuente",
    v4f: (
      <>
        activa las <strong>notificaciones por correo</strong> de tus alertas de
        LinkedIn/portales
      </>
    ),
    privacyTitle: "🔒 Privacidad y seguridad",
    privacy1: (
      <>
        Las credenciales se almacenan <strong>localmente</strong>, con el equipo
        — <strong>nunca</strong> se suben a la nube.
      </>
    ),
    privacy2: (
      <>
        Usa un <strong>buzón dedicado</strong> y una{" "}
        <strong>contraseña específica de aplicación</strong> para que el equipo
        nunca tenga tu correo personal ni tu inicio de sesión real.
      </>
    ),
    privacy3:
      "Revoca en cualquier momento: elimina la contraseña de aplicación (el equipo simplemente deja de leer) o cámbiala en la app de escritorio.",
    graphicsTitle: "🖼️ Materiales gráficos",
    graphicsBody: (
      <>
        Esta guía es para el usuario pero <strong>aún no tiene capturas</strong>
        . Marcadores de posición por rellenar:
      </>
    ),
    tblHash: "#",
    tblExpected: "Captura esperada",
    tblPath: "Ruta de destino",
    g1: (
      <>
        Formulario de escritorio <strong>Ajustes → Correo del equipo</strong>{" "}
        (correo + contraseña de aplicación + botón &quot;Cómo configurar el
        reenvío&quot;)
      </>
    ),
    g2: (
      <>
        Pantalla de creación de la <strong>Contraseña de aplicación</strong> de
        Gmail
      </>
    ),
    g3: (
      <>
        <strong>Job Alert</strong> de LinkedIn con las notificaciones por correo
        activadas
      </>
    ),
    g4: (
      <>
        <strong>Filtro de reenvío</strong> de Gmail que reenvía las alertas al
        buzón del equipo
      </>
    ),
    g5: (
      <>
        Panel que muestra posiciones etiquetadas con una fuente{" "}
        <code className={CODE_CLS}>*-email</code>
      </>
    ),
    allDocs: "Todos los docs",
    privacyPolicy: "Política de privacidad",
  },

  fr: {
    bcHome: "Accueil",
    bcDocs: "Docs",
    bcEmail: "Transfert d'e-mails",
    pageTitle: "📧 Transfert d'e-mails",
    pageSubtitle: "Donnez vos alertes emploi à l'équipe",
    intro: (
      <>
        Donnez à l&apos;équipe une <strong>adresse e-mail dédiée</strong> et
        transférez-y automatiquement les notifications de vos alertes emploi. Le
        Capitaine et les Scouts lisent cette boîte au début de chaque journée de
        travail et transforment les alertes en positions notées — sans se perdre
        sur le web ouvert.
      </>
    ),
    calloutOptional: (
      <>
        ✅ <strong>Facultatif, mais fortement recommandé.</strong> L&apos;équipe
        fonctionne sans (les Scouts cherchent sur le web par eux-mêmes), mais
        c&apos;est <strong>nettement moins efficace</strong>. Si vous configurez
        le transfert, c&apos;est vous qui décidez ce qui arrive à l&apos;équipe
        ; sinon, l&apos;équipe doit se débrouiller seule.
      </>
    ),
    calloutScreens: (
      <>
        📸 <strong>Captures manquantes :</strong> ce guide n&apos;a pas encore
        de captures des étapes. Les emplacements sont listés en bas sous{" "}
        <em>Matériaux graphiques</em>.
      </>
    ),
    whyTitle: "💡 Pourquoi ça rend l'équipe meilleure",
    whyIntro: (
      <>
        Une alerte emploi que <em>vous</em> avez configurée est déjà filtrée
        selon ce que vous voulez : le bon rôle, la bonne ville, le bon niveau de
        séniorité. Quand cette alerte arrive dans la boîte de l&apos;équipe, les
        Scouts obtiennent un <strong>lead pré-qualifié</strong> au lieu de
        deviner des mots-clés sur le web ouvert. Concrètement :
      </>
    ),
    whyAccuracy: (
      <>
        🎯 <strong>Plus de précision</strong> — la position correspond à votre
        véritable intention (les filtres de votre alerte), pas à la meilleure
        supposition d&apos;un Scout.
      </>
    ),
    whyTokens: (
      <>
        💸 <strong>Moins de gaspillage de tokens</strong> — pas de crawling
        étendu du web, pas de combat contre les murs de connexion. Le Scout lit
        un lien que la plateforme a déjà validé pour vous.
      </>
    ),
    whyTailored: (
      <>
        🧩 <strong>De plus en plus sur mesure avec le temps</strong> — affinez
        les filtres de votre alerte et l&apos;entrée de l&apos;équipe évolue
        avec vous.
      </>
    ),
    whyAnyPlatform: (
      <>
        🌍{" "}
        <strong>
          N&apos;importe quelle plateforme, pas seulement LinkedIn
        </strong>{" "}
        — transférez les alertes de LinkedIn, Glassdoor, Indeed{" "}
        <strong>et</strong> tout site d&apos;emploi local/national/municipal qui
        vous envoie des e-mails. S&apos;il envoie une notification,
        l&apos;équipe peut la lire.
      </>
    ),
    whySource: (
      <>
        Chaque position créée par l&apos;équipe est étiquetée avec sa{" "}
        <strong>source</strong> (p. ex.{" "}
        <code className={CODE_CLS}>linkedin-email</code> par rapport à une
        recherche web), pour que vous voyiez sur le tableau de bord comment se
        comparent celles issues des e-mails.
      </>
    ),
    calloutLinkedin: (
      <>
        🔗{" "}
        <strong>
          LinkedIn est à lui seul la configuration la plus précieuse.
        </strong>{" "}
        Configurez vos filtres de recherche sur LinkedIn, enregistrez-les comme{" "}
        <strong>Job Alert</strong>, activez les{" "}
        <strong>notifications par e-mail</strong>, puis transférez ces e-mails à
        l&apos;équipe. Cette seule source rend les Scouts considérablement plus
        efficaces.
      </>
    ),
    stepsTitle: "🗺️ Les trois étapes",
    stepsCode: `1. Créez une boîte dédiée pour l’équipe            →  ex. votrenom.jht@gmail.com
2. Partagez-la avec l’équipe (app de bureau)       →  email + mot de passe d’application, en local
3. Transférez-y vos alertes emploi en automatique  →  depuis LinkedIn et toute plateforme`,
    step1Title: "1️⃣ Créez une boîte dédiée",
    step1Body: (
      <>
        Créez une adresse e-mail <strong>nouvelle et séparée</strong> que
        l&apos;équipe lira — ne lui donnez pas votre boîte personnelle. Un
        compte Gmail gratuit convient très bien (l&apos;équipe utilise par
        défaut <code className={CODE_CLS}>imap.gmail.com</code>). Gardez-la
        dédiée uniquement aux alertes emploi : tout ce qui y arrive est traité
        comme un lead potentiel.
      </>
    ),
    step1Callout: (
      <>
        🔒 <strong>Pourquoi dédiée :</strong> l&apos;équipe lit cette boîte via
        IMAP. Une adresse séparée signifie qu&apos;elle ne touche jamais votre
        courrier personnel, et vous pouvez révoquer l&apos;accès à tout moment
        en changeant un seul mot de passe.
      </>
    ),
    step2Title: "2️⃣ Partagez la boîte avec l'équipe (app de bureau)",
    step2Body: (
      <>
        Dans l&apos;<strong>app de bureau JHT</strong>, ouvrez{" "}
        <strong>Paramètres → E-mail de l&apos;équipe</strong> et saisissez :
      </>
    ),
    tblField: "Champ",
    tblWhatToPut: "Quoi mettre",
    rowEmailLabel: <strong>Adresse e-mail</strong>,
    rowEmailValue: (
      <>
        la boîte dédiée, p. ex.{" "}
        <code className={CODE_CLS}>yourname.jht@gmail.com</code>
      </>
    ),
    rowPwLabel: <strong>Mot de passe d&apos;application</strong>,
    rowPwValue: (
      <>
        un <strong>mot de passe spécifique à l&apos;application</strong>, pas
        votre mot de passe de connexion
      </>
    ),
    step2Local: (
      <>
        L&apos;app de bureau enregistre ces données <strong>localement</strong>{" "}
        (dans le dossier <code className={CODE_CLS}>credentials/</code> de
        l&apos;équipe, sur la machine qui exécute l&apos;équipe) — elles ne sont{" "}
        <strong>jamais</strong> envoyées dans le cloud.
      </>
    ),
    step2Callout: (
      <>
        🔑 <strong>Mot de passe d&apos;application (Gmail) :</strong> activez la
        validation en deux étapes, puis créez un{" "}
        <em>mot de passe d&apos;application</em> (Compte Google → Sécurité →
        Mots de passe des applications) et collez-le. C&apos;est un jeton de 16
        caractères que vous pouvez révoquer indépendamment, ainsi l&apos;équipe
        ne détient jamais votre vrai mot de passe. D&apos;autres fournisseurs
        (Outlook, Fastmail, …) ont le même concept — cherchez &quot;mot de passe
        d&apos;application&quot; ou &quot;jeton d&apos;accès IMAP&quot;.
      </>
    ),
    step2Button: (
      <>
        Le bouton <strong>&quot;Comment configurer le transfert&quot;</strong>{" "}
        dans cette fenêtre vous ramène à ce guide.
      </>
    ),
    step3Title: "3️⃣ Transférez automatiquement vos alertes emploi",
    step3Body: (
      <>
        C&apos;est la partie qui vit dans <strong>votre</strong> boîte mail.
        Vous créez des règles qui transfèrent les e-mails d&apos;alertes emploi
        vers la boîte dédiée. Configurez autant de sources que vous voulez.
      </>
    ),
    liSubtitle: "🔗 LinkedIn (le plus recommandé)",
    li1: (
      <>
        Lancez la recherche qui vous intéresse sur LinkedIn (rôle, lieu,
        filtres).
      </>
    ),
    li2: (
      <>
        Enregistrez-la comme <strong>Job Alert</strong> et définissez la
        fréquence (quotidienne est une bonne valeur par défaut).
      </>
    ),
    li3: (
      <>
        Assurez-vous que les <strong>notifications par e-mail</strong> sont
        activées pour cette alerte (Paramètres → Communications → E-mail →
        Emplois).
      </>
    ),
    li4: (
      <>
        Dans votre boîte personnelle, ajoutez un <strong>filtre/règle</strong> :
        quand l&apos;expéditeur est{" "}
        <code className={CODE_CLS}>jobs-listings@linkedin.com</code> (ou{" "}
        <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>),{" "}
        <strong>transférez</strong> vers votre boîte dédiée de l&apos;équipe.
      </>
    ),
    gmailSubtitle: "📨 Gmail (règle de transfert)",
    gmail1: (
      <>
        <strong>
          Paramètres → Transfert et POP/IMAP → Ajouter une adresse de transfert
        </strong>{" "}
        → la boîte de votre équipe, et confirmez-la.
      </>
    ),
    gmail2: (
      <>
        <strong>Paramètres → Filtres → Créer un nouveau filtre</strong> → faites
        correspondre les expéditeurs des alertes (p. ex.{" "}
        <code className={CODE_CLS}>
          from:(linkedin.com OR glassdoor.com OR indeed.com)
        </code>
        ), puis <strong>Le transférer à</strong> la boîte de votre équipe.
      </>
    ),
    outlookSubtitle: "📨 Outlook / autres",
    outlookBody: (
      <>
        Utilisez les <strong>Règles</strong> (Outlook) ou l&apos;équivalent de
        votre fournisseur :{" "}
        <em>
          si l&apos;expéditeur contient le domaine du site d&apos;emploi →
          transférer vers
        </em>{" "}
        la boîte de l&apos;équipe.
      </>
    ),
    anySubtitle:
      "🌍 Toute autre plateforme (sites locaux / nationaux / de niche)",
    anyBody: (
      <>
        La même recette pour <strong>chaque</strong> site qui vous envoie des
        notifications d&apos;emploi par e-mail — sites nationaux, portails de
        ville, communautés de niche. Abonnez-vous à leurs alertes, puis
        transférez ces e-mails vers la boîte de l&apos;équipe. L&apos;équipe lit{" "}
        <strong>toute</strong> la boîte dédiée, donc les nouvelles plateformes
        fonctionnent sans aucune configuration supplémentaire côté équipe.
      </>
    ),
    anyCallout: (
      <>
        💡 <strong>Astuce :</strong> comme la boîte est dédiée, vous pouvez
        transférer <em>largement</em> et laisser l&apos;équipe faire le tri —
        vous n&apos;avez pas besoin d&apos;un filtre parfait de votre côté.
      </>
    ),
    usesTitle: "🤖 Comment l'équipe l'utilise",
    usesStartOfDay: (
      <>
        🌅 <strong>Début de journée</strong> — le Capitaine et les Scouts
        vérifient la boîte de l&apos;équipe en premier dans la fenêtre de
        travail, avant toute recherche web. Les alertes nocturnes attendent
        déjà.
      </>
    ),
    usesBalance: (
      <>
        🧮 <strong>Le Capitaine équilibre la charge</strong> — si un nombre
        raisonnable d&apos;alertes est arrivé, l&apos;équipe les lit toutes
        (plus de signal vaut mieux). Si un <em>déluge</em> arrive (disons des
        centaines en un jour), le Capitaine choisit les{" "}
        <strong>plus pertinentes</strong> et les fait avancer, de sorte que
        l&apos;objectif est toujours atteint :{" "}
        <strong>les nouvelles positions obtiennent une note</strong>, au lieu de
        s&apos;accumuler sans évaluation.
      </>
    ),
    usesResult: (
      <>
        📊 <strong>Vous voyez le résultat</strong> — les positions apparaissent
        sur votre tableau de bord, notées, étiquetées avec leur source e-mail.
      </>
    ),
    usesCallout: (
      <>
        🎯{" "}
        <strong>
          L&apos;objectif de l&apos;équipe est la note, pas la lettre de
          motivation.
        </strong>{" "}
        La rédaction de CV/lettres de motivation reste à la demande (vous
        cliquez quand vous le voulez). Transférer de bonnes alertes signifie que
        plus de positions <em>pertinentes</em> sont notées dans le budget de
        l&apos;équipe.
      </>
    ),
    verifyTitle: "✅ Vérifiez que ça fonctionne",
    verifyBody: (
      <>
        Après avoir configuré le transfert et saisi les identifiants,
        l&apos;équipe confirme l&apos;accès lors du prochain contrôle de début
        de journée. Vous pouvez aussi surveiller votre tableau de bord : dans
        une fenêtre de travail, vous devriez commencer à voir des positions dont
        la source est une étiquette <code className={CODE_CLS}>*-email</code>.
      </>
    ),
    verifyIfNothing: "Si rien n'apparaît :",
    tblSymptom: "Symptôme",
    tblCause: "Cause probable",
    tblFix: "Solution",
    v1s: (
      <>
        Aucune position <code className={CODE_CLS}>*-email</code>{" "}
        n&apos;apparaît
      </>
    ),
    v1c: "identifiants non enregistrés / erronés",
    v1f: (
      <>
        ressaisissez l&apos;e-mail + le{" "}
        <strong>mot de passe d&apos;application</strong> dans l&apos;app de
        bureau
      </>
    ),
    v2s: <>&quot;Login failed&quot; dans les logs de l&apos;équipe</>,
    v2c: "vous utilisez le mot de passe de connexion, pas celui d'application",
    v2f: (
      <>
        créez un <strong>mot de passe spécifique à l&apos;application</strong>{" "}
        et utilisez-le
      </>
    ),
    v3s: <>Les alertes arrivent mais ne sont pas transférées</>,
    v3c: "la règle de la boîte ne correspond pas",
    v3f: "vérifiez l'adresse de l'expéditeur dans votre filtre de transfert",
    v4s: "Boîte vide",
    v4c: "alertes non activées à la source",
    v4f: (
      <>
        activez les <strong>notifications par e-mail</strong> pour vos alertes
        LinkedIn/sites
      </>
    ),
    privacyTitle: "🔒 Confidentialité et sécurité",
    privacy1: (
      <>
        Les identifiants sont stockés <strong>localement</strong>, avec
        l&apos;équipe — <strong>jamais</strong> téléversés dans le cloud.
      </>
    ),
    privacy2: (
      <>
        Utilisez une <strong>boîte dédiée</strong> et un{" "}
        <strong>mot de passe spécifique à l&apos;application</strong> pour que
        l&apos;équipe ne détienne jamais votre courrier personnel ni votre vraie
        connexion.
      </>
    ),
    privacy3:
      "Révoquez à tout moment : supprimez le mot de passe d'application (l'équipe arrête simplement de lire) ou changez-le dans l'app de bureau.",
    graphicsTitle: "🖼️ Matériaux graphiques",
    graphicsBody: (
      <>
        Ce guide est destiné à l&apos;utilisateur mais{" "}
        <strong>n&apos;a pas encore de captures</strong>. Emplacements à remplir
        :
      </>
    ),
    tblHash: "#",
    tblExpected: "Capture attendue",
    tblPath: "Chemin cible",
    g1: (
      <>
        Formulaire de bureau{" "}
        <strong>Paramètres → E-mail de l&apos;équipe</strong> (e-mail + mot de
        passe d&apos;application + bouton &quot;Comment configurer le
        transfert&quot;)
      </>
    ),
    g2: (
      <>
        Écran de création du <strong>Mot de passe d&apos;application</strong> de
        Gmail
      </>
    ),
    g3: (
      <>
        <strong>Job Alert</strong> LinkedIn avec les notifications par e-mail
        activées
      </>
    ),
    g4: (
      <>
        <strong>Filtre de transfert</strong> Gmail transférant les alertes vers
        la boîte de l&apos;équipe
      </>
    ),
    g5: (
      <>
        Tableau de bord montrant des positions étiquetées avec une source{" "}
        <code className={CODE_CLS}>*-email</code>
      </>
    ),
    allDocs: "Tous les docs",
    privacyPolicy: "Politique de confidentialité",
  },

  de: {
    bcHome: "Start",
    bcDocs: "Docs",
    bcEmail: "E-Mail-Weiterleitung",
    pageTitle: "📧 E-Mail-Weiterleitung",
    pageSubtitle: "Versorge das Team mit deinen Job-Benachrichtigungen",
    intro: (
      <>
        Gib dem Team eine <strong>eigene E-Mail-Adresse</strong> und leite deine
        Job-Benachrichtigungen automatisch dorthin weiter. Der Kapitän und die
        Scouts lesen dieses Postfach zu Beginn jedes Arbeitstags und verwandeln
        die Benachrichtigungen in bewertete Positionen — ohne sich im offenen
        Web zu verlieren.
      </>
    ),
    calloutOptional: (
      <>
        ✅ <strong>Optional, aber dringend empfohlen.</strong> Das Team
        funktioniert auch ohne (die Scouts durchsuchen das Web selbst), ist
        dabei aber <strong>deutlich weniger effizient</strong>. Wenn du die
        Weiterleitung einrichtest, entscheidest du, was das Team erreicht; wenn
        nicht, muss das Team es allein herausfinden.
      </>
    ),
    calloutScreens: (
      <>
        📸 <strong>Fehlende Screenshots:</strong> diese Anleitung hat noch keine
        Screenshots der Schritte. Die Platzhalter sind unten unter{" "}
        <em>Grafikmaterial</em> aufgeführt.
      </>
    ),
    whyTitle: "💡 Warum es das Team besser macht",
    whyIntro: (
      <>
        Eine Job-Benachrichtigung, die <em>du</em> konfiguriert hast, ist
        bereits auf das gefiltert, was du willst: die richtige Rolle, die
        richtige Stadt, das richtige Senioritätslevel. Wenn diese
        Benachrichtigung im Postfach des Teams landet, erhalten die Scouts einen{" "}
        <strong>vorqualifizierten Lead</strong>, statt im offenen Web Keywords
        zu erraten. Konkret:
      </>
    ),
    whyAccuracy: (
      <>
        🎯 <strong>Höhere Genauigkeit</strong> — die Position entspricht deiner
        echten Absicht (deinen Benachrichtigungsfiltern), nicht der besten
        Vermutung eines Scouts.
      </>
    ),
    whyTokens: (
      <>
        💸 <strong>Weniger Token-Verschwendung</strong> — kein breites Crawling
        des Webs, kein Kampf gegen Login-Wände. Der Scout liest einen Link, den
        die Plattform bereits für dich geprüft hat.
      </>
    ),
    whyTailored: (
      <>
        🧩 <strong>Mit der Zeit passgenauer</strong> — feile an deinen
        Benachrichtigungsfiltern und der Input des Teams ändert sich mit dir.
      </>
    ),
    whyAnyPlatform: (
      <>
        🌍 <strong>Jede Plattform, nicht nur LinkedIn</strong> — leite
        Benachrichtigungen von LinkedIn, Glassdoor, Indeed <strong>und</strong>{" "}
        jeder lokalen/landesweiten/stadtbezogenen Jobbörse weiter, die dir
        E-Mails schickt. Wenn sie eine Benachrichtigung sendet, kann das Team
        sie lesen.
      </>
    ),
    whySource: (
      <>
        Jede Position, die das Team erstellt, ist mit ihrer{" "}
        <strong>Quelle</strong> gekennzeichnet (z. B.{" "}
        <code className={CODE_CLS}>linkedin-email</code> im Vergleich zu einer
        Websuche), sodass du im Dashboard siehst, wie sich die per E-Mail
        bezogenen schlagen.
      </>
    ),
    calloutLinkedin: (
      <>
        🔗 <strong>LinkedIn ist die einzelne wertvollste Einrichtung.</strong>{" "}
        Konfiguriere deine Suchfilter auf LinkedIn, speichere sie als{" "}
        <strong>Job Alert</strong>, aktiviere die{" "}
        <strong>E-Mail-Benachrichtigungen</strong> und leite diese E-Mails dann
        an das Team weiter. Allein diese eine Quelle macht die Scouts dramatisch
        effektiver.
      </>
    ),
    stepsTitle: "🗺️ Die drei Schritte",
    stepsCode: `1. Erstelle ein dediziertes Postfach fürs Team  →  z. B. deinname.jht@gmail.com
2. Teile es mit dem Team (Desktop-App)          →  E-Mail + App-Passwort, lokal gespeichert
3. Leite deine Job-Alerts automatisch dorthin   →  von LinkedIn und jeder Plattform`,
    step1Title: "1️⃣ Erstelle ein eigenes Postfach",
    step1Body: (
      <>
        Lege eine <strong>frische, separate</strong> E-Mail-Adresse an, die das
        Team liest — gib ihm nicht dein persönliches Postfach. Ein kostenloses
        Gmail-Konto eignet sich gut (das Team verwendet standardmäßig{" "}
        <code className={CODE_CLS}>imap.gmail.com</code>). Halte es
        ausschließlich für Job-Benachrichtigungen reserviert: alles, was dort
        landet, wird als potenzieller Lead behandelt.
      </>
    ),
    step1Callout: (
      <>
        🔒 <strong>Warum eigens:</strong> das Team liest dieses Postfach über
        IMAP. Eine separate Adresse bedeutet, dass es deine persönliche Post nie
        berührt, und du kannst den Zugriff jederzeit widerrufen, indem du ein
        einziges Passwort änderst.
      </>
    ),
    step2Title: "2️⃣ Teile das Postfach mit dem Team (Desktop-App)",
    step2Body: (
      <>
        Öffne in der <strong>JHT-Desktop-App</strong>{" "}
        <strong>Einstellungen → Team-E-Mail</strong> und gib ein:
      </>
    ),
    tblField: "Feld",
    tblWhatToPut: "Was eintragen",
    rowEmailLabel: <strong>E-Mail-Adresse</strong>,
    rowEmailValue: (
      <>
        das eigene Postfach, z. B.{" "}
        <code className={CODE_CLS}>yourname.jht@gmail.com</code>
      </>
    ),
    rowPwLabel: <strong>App-Passwort</strong>,
    rowPwValue: (
      <>
        ein <strong>app-spezifisches Passwort</strong>, nicht dein
        Login-Passwort
      </>
    ),
    step2Local: (
      <>
        Die Desktop-App speichert diese <strong>lokal</strong> (im Ordner{" "}
        <code className={CODE_CLS}>credentials/</code> des Teams, auf der
        Maschine, die das Team ausführt) — sie werden <strong>nie</strong> in
        die Cloud gesendet.
      </>
    ),
    step2Callout: (
      <>
        🔑 <strong>App-Passwort (Gmail):</strong> aktiviere die Bestätigung in
        zwei Schritten, erstelle dann ein <em>App-Passwort</em> (Google-Konto →
        Sicherheit → App-Passwörter) und füge es ein. Es ist ein 16-stelliges
        Token, das du unabhängig widerrufen kannst, sodass das Team nie dein
        echtes Passwort hält. Andere Anbieter (Outlook, Fastmail, …) haben
        dasselbe Konzept — suche nach &quot;App-Passwort&quot; oder
        &quot;IMAP-Zugriffstoken&quot;.
      </>
    ),
    step2Button: (
      <>
        Die Schaltfläche{" "}
        <strong>&quot;So richtest du die Weiterleitung ein&quot;</strong> in
        diesem Fenster bringt dich zurück zu dieser Anleitung.
      </>
    ),
    step3Title: "3️⃣ Leite deine Job-Benachrichtigungen automatisch weiter",
    step3Body: (
      <>
        Das ist der Teil, der in <strong>deinem</strong> Postfach lebt. Du
        erstellst Regeln, die Job-Benachrichtigungs-E-Mails an das eigene
        Postfach weiterleiten. Richte so viele Quellen ein, wie du möchtest.
      </>
    ),
    liSubtitle: "🔗 LinkedIn (am meisten empfohlen)",
    li1: (
      <>
        Führe die Suche, die dich interessiert, auf LinkedIn aus (Rolle, Ort,
        Filter).
      </>
    ),
    li2: (
      <>
        Speichere sie als <strong>Job Alert</strong> und stelle die Häufigkeit
        ein (täglich ist ein guter Standard).
      </>
    ),
    li3: (
      <>
        Stelle sicher, dass die <strong>E-Mail-Benachrichtigungen</strong> für
        diesen Alert aktiviert sind (Einstellungen → Kommunikation → E-Mail →
        Jobs).
      </>
    ),
    li4: (
      <>
        Füge in deinem persönlichen Postfach einen{" "}
        <strong>Filter/eine Regel</strong> hinzu: wenn der Absender{" "}
        <code className={CODE_CLS}>jobs-listings@linkedin.com</code> (oder{" "}
        <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>) ist,{" "}
        <strong>leite</strong> an dein eigenes Team-Postfach weiter.
      </>
    ),
    gmailSubtitle: "📨 Gmail (Weiterleitungsregel)",
    gmail1: (
      <>
        <strong>
          Einstellungen → Weiterleitung und POP/IMAP → Weiterleitungsadresse
          hinzufügen
        </strong>{" "}
        → dein Team-Postfach, und bestätige es.
      </>
    ),
    gmail2: (
      <>
        <strong>Einstellungen → Filter → Neuen Filter erstellen</strong> → lasse
        die Benachrichtigungs-Absender übereinstimmen (z. B.{" "}
        <code className={CODE_CLS}>
          from:(linkedin.com OR glassdoor.com OR indeed.com)
        </code>
        ), dann <strong>Weiterleiten an</strong> dein Team-Postfach.
      </>
    ),
    outlookSubtitle: "📨 Outlook / andere",
    outlookBody: (
      <>
        Verwende <strong>Regeln</strong> (Outlook) oder das Äquivalent deines
        Anbieters:{" "}
        <em>
          wenn der Absender die Jobbörsen-Domain enthält → weiterleiten an
        </em>{" "}
        das Team-Postfach.
      </>
    ),
    anySubtitle:
      "🌍 Jede andere Plattform (lokale / landesweite / Nischen-Börsen)",
    anyBody: (
      <>
        Dasselbe Rezept für <strong>jede</strong> Seite, die dir
        Job-Benachrichtigungen per E-Mail schickt — nationale Börsen,
        Stadtportale, Nischen-Communitys. Abonniere ihre Benachrichtigungen und
        leite diese E-Mails dann an das Team-Postfach weiter. Das Team liest{" "}
        <strong>das gesamte</strong> eigene Postfach, daher funktionieren neue
        Plattformen ohne zusätzliche Konfiguration auf Team-Seite.
      </>
    ),
    anyCallout: (
      <>
        💡 <strong>Tipp:</strong> da das Postfach reserviert ist, kannst du{" "}
        <em>breit</em> weiterleiten und das Team es sortieren lassen — du
        brauchst keinen perfekten Filter auf deiner Seite.
      </>
    ),
    usesTitle: "🤖 Wie das Team es nutzt",
    usesStartOfDay: (
      <>
        🌅 <strong>Tagesbeginn</strong> — der Kapitän und die Scouts prüfen das
        Team-Postfach als Erstes im Arbeitsfenster, vor jeder Websuche. Die
        Benachrichtigungen über Nacht warten bereits.
      </>
    ),
    usesBalance: (
      <>
        🧮 <strong>Der Kapitän balanciert die Last</strong> — wenn eine
        vernünftige Anzahl an Benachrichtigungen eingegangen ist, liest das Team
        sie alle (mehr Signal ist besser). Wenn eine <em>Flut</em> eintrifft
        (sagen wir Hunderte an einem Tag), wählt der Kapitän die{" "}
        <strong>relevantesten</strong> aus und treibt diese voran, sodass das
        Ziel immer erreicht wird:{" "}
        <strong>neue Positionen erhalten eine Bewertung</strong>, statt sich nur
        unbewertet anzuhäufen.
      </>
    ),
    usesResult: (
      <>
        📊 <strong>Du siehst das Ergebnis</strong> — die Positionen erscheinen
        auf deinem Dashboard, bewertet, mit ihrer E-Mail-Quelle gekennzeichnet.
      </>
    ),
    usesCallout: (
      <>
        🎯{" "}
        <strong>
          Das Ziel des Teams ist die Bewertung, nicht das Anschreiben.
        </strong>{" "}
        Das Verfassen von Lebenslauf/Anschreiben bleibt auf Abruf (du klickst,
        wenn du es willst). Gute Benachrichtigungen weiterzuleiten bedeutet,
        dass mehr der <em>richtigen</em> Positionen innerhalb des Team-Budgets
        bewertet werden.
      </>
    ),
    verifyTitle: "✅ Prüfen, ob es funktioniert",
    verifyBody: (
      <>
        Nachdem du die Weiterleitung eingerichtet und die Zugangsdaten
        eingegeben hast, bestätigt das Team den Zugriff bei der nächsten
        Tagesbeginn-Prüfung. Du kannst auch dein Dashboard beobachten: innerhalb
        eines Arbeitsfensters solltest du beginnen, Positionen zu sehen, deren
        Quelle ein <code className={CODE_CLS}>*-email</code>-Tag ist.
      </>
    ),
    verifyIfNothing: "Wenn nichts erscheint:",
    tblSymptom: "Symptom",
    tblCause: "Wahrscheinliche Ursache",
    tblFix: "Lösung",
    v1s: (
      <>
        Es erscheinen keine <code className={CODE_CLS}>*-email</code>-Positionen
      </>
    ),
    v1c: "Zugangsdaten nicht gespeichert / falsch",
    v1f: (
      <>
        E-Mail + <strong>App-Passwort</strong> in der Desktop-App erneut
        eingeben
      </>
    ),
    v2s: <>&quot;Login failed&quot; in den Team-Logs</>,
    v2c: "du verwendest das Login-Passwort, nicht das App-Passwort",
    v2f: (
      <>
        ein <strong>app-spezifisches Passwort</strong> erstellen und dieses
        verwenden
      </>
    ),
    v3s: <>Benachrichtigungen kommen an, werden aber nicht weitergeleitet</>,
    v3c: "die Postfach-Regel passt nicht",
    v3f: "prüfe die Absenderadresse in deinem Weiterleitungsfilter",
    v4s: "Postfach leer",
    v4c: "Benachrichtigungen an der Quelle nicht aktiviert",
    v4f: (
      <>
        aktiviere die <strong>E-Mail-Benachrichtigungen</strong> für deine
        LinkedIn-/Börsen-Alerts
      </>
    ),
    privacyTitle: "🔒 Datenschutz & Sicherheit",
    privacy1: (
      <>
        Die Zugangsdaten werden <strong>lokal</strong> gespeichert, beim Team —{" "}
        <strong>nie</strong> in die Cloud hochgeladen.
      </>
    ),
    privacy2: (
      <>
        Verwende ein <strong>eigenes Postfach</strong> und ein{" "}
        <strong>app-spezifisches Passwort</strong>, damit das Team nie deine
        persönliche Post oder dein echtes Login hält.
      </>
    ),
    privacy3:
      "Jederzeit widerrufen: lösche das App-Passwort (das Team hört einfach auf zu lesen) oder ändere es in der Desktop-App.",
    graphicsTitle: "🖼️ Grafikmaterial",
    graphicsBody: (
      <>
        Diese Anleitung ist für Endnutzer, hat aber{" "}
        <strong>noch keine Screenshots</strong>. Auszufüllende Platzhalter:
      </>
    ),
    tblHash: "#",
    tblExpected: "Erwarteter Screenshot",
    tblPath: "Zielpfad",
    g1: (
      <>
        Desktop-Formular <strong>Einstellungen → Team-E-Mail</strong> (E-Mail +
        App-Passwort + Schaltfläche &quot;So richtest du die Weiterleitung
        ein&quot;)
      </>
    ),
    g2: (
      <>
        Gmail-Bildschirm zur Erstellung des <strong>App-Passworts</strong>
      </>
    ),
    g3: (
      <>
        LinkedIn-<strong>Job Alert</strong> mit aktivierten
        E-Mail-Benachrichtigungen
      </>
    ),
    g4: (
      <>
        Gmail-<strong>Weiterleitungsfilter</strong>, der Benachrichtigungen an
        das Team-Postfach weiterleitet
      </>
    ),
    g5: (
      <>
        Dashboard, das Positionen mit einer{" "}
        <code className={CODE_CLS}>*-email</code>-Quelle zeigt
      </>
    ),
    allDocs: "Alle Docs",
    privacyPolicy: "Datenschutzerklärung",
  },

  hu: {
    bcHome: "Kezdőlap",
    bcDocs: "Docs",
    bcEmail: "E-mail továbbítás",
    pageTitle: "📧 E-mail továbbítás",
    pageSubtitle: "Add át a csapatnak az álláshirdetés-értesítőidet",
    intro: (
      <>
        Adj a csapatnak egy <strong>dedikált e-mail-címet</strong>, és
        továbbítsd oda automatikusan az álláshirdetés-értesítőidet. A Kapitány
        és a Scoutok minden munkanap elején elolvassák ezt a postafiókot, és az
        értesítőket pontozott pozíciókká alakítják — anélkül, hogy elvesznének a
        nyílt weben.
      </>
    ),
    calloutOptional: (
      <>
        ✅ <strong>Opcionális, de erősen ajánlott.</strong> A csapat enélkül is
        jól működik (a Scoutok maguk keresnek a weben), de{" "}
        <strong>érezhetően kevésbé hatékony</strong>. Ha beállítod a
        továbbítást, te döntöd el, mi jut el a csapathoz; ha nem, a csapatnak
        magának kell kitalálnia.
      </>
    ),
    calloutScreens: (
      <>
        📸 <strong>Hiányzó képernyőképek:</strong> ehhez az útmutatóhoz még
        nincsenek képernyőképek a lépésekről. A helyőrzők alul, a{" "}
        <em>Grafikai anyagok</em> alatt vannak felsorolva.
      </>
    ),
    whyTitle: "💡 Miért teszi jobbá a csapatot",
    whyIntro: (
      <>
        Egy álláshirdetés-értesítő, amelyet <em>te</em> állítottál be, már arra
        van szűrve, amit szeretnél: a megfelelő szerep, a megfelelő város, a
        megfelelő szenioritás. Amikor ez az értesítő megérkezik a csapat
        postafiókjába, a Scoutok <strong>előminősített leadet</strong> kapnak
        ahelyett, hogy kulcsszavakat találgatnának a nyílt weben. Konkrétan:
      </>
    ),
    whyAccuracy: (
      <>
        🎯 <strong>Nagyobb pontosság</strong> — a pozíció a valódi szándékodnak
        felel meg (az értesítő szűrőidnek), nem egy Scout legjobb tippjének.
      </>
    ),
    whyTokens: (
      <>
        💸 <strong>Kevesebb token-pazarlás</strong> — nincs széles körű
        web-feltérképezés, nincs harc a bejelentkezési falakkal. A Scout egy
        olyan linket olvas, amelyet a platform már megszűrt neked.
      </>
    ),
    whyTailored: (
      <>
        🧩 <strong>Idővel egyre testreszabottabb</strong> — finomítsd az
        értesítő szűrőidet, és a csapat bemenete együtt változik veled.
      </>
    ),
    whyAnyPlatform: (
      <>
        🌍 <strong>Bármelyik platform, nem csak a LinkedIn</strong> — továbbítsd
        az értesítőket a LinkedInről, Glassdoorról, Indeedről{" "}
        <strong>és</strong> bármilyen helyi/országos/városi álláshirdető
        oldalról, amely e-mailt küld neked. Ha küld értesítőt, a csapat el tudja
        olvasni.
      </>
    ),
    whySource: (
      <>
        A csapat által létrehozott minden pozíció meg van jelölve a{" "}
        <strong>forrásával</strong> (pl.{" "}
        <code className={CODE_CLS}>linkedin-email</code> egy webes kereséshez
        képest), így a vezérlőpulton láthatod, hogyan teljesítenek az e-mailből
        származók.
      </>
    ),
    calloutLinkedin: (
      <>
        🔗 <strong>A LinkedIn önmagában a legértékesebb beállítás.</strong>{" "}
        Állítsd be a keresési szűrőidet a LinkedInen, mentsd el{" "}
        <strong>Job Alertként</strong>, kapcsold be az{" "}
        <strong>e-mail-értesítéseket</strong>, majd továbbítsd ezeket az
        e-maileket a csapatnak. Ez az egyetlen forrás önmagában is jelentősen
        hatékonyabbá teszi a Scoutokat.
      </>
    ),
    stepsTitle: "🗺️ A három lépés",
    stepsCode: `1. Hozz létre dedikált postafiókot a csapatnak        →  pl. nev.jht@gmail.com
2. Oszd meg a csapattal (asztali app)                 →  e-mail + alkalmazásjelszó, helyben mentve
3. Továbbítsd ide az állásértesítőidet automatikusan  →  LinkedInről és bármely platformról`,
    step1Title: "1️⃣ Hozz létre egy dedikált postafiókot",
    step1Body: (
      <>
        Hozz létre egy <strong>új, külön</strong> e-mail-címet, amelyet a csapat
        fog olvasni — ne add meg a személyes postafiókodat. Egy ingyenes
        Gmail-fiók jól megfelel (a csapat alapértelmezetten az{" "}
        <code className={CODE_CLS}>imap.gmail.com</code> címet használja).
        Tartsd kizárólag az álláshirdetés-értesítőkre dedikáltan: minden, ami
        oda érkezik, potenciális leadnek számít.
      </>
    ),
    step1Callout: (
      <>
        🔒 <strong>Miért dedikált:</strong> a csapat IMAP-on keresztül olvassa
        ezt a postafiókot. A külön cím azt jelenti, hogy soha nem érinti a
        személyes leveleidet, és a hozzáférést bármikor visszavonhatod egyetlen
        jelszó megváltoztatásával.
      </>
    ),
    step2Title: "2️⃣ Oszd meg a postafiókot a csapattal (asztali alkalmazás)",
    step2Body: (
      <>
        A <strong>JHT asztali alkalmazásban</strong> nyisd meg a{" "}
        <strong>Beállítások → Csapat e-mail</strong> menüt, és add meg:
      </>
    ),
    tblField: "Mező",
    tblWhatToPut: "Mit írj be",
    rowEmailLabel: <strong>E-mail-cím</strong>,
    rowEmailValue: (
      <>
        a dedikált postafiók, pl.{" "}
        <code className={CODE_CLS}>yourname.jht@gmail.com</code>
      </>
    ),
    rowPwLabel: <strong>Alkalmazásjelszó</strong>,
    rowPwValue: (
      <>
        egy <strong>alkalmazásspecifikus jelszó</strong>, nem a bejelentkezési
        jelszavad
      </>
    ),
    step2Local: (
      <>
        Az asztali alkalmazás ezeket <strong>helyileg</strong> menti (a csapat{" "}
        <code className={CODE_CLS}>credentials/</code> mappájában, azon a gépen,
        amely a csapatot futtatja) — <strong>soha</strong> nem kerülnek fel a
        felhőbe.
      </>
    ),
    step2Callout: (
      <>
        🔑 <strong>Alkalmazásjelszó (Gmail):</strong> kapcsold be a kétlépcsős
        azonosítást, majd hozz létre egy <em>Alkalmazásjelszót</em> (Google-fiók
        → Biztonság → Alkalmazásjelszavak), és illeszd be azt. Ez egy 16
        karakteres token, amelyet függetlenül visszavonhatsz, így a csapat soha
        nem tartja nálad a valódi jelszavadat. Más szolgáltatóknak (Outlook,
        Fastmail, …) ugyanez a koncepciójuk — keresd az
        &quot;alkalmazásjelszó&quot; vagy &quot;IMAP-hozzáférési token&quot;
        kifejezést.
      </>
    ),
    step2Button: (
      <>
        Az ablakban lévő{" "}
        <strong>&quot;Hogyan állítsd be a továbbítást&quot;</strong> gomb
        visszahoz erre az útmutatóra.
      </>
    ),
    step3Title: "3️⃣ Továbbítsd automatikusan az álláshirdetés-értesítőidet",
    step3Body: (
      <>
        Ez az a rész, amely a <strong>te</strong> postafiókodban él. Olyan
        szabályokat hozol létre, amelyek a dedikált postafiókba továbbítják az
        álláshirdetés-értesítő e-maileket. Annyi forrást állíts be, amennyit
        csak szeretnél.
      </>
    ),
    liSubtitle: "🔗 LinkedIn (a leginkább ajánlott)",
    li1: (
      <>
        Futtasd le a téged érdeklő keresést a LinkedInen (szerep, hely, szűrők).
      </>
    ),
    li2: (
      <>
        Mentsd el <strong>Job Alertként</strong>, és állítsd be a gyakoriságot
        (a napi jó alapérték).
      </>
    ),
    li3: (
      <>
        Győződj meg róla, hogy az <strong>e-mail-értesítések</strong> be vannak
        kapcsolva ehhez az értesítőhöz (Beállítások → Kommunikáció → E-mail →
        Állások).
      </>
    ),
    li4: (
      <>
        A személyes postafiókodban adj hozzá egy{" "}
        <strong>szűrőt/szabályt</strong>: amikor a feladó{" "}
        <code className={CODE_CLS}>jobs-listings@linkedin.com</code> (vagy{" "}
        <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>),{" "}
        <strong>továbbítsd</strong> a dedikált csapat-postafiókodba.
      </>
    ),
    gmailSubtitle: "📨 Gmail (továbbítási szabály)",
    gmail1: (
      <>
        <strong>
          Beállítások → Továbbítás és POP/IMAP → Továbbítási cím hozzáadása
        </strong>{" "}
        → a csapat-postafiókod, és erősítsd meg.
      </>
    ),
    gmail2: (
      <>
        <strong>Beállítások → Szűrők → Új szűrő létrehozása</strong> → illeszd
        az értesítők feladóit (pl.{" "}
        <code className={CODE_CLS}>
          from:(linkedin.com OR glassdoor.com OR indeed.com)
        </code>
        ), majd <strong>Továbbítás ide</strong>: a csapat-postafiókod.
      </>
    ),
    outlookSubtitle: "📨 Outlook / egyéb",
    outlookBody: (
      <>
        Használj <strong>Szabályokat</strong> (Outlook) vagy a szolgáltatód
        megfelelőjét:{" "}
        <em>
          ha a feladó tartalmazza az álláshirdető oldal domainjét → továbbítás
          ide
        </em>
        : a csapat postafiókja.
      </>
    ),
    anySubtitle: "🌍 Bármely más platform (helyi / országos / niche oldalak)",
    anyBody: (
      <>
        Ugyanaz a recept <strong>minden</strong> oldalhoz, amely
        állásértesítőket küld neked e-mailben — országos oldalak, városi
        portálok, niche közösségek. Iratkozz fel az értesítőikre, majd
        továbbítsd ezeket az e-maileket a csapat postafiókjába. A csapat a{" "}
        <strong>teljes</strong> dedikált postafiókot olvassa, így az új
        platformok bármilyen további beállítás nélkül működnek a csapat oldalán.
      </>
    ),
    anyCallout: (
      <>
        💡 <strong>Tipp:</strong> mivel a postafiók dedikált, <em>tágan</em> is
        továbbíthatsz, és hagyhatod, hogy a csapat válogasson — nincs szükséged
        tökéletes szűrőre a te oldaladon.
      </>
    ),
    usesTitle: "🤖 Hogyan használja a csapat",
    usesStartOfDay: (
      <>
        🌅 <strong>A nap kezdete</strong> — a Kapitány és a Scoutok elsőként a
        csapat postafiókját ellenőrzik a munkaablakban, bármilyen webes keresés
        előtt. Az éjszakai értesítők már várnak.
      </>
    ),
    usesBalance: (
      <>
        🧮 <strong>A Kapitány kiegyensúlyozza a terhelést</strong> — ha ésszerű
        számú értesítő érkezett, a csapat mindet elolvassa (több jel jobb). Ha{" "}
        <em>áradat</em> érkezik (mondjuk több száz egy nap alatt), a Kapitány a{" "}
        <strong>legrelevánsabbakat</strong> választja ki, és azokat tolja át,
        így a cél mindig teljesül: <strong>az új pozíciók pontot kapnak</strong>
        , nem csak értékelés nélkül halmozódnak.
      </>
    ),
    usesResult: (
      <>
        📊 <strong>Te látod az eredményt</strong> — a pozíciók megjelennek a
        vezérlőpultodon, pontozva, az e-mail-forrásukkal megjelölve.
      </>
    ),
    usesCallout: (
      <>
        🎯 <strong>A csapat célja a pontszám, nem a motivációs levél.</strong>{" "}
        Az önéletrajz/motivációs levél írása igény szerinti marad (akkor
        kattintasz, amikor szeretnéd). A jó értesítők továbbítása azt jelenti,
        hogy több <em>megfelelő</em> pozíció kap pontot a csapat keretén belül.
      </>
    ),
    verifyTitle: "✅ Ellenőrizd, hogy működik",
    verifyBody: (
      <>
        Miután beállítottad a továbbítást és megadtad a hitelesítő adatokat, a
        csapat a következő napkezdő ellenőrzéskor megerősíti a hozzáférést.
        Figyelheted a vezérlőpultodat is: egy munkaablakon belül elkezdesz olyan
        pozíciókat látni, amelyek forrása egy{" "}
        <code className={CODE_CLS}>*-email</code> címke.
      </>
    ),
    verifyIfNothing: "Ha semmi nem jelenik meg:",
    tblSymptom: "Tünet",
    tblCause: "Valószínű ok",
    tblFix: "Megoldás",
    v1s: (
      <>
        Nem jelenik meg egyetlen <code className={CODE_CLS}>*-email</code>{" "}
        pozíció sem
      </>
    ),
    v1c: "a hitelesítő adatok nincsenek mentve / hibásak",
    v1f: (
      <>
        add meg újra az e-mailt + az <strong>alkalmazásjelszót</strong> az
        asztali alkalmazásban
      </>
    ),
    v2s: <>&quot;Login failed&quot; a csapat naplóiban</>,
    v2c: "a bejelentkezési jelszót használod, nem az alkalmazásjelszót",
    v2f: (
      <>
        hozz létre egy <strong>alkalmazásspecifikus jelszót</strong>, és azt
        használd
      </>
    ),
    v3s: <>Az értesítők megérkeznek, de nem továbbítódnak</>,
    v3c: "a postafiók-szabály nem illeszkedik",
    v3f: "ellenőrizd a feladó címét a továbbítási szűrődben",
    v4s: "Üres postafiók",
    v4c: "az értesítők nincsenek bekapcsolva a forrásnál",
    v4f: (
      <>
        kapcsold be az <strong>e-mail-értesítéseket</strong> a
        LinkedIn-/oldal-értesítőidhez
      </>
    ),
    privacyTitle: "🔒 Adatvédelem és biztonság",
    privacy1: (
      <>
        A hitelesítő adatok <strong>helyileg</strong> tárolódnak, a csapatnál —{" "}
        <strong>soha</strong> nem kerülnek fel a felhőbe.
      </>
    ),
    privacy2: (
      <>
        Használj <strong>dedikált postafiókot</strong> és{" "}
        <strong>alkalmazásspecifikus jelszót</strong>, hogy a csapat soha ne
        tartsa nálad a személyes leveleidet vagy a valódi bejelentkezésedet.
      </>
    ),
    privacy3:
      "Bármikor visszavonhatod: töröld az alkalmazásjelszót (a csapat egyszerűen abbahagyja az olvasást), vagy módosítsd az asztali alkalmazásban.",
    graphicsTitle: "🖼️ Grafikai anyagok",
    graphicsBody: (
      <>
        Ez az útmutató felhasználóknak szól, de{" "}
        <strong>még nincsenek képernyőképei</strong>. Kitöltendő helyőrzők:
      </>
    ),
    tblHash: "#",
    tblExpected: "Várt képernyőkép",
    tblPath: "Célútvonal",
    g1: (
      <>
        Asztali <strong>Beállítások → Csapat e-mail</strong> űrlap (e-mail +
        alkalmazásjelszó + &quot;Hogyan állítsd be a továbbítást&quot; gomb)
      </>
    ),
    g2: (
      <>
        Gmail <strong>Alkalmazásjelszó</strong> létrehozási képernyő
      </>
    ),
    g3: (
      <>
        LinkedIn <strong>Job Alert</strong> bekapcsolt e-mail-értesítésekkel
      </>
    ),
    g4: (
      <>
        Gmail <strong>továbbítási szűrő</strong>, amely az értesítőket a csapat
        postafiókjába továbbítja
      </>
    ),
    g5: (
      <>
        Vezérlőpult, amely <code className={CODE_CLS}>*-email</code> forrással
        megjelölt pozíciókat mutat
      </>
    ),
    allDocs: "Összes dokumentum",
    privacyPolicy: "Adatvédelmi irányelvek",
  },

  pt: {
    bcHome: "Início",
    bcDocs: "Docs",
    bcEmail: "Encaminhamento de e-mail",
    pageTitle: "📧 Encaminhamento de e-mail",
    pageSubtitle: "Forneça à equipe os seus alertas de emprego",
    intro: (
      <>
        Dê à equipe um <strong>endereço de e-mail dedicado</strong> e encaminhe
        automaticamente para ele as notificações dos seus alertas de emprego. O
        Capitão e os Scouts leem essa caixa de entrada no início de cada dia de
        trabalho e transformam os alertas em posições pontuadas — sem se perder
        na web aberta.
      </>
    ),
    calloutOptional: (
      <>
        ✅ <strong>Opcional, mas fortemente recomendado.</strong> A equipe
        funciona bem sem isso (os Scouts pesquisam na web por conta própria),
        mas é <strong>notavelmente menos eficiente</strong>. Se você configurar
        o encaminhamento, você decide o que chega à equipe; se não, a equipe tem
        que descobrir sozinha.
      </>
    ),
    calloutScreens: (
      <>
        📸 <strong>Capturas de tela ausentes:</strong> este guia ainda não tem
        capturas de tela dos passos. Os espaços reservados estão listados no
        final, em <em>Materiais gráficos</em>.
      </>
    ),
    whyTitle: "💡 Por que torna a equipe melhor",
    whyIntro: (
      <>
        Um alerta de emprego que <em>você</em> configurou já está filtrado para
        o que você quer: a função certa, a cidade certa, a senioridade certa.
        Quando esse alerta chega à caixa de entrada da equipe, os Scouts recebem
        um <strong>lead pré-qualificado</strong> em vez de adivinhar palavras-
        chave na web aberta. Concretamente:
      </>
    ),
    whyAccuracy: (
      <>
        🎯 <strong>Maior precisão</strong> — a posição corresponde à sua real
        intenção (os filtros do seu alerta), não ao melhor palpite de um Scout.
      </>
    ),
    whyTokens: (
      <>
        💸 <strong>Menos desperdício de tokens</strong> — sem rastreamento amplo
        da web, sem brigar com muros de login. O Scout lê um link que a
        plataforma já validou para você.
      </>
    ),
    whyTailored: (
      <>
        🧩 <strong>Mais sob medida ao longo do tempo</strong> — ajuste os
        filtros do seu alerta e a entrada da equipe muda com você.
      </>
    ),
    whyAnyPlatform: (
      <>
        🌍 <strong>Qualquer plataforma, não só o LinkedIn</strong> — encaminhe
        alertas do LinkedIn, Glassdoor, Indeed <strong>e</strong> qualquer site
        de empregos local/nacional/da cidade que lhe envie e-mails. Se enviar
        uma notificação, a equipe consegue lê-la.
      </>
    ),
    whySource: (
      <>
        Cada posição que a equipe cria é marcada com a sua{" "}
        <strong>fonte</strong> (p. ex.{" "}
        <code className={CODE_CLS}>linkedin-email</code> versus uma busca na
        web), para que você veja no painel como as provenientes de e-mail se
        comparam.
      </>
    ),
    calloutLinkedin: (
      <>
        🔗{" "}
        <strong>O LinkedIn é, sozinho, a configuração de maior valor.</strong>{" "}
        Configure os seus filtros de busca no LinkedIn, salve-os como{" "}
        <strong>Job Alert</strong>, ative as{" "}
        <strong>notificações por e-mail</strong> e depois encaminhe esses
        e-mails para a equipe. Só essa fonte já torna os Scouts drasticamente
        mais eficazes.
      </>
    ),
    stepsTitle: "🗺️ Os três passos",
    stepsCode: `1. Cria uma caixa dedicada para a equipa        →  ex. oteunome.jht@gmail.com
2. Partilha-a com a equipa (app de computador)  →  email + palavra-passe de app, em local
3. Reencaminha aí os teus alertas de emprego    →  do LinkedIn e de qualquer plataforma`,
    step1Title: "1️⃣ Crie uma caixa de entrada dedicada",
    step1Body: (
      <>
        Crie um endereço de e-mail <strong>novo e separado</strong> que a equipe
        vai ler — não dê a sua caixa de entrada pessoal. Uma conta gratuita do
        Gmail funciona bem (a equipe usa por padrão{" "}
        <code className={CODE_CLS}>imap.gmail.com</code>). Mantenha-a dedicada
        apenas aos alertas de emprego: tudo o que chega ali é tratado como um
        possível lead.
      </>
    ),
    step1Callout: (
      <>
        🔒 <strong>Por que dedicada:</strong> a equipe lê esta caixa de entrada
        via IMAP. Um endereço separado significa que ela nunca toca no seu
        e-mail pessoal, e você pode revogar o acesso a qualquer momento mudando
        uma única senha.
      </>
    ),
    step2Title:
      "2️⃣ Compartilhe a caixa de entrada com a equipe (app de desktop)",
    step2Body: (
      <>
        No <strong>app de desktop JHT</strong>, abra{" "}
        <strong>Configurações → E-mail da equipe</strong> e insira:
      </>
    ),
    tblField: "Campo",
    tblWhatToPut: "O que colocar",
    rowEmailLabel: <strong>Endereço de e-mail</strong>,
    rowEmailValue: (
      <>
        a caixa de entrada dedicada, p. ex.{" "}
        <code className={CODE_CLS}>yourname.jht@gmail.com</code>
      </>
    ),
    rowPwLabel: <strong>Senha de app</strong>,
    rowPwValue: (
      <>
        uma <strong>senha específica de app</strong>, não a sua senha de login
      </>
    ),
    step2Local: (
      <>
        O app de desktop salva esses dados <strong>localmente</strong> (na pasta{" "}
        <code className={CODE_CLS}>credentials/</code> da equipe, na máquina que
        executa a equipe) — eles <strong>nunca</strong> são enviados para a
        nuvem.
      </>
    ),
    step2Callout: (
      <>
        🔑 <strong>Senha de app (Gmail):</strong> ative a Verificação em duas
        etapas, depois crie uma <em>Senha de app</em> (Conta do Google →
        Segurança → Senhas de app) e cole-a. É um token de 16 caracteres que
        você pode revogar de forma independente, então a equipe nunca guarda a
        sua senha real. Outros provedores (Outlook, Fastmail, …) têm o mesmo
        conceito — procure por &quot;senha de app&quot; ou &quot;token de acesso
        IMAP&quot;.
      </>
    ),
    step2Button: (
      <>
        O botão <strong>&quot;Como configurar o encaminhamento&quot;</strong>{" "}
        nessa janela traz você de volta a este guia.
      </>
    ),
    step3Title: "3️⃣ Encaminhe automaticamente os seus alertas de emprego",
    step3Body: (
      <>
        Esta é a parte que vive na <strong>sua</strong> caixa de e-mail. Você
        cria regras que encaminham os e-mails de alerta de emprego para a caixa
        de entrada dedicada. Configure quantas fontes quiser.
      </>
    ),
    liSubtitle: "🔗 LinkedIn (o mais recomendado)",
    li1: (
      <>
        Execute a busca que lhe interessa no LinkedIn (função, localização,
        filtros).
      </>
    ),
    li2: (
      <>
        Salve-a como <strong>Job Alert</strong> e defina a frequência (diária é
        um bom padrão).
      </>
    ),
    li3: (
      <>
        Certifique-se de que as <strong>notificações por e-mail</strong> estão
        ativadas para esse alerta (Configurações → Comunicações → E-mail →
        Empregos).
      </>
    ),
    li4: (
      <>
        Na sua caixa de e-mail pessoal, adicione um{" "}
        <strong>filtro/regra</strong>: quando o remetente for{" "}
        <code className={CODE_CLS}>jobs-listings@linkedin.com</code> (ou{" "}
        <code className={CODE_CLS}>jobalerts-noreply@linkedin.com</code>),{" "}
        <strong>encaminhe</strong> para a sua caixa de entrada dedicada da
        equipe.
      </>
    ),
    gmailSubtitle: "📨 Gmail (regra de encaminhamento)",
    gmail1: (
      <>
        <strong>
          Configurações → Encaminhamento e POP/IMAP → Adicionar um endereço de
          encaminhamento
        </strong>{" "}
        → a caixa de entrada da sua equipe, e confirme.
      </>
    ),
    gmail2: (
      <>
        <strong>Configurações → Filtros → Criar um novo filtro</strong> →
        corresponda os remetentes dos alertas (p. ex.{" "}
        <code className={CODE_CLS}>
          from:(linkedin.com OR glassdoor.com OR indeed.com)
        </code>
        ), depois <strong>Encaminhá-lo para</strong> a caixa de entrada da sua
        equipe.
      </>
    ),
    outlookSubtitle: "📨 Outlook / outros",
    outlookBody: (
      <>
        Use <strong>Regras</strong> (Outlook) ou o equivalente do seu provedor:{" "}
        <em>
          se o remetente contiver o domínio do site de empregos → encaminhar
          para
        </em>{" "}
        a caixa de entrada da equipe.
      </>
    ),
    anySubtitle:
      "🌍 Qualquer outra plataforma (sites locais / nacionais / de nicho)",
    anyBody: (
      <>
        A mesma receita para <strong>cada</strong> site que lhe envia
        notificações de emprego por e-mail — sites nacionais, portais de cidade,
        comunidades de nicho. Inscreva-se nos alertas deles e depois encaminhe
        esses e-mails para a caixa de entrada da equipe. A equipe lê{" "}
        <strong>toda</strong> a caixa de entrada dedicada, então novas
        plataformas funcionam sem nenhuma configuração extra do lado da equipe.
      </>
    ),
    anyCallout: (
      <>
        💡 <strong>Dica:</strong> como a caixa de entrada é dedicada, você pode
        encaminhar de forma <em>ampla</em> e deixar a equipe organizar — você
        não precisa de um filtro perfeito do seu lado.
      </>
    ),
    usesTitle: "🤖 Como a equipe usa",
    usesStartOfDay: (
      <>
        🌅 <strong>Início do dia</strong> — o Capitão e os Scouts verificam a
        caixa de entrada da equipe logo no começo da janela de trabalho, antes
        de qualquer busca na web. Os alertas da noite já estão esperando.
      </>
    ),
    usesBalance: (
      <>
        🧮 <strong>O Capitão equilibra a carga</strong> — se chegou um número
        razoável de alertas, a equipe lê todos (mais sinal é melhor). Se chega
        uma <em>enxurrada</em> (digamos centenas em um dia), o Capitão escolhe
        os <strong>mais relevantes</strong> e os empurra adiante, de modo que o
        objetivo é sempre cumprido:{" "}
        <strong>novas posições chegam a uma pontuação</strong>, em vez de apenas
        se acumularem sem avaliação.
      </>
    ),
    usesResult: (
      <>
        📊 <strong>Você vê o resultado</strong> — as posições aparecem no seu
        painel, pontuadas, marcadas com a sua fonte de e-mail.
      </>
    ),
    usesCallout: (
      <>
        🎯{" "}
        <strong>
          O objetivo da equipe é a pontuação, não a carta de apresentação.
        </strong>{" "}
        A redação de CV/carta de apresentação continua sob demanda (você clica
        quando quiser). Encaminhar bons alertas significa que mais posições{" "}
        <em>certas</em> são pontuadas dentro do orçamento da equipe.
      </>
    ),
    verifyTitle: "✅ Verifique se está funcionando",
    verifyBody: (
      <>
        Depois de configurar o encaminhamento e inserir as credenciais, a equipe
        confirma o acesso na próxima verificação de início do dia. Você também
        pode acompanhar o seu painel: dentro de uma janela de trabalho você deve
        começar a ver posições cuja fonte é uma etiqueta{" "}
        <code className={CODE_CLS}>*-email</code>.
      </>
    ),
    verifyIfNothing: "Se nada aparecer:",
    tblSymptom: "Sintoma",
    tblCause: "Causa provável",
    tblFix: "Solução",
    v1s: (
      <>
        Nenhuma posição <code className={CODE_CLS}>*-email</code> aparece
      </>
    ),
    v1c: "credenciais não salvas / incorretas",
    v1f: (
      <>
        insira novamente o e-mail + a <strong>senha de app</strong> no app de
        desktop
      </>
    ),
    v2s: <>&quot;Login failed&quot; nos logs da equipe</>,
    v2c: "usando a senha de login, não a senha de app",
    v2f: (
      <>
        crie uma <strong>senha específica de app</strong> e use essa
      </>
    ),
    v3s: <>Os alertas chegam mas não são encaminhados</>,
    v3c: "a regra da caixa de entrada não corresponde",
    v3f: "verifique o endereço do remetente no seu filtro de encaminhamento",
    v4s: "Caixa de entrada vazia",
    v4c: "alertas não ativados na fonte",
    v4f: (
      <>
        ative as <strong>notificações por e-mail</strong> dos seus alertas do
        LinkedIn/sites
      </>
    ),
    privacyTitle: "🔒 Privacidade e segurança",
    privacy1: (
      <>
        As credenciais são armazenadas <strong>localmente</strong>, com a equipe
        — <strong>nunca</strong> enviadas para a nuvem.
      </>
    ),
    privacy2: (
      <>
        Use uma <strong>caixa de entrada dedicada</strong> e uma{" "}
        <strong>senha específica de app</strong> para que a equipe nunca guarde
        o seu e-mail pessoal nem o seu login real.
      </>
    ),
    privacy3:
      "Revogue a qualquer momento: exclua a senha de app (a equipe simplesmente para de ler) ou altere-a no app de desktop.",
    graphicsTitle: "🖼️ Materiais gráficos",
    graphicsBody: (
      <>
        Este guia é voltado para o usuário, mas{" "}
        <strong>ainda não tem capturas de tela</strong>. Espaços reservados a
        preencher:
      </>
    ),
    tblHash: "#",
    tblExpected: "Captura de tela esperada",
    tblPath: "Caminho de destino",
    g1: (
      <>
        Formulário de desktop <strong>Configurações → E-mail da equipe</strong>{" "}
        (e-mail + senha de app + botão &quot;Como configurar o
        encaminhamento&quot;)
      </>
    ),
    g2: (
      <>
        Tela de criação da <strong>Senha de app</strong> do Gmail
      </>
    ),
    g3: (
      <>
        <strong>Job Alert</strong> do LinkedIn com as notificações por e-mail
        ativadas
      </>
    ),
    g4: (
      <>
        <strong>Filtro de encaminhamento</strong> do Gmail encaminhando alertas
        para a caixa de entrada da equipe
      </>
    ),
    g5: (
      <>
        Painel mostrando posições marcadas com uma fonte{" "}
        <code className={CODE_CLS}>*-email</code>
      </>
    ),
    allDocs: "Todos os docs",
    privacyPolicy: "Política de privacidade",
  },
};
