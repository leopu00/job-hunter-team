"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";
import { STORIES } from "./stories";

const T = {
  it: {
    title: "Cronache del Team",
    coverAlt:
      "Illustrazione: un cubo di vetro sospeso che racchiude un ufficio-loft in miniatura visto dall'alto — scrivanie con monitor, un globo olografico, un laboratorio — mentre due scienziati in camice bianco lo osservano da fuori prendendo appunti.",
    subtitle:
      "Eventi tecnici realmente accaduti al nostro team di agenti AI, messi in scena come racconti cinematografici.",
    preamble: [
      "Ogni team di agenti vive dentro un contenitore: un piccolo universo che gira per conto suo, dove ogni tanto succede qualcosa di inatteso. Noi lo osserviamo da fuori, ne documentiamo le vicende e, quando serve, mettiamo mano.",
      "In ciascuno di questi contenitori c'è un ufficio, e in quell'ufficio lavora una squadra di impiegati virtuali: non persone in carne e ossa, ma agenti — menti artificiali con un compito molto concreto, cercare lavoro per chi ha avviato il contenitore e fare ciò che chiede.",
      "Noi restiamo fuori, chini su quel mondo come su un acquario: possiamo zoomare fin dentro le stanze, leggere ogni messaggio che gli agenti si scambiano, vedere chi lavora e chi si è fermato — e, quando serve, allungare una mano e cambiare le cose.",
      "Quasi sempre, là dentro, fila tutto liscio. Ma ogni tanto succede qualcosa: un impiegato si addormenta e nessuno se ne accorge, un altro va nel panico, un altro ancora si incaponisce su un'idea sbagliata. Sotto sotto sono piccoli inciampi tecnici — ma siccome questi agenti pensano e reagiscono a modo loro, finiscono per comportarsi in modi che nessuno aveva previsto. E così, da semplici errori, nascono le storie che leggi qui.",
    ],
    back: "← Indietro",
    soon: "presto",
    read: "Leggi →",
  },
  en: {
    title: "Team Chronicles",
    coverAlt:
      "Illustration: a floating glass cube containing a miniature loft office seen from above — desks with monitors, a holographic globe, a lab — while two scientists in white coats watch it from outside, taking notes.",
    subtitle:
      "Real technical events from our AI agent team, staged as cinematic stories.",
    preamble: [
      "Every team of agents lives inside a container: a small universe that runs on its own, where every so often something unexpected happens. We watch it from the outside, document what unfolds, and step in when needed.",
      "Inside each of these containers there's an office, and in that office works a team of virtual employees: not people of flesh and blood, but agents — artificial minds with a very concrete job, to hunt for work for whoever started the container up and do what they ask.",
      "We stay outside, leaning over that world as if over a fish tank: we can zoom right into the rooms, read every message the agents exchange, see who's working and who has stopped — and, when needed, reach in and change things.",
      "Almost always, in there, everything runs smoothly. But every now and then something happens: one employee falls asleep and nobody notices, another panics, another digs in on a wrong idea. Underneath they're small technical hiccups — but since these agents think and react in their own way, they end up behaving in ways no one had predicted. And so, out of plain errors, come the stories you'll read here.",
    ],
    back: "← Back",
    soon: "soon",
    read: "Read →",
  },
};

function ChroniclesContent() {
  const { lang } = useLandingI18n();
  const t = T[lang as keyof typeof T] ?? T.en;
  const storyLang = (lang === "it" ? "it" : "en") as "it" | "en";

  return (
    <>
      <style>{`a.chronicle-card,a.chronicle-card *,a.chronicle-card:hover,a.chronicle-card:hover *{text-decoration:none !important}`}</style>
      <LandingNav />
      <main
        className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto"
        style={{ animation: "fade-in 0.4s ease both" }}
      >
        <div className="text-center mb-10">
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {t.title}
          </h1>
          <p className="text-[13px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">
            {t.subtitle}
          </p>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/chronicles/the-box.png"
          alt={t.coverAlt}
          width={1672}
          height={941}
          className="w-full h-auto mb-10"
          style={{
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%)",
            WebkitMaskComposite: "source-in",
            maskImage:
              "linear-gradient(to bottom, transparent 0%, #000 14%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%)",
            maskComposite: "intersect",
          }}
        />

        <section className="mb-14">
          <p className="text-[18px] md:text-[24px] text-[var(--color-white)] leading-snug font-medium max-w-4xl mx-auto text-center mb-8">
            {t.preamble[0]}
          </p>
          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            {t.preamble.slice(1).map((p, i) => (
              <p
                key={i}
                className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed"
              >
                {p}
              </p>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {STORIES.map((s) => {
            const body = (
              <>
                {s.published && (
                  <div className="w-full h-32 md:h-36 overflow-hidden bg-[var(--color-deep)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/chronicles/${s.slug}.png`}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      width={1672}
                      height={941}
                      className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  </div>
                )}
                <div className="p-5 flex flex-col gap-3 flex-1">
                  <span className="text-[9px] font-semibold tracking-[0.2em] uppercase text-[var(--color-muted)]">
                    {s.date}
                  </span>
                  <h2 className="text-[15px] font-bold text-[var(--color-white)] leading-snug transition-colors group-hover:text-[var(--color-green)]">
                    {s[storyLang].title}
                  </h2>
                  <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
                    {s[storyLang].hook}
                  </p>
                  <span
                    className="mt-auto pt-1 text-[10px] font-semibold tracking-wide"
                    style={{
                      color: s.published
                        ? "var(--color-green)"
                        : "var(--color-muted)",
                    }}
                  >
                    {s.published ? t.read : t.soon}
                  </span>
                </div>
              </>
            );

            const cls =
              "chronicle-card group border border-[var(--color-border)] flex flex-col h-full overflow-hidden no-underline transition-colors";

            return s.published ? (
              <Link
                key={s.slug}
                href={`/chronicles/${s.slug}`}
                className={`${cls} hover:border-[var(--color-green)]`}
                style={{ background: "var(--color-panel)" }}
              >
                {body}
              </Link>
            ) : (
              <article
                key={s.slug}
                className={cls}
                style={{ background: "var(--color-panel)", opacity: 0.65 }}
              >
                {body}
              </article>
            );
          })}
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/"
            className="text-[11px] tracking-wide text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors no-underline"
          >
            {t.back}
          </Link>
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

export default function ChroniclesPage() {
  return (
    <LandingI18nProvider>
      <ChroniclesContent />
    </LandingI18nProvider>
  );
}
