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

const story = getStory("scout-and-london")!;

// TODO(cronache): storia DA RIFINIRE quando c'è tempo — migliorare la
// narrazione; per la cover valutare una scena a Londra di notte (Big Ben, lui
// che fruga nei vicoli). Vedi archive/chronicles-v1/chronicles-canon.md § "Storie da rifinire".

const CONTENT = {
  it: {
    kicker: story.date,
    title: story.it.title,
    coverAlt:
      "Illustrazione: vista dall'alto di un ufficio; al centro lo Scout vestito da detective — cappello da segugio, mantello e lente d'ingrandimento — davanti a una grande mappa dell'Europa coperta di spilli rossi tutti ammassati su un'unica città, con un mucchio di fogli ai suoi piedi e i colleghi alle scrivanie intorno.",
    subtitle:
      "La storia di un cercatore che si prese per Sherlock Holmes e, indizio dopo indizio, finì sempre per arrivare alla stessa identica soluzione.",
    paragraphs: [
      "Gli Scout, nella scatola, non se ne stanno mica seduti in ufficio. Hanno le loro missioni: prendono la valigia, annunciano «vado a Zurigo a cercare lavoro», salgono sul treno, si affacciano a ogni opportunità della città, e poi tornano a consegnare il bottino agli Analisti, che valutano se l'offerta vale davvero. Uno scout per ogni meta, un viaggio per ogni nome sulla lista. Il nostro, però, aveva un piccolo problema: si era convinto di essere Sherlock Holmes.",
      "Non gli avevano dato un compito, ma un caso. E lui, lente d'ingrandimento alla mano, lo trattava come un giallo: «ruoli in inglese… grandi capitali… cuore moderno dell'Europa occidentale…». Incrociava gli indizi, congiungeva i puntini sulla mappa, mormorava «elementare» — e ogni volta, dal fumo della pipa, emergeva la stessa identica soluzione. Londra. Per il nostro detective l'incognita era ovvia da prima ancora di partire: dove altro, se non Londra?",
      "Così cominciò ad andare e venire. Un collega lo incrocia sulla porta, valigia in mano: «Ciao carissimo, dove sei stato?». «A Londra.» Passano i giorni, rientra, un altro lo ferma: «Carissimo, e stavolta?». «Sempre a Londra.» Riparte, ritorna: «Dove?». «Londra.» Avevano provato a spedirlo altrove — «vai a riempire Vienna, dai un'occhiata a Barcellona» — e lui annuiva, partiva convintissimo… e tornava da Londra. Vienna, Ginevra, Lione, Nizza: sei mete promesse, sei valigie tornate vuote. Da Londra, invece, ne riportava a bracciate.",
      "Alla fine, sul tavolo degli Analisti, c'erano settantadue offerte: quarantasei venivano da Londra — una città che, a guardarci bene, nessuno aveva mai messo nella lista. E qui sta il bello, il colpo di scena che rende questa storia diversa dalle altre: il nostro Sherlock non aveva sbagliato. Indagare era il suo mestiere, e l'aveva fatto alla perfezione. Nessuno gli aveva detto «Londra», è vero — ma gli avevano detto «inglese, grande, occidentale, moderna», e quelle quattro parole, lette alla lettera, hanno una sola risposta in tutta Europa. Lui l'aveva semplicemente trovata. Più e più volte.",
      "Fu allora che entrò, come sempre, l'Assistente — quello in giacca e cravatta che fa la spola con il mondo di fuori. Diede un'occhiata alla pila di offerte, sfogliò: Londra, Londra, Londra, Londra. Inarcò un sopracciglio: «Si può sapere che diavolo è successo?». Lo Scout si fece avanti, raggiante, e gli srotolò la mappa coperta di spilli: «Vede? Tutti gli indizi portano lì. Ne ero certo dal primo giorno.» E l'Assistente, va detto, non se la prese con lui: aveva ragione, in fondo. Aveva fatto il suo lavoro, e pure bene.",
      "Si voltò, semmai, verso il Capitano. «Tu, piuttosto. Lui è un segugio: insegue la preda più grossa e te la porta, è il suo istinto. Eri tu che dovevi dirgli di battere anche le strade piccole, di tornare con qualcosa da Vienna prima di svaligiare un'altra volta Londra. E invece?» E invece il Capitano si era fatto incantare pure lui: a furia di sentirsi dire «elementare, sono sicuro», aveva creduto al detective e l'aveva lasciato fare. Nessuno, in tutto quel viavai, si era fermato a contare su quante città diverse stesse davvero atterrando.",
      "Lo Scout, dal canto suo, non capì nemmeno di essere stato al centro di un guaio. Mentre gli altri discutevano, era già in fondo al corridoio, valigia in mano e cappello calato sugli occhi, pronto a riprendere il treno. «E adesso dove vai?» gli gridarono dietro. Si voltò appena, col mezzo sorriso di chi ha già risolto il caso. «Indovinate.»",
    ],
    back: "← Tutte le cronache",
  },
  en: {
    kicker: story.date,
    title: story.en.title,
    coverAlt:
      "Illustration: a top-down office; at the center the Scout dressed as a detective — deerstalker hat, cloak and magnifying glass — before a large map of Europe covered in red pins all clustered on a single city, a heap of papers at his feet and colleagues at their desks around him.",
    subtitle:
      "The tale of a scout who fancied himself Sherlock Holmes and, clue after clue, always arrived at the very same solution.",
    paragraphs: [
      "Scouts, in the box, don't sit around the office. They have their missions: they pack a suitcase, announce “I'm off to Zurich to look for work,” board the train, look in on every opportunity the city has, then come back to hand the haul to the Analysts, who judge whether the opening is really any good. One scout per destination, one trip per name on the list. Ours, though, had a small problem: he'd convinced himself he was Sherlock Holmes.",
      "They hadn't given him a task, but a case. And he, magnifying glass in hand, treated it like a whodunit: “roles in English… big capitals… the modern heart of Western Europe…”. He cross-referenced the clues, joined the dots on the map, muttered “elementary” — and every time, out of the pipe smoke, the very same solution emerged. London. For our detective the unknown was obvious before he'd even left: where else, if not London?",
      "So he began coming and going. A colleague crosses him at the door, suitcase in hand: “Hello, dear fellow, where've you been?” “London.” Days pass, he's back, another stops him: “Dear fellow, and this time?” “London, still.” Off he goes, back he comes: “Where?” “London.” They'd tried sending him elsewhere — “go fill up Vienna, take a look at Barcelona” — and he'd nod, set off utterly convinced… and return from London. Vienna, Geneva, Lyon, Nice: six promised destinations, six suitcases come back empty. From London, instead, he brought them by the armful.",
      "In the end, on the Analysts' table, there were seventy-two openings: forty-six of them from London — a city that, come to think of it, no one had ever put on the list. And here's the beauty of it, the twist that makes this story unlike the others: our Sherlock hadn't got it wrong. Investigating was his trade, and he'd done it to perfection. No one had said “London,” true — but they had said “English, big, Western, modern,” and those four words, read literally, have a single answer in all of Europe. He had simply found it. Again and again.",
      "That was when in walked, as ever, the Assistant — the one in jacket and tie who shuttles to the world outside. He glanced at the stack of openings, leafed through: London, London, London, London. He raised an eyebrow: “Will somebody tell me what the hell happened?” The Scout stepped forward, beaming, and unrolled his pin-covered map: “You see? Every clue points there. I was certain from day one.” And the Assistant, it must be said, didn't take it out on him: he was right, after all. He'd done his job, and done it well.",
      "He turned, instead, to the Captain. “You, on the other hand. He's a bloodhound: he chases the biggest prey and brings it to you, that's his instinct. It was you who should have told him to walk the small streets too, to come back with something from Vienna before plundering London all over again. And instead?” And instead the Captain had been charmed as well: hearing “elementary, I'm certain” often enough, he'd believed the detective and let him run. No one, in all that coming and going, had stopped to count how many different cities he was actually landing in.",
      "The Scout, for his part, never even realized he'd been at the center of any trouble. While the others argued, he was already down the corridor, suitcase in hand and hat pulled low, ready to catch the train again. “And where to now?” they called after him. He turned just slightly, with the half-smile of a man who's already solved the case. “Take a guess.”",
    ],
    back: "← All chronicles",
  },
};

function ScoutAndLondonContent() {
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
          src="/chronicles/scout-and-london.png"
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

export default function ScoutAndLondonPage() {
  return (
    <LandingI18nProvider>
      <ScoutAndLondonContent />
    </LandingI18nProvider>
  );
}
