// 0.4.0 is installed from the command line: the desktop app is not in this version. One note, the same key in the
// seven languages, at the top of the pages that still describe the app (/run, /welcome, /setup-guide); the rest of
// each page stays as it is.
import type { Locale } from "@/i18n/config";

export const QUICKSTART_CLI_URL = "https://github.com/leopu00/job-hunter-team/blob/master/docs/guides/QUICKSTART.md";

export const CLI_FIRST_NOTE: Record<Locale, { text: string; link: string }> = {
  en: { text: "0.4.0 is installed from the command line; the desktop app comes in a later release.", link: "CLI quickstart" },
  it: { text: "La 0.4.0 si installa dalla riga di comando; l'app desktop arriva in una versione successiva.", link: "Quickstart della CLI" },
  es: { text: "La 0.4.0 se instala desde la línea de comandos; la app de escritorio llega en una versión posterior.", link: "Quickstart de la CLI" },
  fr: { text: "La 0.4.0 s'installe en ligne de commande ; l'application de bureau arrive dans une version ultérieure.", link: "Quickstart de la CLI" },
  de: { text: "0.4.0 wird über die Kommandozeile installiert; die Desktop-App kommt in einer späteren Version.", link: "Quickstart der CLI" },
  pt: { text: "A 0.4.0 instala-se pela linha de comandos; a app de ambiente de trabalho chega numa versão posterior.", link: "Quickstart da CLI" },
  hu: { text: "A 0.4.0 parancssorból telepíthető; az asztali alkalmazás egy későbbi verzióban érkezik.", link: "A CLI Quickstart leírása" },
};

export function CliFirstNote({ lang, className = "" }: { lang: string; className?: string }) {
  const note = CLI_FIRST_NOTE[(lang in CLI_FIRST_NOTE ? lang : "en") as Locale];
  return (
    <p
      data-cli-first-note
      className={`border border-[var(--color-green)] bg-[var(--color-panel)] px-4 py-3 text-[12px] leading-relaxed text-[var(--color-bright)] ${className}`}
    >
      {note.text}{" "}
      <a
        href={QUICKSTART_CLI_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-[var(--color-green)] no-underline hover:opacity-80"
      >
        {note.link} →
      </a>
    </p>
  );
}
