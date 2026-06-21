"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";
import ImagePlaceholder from "../components/landing/ImagePlaceholder";

type RoleCopy = { title: string; p1: string; p2: string };
type Role = {
  slug: string;
  promptId: string;
  img?: string;
  it: RoleCopy;
  en: RoleCopy;
};

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
  },
  {
    slug: "scout",
    promptId: "team.scout",
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
  },
];

const PAGE = {
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
};

function TeamContent() {
  const { lang } = useLandingI18n();
  const L = lang === "it" ? "it" : "en";
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
                  ) : (
                    <ImagePlaceholder
                      label={c.title}
                      promptId={role.promptId}
                      aspect="4 / 3"
                    />
                  )}
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
