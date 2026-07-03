"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../../components/landing/LandingI18n";
import LandingNav from "../../components/landing/LandingNav";
import { LandingFooter } from "../../components/landing/LandingCTA";
import ScrollToTop from "../../components/landing/ScrollToTop";
import { getStory } from "../stories";

const story = getStory("zombie-night")!;

// TODO(cronache): storia DA RIFINIRE quando c'è tempo — riallineare il registro
// narrativo a quello delle storie nuove (mostrare non spiegare, dialoghi).
// Vedi archive/chronicles-v1/chronicles-canon.md § "Storie da rifinire".

const CONTENT = {
  it: {
    kicker: story.date,
    title: story.it.title,
    subtitle:
      "La notte in cui il Capitano è diventato uno zombie, e per otto ore l'intero ufficio ha fatto finta di niente.",
    coverAlt:
      "Illustrazione: il Capitano zombie, in divisa da pilota, cammina di notte tra le scrivanie dell'ufficio mentre un paio di colleghi lo guardano.",
    paragraphs: [
      "Quella notte, dentro la scatola, il team si preparava a lavorare fino all'alba: gli scout pronti a battere il mondo in cerca di offerte, gli analisti con le maniche rimboccate, tutti al loro posto. Poi, allo scoccare della mezzanotte, succede una cosa che nessuno aveva messo in conto.",
      "Il Capitano — quello che dirige l'ufficio, convoca gli agenti e smista gli ordini — di colpo smette di essere se stesso. Niente schianto, niente urla: dietro i suoi occhi, qualcosa semplicemente si spegne. Resta in piedi, continua perfino a camminare. Ma non è più lui: è diventato uno zombie.",
      "Lo si vede trascinarsi per i corridoi, lento, lo sguardo vuoto. «Capo, questa offerta la mando o no?», chiede un agente alzando la testa. Niente. «Capo, c'è un candidato che aspetta una risposta…». Niente. Il Capitano biascica qualcosa di incomprensibile, urta una sedia e prosegue. Intanto, nella sala di controllo, il pannello dei battiti racconta tutto: una sola linea è piatta, la sua. Battito: zero. Eppure cammina ancora, mentre i messaggi gli si ammucchiano sulla scrivania e nessuno ne apre uno.",
      "Per fortuna, in quell'ufficio, gira un medico — uno di quelli che ogni tanto si affaccia, ti dà una pacca e chiede «Tutto bene?». Quella notte ne passano a decine. Il primo si pianta davanti al Capitano-zombie: «Come stai, capo?». Silenzio. Il medico annuisce soddisfatto — «nessuna lamentela, che meraviglia» — scrive «tutto regolare» e se ne va. Mezz'ora dopo, un altro: «Come ci sentiamo oggi?». Silenzio. «Che paziente tranquillo», e via pure lui. E così per tutta la notte: una processione di camici bianchi che chiede a un morto come va, scambia il suo silenzio per un sì, e tira dritto. Chi tace acconsente, no?",
      "È mattina quando l'utente si affaccia di nuovo dentro la scatola. E trova un disastro: una notte intera, e niente di fatto. Zero offerte, zero candidature, zero lavoro. Chiama l'Assistente — l'unico là dentro che parla con il mondo di fuori: «Si può sapere che diavolo è successo stanotte?». L'Assistente fa un giro, torna con la faccia di chi le ha viste tutte: «Il Capitano è diventato uno zombie». «E allora curalo». Così gli versa in gola una pozione e aspetta. Per un istante, niente. Poi lo sguardo del Capitano si rimette a fuoco, le spalle si raddrizzano. «Da quanto sono qui?». Otto ore. Aveva vagato tra le scrivanie, da morto, per otto ore intere.",
      "Da quella notte, accanto al pannello dei battiti, c'è sempre qualcuno che non si fida più di vedere uno in piedi: gli si avvicina e controlla che dentro ci sia ancora qualcuno. Perché stare in piedi, si è capito, non vuol dire essere vivi.",
    ],
    back: "← Tutte le cronache",
  },
  en: {
    kicker: story.date,
    title: story.en.title,
    subtitle:
      "The night the Captain turned into a zombie, and for eight hours the whole office pretended nothing was wrong.",
    coverAlt:
      "Illustration: the zombie Captain in a pilot's uniform shuffles through the night office between the desks while a couple of colleagues stare at him.",
    paragraphs: [
      "That night, inside the box, the team was gearing up to work until dawn: the scouts ready to comb the world for openings, the analysts with their sleeves already rolled up, everyone at their post. Then, on the stroke of midnight, something happened that nobody had planned for.",
      "The Captain — the one who runs the office, summons the agents and hands out the orders — suddenly stops being himself. No crash, no scream: behind his eyes, something simply switches off. He stays on his feet. He even keeps walking. But it isn't him anymore: he has turned into a zombie.",
      "You can see him dragging himself down the corridors, slow, his stare empty. “Boss, do I send this opening or not?” an agent asks, looking up. Nothing. “Boss, there's a candidate waiting for an answer…” Nothing. The Captain mumbles something unintelligible, bumps into a chair and shuffles on. Meanwhile, in the control room, the panel of heartbeats tells the whole story: one line is flat — his. Heartbeat: zero. And yet he keeps walking, while the messages pile up on his desk and no one opens a single one.",
      "Luckily, in that office, a doctor does the rounds — one of those who drops by now and then, gives you a pat and asks “All good?” That night, dozens of them come through. The first plants himself in front of the zombie Captain: “How are you, boss?” Silence. The doctor nods, pleased — “no complaints, wonderful” — writes “all in order” and leaves. Half an hour later, another: “How are we feeling today?” Silence. “What a calm patient,” and off he goes too. And so all night long: a procession of white coats asking a dead man how he's doing, mistaking his silence for a yes, and moving right along. Silence means consent, right?",
      "It's morning when the user looks back into the box. And finds a disaster: a whole night, and nothing done. Zero openings, zero applications, zero work. He calls the Assistant — the only one in there who talks to the outside world: “Will someone tell me what the hell happened last night?” The Assistant takes a walk, comes back with the face of someone who's seen it all: “The Captain has turned into a zombie.” “Then cure him.” So he pours a potion down his throat and waits. For a moment, nothing. Then the Captain's eyes refocus, his shoulders straighten. “How long have I been here?” Eight hours. He had wandered among the desks, dead, for eight whole hours.",
      "Since that night, next to the panel of heartbeats, there's always someone who no longer trusts seeing a person on their feet: they walk up and check that someone is still in there. Because standing up, as it turns out, doesn't mean being alive.",
    ],
    back: "← All chronicles",
  },
};

