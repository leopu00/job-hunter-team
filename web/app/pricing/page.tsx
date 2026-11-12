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
  vendor: string;
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
    name: "GLM",
    vendor: "Z.ai",
    tier: "high",
    url: "https://z.ai",
    it: "L'unico provider della 0.4.0: gli agenti girano sull'harness Pi con la tua chiave API, a consumo. jht setup chiede la chiave, la controlla e la tiene nel container; un tetto di spesa giornaliero mette in pausa il team. Misurato: circa 0,10 USD per posizione valutata.",
    en: "The one provider of 0.4.0: the agents run on the Pi harness with your API key, paid per call. jht setup asks for the key, checks it and keeps it in the container; a daily spending ceiling pauses the team. Measured: about 0.10 USD per scored position.",
    es: "El único proveedor de la 0.4.0: los agentes funcionan sobre el harness Pi con tu clave de API, de pago por uso. jht setup pide la clave, la comprueba y la guarda en el contenedor; un tope de gasto diario pausa el equipo. Medido: unos 0,10 USD por posición evaluada.",
    fr: "L'unique fournisseur de la 0.4.0 : les agents tournent sur le harness Pi avec votre clé d'API, payée à l'usage. jht setup demande la clé, la vérifie et la garde dans le conteneur ; un plafond de dépense quotidien met l'équipe en pause. Mesuré : environ 0,10 USD par poste évalué.",
    de: "Der einzige Anbieter von 0.4.0: Die Agenten laufen auf dem Pi-Harness mit deinem API-Key, pro Aufruf bezahlt. jht setup fragt nach dem Key, prüft ihn und bewahrt ihn im Container auf; ein tägliches Ausgabenlimit pausiert das Team. Gemessen: etwa 0,10 USD pro bewerteter Stelle.",
    pt: "O único fornecedor da 0.4.0: os agentes correm no harness Pi com a sua chave de API, paga por uso. O jht setup pede a chave, verifica-a e guarda-a no contentor; um teto de gastos diário pausa a equipa. Medido: cerca de 0,10 USD por posição avaliada.",
    hu: "A 0.4.0 egyetlen szolgáltatója: az ügynökök a Pi harness-en futnak az API-kulcsoddal, hívásonként fizetve. A jht setup elkéri a kulcsot, ellenőrzi és a konténerben tartja; a napi költési plafon szünetelteti a csapatot. Mérve: kb. 0,10 USD értékelt pozíciónként.",
  },
];

