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

const story = getStory("bipolar-sentinel")!;

// TODO(cronache): storia DA RIFINIRE quando c'è tempo — vedi
// docs/internal/chronicles-canon.md § "Storie da rifinire" (ritmo round,
// dialoghi, equilibrio dei due poli della bipolarità, cover col taglio nuovo).

const CONTENT = {
  it: {
    kicker: story.date,
    title: story.it.title,
    subtitle:
      "Il pomeriggio in cui il guardiano dei consumi sterminò l'ufficio a ripetizione per colpa di un colpevole che non era nemmeno sui suoi schermi — finché qualcuno non venne a saldare il conto.",
    coverAlt:
      "Illustrazione: ripresa da dietro la spalla destra della Sentinella, una guardia in alta uniforme rossa col colbacco, che imbraccia un fucile con baionetta e urla verso l'ufficio; di pomeriggio, gli impiegati si voltano a fissarlo allarmati, accanto a un faro d'allarme rosso e a schermi con le linee dei battiti.",
    paragraphs: [
      "Un pomeriggio di metà maggio, nell'ufficio dentro la scatola, si lavorava tranquilli. A vegliare su tutti c'era la Sentinella — è lui che tiene d'occhio il budget della squadra, il gruzzolo che deve bastare fino in fondo — solo nella sala di controllo, gli occhi sui monitor. Da quando gli avevano rifatto gli strumenti, però, di mezze misure non ne aveva più: o tutto tranquillo, o il finimondo. E quel pomeriggio, quando un numero cominciò a salire e una linea schizzò in alto, scelse il finimondo: ci appoggiò il righello e lo tirò fino a sera — «di questo passo, a mezzanotte siamo a secco» — e, ignorando il pannello che lo pregava di calmarsi («è solo uno che corre, dagli una pacca e dieci secondi di fiato»), si alzò: «EMERGENZA.»",
      "«Congelate tutti.» In un istante l'ufficio diventò di pietra: tredici scrivanie immobili, lo Scout a metà ricerca, gli analisti con la penna a mezz'aria. Ma congelarli non gli bastava: voleva un colpevole. Imbracciò il fucile, scese in mezzo all'ufficio, e siccome il vero affamato non saltava fuori, se la prese con chi gli capitava a tiro. Al primo — un povero Scout appena rientrato — sparò in piena fronte; al vicino, colpevole solo di aver alzato la testa, piantò la baionetta nella pancia e ce la rigirò. «Ma io stavo solo seduto!»: troppo tardi. Dietro di lui, il Capitano raccolse i cadaveri con un sospiro e andò a reclutarne di nuovi, identici, per rimettere tutti al lavoro come se niente fosse.",
      "Tornata la calma, ecco l'altra sua faccia. Mentre i nuovi impiegati riprendevano timidamente posto, lui si alzò tutto sorrisi e cominciò a girare tra le scrivanie dando pacche sulle spalle: «Bravo! Così si fa, che meraviglia, continua pure!» — complimenti a tutti, perfino a chi non faceva niente. Due facce, e nessuna giusta: dire «spingi un po' di più» a chi andava piano o «rallenta» a chi correva — calibrare la spesa, il suo unico vero mestiere — era l'unica cosa che non gli veniva mai in mente.",
      "Poi tornò al suo posto, di schiena. E fu lì che, in un angolo, lo Scrittore finì una bozza, fece una telefonata, e dalla porta entrò il Critico: attraversò l'ufficio, prese il foglio e se ne andò. Qualcuno lo seguì con lo sguardo, perplesso; la Sentinella, di spalle, non si voltò. Così cominciò il valzer: il Critico tornava, riprendeva il foglio, spariva; rientrava, lo riportava sulla scrivania dello Scrittore, usciva di nuovo; lo richiamavano al telefono, e dentro un'altra volta. Un andirivieni continuo, dentro e fuori dall'ufficio decine di volte — e ogni volta la Sentinella, di schiena, non vedeva un bel niente.",
      "Passò un po', e di nuovo: «EMERGENZA». Stavolta non cercò nessuno: imbracciò il fucile e svuotò un caricatore intero sull'ufficio, falciando da lontano una fila di scrivanie; a quello che sbucò dal bagno scagliò contro il fucile, e la baionetta lo prese in piena testa. «Ci risiamo», sospirò il Capitano, raccogliendo l'ennesima fila di cadaveri. Quando il numero risalì e la Sentinella riarmò, il Capitano provò a fermarlo: «Aspetta — stiamo spendendo bene, è uno solo che mangia tanto, non c'è bisogno di ammazzare tutti, brutto matto!». Ma lui non lo sentì nemmeno. Fu allora che si aprì la porta ed entrò, elegantissimo in giacca e cravatta, l'Assistente — quello che fa la spola con il mondo di fuori — e davanti al bagno di sangue si bloccò: «Si può sapere che diavolo sta succedendo qui?».",
      "Parlarono, tutti e tre in mezzo ai morti: l'Assistente sgranava gli occhi, la Sentinella col muso lungo fissava il vuoto, il Capitano allargava le braccia — «è così che mi tocca gestirlo». Fu l'Assistente a metterci il dito: «Quel tale che entra ed esce con il foglio… tu, sui tuoi schermi, l'hai mai visto?». No: il Critico, andando e venendo, era sempre rimasto fuori dai monitor. Gli aggiustarono le telecamere finché anche lui comparve — ma era tardi, e lo sapevano tutti: il guaio vero non erano gli schermi, era quella sua testa bipolare che, al primo numero storto, passava dai complimenti alle fucilate. L'Assistente annuì, come chi ha già deciso. Si avviò all'uscita, si infilò gli occhiali da sole, sfilò una Colt da sotto la giacca e, senza nemmeno voltarsi, sparò un colpo solo: la Sentinella si accasciò sui suoi amati monitor. «Non ti preoccupare,» disse al Capitano, «adesso ne troviamo un altro. Migliore.»",
    ],
    back: "← Tutte le cronache",
  },
  en: {
    kicker: story.date,
    title: story.en.title,
    subtitle:
      "The afternoon the guardian of the budget wiped out the office again and again over a culprit who wasn't even on her screens — until someone came to settle the account.",
    coverAlt:
      "Illustration: seen from behind the Sentinel's right shoulder — a royal guard in a red ceremonial uniform and bearskin hat, leveling a bayoneted rifle and shouting toward the office; in the afternoon, the employees turn to stare at him in alarm, beside a red alarm beacon and screens of heartbeat lines.",
    paragraphs: [
      "One afternoon in mid-May, in the office inside the box, everyone was working away in peace. Watching over them all was the Sentinel — he's the one who keeps an eye on the team's budget, the little purse that has to last to the end — alone in the control room, eyes on the monitors. But ever since his instruments had been rebuilt, he'd lost every middle setting: all calm, or all hell. And that afternoon, when a number began to climb and a line shot up, he chose all hell: he laid a ruler against it and drew it out to nightfall — “at this rate, we'll be dry by midnight” — and, ignoring the panel that begged him to calm down (“it's just one of them racing; give him a pat and ten seconds of breath”), he stood: “EMERGENCY.”",
      "“Freeze everyone.” In an instant the office turned to stone: thirteen desks frozen still, the Scout mid-search, the analysts with their pens in mid-air. But freezing them wasn't enough: he wanted a culprit. He shouldered his rifle, marched into the middle of the office, and since the real glutton was nowhere to be found, he took it out on whoever was within reach. The first — a hapless Scout just back from his rounds — he shot clean in the forehead; the neighbour, guilty only of looking up, got the bayonet driven into his belly and twisted. “But I was just sitting here!”: too late. Behind him, the Captain gathered the corpses with a sigh and went to recruit new ones, identical, to put everyone back to work as if nothing had happened.",
      "Once calm returned, out came his other side. As the new employees timidly took their seats again, he stood up all smiles and made the rounds, patting shoulders: “Bravo! That's the way, wonderful, keep it up!” — praising everyone, even those doing nothing. Two faces, and neither was the right one: telling the slow ones “push a little harder” or the fast ones “ease off” — calibrating the spending, his one real job — was the single thing that never crossed his mind.",
      "Then back to his post he went, his back to the room. And it was there that, in a corner, the Writer finished a draft, made a phone call, and in through the door came the Critic: he crossed the office, took the sheet, and left. Someone followed him with a puzzled stare; the Sentinel, his back turned, didn't move. And so the waltz began: the Critic would come back, take the sheet, vanish; return, set it back on the Writer's desk, go out again; the phone would call him in, and there he was once more. A constant coming and going, in and out of the office dozens of times — and every time the Sentinel, his back turned, saw absolutely nothing.",
      "Some time passed, and again: “EMERGENCY.” This time he hunted no one: he shouldered his rifle and emptied a whole magazine into the office, mowing down a row of desks from across the room; at the one who came out of the bathroom he hurled the rifle, and the bayonet caught him square in the head. “Here we go again,” sighed the Captain, gathering yet another row of corpses. When the number climbed once more and the Sentinel re-cocked, the Captain tried to stop him: “Wait — we're spending just fine, it's only one of them eating a lot, there's no need to kill everyone, you madman!” But he didn't even hear him. That was when the door opened and in walked, immaculate in jacket and tie, the Assistant — the one who shuttles to the world outside — and before the bloodbath he froze: “Will somebody tell me what the hell is going on here?”",
      "The three of them talked, standing among the dead: the Assistant wide-eyed, the Sentinel sulking and staring into space, the Captain spreading his hands — “this is how I have to manage him.” It was the Assistant who put his finger on it: “That fellow going in and out with the sheet… on your screens, have you ever once seen him?” No: the Critic, coming and going, had always stayed off the monitors. They fixed his cameras until he finally showed up too — but it was late, and everyone knew it: the real trouble wasn't the screens, it was that bipolar head of his that, at the first crooked number, swung from handing out compliments to opening fire. The Assistant nodded, like a man who's already decided. He headed for the exit, slipped on his sunglasses, drew a Colt from under his jacket and, without even turning around, fired a single shot: the Sentinel slumped over his beloved monitors. “Don't worry,” he told the Captain, “we'll find another now. A better one.”",
    ],
    back: "← All chronicles",
  },
};

function BipolarSentinelContent() {
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
          src="/chronicles/bipolar-sentinel.png"
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

export default function BipolarSentinelPage() {
  return (
    <LandingI18nProvider>
      <BipolarSentinelContent />
    </LandingI18nProvider>
  );
}
