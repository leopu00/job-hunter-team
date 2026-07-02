import type { Locale } from "@/i18n/config";
import { getRequestLocale } from "@/lib/request-locale";
import { DocHeader, H2, P, UL, LI, Callout, GitHubMore } from "../../DocKit";
import { repoTree } from "../../repo";

const ISSUES = "https://github.com/leopu00/job-hunter-team/issues/new";
const LINK_CLS =
  "text-[var(--color-white)] underline underline-offset-2 hover:text-[var(--color-green)] transition-colors";

type BetaCopy = {
  title: string;
  tagline: string;
  intro: string;
  whyH: string;
  whyP: string;
  whoH: string;
  whoLead: string;
  who1: string;
  who2: string;
  who3: string;
  whoNoTech: string;
  getH: string;
  get1: string;
  get2: string;
  get3: string;
  get4: string;
  askH: string;
  ask1: string;
  ask2: string;
  ask3: string;
  ask4: string;
  ask5: string;
  applyH: string;
  applyLead: string;
  aq1: string;
  aq2: string;
  aq3: string;
  aq4: string;
  aq5: string;
  aq6: string;
  applyCta: string;
  applyNote: string;
  expectH: string;
  expectLead: string;
  exp1: string;
  exp2: string;
  exp3: string;
  expectClose: string;
  githubMore: string;
};

// EN + IT autorati; le altre lingue arrivano dai traduttori (fallback su EN
// finché non presenti) — stesso pattern delle altre guide.
const T: Partial<Record<Locale, BetaCopy>> = {
  en: {
    title: "Becoming a beta tester",
    tagline: "Run the team on your real job hunt — and tell us what breaks",
    intro:
      "Job Hunter Team is in active beta. We're looking for a small group of real job-seekers willing to run the team against their actual search and tell us what works and what doesn't.",
    whyH: "Why your test matters",
    whyP: "Most of what we can say about Job Hunter Team today comes from a handful of profiles. The question everyone asks is “does it work for my role, on my provider, at my budget?” — and you running it on your real job hunt is how we find out.",
    whoH: "Who we're looking for",
    whoLead: "You're a good fit if:",
    who1: "You're actively looking for a job (or about to start) — the team needs a real pipeline to work on.",
    who2: "You can afford at least one supported subscription. Kimi (~€40/mo) is the easiest entry point.",
    who3: "You're willing to report back honestly — what worked, what didn't, what was confusing.",
    whoNoTech:
      "No technical background required. Job Hunter Team runs from a desktop app: installation is one click, and the team's Assistant walks you through anything you don't understand. If you can install a normal app and follow on-screen steps, you can run it.",
    getH: "What you get",
    get1: "Direct support from the maintainer.",
    get2: "Early access to features before they ship.",
    get3: "Your results published as a case study on the site — anonymized if you prefer.",
    get4: "A real say in what gets built next.",
    askH: "What we ask in return",
    ask1: "Use it for your real job search for at least two weeks.",
    ask2: "Share your numbers at the end: offers analyzed, CVs sent, interviews.",
    ask3: "Report everything that confused, broke or surprised you.",
    ask4: "Be available for a 30-minute call at the end of the test.",
    ask5: "No cherry-picking — tell us about the failures too. They matter as much as the wins.",
    applyH: "How to apply",
    applyLead:
      "Open an issue on GitHub titled “Beta tester application — [your handle]” and answer:",
    aq1: "What role or industry are you searching in?",
    aq2: "Where are you based (country / remote)?",
    aq3: "Which subscription do you have or plan to get?",
    aq4: "How much time per week can you commit?",
    aq5: "Anything specific about your profile we should know? (feedback from outside tech is especially welcome)",
    aq6: "Anything else we should know?",
    applyCta: "Apply on GitHub",
    applyNote: "We reply within a few days.",
    expectH: "What to expect today",
    expectLead: "Before you sign up, set your expectations honestly:",
    exp1: "The team runs end to end — pipeline, dashboard, CLI, Telegram and the desktop app all work.",
    exp2: "The onboarding wizard still has rough edges — expect to ask for help once or twice.",
    exp3: "At first launch your operating system may warn about an “unverified app”. Job Hunter Team is open source — you can right-click → Open (macOS) or Run anyway (Windows), or build it from source.",
    expectClose:
      "If “rough edges” doesn't scare you, you're exactly the kind of beta tester we need.",
    githubMore: "the docs on GitHub",
  },
  it: {
    title: "Diventare beta tester",
    tagline:
      "Fai girare il team sulla tua ricerca di lavoro vera — e dicci cosa si rompe",
    intro:
      "Job Hunter Team è in beta attiva. Cerchiamo un piccolo gruppo di persone che stanno davvero cercando lavoro e sono disposte a far girare il team sulla loro ricerca reale e raccontarci cosa funziona e cosa no.",
    whyH: "Perché il tuo test conta",
    whyP: "Quasi tutto ciò che oggi possiamo dire su Job Hunter Team viene da una manciata di profili. La domanda che si fanno tutti è «funziona per il mio ruolo, sul mio provider, col mio budget?» — e sei tu, facendolo girare sulla tua ricerca vera, a darci la risposta.",
    whoH: "Chi cerchiamo",
    whoLead: "Fai al caso nostro se:",
    who1: "Stai cercando lavoro attivamente (o stai per iniziare) — al team serve una pipeline reale su cui lavorare.",
    who2: "Puoi permetterti almeno un abbonamento supportato. Kimi (~€40/mese) è il punto d'ingresso più semplice.",
    who3: "Sei disposto a darci un riscontro onesto — cosa ha funzionato, cosa no, cosa era poco chiaro.",
    whoNoTech:
      "Non serve alcuna competenza tecnica. Job Hunter Team gira da un'app desktop: l'installazione è un clic, e l'Assistente del team ti guida in tutto ciò che non capisci. Se sai installare una normale app e seguire i passaggi a schermo, sai usarlo.",
    getH: "Cosa ottieni",
    get1: "Supporto diretto dal maintainer.",
    get2: "Accesso in anteprima alle nuove funzioni.",
    get3: "I tuoi risultati pubblicati come case study sul sito — anonimizzati se preferisci.",
    get4: "Voce in capitolo su cosa costruiamo dopo.",
    askH: "Cosa chiediamo in cambio",
    ask1: "Usalo per la tua ricerca di lavoro vera per almeno due settimane.",
    ask2: "Condividi i tuoi numeri alla fine: offerte analizzate, CV inviati, colloqui.",
    ask3: "Segnala tutto ciò che ti ha confuso, si è rotto o ti ha sorpreso.",
    ask4: "Sii disponibile per una chiamata di 30 minuti a fine test.",
    ask5: "Niente cherry-picking — raccontaci anche i fallimenti. Contano quanto i successi.",
    applyH: "Come candidarti",
    applyLead:
      "Apri una issue su GitHub con titolo «Beta tester application — [il tuo handle]» e rispondi a:",
    aq1: "In quale ruolo o settore stai cercando?",
    aq2: "Dove sei (Paese / remoto)?",
    aq3: "Quale abbonamento hai o pensi di prendere?",
    aq4: "Quanto tempo a settimana puoi dedicarci?",
    aq5: "Qualcosa di specifico sul tuo profilo che dovremmo sapere? (i riscontri da fuori dal mondo tech sono particolarmente graditi)",
    aq6: "Altro che dovremmo sapere?",
    applyCta: "Candidati su GitHub",
    applyNote: "Rispondiamo entro qualche giorno.",
    expectH: "Cosa aspettarti oggi",
    expectLead: "Prima di iscriverti, mettiamo le aspettative in chiaro:",
    exp1: "Il team funziona dall'inizio alla fine — pipeline, dashboard, CLI, Telegram e app desktop funzionano tutti.",
    exp2: "Il wizard di onboarding ha ancora qualche spigolo — mettiti in conto di chiedere aiuto una o due volte.",
    exp3: "Al primo avvio il tuo sistema operativo potrebbe avvisarti di un'«app non verificata». Job Hunter Team è open source — puoi fare clic destro → Apri (macOS) o Esegui comunque (Windows), oppure compilarlo dai sorgenti.",
    expectClose:
      "Se «qualche spigolo» non ti spaventa, sei esattamente il beta tester che ci serve.",
    githubMore: "i docs su GitHub",
  },
};

