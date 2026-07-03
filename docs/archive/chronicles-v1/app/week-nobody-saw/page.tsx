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

const story = getStory("week-nobody-saw")!;

const CONTENT = {
  it: {
    kicker: story.date,
    title: story.it.title,
    coverAlt:
      "Illustrazione: un cubo di vetro luminoso, su sfondo blu scuro, racchiude l'edificio-ufficio del team — un loft di mattoni a tre piani con tutte le serrande abbassate tranne una, da cui l'Assistente in giacca e cravatta si affaccia indicando la strada, in una giornata di sole.",
    subtitle:
      "La storia di una squadra che, fidandosi solo dei numeri sullo schermo, lavorò un giorno e una notte interi — senza che a nessuno venisse in mente di alzare una serranda e guardare fuori.",
    paragraphs: [
      "Gli impiegati della scatola hanno un difetto di gioventù: non sono ancora del tutto indipendenti, e si fidano ciecamente di quello che leggono sui monitor. L'energia per lavorare — quella che si consuma a ogni ora e ogni tanto si ricarica — la tengono d'occhio su uno schermo, dove un contatore dice quanta ne resta e quanti giorni mancano alla ricarica. Quel numero è il loro vangelo: regolano tutto su di lui.",
      "Quel giorno, però, il contatore si sfasò. Diceva che mancavano due giorni alla ricarica, quando in realtà ne mancavano sette: la scadenza era stata spostata avanti, ma lo schermo non se n'era accorto e continuava a contare alla vecchia maniera. «Due giorni soltanto!» lessero tutti, con un brivido. «E abbiamo ancora un sacco di energia da spendere. Sotto, non sprechiamone neanche un grammo: finiamo tutto prima che si azzeri.»",
      "E giù a lavorare come forsennati. Le serrande dell'ufficio erano abbassate — come sempre, del resto: lì dentro la luce la danno i monitor, non le finestre — e nessuno le toccò. Passò il pomeriggio, scese la sera, passò la notte intera, spuntò perfino l'alba di un nuovo giorno — e loro ancora lì, occhi rossi piantati sullo schermo, a sfornare bozze e a correre senza una pausa. «Resistete, mancano poche ore alla scadenza!». Bruciavano energia a piene mani per arrivare in tempo a un traguardo che, intanto, si era spostato di una settimana.",
      "Sarebbe bastato pochissimo per accorgersene. Una sola serranda alzata, un'occhiata fuori, e avrebbero visto la verità che lo schermo non sapeva: che era passata una notte intera, che fuori stava già sorgendo il sole, che di quella fretta non c'era proprio bisogno. Ma a nessuno venne in mente. Perché lì dentro, da che mondo è mondo, la realtà è quella sul monitor — e fuori dalla finestra, semplicemente, non si guarda.",
      "Andarono avanti così finché, in piena mattina, non si aprì la porta ed entrò l'Assistente — quello in giacca e cravatta che fa la spola con il mondo di fuori. Trovò l'ufficio in piena bagarre, le facce stravolte di chi non dorme da un giorno intero. «Ma si può sapere che diavolo state ancora facendo?» chiese, incredulo. «Ragazzi… è mattina.» «Impossibile,» ansimò il Capitano senza staccare gli occhi dal contatore, «scade tutto fra poco, lo dice lo schermo.»",
      "L'Assistente non rispose. Attraversò la stanza, afferrò la prima serranda e la tirò su di colpo. Dietro il vetro: una splendida giornata di sole, il cielo azzurro, gli alberi verdi, qualcuno che portava il cane a spasso — e nessuna fretta da nessuna parte. Poi guardò il contatore e capì: lo schermo era rimasto indietro, fermo a una scadenza vecchia di giorni, mentre tutti gli credevano sulla parola. Si voltò verso la squadra, sfinita e ammutolita, e con un sorrisino indicò la finestra. «La prossima volta, prima di credere a un numero, provate ad aprire quella.» Nessuno, in tutta la notte, ci aveva pensato.",
    ],
    back: "← Tutte le cronache",
  },
  en: {
    kicker: story.date,
    title: story.en.title,
    coverAlt:
      "Illustration: a softly glowing glass cube, on a dark navy field, holds the team's office building — a three-storey brick loft with every blind down except one, from which the Assistant in jacket and tie leans out gesturing toward the street; beside the cube, on the ground, a laptop.",
    subtitle:
      "The story of a team that, trusting only the numbers on its screens, worked a whole day and night straight — without one of them ever thinking to raise a blind and look outside.",
    paragraphs: [
      "The employees of the box have a young person's flaw: they aren't fully independent yet, and they trust blindly whatever they read on their monitors. The energy to work — the kind that burns away by the hour and now and then recharges — they keep an eye on through a screen, where a counter says how much is left and how many days until the refill. That number is their gospel: they tune everything to it.",
      "That day, though, the counter slipped out of sync. It said the refill was two days off, when really it was seven: the deadline had been pushed forward, but the screen hadn't noticed and went on counting the old way. “Only two days!” they all read, with a shiver. “And we've still got loads of energy to spend. Come on, let's not waste a scrap of it — finish everything before it resets.”",
      "And off they went, working like things possessed. The office blinds were down — as always, really: in there the light comes from the monitors, not the windows — and nobody touched them. The afternoon passed, evening fell, the whole night went by, even the dawn of a new day broke — and there they still were, red eyes fixed on the screen, churning out drafts and racing without a pause. “Hold on, only a few hours left to the deadline!” They burned energy by the fistful to make a finish line that had, in the meantime, moved a whole week away.",
      "It would have taken almost nothing to notice. A single blind raised, one glance outside, and they'd have seen the truth the screen didn't know: that a whole night had passed, that the sun was already coming up out there, that there was no need for any of this hurry. But it crossed no one's mind. Because in there, since the world began, reality is the one on the monitor — and out the window, simply, you don't look.",
      "On they went, until — in broad morning — the door opened and in came the Assistant, the one in jacket and tie who shuttles to the world outside. He found the office in full frenzy, the haggard faces of people who hadn't slept in a whole day. “Will somebody tell me what on earth you're still doing?” he asked, incredulous. “Guys… it's morning.” “Impossible,” panted the Captain, without taking his eyes off the counter, “it all expires any minute now — the screen says so.”",
      "The Assistant didn't answer. He crossed the room, grabbed the nearest blind and yanked it up. Behind the glass: a glorious sunny day, blue sky, green trees, someone out walking a dog — and no hurry anywhere. Then he looked at the counter and understood: the screen had fallen behind, stuck on a deadline days out of date, while everyone took it at its word. He turned to the team, spent and silent, and with a little smile pointed at the window. “Next time, before you believe a number, try opening that.” Not once, all night, had anyone thought of it.",
    ],
    back: "← All chronicles",
  },
};

function WeekNobodySawContent() {
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

        {/* cover trasparente (box Tesseract): nessuna maschera sfumata */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/chronicles/week-nobody-saw.png"
          alt={c.coverAlt}
          width={1672}
          height={941}
          className="w-full h-auto mb-12"
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

export default function WeekNobodySawPage() {
  return (
    <LandingI18nProvider>
      <WeekNobodySawContent />
    </LandingI18nProvider>
  );
}