const PAGE = {
  it: {
    title: "Prezzi",
    subtitle: "Job Hunter Team è open source. Ecco l'unica cosa che ti costa.",
    freeTitle: "La piattaforma non si paga",
    freeBody:
      "Software open source con licenza MIT: nessun abbonamento alla piattaforma, nessun costo nascosto, nessun ricavo per noi. Lo scarichi e fai girare il team a casa tua; l'unica spesa è il consumo del modello AI, pagato al provider con la tua chiave API.",
    providersTitle: "I provider AI",
    providersIntro:
      "Nella 0.4.0 il team gira su GLM (Z.ai) con una chiave API, pagata a consumo; Codex non è in questa versione. I prezzi cambiano e non li ripetiamo qui: il riferimento sono le pagine ufficiali.",
    providerLink: "Prezzi ufficiali →",
    dedicatedTitle: "Dedica la chiave al team",
    dedicatedNote:
      "Un punto importante: usa una chiave API solo per il team, separata da quella che usi ogni giorno, e metti un tetto di spesa sia nel team sia presso il provider: così il conto si legge e non si mescola con il tuo uso personale.",
    ctaSetup: "Come si avvia →",
    back: "← Torna alla home",
  },
  en: {
    title: "Pricing",
    subtitle:
      "Job Hunter Team is open source. Here's the only thing it costs you.",
    freeTitle: "The platform is free",
    freeBody:
      "Open source under the MIT license: no platform subscription, no hidden fees, no revenue for us. You download and run the team on your own machine; the only cost is the AI model's usage, paid to the provider with your API key.",
    providersTitle: "The AI providers",
    providersIntro:
      "In 0.4.0 the team runs on GLM (Z.ai) with an API key, paid per call; Codex is not in this version. Prices change and we don't quote them here: the official pages are the reference.",
    providerLink: "Official pricing →",
    dedicatedTitle: "Dedicate the key to the team",
    dedicatedNote:
      "One important point: use an API key for the team only, separate from the one you use day to day, and set a spending ceiling both in the team and with the provider: the spending stays readable and apart from your personal use.",
    ctaSetup: "How to run it →",
    back: "← Back to home",
  },
  es: {
    title: "Precios",
    subtitle: "Job Hunter Team es open source. Esto es lo único que te cuesta.",
    freeTitle: "La plataforma es gratuita",
    freeBody:
      "Software open source con licencia MIT: ninguna suscripción a la plataforma, ningún coste oculto, ningún ingreso para nosotros. Lo descargas y haces funcionar el equipo en tu propia máquina; el único gasto es el uso del modelo de IA, pagado al proveedor con tu clave de API.",
    providersTitle: "Los proveedores de IA",
    providersIntro:
      "En la 0.4.0 el equipo funciona con GLM (Z.ai) y una clave de API, de pago por uso; Codex no está en esta versión. Los precios cambian y no los reproducimos aquí: la referencia son las páginas oficiales.",
    providerLink: "Precios oficiales →",
    dedicatedTitle: "Dedica la clave al equipo",
    dedicatedNote:
      "Un punto importante: usa una clave de API solo para el equipo, separada de la que usas a diario, y pon un tope de gasto tanto en el equipo como en el proveedor: así la factura se lee y no se mezcla con tu uso personal.",
    ctaSetup: "Cómo se inicia →",
    back: "← Volver al inicio",
  },
  fr: {
    title: "Tarifs",
    subtitle:
      "Job Hunter Team est open source. Voici la seule chose qui vous coûte.",
    freeTitle: "La plateforme est gratuite",
    freeBody:
      "Logiciel open source sous licence MIT : aucun abonnement à la plateforme, aucun coût caché, aucun revenu pour nous. Vous le téléchargez et faites tourner l'équipe sur votre propre machine ; la seule dépense est l'usage du modèle d'IA, payé au fournisseur avec votre clé d'API.",
    providersTitle: "Les fournisseurs d'IA",
    providersIntro:
      "Dans la 0.4.0, l'équipe fonctionne avec GLM (Z.ai) et une clé d'API, payée à l'usage ; Codex n'est pas dans cette version. Les prix changent et nous ne les reprenons pas ici : les pages officielles font foi.",
    providerLink: "Tarifs officiels →",
    dedicatedTitle: "Dédiez la clé à l'équipe",
    dedicatedNote:
      "Un point important : utilisez une clé d'API réservée à l'équipe, distincte de celle de votre usage quotidien, et fixez un plafond de dépense dans l'équipe et chez le fournisseur : la facture reste lisible et séparée de votre usage personnel.",
    ctaSetup: "Comment le lancer →",
    back: "← Retour à l'accueil",
  },
  de: {
    title: "Preise",
    subtitle:
      "Job Hunter Team ist Open Source. Das ist das Einzige, was es dich kostet.",
    freeTitle: "Die Plattform ist kostenlos",
    freeBody:
      "Open-Source-Software unter MIT-Lizenz: kein Plattform-Abonnement, keine versteckten Kosten, keine Einnahmen für uns. Du lädst sie herunter und lässt das Team auf deinem eigenen Rechner laufen; die einzige Ausgabe ist die Nutzung des KI-Modells, mit deinem API-Key beim Anbieter bezahlt.",
    providersTitle: "Die KI-Anbieter",
    providersIntro:
      "In 0.4.0 läuft das Team mit GLM (Z.ai) und einem API-Key, pro Aufruf bezahlt; Codex ist nicht in dieser Version. Preise ändern sich und wir geben sie hier nicht wieder: Maßgeblich sind die offiziellen Seiten.",
    providerLink: "Offizielle Preise →",
    dedicatedTitle: "Widme den Key dem Team",
    dedicatedNote:
      "Ein wichtiger Punkt: Nutze einen API-Key nur für das Team, getrennt von dem, den du täglich nutzt, und setze ein Ausgabenlimit im Team und beim Anbieter: So bleibt die Rechnung lesbar und getrennt von deiner persönlichen Nutzung.",
    ctaSetup: "So wird es gestartet →",
    back: "← Zurück zur Startseite",
  },
  hu: {
    title: "Árak",
    subtitle:
      "A Job Hunter Team nyílt forráskódú. Ez az egyetlen dolog, ami pénzbe kerül.",
    freeTitle: "A platform ingyenes",
    freeBody:
      "Nyílt forráskódú szoftver MIT licenc alatt: nincs platform-előfizetés, nincsenek rejtett költségek, nincs bevételünk belőle. Letöltöd és a saját gépeden futtatod a csapatot; az egyetlen kiadás az AI-modell használata, amelyet az API-kulcsoddal fizetsz a szolgáltatónak.",
    providersTitle: "Az AI-szolgáltatók",
    providersIntro:
      "A 0.4.0-ban a csapat GLM-mel (Z.ai) fut, API-kulccsal, hívásonként fizetve; a Codex nincs benne ebben a verzióban. Az árak változnak, és itt nem ismételjük őket: a hivatalos oldalak az irányadók.",
    providerLink: "Hivatalos árak →",
    dedicatedTitle: "Szentelj egy kulcsot a csapatnak",
    dedicatedNote:
      "Egy fontos pont: használj csak a csapatnak szánt API-kulcsot, elkülönítve attól, amit naponta használsz, és állíts be költési plafont a csapatban és a szolgáltatónál is: így a számla átlátható marad, és nem keveredik a személyes használatoddal.",
    ctaSetup: "Hogyan indítható →",
    back: "← Vissza a főoldalra",
  },
  pt: {
    title: "Preços",
    subtitle:
      "O Job Hunter Team é open source. Aqui está a única coisa que lhe custa.",
    freeTitle: "A plataforma é gratuita",
    freeBody:
      "Software open source com licença MIT: nenhuma subscrição da plataforma, nenhum custo oculto, nenhuma receita para nós. Transfere-o e põe o equipa a funcionar na sua própria máquina; a única despesa é o uso do modelo de IA, pago ao fornecedor com a sua chave de API.",
    providersTitle: "Os fornecedores de IA",
    providersIntro:
      "Na 0.4.0 a equipa funciona com GLM (Z.ai) e uma chave de API, paga por uso; Codex não está nesta versão. Os preços mudam e não os repetimos aqui: a referência são as páginas oficiais.",
    providerLink: "Preços oficiais →",
    dedicatedTitle: "Dedique a chave à equipa",
    dedicatedNote:
      "Um ponto importante: use uma chave de API só para a equipa, separada da que usa no dia a dia, e defina um teto de gastos na equipa e no fornecedor: assim a fatura fica legível e separada do seu uso pessoal.",
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
                  {prov.vendor}
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

          {/* Avviso evidente: chiave dedicata al team */}
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
