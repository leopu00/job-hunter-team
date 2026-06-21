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
    url: "https://www.kimi.com/code",
    it: "Il più economico, validato per l'uso quotidiano: in un test reale ha lavorato giorni interi trovando centinaia di posizioni. Ottimo punto di partenza.",
    en: "The most affordable, validated for everyday use: in a real test it ran for days, finding hundreds of openings. A great starting point.",
  },
  {
    name: "Claude",
    plan: "Anthropic · Max",
    price: "~€90",
    url: "https://www.anthropic.com/pricing",
    it: "La massima precisione, il migliore per valutare le offerte e scrivere i CV. Per chi vuole il risultato migliore possibile.",
    en: "The highest precision, best for evaluating jobs and writing CVs. For those who want the very best result.",
  },
  {
    name: "Codex",
    plan: "OpenAI · Plus / Pro",
    price: "~€100",
    url: "https://openai.com/chatgpt/pricing",
    it: "Equilibrio tra qualità e costo. Testato su server: 131 posizioni elaborate in 48 ore.",
    en: "A balance of quality and cost. Tested on a server: 131 openings processed in 48 hours.",
  },
];

const PAGE = {
  it: {
    title: "Prezzi",
    subtitle: "Job Hunter Team è open source. Ecco l'unica cosa che ti costa.",
    freeTitle: "La piattaforma non si paga",
    freeBody:
      "Software open source con licenza MIT: nessun abbonamento alla piattaforma, nessun costo nascosto, nessun ricavo per noi. Lo scarichi e fai girare il team a casa tua; l'unica spesa è l'abbonamento al modello AI.",
    providersTitle: "I provider AI",
    providersIntro:
      "Scegli tu quale intelligenza far lavorare per te. Questi sono i piani testati e i costi indicativi al mese (i prezzi reali sono sulle pagine ufficiali di ogni provider).",
    providerLink: "Prezzi ufficiali →",
    dedicatedTitle: "Dedica l'abbonamento al team",
    dedicatedNote:
      "Un punto importante: serve un abbonamento AI tutto per il team, separato da quello che usi ogni giorno. Il team lo consuma per intero, quindi non condividerlo con il tuo uso personale.",
    approx: "Prezzi indicativi al mese, IVA inclusa. Possono variare.",
    ctaSetup: "Come si avvia →",
    back: "← Torna alla home",
  },
  en: {
    title: "Pricing",
    subtitle:
      "Job Hunter Team is open source. Here's the only thing it costs you.",
    freeTitle: "The platform is free",
    freeBody:
      "Open source under the MIT license: no platform subscription, no hidden fees, no revenue for us. You download and run the team on your own machine; the only cost is the AI model's subscription.",
    providersTitle: "The AI providers",
    providersIntro:
      "You choose which intelligence works for you. These are the tested plans and indicative monthly costs (real prices are on each provider's official page).",
    providerLink: "Official pricing →",
    dedicatedTitle: "Dedicate the subscription to the team",
    dedicatedNote:
      "One important point: the team needs an AI subscription of its own, separate from the one you use day to day. It consumes the whole allowance, so don't share it with your personal use.",
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
          className="mb-14 border border-[var(--color-border)] p-8 md:p-10"
          style={{ background: "var(--color-panel)" }}
        >
          <div className="text-center md:text-left">
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)] mb-3">
              Open source · MIT
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-[var(--color-white)] tracking-tight mb-4">
              {p.freeTitle}
            </h2>
            <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed">
              {p.freeBody}
            </p>
          </div>
        </section>

        {/* Provider */}
        <section className="mb-14">
          <h2 className="text-lg md:text-xl font-bold text-[var(--color-white)] tracking-tight mb-2 text-center">
            {p.providersTitle}
          </h2>
          <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed text-center">
            {p.providersIntro}
          </p>

          <div className="max-w-md mx-auto my-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pricing-brain.png"
              alt={
                L === "it"
                  ? "Radiografia di profilo della testa di un agente: al posto del cervello una rete neurale AI illuminata in verde — il «cervello» è il provider AI, l'unica cosa a pagamento."
                  : "Side X-ray of an agent's head with an AI neural network glowing green in place of the brain: the “brain” is the AI provider, the only paid part."
              }
              width={1448}
              height={1086}
              className="w-full h-auto"
            />
            <p className="mt-2 text-center text-[11px] text-[var(--color-muted)] leading-relaxed">
              {L === "it"
                ? "Il «cervello» — il provider AI — è l'unica cosa che paghi."
                : "The “brain” — the AI provider — is the only thing you pay for."}
            </p>
          </div>

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

          {/* Avviso evidente: abbonamento dedicato al team */}
          <div
            className="mt-8 border-l-2 border-[var(--color-green)] p-5 md:p-6 max-w-3xl mx-auto"
            style={{ background: "var(--color-panel)" }}
          >
            <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-[var(--color-green)] mb-2">
              {p.dedicatedTitle}
            </div>
            <p className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed">
              {p.dedicatedNote}
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
