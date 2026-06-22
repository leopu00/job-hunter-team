"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

type Lang = "it" | "en" | "es" | "fr" | "de" | "pt" | "hu";

type Provider = {
  name: string;
  plan: string;
  price: string;
  url: string;
} & Record<Lang, string>;

const PROVIDERS: Provider[] = [
  {
    name: "Kimi",
    plan: "Moonshot · Pro",
    price: "~€40",
    url: "https://www.kimi.com/code",
    it: "Il più economico, validato per l'uso quotidiano: in un test reale ha lavorato giorni interi trovando centinaia di posizioni. Ottimo punto di partenza.",
    en: "The most affordable, validated for everyday use: in a real test it ran for days, finding hundreds of openings. A great starting point.",
    es: "El más económico, validado para el uso diario: en una prueba real trabajó durante días enteros encontrando cientos de posiciones. Un excelente punto de partida.",
    fr: "Le plus économique, validé pour un usage quotidien : lors d'un test réel, il a travaillé des journées entières en trouvant des centaines d'offres. Un excellent point de départ.",
    de: "Das günstigste, für den täglichen Einsatz erprobt: In einem echten Test lief es tagelang und fand Hunderte von Stellen. Ein hervorragender Ausgangspunkt.",
    pt: "O mais económico, validado para o uso diário: num teste real, trabalhou dias inteiros encontrando centenas de posições. Um excelente ponto de partida.",
    hu: "A legolcsóbb, mindennapi használatra bevált: egy valós tesztben napokon át dolgozott, és több száz pozíciót talált. Kiváló kiindulópont.",
  },
  {
    name: "Claude",
    plan: "Anthropic · Max",
    price: "~€90",
    url: "https://www.anthropic.com/pricing",
    it: "La massima precisione, il migliore per valutare le offerte e scrivere i CV. Per chi vuole il risultato migliore possibile.",
    en: "The highest precision, best for evaluating jobs and writing CVs. For those who want the very best result.",
    es: "La máxima precisión, el mejor para evaluar las ofertas y escribir los CV. Para quien quiere el mejor resultado posible.",
    fr: "La précision maximale, le meilleur pour évaluer les offres et rédiger les CV. Pour qui veut le meilleur résultat possible.",
    de: "Höchste Präzision, am besten geeignet, um Stellen zu bewerten und Lebensläufe zu schreiben. Für alle, die das bestmögliche Ergebnis wollen.",
    pt: "A máxima precisão, o melhor para avaliar as ofertas e escrever os CV. Para quem quer o melhor resultado possível.",
    hu: "A legnagyobb pontosság, a legjobb az ajánlatok értékeléséhez és az önéletrajzok megírásához. Azoknak, akik a lehető legjobb eredményt szeretnék.",
  },
  {
    name: "Codex",
    plan: "OpenAI · Plus / Pro",
    price: "~€100",
    url: "https://openai.com/chatgpt/pricing",
    it: "Equilibrio tra qualità e costo. Testato su server: 131 posizioni elaborate in 48 ore.",
    en: "A balance of quality and cost. Tested on a server: 131 openings processed in 48 hours.",
    es: "Equilibrio entre calidad y coste. Probado en servidor: 131 posiciones procesadas en 48 horas.",
    fr: "Un équilibre entre qualité et coût. Testé sur serveur : 131 offres traitées en 48 heures.",
    de: "Ausgewogenes Verhältnis von Qualität und Kosten. Auf einem Server getestet: 131 Stellen in 48 Stunden verarbeitet.",
    pt: "Equilíbrio entre qualidade e custo. Testado em servidor: 131 posições processadas em 48 horas.",
    hu: "Egyensúly a minőség és a költség között. Szerveren tesztelve: 131 pozíció feldolgozva 48 óra alatt.",
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
  es: {
    title: "Precios",
    subtitle:
      "Job Hunter Team es open source. Esto es lo único que te cuesta.",
    freeTitle: "La plataforma es gratuita",
    freeBody:
      "Software open source con licencia MIT: ninguna suscripción a la plataforma, ningún coste oculto, ningún ingreso para nosotros. Lo descargas y haces funcionar el equipo en tu propia máquina; el único gasto es la suscripción al modelo de IA.",
    providersTitle: "Los proveedores de IA",
    providersIntro:
      "Tú eliges qué inteligencia trabaja para ti. Estos son los planes probados y los costes indicativos al mes (los precios reales están en las páginas oficiales de cada proveedor).",
    providerLink: "Precios oficiales →",
    dedicatedTitle: "Dedica la suscripción al equipo",
    dedicatedNote:
      "Un punto importante: hace falta una suscripción de IA propia para el equipo, separada de la que usas a diario. El equipo la consume por completo, así que no la compartas con tu uso personal.",
    approx: "Precios indicativos al mes, IVA incluido. Pueden variar.",
    ctaSetup: "Cómo se inicia →",
    back: "← Volver al inicio",
  },
  fr: {
    title: "Tarifs",
    subtitle:
      "Job Hunter Team est open source. Voici la seule chose qui vous coûte.",
    freeTitle: "La plateforme est gratuite",
    freeBody:
      "Logiciel open source sous licence MIT : aucun abonnement à la plateforme, aucun coût caché, aucun revenu pour nous. Vous le téléchargez et faites tourner l'équipe sur votre propre machine ; la seule dépense est l'abonnement au modèle d'IA.",
    providersTitle: "Les fournisseurs d'IA",
    providersIntro:
      "C'est vous qui choisissez quelle intelligence travaille pour vous. Voici les forfaits testés et les coûts indicatifs par mois (les prix réels figurent sur les pages officielles de chaque fournisseur).",
    providerLink: "Tarifs officiels →",
    dedicatedTitle: "Dédiez l'abonnement à l'équipe",
    dedicatedNote:
      "Un point important : il faut un abonnement d'IA dédié à l'équipe, distinct de celui que vous utilisez au quotidien. L'équipe le consomme entièrement, alors ne le partagez pas avec votre usage personnel.",
    approx: "Prix indicatifs par mois, TVA incluse. Susceptibles de varier.",
    ctaSetup: "Comment le lancer →",
    back: "← Retour à l'accueil",
  },
  de: {
    title: "Preise",
    subtitle:
      "Job Hunter Team ist Open Source. Das ist das Einzige, was es dich kostet.",
    freeTitle: "Die Plattform ist kostenlos",
    freeBody:
      "Open-Source-Software unter MIT-Lizenz: kein Plattform-Abonnement, keine versteckten Kosten, keine Einnahmen für uns. Du lädst sie herunter und lässt das Team auf deinem eigenen Rechner laufen; die einzige Ausgabe ist das Abonnement für das KI-Modell.",
    providersTitle: "Die KI-Anbieter",
    providersIntro:
      "Du entscheidest, welche Intelligenz für dich arbeitet. Dies sind die getesteten Tarife und die ungefähren monatlichen Kosten (die echten Preise stehen auf den offiziellen Seiten der jeweiligen Anbieter).",
    providerLink: "Offizielle Preise →",
    dedicatedTitle: "Widme das Abonnement dem Team",
    dedicatedNote:
      "Ein wichtiger Punkt: Das Team braucht ein eigenes KI-Abonnement, getrennt von dem, das du täglich nutzt. Das Team verbraucht es vollständig, teile es also nicht mit deiner persönlichen Nutzung.",
    approx: "Ungefähre Monatspreise, inkl. MwSt. Änderungen vorbehalten.",
    ctaSetup: "So wird es gestartet →",
    back: "← Zurück zur Startseite",
  },
  hu: {
    title: "Árak",
    subtitle:
      "A Job Hunter Team nyílt forráskódú. Ez az egyetlen dolog, ami pénzbe kerül.",
    freeTitle: "A platform ingyenes",
    freeBody:
      "Nyílt forráskódú szoftver MIT licenc alatt: nincs platform-előfizetés, nincsenek rejtett költségek, nincs bevételünk belőle. Letöltöd és a saját gépeden futtatod a csapatot; az egyetlen kiadás az AI-modell előfizetése.",
    providersTitle: "Az AI-szolgáltatók",
    providersIntro:
      "Te döntöd el, melyik intelligencia dolgozzon érted. Ezek a tesztelt csomagok és a havi irányárak (a valós árak az egyes szolgáltatók hivatalos oldalain találhatók).",
    providerLink: "Hivatalos árak →",
    dedicatedTitle: "Szentelj egy előfizetést a csapatnak",
    dedicatedNote:
      "Egy fontos pont: a csapatnak saját AI-előfizetésre van szüksége, elkülönítve attól, amit naponta használsz. A csapat teljesen felhasználja, ezért ne oszd meg a személyes használatoddal.",
    approx: "Irányadó havi árak, áfával. Változhatnak.",
    ctaSetup: "Hogyan indítható →",
    back: "← Vissza a főoldalra",
  },
  pt: {
    title: "Preços",
    subtitle:
      "O Job Hunter Team é open source. Aqui está a única coisa que lhe custa.",
    freeTitle: "A plataforma é gratuita",
    freeBody:
      "Software open source com licença MIT: nenhuma subscrição da plataforma, nenhum custo oculto, nenhuma receita para nós. Transfere-o e põe o equipa a funcionar na sua própria máquina; a única despesa é a subscrição do modelo de IA.",
    providersTitle: "Os fornecedores de IA",
    providersIntro:
      "É você quem escolhe que inteligência trabalha para si. Estes são os planos testados e os custos indicativos por mês (os preços reais estão nas páginas oficiais de cada fornecedor).",
    providerLink: "Preços oficiais →",
    dedicatedTitle: "Dedique a subscrição à equipa",
    dedicatedNote:
      "Um ponto importante: a equipa precisa de uma subscrição de IA própria, separada da que usa no dia a dia. A equipa consome-a por inteiro, por isso não a partilhe com o seu uso pessoal.",
    approx: "Preços indicativos por mês, IVA incluído. Sujeitos a alteração.",
    ctaSetup: "Como se inicia →",
    back: "← Voltar ao início",
  },
};

const BRAIN = {
  alt: {
    it: "Radiografia di profilo della testa di un agente: al posto del cervello una rete neurale AI illuminata in verde — il «cervello» è il provider AI, l'unica cosa a pagamento.",
    en: "Side X-ray of an agent's head with an AI neural network glowing green in place of the brain: the “brain” is the AI provider, the only paid part.",
    es: "Radiografía de perfil de la cabeza de un agente: en lugar del cerebro, una red neuronal de IA iluminada en verde — el «cerebro» es el proveedor de IA, lo único de pago.",
    fr: "Radiographie de profil de la tête d'un agent : à la place du cerveau, un réseau de neurones d'IA illuminé en vert — le « cerveau » est le fournisseur d'IA, la seule partie payante.",
    de: "Seitliches Röntgenbild des Kopfes eines Agenten: anstelle des Gehirns ein grün leuchtendes neuronales KI-Netz — das „Gehirn“ ist der KI-Anbieter, das Einzige, was kostet.",
    pt: "Radiografia de perfil da cabeça de um agente: no lugar do cérebro, uma rede neuronal de IA iluminada a verde — o «cérebro» é o fornecedor de IA, a única parte paga.",
    hu: "Egy ügynök fejének oldalsó röntgenfelvétele: az agy helyén egy zölden világító AI neurális hálózat — az „agy” az AI-szolgáltató, az egyetlen fizetős rész.",
  },
  caption: {
    it: "Il «cervello» — il provider AI — è l'unica cosa che paghi.",
    en: "The “brain” — the AI provider — is the only thing you pay for.",
    es: "El «cerebro» — el proveedor de IA — es lo único que pagas.",
    fr: "Le « cerveau » — le fournisseur d'IA — est la seule chose que vous payez.",
    de: "Das „Gehirn“ — der KI-Anbieter — ist das Einzige, wofür du zahlst.",
    pt: "O «cérebro» — o fornecedor de IA — é a única coisa que paga.",
    hu: "Az „agy” — az AI-szolgáltató — az egyetlen dolog, amiért fizetsz.",
  },
  per: {
    it: "mese",
    en: "month",
    es: "mes",
    fr: "mois",
    de: "Monat",
    pt: "mês",
    hu: "hónap",
  },
};

function PricingContent() {
  const { lang } = useLandingI18n();
  const L = (PAGE[lang as Lang] ? lang : "en") as Lang;
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
              alt={BRAIN.alt[L]}
              width={1448}
              height={1086}
              className="w-full h-auto"
            />
            <p className="mt-2 text-center text-[11px] text-[var(--color-muted)] leading-relaxed">
              {BRAIN.caption[L]}
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
                    /{BRAIN.per[L]}
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
