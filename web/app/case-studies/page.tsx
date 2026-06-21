// Pagina principale /case-studies — landing della sezione.
//
// Spiega cos'è (dati reali e anonimi di team in esecuzione su profili veri),
// elenca i case study disponibili come card (→ /case-studies/[id]) e incentiva
// gli utenti a contribuire i propri dati, referenziando i doc GitHub.
// È pensata per crescere: col tempo accoglierà il monitoraggio di più team.

import Link from "next/link";
import { LandingI18nProvider } from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { CASE_STUDIES, CONTRIBUTE_LINKS } from "@/lib/case-studies";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Case studies · Job Hunter Team",
  description:
    "Dati reali e anonimi di team di agenti Job Hunter Team in esecuzione su profili veri. Guarda i risultati, e contribuisci con i tuoi dati.",
};

function nf(n: number): string {
  return n.toLocaleString("it-IT");
}

export default function CaseStudiesIndexPage() {
  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* ── Hero / cos'è ──────────────────────────────────────── */}
        <header className="mb-12">
          <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[var(--color-dim)]">
            Case studies · dati di campo reali e anonimi
          </span>
          <h1 className="mt-2 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
            Cosa fa <span style={{ color: "#00e676" }}>davvero</span> un team
            Job&nbsp;Hunter
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--color-muted)]">
            Job Hunter è un team di agenti AI che cerca lavoro al posto tuo:
            trova posizioni, le analizza, le valuta sul tuo profilo e prepara le
            candidature. Qui mostriamo cosa ha prodotto su{" "}
            <strong className="text-[var(--color-white)]">
              profili candidato reali
            </strong>{" "}
            — dati aggregati e anonimi, nessuna informazione personale.
          </p>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--color-dim)]">
            È una pagina viva: cresce a ogni nuovo team monitorato. Scegli un
            case study qui sotto per vedere tutti i risultati.
          </p>
        </header>

        {/* ── Card dei case study ───────────────────────────────── */}
        <section className="mb-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CASE_STUDIES.map((cs) => (
              <Link
                key={cs.id}
                href={`/case-studies/${cs.id}`}
                className="group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 transition-colors hover:border-[var(--color-blue)] no-underline"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-[14px] font-extrabold shrink-0"
                    style={{
                      background:
                        "color-mix(in srgb, var(--color-blue) 18%, transparent)",
                      color: "var(--color-blue)",
                    }}
                  >
                    {cs.profile.badge}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-[var(--color-white)]">
                      {cs.label}
                    </div>
                    <div className="text-[11px] text-[var(--color-dim)] truncate">
                      {cs.tagline}
                    </div>
                  </div>
                  <span className="ml-auto text-[var(--color-dim)] group-hover:text-[var(--color-blue)] transition-colors">
                    →
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-muted)] leading-relaxed line-clamp-2 mb-4">
                  {cs.profile.headline} · {cs.profile.summary}
                </p>
                <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3">
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "var(--color-blue)" }}
                    >
                      {nf(cs.run.totals.positions)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      posizioni
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "#00e676" }}
                    >
                      {Math.round(cs.run.match.avg)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      match medio
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "#00e676" }}
                    >
                      {nf(cs.run.match.strong70)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      match forti
                    </div>
                  </div>
                </div>
              </Link>
            ))}

            {/* placeholder: altri in arrivo */}
            <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-5 flex items-center justify-center text-center opacity-70">
              <div>
                <div className="text-2xl mb-1">➕</div>
                <div className="text-[12px] text-[var(--color-muted)] font-semibold">
                  Altri case study in arrivo
                </div>
                <div className="text-[11px] text-[var(--color-dim)] mt-1">
                  il tuo potrebbe essere il prossimo
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Contribuisci ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 sm:p-8">
          <h2 className="text-xl font-bold tracking-tight">
            📥 Contribuisci con i tuoi dati
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--color-muted)]">
            Più profili reali raccogliamo, più questa pagina diventa utile a chi
            cerca lavoro. Fai girare Job Hunter sulla tua ricerca e condividi i
            risultati (aggregati e anonimi): bastano pochi passi.
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href={CONTRIBUTE_LINKS.results}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-[#00e676]/40 bg-[var(--color-bg)] p-5 transition-colors hover:border-[#00e676] no-underline"
            >
              <div className="text-[13px] font-bold text-[var(--color-white)]">
                🧪 Diventa beta tester{" "}
                <span
                  className="inline-block transition-transform group-hover:translate-x-0.5"
                  style={{ color: "#00e676" }}
                >
                  →
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                Fai girare il team per qualche settimana sulla tua ricerca e
                condividi i risultati: ti aiutiamo col setup. Guida e modello
                dati su GitHub.
              </p>
            </a>
            <a
              href={CONTRIBUTE_LINKS.contributing}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 transition-colors hover:border-[var(--color-blue)] no-underline"
            >
              <div className="text-[13px] font-bold text-[var(--color-white)]">
                🛠️ Self-host & contribuisci{" "}
                <span className="inline-block transition-transform group-hover:translate-x-0.5 text-[var(--color-blue)]">
                  →
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                Installa Job Hunter in locale o sul tuo VPS, usalo sulla tua
                ricerca e apri una PR con i tuoi dati. Tutto open source.
              </p>
            </a>
          </div>
          <div className="mt-5 text-[11px] text-[var(--color-dim)]">
            Repository:{" "}
            <a
              href={CONTRIBUTE_LINKS.repo}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-muted)] underline hover:text-[var(--color-white)]"
            >
              github.com/leopu00/job-hunter-team
            </a>
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        Dati anonimi da run reali del team · snapshot committati, nessuna
        informazione personale del candidato.
      </footer>
    </main>
  );
}
