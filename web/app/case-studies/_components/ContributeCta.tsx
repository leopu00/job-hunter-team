export function ContributeCta() {
  return (
    <section className="border-t border-slate-200 bg-slate-50 py-12">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="mb-2 text-2xl font-bold text-slate-900">📥 Help us fill the matrix</h2>
        <p className="mb-8 max-w-2xl text-sm text-slate-600">
          Real case studies on diverse profiles are the highest-leverage pre-launch milestone.
          Two ways to contribute:
        </p>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <a
            href="/docs/guides/BETA"
            className="group rounded-xl border border-emerald-200 bg-white p-6 transition hover:border-emerald-400 hover:shadow-md"
          >
            <div className="mb-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
              warm path
            </div>
            <h3 className="mb-2 text-lg font-bold text-slate-900">
              🧪 Become a beta tester{" "}
              <span className="text-emerald-600 transition group-hover:translate-x-1">→</span>
            </h3>
            <p className="text-sm text-slate-600">
              Pick an open matrix cell that fits your profile, run JHT for 2+ weeks, file an issue
              with your results. We help with setup and pay the VPS bill for the first wave.
            </p>
          </a>

          <a
            href="https://github.com/leopu00/job-hunter-team#installation"
            className="group rounded-xl border border-slate-200 bg-white p-6 transition hover:border-slate-400 hover:shadow-md"
          >
            <div className="mb-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
              cold path
            </div>
            <h3 className="mb-2 text-lg font-bold text-slate-900">
              🛠️ Self-host & contribute data{" "}
              <span className="text-slate-500 transition group-hover:translate-x-1">→</span>
            </h3>
            <p className="text-sm text-slate-600">
              Install JHT locally or on your own VPS, run it on your job hunt, share what worked /
              what didn&apos;t as a PR against{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">docs/about/RESULTS.md</code>.
            </p>
          </a>
        </div>
      </div>
    </section>
  )
}
