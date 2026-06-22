"use client";

import Link from "next/link";
import { getDocsNav, type DocLocale } from "./docs-nav";
import { REPO } from "./DocKit";
import { useLandingI18n } from "../components/landing/LandingI18n";

const T: Record<
  DocLocale,
  { heading: string; intro: string; readSource: string }
> = {
  it: {
    heading: "Documentazione",
    intro:
      "Le basi per configurare e far girare Job Hunter Team. Queste pagine sono brevi e dirette — per il dettaglio tecnico completo e il codice stesso, il sorgente è il riferimento migliore.",
    readSource: "Leggi il sorgente su GitHub ↗",
  },
  en: {
    heading: "Documentation",
    intro:
      "The essentials for setting up and running Job Hunter Team. These pages are short and to the point — for the full technical detail and the code itself, the source is the best reference.",
    readSource: "Read the source on GitHub ↗",
  },
  es: {
    heading: "Documentación",
    intro:
      "Lo esencial para configurar y ejecutar Job Hunter Team. Estas páginas son breves y directas — para el detalle técnico completo y el código en sí, el código fuente es la mejor referencia.",
    readSource: "Lee el código en GitHub ↗",
  },
  fr: {
    heading: "Documentation",
    intro:
      "L'essentiel pour configurer et exécuter Job Hunter Team. Ces pages sont courtes et précises — pour le détail technique complet et le code lui-même, le code source est la meilleure référence.",
    readSource: "Lire le code sur GitHub ↗",
  },
  de: {
    heading: "Dokumentation",
    intro:
      "Das Wesentliche, um Job Hunter Team einzurichten und zu betreiben. Diese Seiten sind kurz und auf den Punkt — für die vollständigen technischen Details und den Code selbst ist der Quellcode die beste Referenz.",
    readSource: "Quellcode auf GitHub lesen ↗",
  },
  hu: {
    heading: "Dokumentáció",
    intro:
      "A lényeg a Job Hunter Team beállításához és futtatásához. Ezek az oldalak rövidek és lényegre törők — a teljes technikai részletekért és magáért a kódért a forráskód a legjobb hivatkozás.",
    readSource: "Forráskód a GitHubon ↗",
  },
  pt: {
    heading: "Documentação",
    intro:
      "O essencial para configurar e executar o Job Hunter Team. Estas páginas são curtas e diretas — para o detalhe técnico completo e o próprio código, o código-fonte é a melhor referência.",
    readSource: "Veja o código no GitHub ↗",
  },
};

export default function DocsIndex() {
  const { lang } = useLandingI18n();
  const t = T[lang as DocLocale] ?? T.en;
  const nav = getDocsNav(lang as DocLocale);
  return (
    <div>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
          📚 {t.heading}
        </h1>
        <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
          {t.intro}
        </p>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 mt-4 text-[12px] font-semibold text-[var(--color-green)] no-underline hover:opacity-80 transition-opacity"
        >
          {t.readSource}
        </a>
      </div>

      {nav.map((section) => (
        <div key={section.group} className="mb-10">
          <h2 className="text-[13px] font-bold text-[var(--color-white)] mb-4">
            {section.group}
          </h2>
          <ul className="space-y-4">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block no-underline group">
                  <span className="text-[13px] font-semibold text-[var(--color-white)] group-hover:underline">
                    {item.emoji ? `${item.emoji} ` : ""}
                    {item.title}
                  </span>
                  {item.description ? (
                    <span className="block text-[12px] text-[var(--color-muted)] mt-1 leading-relaxed">
                      {item.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
