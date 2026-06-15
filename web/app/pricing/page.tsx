"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

type Provider = {
  name: string;
  plan: string;
  price: string;
  url: string;
  it: string;
  en: string;
};

const PROVIDERS: Provider[] = [
  {
    name: "Kimi",
    plan: "Moonshot · Pro",
    price: "~€40",
    url: "https://www.kimi.com",
    it: "Il più economico, validato per l'uso quotidiano: in un test reale ha lavorato giorni interi trovando centinaia di posizioni. Ottimo punto di partenza.",
    en: "The most affordable, validated for everyday use: in a real test it ran for days, finding hundreds of openings. A great starting point.",
  },
  {
    name: "Codex",
    plan: "OpenAI · Plus / Pro",
    price: "~€100",
    url: "https://openai.com/chatgpt/pricing",
    it: "Equilibrio tra qualità e costo. Testato su server: 131 posizioni elaborate in 48 ore.",
    en: "A balance of quality and cost. Tested on a server: 131 openings processed in 48 hours.",
  },
  {
    name: "Claude",
    plan: "Anthropic · Max x20",
    price: "~€200",
    url: "https://www.anthropic.com/pricing",
    it: "La massima precisione, il migliore per valutare le offerte e scrivere i CV. Per chi vuole il risultato migliore possibile.",
    en: "The highest precision, best for evaluating jobs and writing CVs. For those who want the very best result.",
  },
];

const PAGE = {
  it: {
    title: "Prezzi",
    subtitle:
      "Job Hunter Team è open source. La piattaforma è gratuita: paghi solo il provider AI che scegli.",
    freeTitle: "La piattaforma non si paga",
    freeBody:
      "Il software è open source con licenza MIT: niente abbonamento alla piattaforma, niente costi nascosti, nessun ricavo per noi sul tuo utilizzo. Scarichi, installi e fai girare il team a casa tua. L'unica spesa è l'abbonamento al modello AI che decide la squadra di usare.",
    providersTitle: "I provider AI",
    providersIntro:
      "Scegli tu quale intelligenza far lavorare per te. Questi sono i piani testati e i costi indicativi al mese (i prezzi reali sono sulle pagine ufficiali di ogni provider).",
    providerLink: "Prezzi ufficiali →",
    dedicatedNote:
      "Consiglio: dedica l'abbonamento a Job Hunter Team, separato da quello che usi per l'AI personale, così non esaurite la stessa quota.",
    localTitle: "E i modelli locali?",
    localBody:
      "In futuro potrai far girare il team con modelli AI in locale, sul tuo computer: in quel caso non pagherai alcun provider, ma soltanto l'elettricità. Oggi la qualità dei modelli locali non è ancora all'altezza per questo tipo di lavoro, ma è una direzione su cui lavoriamo.",
    vpsTitle: "Se usi una VPS",
    vpsBody:
      "Far girare il team su una VPS sempre accesa costa circa €6–10 al mese di server, da aggiungere al provider AI. È il modo più economico per averlo attivo 24 ore su 24 senza tenere acceso un computer.",
    approx: "Prezzi indicativi al mese, IVA inclusa. Possono variare.",
    ctaSetup: "Come si avvia →",
    back: "← Torna alla home",
  },
  en: {
    title: "Pricing",
    subtitle:
      "Job Hunter Team is open source. The platform is free: you only pay the AI provider you choose.",
    freeTitle: "The platform is free",
    freeBody:
      "The software is open source under the MIT license: no platform subscription, no hidden fees, no revenue for us on your usage. You download, install and run the team on your own machine. The only cost is the subscription to the AI model the team uses.",
    providersTitle: "The AI providers",
    providersIntro:
      "You choose which intelligence works for you. These are the tested plans and indicative monthly costs (real prices are on each provider's official page).",
    providerLink: "Official pricing →",
    dedicatedNote:
      "Tip: dedicate the subscription to Job Hunter Team, separate from your personal AI, so you don't drain the same quota.",
    localTitle: "What about local models?",
    localBody:
      "In the future you'll be able to run the team with local AI models, on your own computer: then you pay no provider at all — only electricity. Today local models aren't yet good enough for this kind of work, but it's a direction we're pursuing.",
    vpsTitle: "If you use a VPS",
    vpsBody:
      "Running the team on an always-on VPS costs about €6–10 a month for the server, on top of the AI provider. It's the cheapest way to keep it running 24/7 without leaving a computer on.",
    approx: "Indicative monthly prices, VAT included. Subject to change.",
    ctaSetup: "How to run it →",
    back: "← Back to home",
  },
};

function PricingContent() {
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
        <div className="text-center mb-14">
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {p.title}
          </h1>
          <p className="text-[13px] md:text-[15px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">
            {p.subtitle}
          </p>
        </div>

        {/* Piattaforma gratuita */}
        <section
          className="mb-14 rounded-xl border border-[var(--color-border)] p-8 md:p-10 text-center"
          style={{ background: "var(--color-panel)" }}
        >
          <div className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)] mb-3">
            Open source · MIT
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-[var(--color-white)] tracking-tight mb-4">
            {p.freeTitle}
          </h2>
          <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed max-w-2xl mx-auto">
            {p.freeBody}
          </p>
        </section>

        {/* Provider */}
        <section className="mb-14">
          <h2 className="text-lg md:text-xl font-bold text-[var(--color-white)] tracking-tight mb-2 text-center">
            {p.providersTitle}
          </h2>
          <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed text-center mb-8">
            {p.providersIntro}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PROVIDERS.map((prov) => (
              <div
                key={prov.name}
                className="flex flex-col border border-[var(--color-border)] p-6"
                style={{ background: "var(--color-panel)" }}
              >
                <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-2">
                  {prov.plan}
                </span>
                <h3 className="text-[16px] font-bold text-[var(--color-white)] mb-1">
                  {prov.name}
                </h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-2xl font-extrabold text-[var(--color-green)]">
                    {prov.price}
                  </span>
                  <span className="text-[11px] text-[var(--color-muted)]">
                    /{L === "it" ? "mese" : "month"}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-bright)] leading-relaxed flex-1 mb-4">
                  {prov[L]}
                </p>
                <a
                  href={prov.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-semibold tracking-wide text-[var(--color-green)] hover:opacity-80 transition-opacity no-underline"
                >
                  {p.providerLink}
                </a>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[10px] text-[var(--color-dim)] text-center">
            {p.approx}
          </p>
          <p className="mt-3 text-[12px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed text-center">
            {p.dedicatedNote}
          </p>
        </section>

        {/* Local + VPS */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-14">
          <div className="border border-[var(--color-border)] p-6">
            <h3 className="text-[15px] font-bold text-[var(--color-white)] mb-3">
              {p.localTitle}
            </h3>
            <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
              {p.localBody}
            </p>
          </div>
          <div className="border border-[var(--color-border)] p-6">
            <h3 className="text-[15px] font-bold text-[var(--color-white)] mb-3">
              {p.vpsTitle}
            </h3>
            <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
              {p.vpsBody}
            </p>
          </div>
        </section>

        <div className="flex flex-col items-center gap-4">
          <Link
            href="/run"
            className="inline-flex items-center px-8 py-3.5 text-[13px] font-bold tracking-wider no-underline transition-all hover:opacity-90"
            style={{ background: "var(--color-green)", color: "#060608" }}
          >
            {p.ctaSetup}
          </Link>
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

export default function PricingPage() {
  return (
    <LandingI18nProvider>
      <PricingContent />
    </LandingI18nProvider>
  );
}