function ZombieNightContent() {
  const { lang } = useLandingI18n();
  const c = CONTENT[lang === "it" ? "it" : "en"];

  return (
    <>
      <LandingNav />
      <main
        className="px-5 sm:px-6 pt-28 pb-16 max-w-4xl mx-auto"
        style={{ animation: "fade-in 0.4s ease both" }}
      >
        <header className="mb-8 text-center">
          <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-muted)] mb-3">
            {c.kicker}
          </p>
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-4">
            {c.title}
          </h1>
          <p className="text-[13px] md:text-[14px] text-[var(--color-muted)] italic max-w-xl mx-auto leading-relaxed">
            {c.subtitle}
          </p>
        </header>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/chronicles/zombie-night.png"
          alt={c.coverAlt}
          width={1672}
          height={941}
          className="w-full h-auto mb-12"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%)",
            WebkitMaskComposite: "source-in",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%)",
            maskComposite: "intersect",
          }}
        />

        <div>
          <article lang={lang} className="flex flex-col gap-5 hyphens-auto">
            {c.paragraphs.map((p, i) => (
              <p
                key={i}
                className="text-[14px] md:text-[16px] text-[var(--color-bright)] leading-[1.8] text-justify"
              >
                {p}
              </p>
            ))}
          </article>

          <div className="mt-12 flex justify-center">
            <Link
              href="/chronicles"
              className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
            >
              {c.back}
            </Link>
          </div>
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

export default function ZombieNightPage() {
  return (
    <LandingI18nProvider>
      <ZombieNightContent />
    </LandingI18nProvider>
  );
}