export default async function BetaPage() {
  const locale = await getRequestLocale();
  const t = (T[locale] ?? T.en) as BetaCopy;

  return (
    <div>
      <DocHeader emoji="🧪" title={t.title} tagline={t.tagline}>
        {t.intro}
      </DocHeader>

      <H2>{t.whyH}</H2>
      <P>{t.whyP}</P>

      <H2>{t.whoH}</H2>
      <P>{t.whoLead}</P>
      <UL>
        <LI>{t.who1}</LI>
        <LI>{t.who2}</LI>
        <LI>{t.who3}</LI>
      </UL>
      <P>{t.whoNoTech}</P>

      <H2>{t.getH}</H2>
      <UL>
        <LI>{t.get1}</LI>
        <LI>{t.get2}</LI>
        <LI>{t.get3}</LI>
        <LI>{t.get4}</LI>
      </UL>

      <H2>{t.askH}</H2>
      <UL>
        <LI>{t.ask1}</LI>
        <LI>{t.ask2}</LI>
        <LI>{t.ask3}</LI>
        <LI>{t.ask4}</LI>
        <LI>{t.ask5}</LI>
      </UL>

      <H2>{t.applyH}</H2>
      <P>{t.applyLead}</P>
      <UL>
        <LI>{t.aq1}</LI>
        <LI>{t.aq2}</LI>
        <LI>{t.aq3}</LI>
        <LI>{t.aq4}</LI>
        <LI>{t.aq5}</LI>
        <LI>{t.aq6}</LI>
      </UL>
      <Callout>
        🧪{" "}
        <a
          href={ISSUES}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLS}
        >
          {t.applyCta}
        </a>{" "}
        — {t.applyNote}
      </Callout>

      <H2>{t.expectH}</H2>
      <P>{t.expectLead}</P>
      <UL>
        <LI>{t.exp1}</LI>
        <LI>{t.exp2}</LI>
        <LI>{t.exp3}</LI>
      </UL>
      <P>{t.expectClose}</P>

      <GitHubMore href={repoTree("docs")}>{t.githubMore}</GitHubMore>
    </div>
  );
}
