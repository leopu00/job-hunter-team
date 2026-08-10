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

type Tier = "base" | "high";

type Provider = {
  name: string;
  plan: string;
  tier: Tier;
  url: string;
} & Record<Lang, string>;

// Nessuna cifra: i prezzi cambiano e li dichiarano solo le pagine ufficiali
// (O-12, 2026-08-09). La guida è qualitativa: i piani base funzionano, la
// fascia alta dà i risultati migliori.
const TIER_LABEL: Record<Lang, Record<Tier, string>> = {
  it: {
    base: "Piano base — funziona",
    high: "Fascia alta — risultati migliori",
  },
  en: { base: "Base plan — it works", high: "High tier — best results" },
  es: { base: "Plan base — funciona", high: "Nivel alto — mejores resultados" },
  fr: {
    base: "Formule de base — ça marche",
    high: "Haut de gamme — meilleurs résultats",
  },
  de: {
    base: "Basistarif — funktioniert",
    high: "Oberklasse — beste Ergebnisse",
  },
  pt: {
    base: "Plano base — funciona",
    high: "Nível alto — melhores resultados",
  },
  hu: {
    base: "Alapcsomag — működik",
    high: "Felső kategória — legjobb eredmények",
  },
};

const PROVIDERS: Provider[] = [
  {
    name: "Kimi",
    plan: "Moonshot · Pro",
    tier: "base",
    url: "https://www.kimi.com/code",
    it: "Output paragonabile agli altri due e il piano più semplice da cui partire. Il modello è ancora in rifinitura sulla gestione del budget giornaliero.",
    en: "Output comparable to the other two, and the simplest plan to start from. The model is still being refined on daily budget management.",
    es: "Un resultado comparable a los otros dos y el plan más sencillo para empezar. El modelo aún se está afinando en la gestión del presupuesto diario.",
    fr: "Un résultat comparable aux deux autres, et la formule la plus simple pour démarrer. Le modèle est encore en cours d'affinage sur la gestion du budget quotidien.",
    de: "Ein Ergebnis vergleichbar mit den anderen beiden und der einfachste Tarif für den Einstieg. Das Modell wird bei der Verwaltung des Tagesbudgets noch verfeinert.",
    pt: "Um resultado comparável aos outros dois e o plano mais simples para começar. O modelo ainda está a ser afinado na gestão do orçamento diário.",
    hu: "A másik kettővel összevethető eredmény, és a legegyszerűbb csomag a kezdéshez. A modell finomítása a napi költségkeret kezelésén még folyamatban van.",
  },
  {
    name: "Claude",
    plan: "Anthropic · Max",
    tier: "high",
    url: "https://www.anthropic.com/pricing",
    it: "Un po' meno output di Codex, ma il più preciso e il più intelligente: la scelta migliore per valutare le offerte e scrivere i CV con cura.",
    en: "A bit less output than Codex, but the most precise and the most intelligent: the best choice for evaluating jobs and writing CVs with care.",
    es: "Un poco menos de resultado que Codex, pero el más preciso y el más inteligente: la mejor opción para evaluar las ofertas y escribir los CV con cuidado.",
    fr: "Un peu moins de résultat que Codex, mais le plus précis et le plus intelligent : le meilleur choix pour évaluer les offres et rédiger les CV avec soin.",
    de: "Etwas weniger Output als Codex, aber am präzisesten und intelligentesten: die beste Wahl, um Stellen zu bewerten und Lebensläufe sorgfältig zu schreiben.",
    pt: "Um pouco menos de resultado que o Codex, mas o mais preciso e o mais inteligente: a melhor escolha para avaliar as ofertas e escrever os CV com cuidado.",
    hu: "Kicsivel kevesebb kimenet, mint a Codexé, de a legpontosabb és a legintelligensebb: a legjobb választás az ajánlatok értékeléséhez és az önéletrajzok gondos megírásához.",
  },
  {
    name: "Codex",
    plan: "OpenAI · Plus / Pro",
    tier: "high",
    url: "https://openai.com/chatgpt/pricing",
    it: "Il più completo: provato a fondo in ogni scenario, offre l'output migliore per qualità e quantità. La scelta più solida se vuoi il massimo dal team.",
    en: "The most complete: thoroughly tested in every scenario, it delivers the best output for both quality and quantity. The most solid choice if you want the most from the team.",
    es: "El más completo: probado a fondo en todos los escenarios, ofrece el mejor resultado en calidad y cantidad. La opción más sólida si quieres lo máximo del equipo.",
    fr: "Le plus complet : testé à fond dans tous les scénarios, il offre le meilleur résultat en qualité et en quantité. Le choix le plus solide si vous voulez le maximum de l'équipe.",
    de: "Das vollständigste: gründlich in jedem Szenario getestet, liefert es den besten Output in Qualität und Menge. Die solideste Wahl, wenn du das Maximum aus dem Team willst.",
    pt: "O mais completo: testado a fundo em todos os cenários, oferece o melhor resultado em qualidade e quantidade. A escolha mais sólida se queres o máximo da equipa.",
    hu: "A legteljesebb: minden helyzetben alaposan tesztelve, minőségben és mennyiségben a legjobb kimenetet nyújtja. A legszilárdabb választás, ha a maximumot szeretnéd a csapattól.",
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
      "Scegli tu quale intelligenza far lavorare per te. Questi sono i provider che abbiamo testato: funzionano già con i piani base, ma per i risultati migliori consigliamo la fascia alta. I prezzi cambiano e non li ripetiamo qui: il riferimento sono le pagine ufficiali.",
    providerLink: "Prezzi ufficiali →",
    dedicatedTitle: "Dedica l'abbonamento al team",
    dedicatedNote:
      "Un punto importante: serve un abbonamento AI tutto per il team, separato da quello che usi ogni giorno. Il team lo consuma per intero, quindi non condividerlo con il tuo uso personale.",
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
      "You choose which intelligence works for you. These are the providers we tested: they all work on their base plans, but for the best results we recommend the high tier. Prices change and we don't quote them here: the official pages are the reference.",
    providerLink: "Official pricing →",
    dedicatedTitle: "Dedicate the subscription to the team",
    dedicatedNote:
      "One important point: the team needs an AI subscription of its own, separate from the one you use day to day. It consumes the whole allowance, so don't share it with your personal use.",
    ctaSetup: "How to run it →",
    back: "← Back to home",
  },
  es: {
    title: "Precios",
    subtitle: "Job Hunter Team es open source. Esto es lo único que te cuesta.",
    freeTitle: "La plataforma es gratuita",
    freeBody:
      "Software open source con licencia MIT: ninguna suscripción a la plataforma, ningún coste oculto, ningún ingreso para nosotros. Lo descargas y haces funcionar el equipo en tu propia máquina; el único gasto es la suscripción al modelo de IA.",
    providersTitle: "Los proveedores de IA",
    providersIntro:
      "Tú eliges qué inteligencia trabaja para ti. Estos son los proveedores que hemos probado: todos funcionan con los planes base, pero para los mejores resultados recomendamos el nivel alto. Los precios cambian y no los reproducimos aquí: la referencia son las páginas oficiales.",
    providerLink: "Precios oficiales →",
    dedicatedTitle: "Dedica la suscripción al equipo",
    dedicatedNote:
      "Un punto importante: hace falta una suscripción de IA propia para el equipo, separada de la que usas a diario. El equipo la consume por completo, así que no la compartas con tu uso personal.",
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
      "C'est vous qui choisissez quelle intelligence travaille pour vous. Voici les fournisseurs que nous avons testés : ils fonctionnent tous avec leurs formules de base, mais pour les meilleurs résultats nous recommandons le haut de gamme. Les prix changent et nous ne les reprenons pas ici : les pages officielles font foi.",
    providerLink: "Tarifs officiels →",
    dedicatedTitle: "Dédiez l'abonnement à l'équipe",
    dedicatedNote:
      "Un point important : il faut un abonnement d'IA dédié à l'équipe, distinct de celui que vous utilisez au quotidien. L'équipe le consomme entièrement, alors ne le partagez pas avec votre usage personnel.",
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
      "Du entscheidest, welche Intelligenz für dich arbeitet. Dies sind die von uns getesteten Anbieter: Sie funktionieren alle schon mit ihren Basistarifen, aber für die besten Ergebnisse empfehlen wir die Oberklasse. Preise ändern sich und wir geben sie hier nicht wieder: Maßgeblich sind die offiziellen Seiten.",
    providerLink: "Offizielle Preise →",
    dedicatedTitle: "Widme das Abonnement dem Team",
    dedicatedNote:
      "Ein wichtiger Punkt: Das Team braucht ein eigenes KI-Abonnement, getrennt von dem, das du täglich nutzt. Das Team verbraucht es vollständig, teile es also nicht mit deiner persönlichen Nutzung.",
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
      "Te döntöd el, melyik intelligencia dolgozzon érted. Ezek az általunk tesztelt szolgáltatók: mindegyik működik már az alapcsomaggal is, de a legjobb eredményekhez a felső kategóriát javasoljuk. Az árak változnak, és itt nem ismételjük őket: a hivatalos oldalak az irányadók.",
    providerLink: "Hivatalos árak →",
    dedicatedTitle: "Szentelj egy előfizetést a csapatnak",
    dedicatedNote:
      "Egy fontos pont: a csapatnak saját AI-előfizetésre van szüksége, elkülönítve attól, amit naponta használsz. A csapat teljesen felhasználja, ezért ne oszd meg a személyes használatoddal.",
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
      "É você quem escolhe que inteligência trabalha para si. Estes são os fornecedores que testámos: todos funcionam já com os planos base, mas para os melhores resultados recomendamos o nível alto. Os preços mudam e não os repetimos aqui: a referência são as páginas oficiais.",
    providerLink: "Preços oficiais →",
    dedicatedTitle: "Dedique a subscrição à equipa",
    dedicatedNote:
      "Um ponto importante: a equipa precisa de uma subscrição de IA própria, separada da que usa no dia a dia. A equipa consome-a por inteiro, por isso não a partilhe com o seu uso pessoal.",
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
};

function PricingContent() {
  const { lang } = useLandingI18n();
  const L = (PAGE[lang as Lang] ? lang : "en") as Lang;
  const p = PAGE[L];

  return (
    <>
      <LandingNav />
      <main className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto">
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
                className="relative flex flex-col border border-[var(--color-border)] p-6"
                style={{ background: "var(--color-panel)" }}
              >
                <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-muted)] mb-2">
                  {prov.plan}
                </span>
                <h3 className="text-[16px] font-bold text-[var(--color-white)] mb-1">
                  {prov.name}
                </h3>
                <div className="mb-4">
                  <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--color-green)]">
                    {TIER_LABEL[L][prov.tier]}
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
