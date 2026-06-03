export function ContributeCta() {
  return (
    <section className="border-t border-[var(--color-border)] bg-[var(--color-deep)] py-12">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-2 text-2xl font-bold text-[var(--color-white)]">
          📥 Help us fill the matrix
        </h2>
        <p className="mb-8 max-w-2xl text-sm text-[var(--color-muted)]">
          Real case studies on diverse profiles are the highest-leverage
          pre-launch milestone. Two ways to contribute:
        </p>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <a
            href="/docs/guides/BETA"
            className="group rounded-xl border border-emerald-200 bg-[var(--color-panel)] p-6 transition hover:border-emerald-400 hover:shadow-md"
          >
            <div className="mb-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
              warm path
            </div>
            <h3 className="mb-2 text-lg font-bold text-[var(--color-white)]">
              🧪 Become a beta tester{" "}
              <span className="text-emerald-600 transition group-hover:translate-x-1">
                →
              </span>
            </h3>
            <p className="text-sm text-[var(--color-muted)]">
              Pick an open matrix cell that fits your profile, run JHT for 2+
              weeks, file an issue with your results. We help with setup and pay
              the VPS bill for the first wave.
            </p>
          </a>

          <a
            href="https://github.com/leopu00/job-hunter-team#installation"
            className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 transition hover:border-[var(--color-border)] hover:shadow-md"
          >
            <div className="mb-2 inline-block rounded-full bg-[var(--color-card)] px-2 py-0.5 text-xs font-bold text-[var(--color-bright)]">
              cold path
            </div>
            <h3 className="mb-2 text-lg font-bold text-[var(--color-white)]">
              🛠️ Self-host & contribute data{" "}
              <span className="text-[var(--color-muted)] transition group-hover:translate-x-1">
                →
              </span>
            </h3>
            <p className="text-sm text-[var(--color-muted)]">
              Install JHT locally or on your own VPS, run it on your job hunt,
              share what worked / what didn&apos;t as a PR against{" "}
              <code className="rounded bg-[var(--color-card)] px-1 py-0.5 text-xs">
                docs/about/RESULTS.md
              </code>
              .
            </p>
          </a>
        </div>
      </div>
    </section>
  );
}
