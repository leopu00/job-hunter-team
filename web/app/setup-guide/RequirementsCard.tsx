"use client";

// La scheda dei requisiti, nativa invece che fotografata.
//
// Il contratto descrive `S01-prerequisites` come una «requirement card» con
// una riga per il computer locale, una per il disco, una separata per il
// VPS. Renderla come immagine avrebbe tre difetti che qui non esistono: su
// un telefono da 390 px una tabella fotografata è illeggibile; il testo
// dentro un PNG non si traduce, quindi servirebbero sette riprese; e i
// numeri diventerebbero impossibili da correggere senza rigirare tutto.
//
// I VALORI vengono dal contratto e restano inglesi finché non sono
// tradotti; le ETICHETTE di riga sono microcopy della pagina, tradotte in
// tutte e sette. La riga del VPS è staccata di proposito: sono i requisiti
// di un server dedicato, non del computer di casa, e confonderli è
// esattamente l'equivoco che il link alla guida VPS deve evitare.

import Link from "next/link";

import { DOCS_VPS } from "./guide-config";
import { untranslated, type GuideText } from "./guide-types";
import type { Lang } from "../components/landing/LandingI18n";

const LABELS: Record<string, GuideText> = {
  docker: {
    en: "Docker",
    it: "Docker",
    es: "Docker",
    fr: "Docker",
    de: "Docker",
    pt: "Docker",
    hu: "Docker",
  },
  memory: {
    en: "Memory",
    it: "Memoria",
    es: "Memoria",
    fr: "Mémoire",
    de: "Arbeitsspeicher",
    pt: "Memória",
    hu: "Memória",
  },
  disk: {
    en: "Disk",
    it: "Disco",
    es: "Disco",
    fr: "Disque",
    de: "Speicherplatz",
    pt: "Disco",
    hu: "Lemez",
  },
  internet: {
    en: "Internet",
    it: "Internet",
    es: "Internet",
    fr: "Internet",
    de: "Internet",
    pt: "Internet",
    hu: "Internet",
  },
  provider: {
    en: "AI provider",
    it: "Provider AI",
    es: "Proveedor de AI",
    fr: "Fournisseur AI",
    de: "AI-Anbieter",
    pt: "Provedor de AI",
    hu: "AI-szolgáltató",
  },
};

const LOCAL_TITLE: GuideText = {
  en: "On your own computer",
  it: "Sul tuo computer",
  es: "En tu propio ordenador",
  fr: "Sur votre ordinateur",
  de: "Auf deinem eigenen Rechner",
  pt: "No teu próprio computador",
  hu: "A saját gépeden",
};

const VPS_TITLE: GuideText = {
  en: "On a dedicated VPS — a separate baseline",
  it: "Su un VPS dedicato — una baseline separata",
  es: "En un VPS dedicado — una baseline separada",
  fr: "Sur un VPS dédié — une base distincte",
  de: "Auf einem dedizierten VPS — eine eigene Grundlage",
  pt: "Num VPS dedicado — uma baseline separada",
  hu: "Dedikált VPS-en — külön alapkonfiguráció",
};

/** I valori, dal contratto. Inglesi finché non sono tradotti, come il
 *  resto del copy canonico. */
const VALUES: Record<string, GuideText> = {
  docker: untranslated("Required"),
  memory: untranslated("About 8 GB available before starting the team"),
  disk: untranslated("Room for the team image — no minimum has been measured"),
  internet: untranslated("Required"),
  provider: untranslated("A supported subscription — never an API key"),
  vps: untranslated(
    "Ubuntu 24.04 · 4 GB RAM · 2 vCPU · 80 GB SSD · 2 GB preventive swap",
  ),
};

const EVIDENCE: GuideText = untranslated(
  "Measured over 30 minutes on Windows: a 12 GB machine kept more than 4 GB free with the team and Job Hunter Team Desktop running, on a 2013 2-core, 4-thread CPU, without saturation.",
);

const VPS_LINK: GuideText = {
  en: "Run 24/7 on a VPS",
  it: "Esegui 24/7 su un VPS",
  es: "Ejecuta 24/7 en un VPS",
  fr: "Exécutez 24/7 sur un VPS",
  de: "24/7 auf einem VPS laufen lassen",
  pt: "Executa 24/7 num VPS",
  hu: "Futtasd 24/7-ben egy VPS-en",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 border-t border-[var(--color-border)] py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[7rem_1fr] sm:gap-4">
      <dt className="text-[12px] font-semibold text-[var(--color-white)]">
        {label}
      </dt>
      <dd className="text-[12.5px] leading-relaxed text-[var(--color-bright)]">
        {value}
      </dd>
    </div>
  );
}

export default function RequirementsCard({ lang }: { lang: Lang }) {
  return (
    <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-4 sm:p-5">
      <h4 className="text-[13px] font-bold text-[var(--color-white)]">
        {LOCAL_TITLE[lang]}
      </h4>
      <dl className="mt-3">
        {(["docker", "memory", "disk", "internet", "provider"] as const).map(
          (key) => (
            <Row
              key={key}
              label={LABELS[key][lang]}
              value={VALUES[key][lang]}
            />
          ),
        )}
      </dl>
      <p className="mt-3 border-l-2 border-[var(--color-border)] pl-3 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        {EVIDENCE[lang]}
      </p>

      <div className="mt-5 border-t border-[var(--color-border)] pt-4">
        <h4 className="text-[13px] font-bold text-[var(--color-white)]">
          {VPS_TITLE[lang]}
        </h4>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-bright)]">
          {VALUES.vps[lang]}
        </p>
        <Link
          href={DOCS_VPS}
          className="mt-3 inline-flex min-h-11 items-center text-[12.5px] font-semibold text-[var(--color-muted)] no-underline transition-colors hover:text-[var(--color-green)]"
        >
          {VPS_LINK[lang]}
        </Link>
      </div>
    </div>
  );
}
