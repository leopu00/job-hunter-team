import type { CoverageCell } from "./types"

type Props = {
  coverage: CoverageCell[]
}

const STATUS_BADGE: Record<CoverageCell["status"], { emoji: string; label: string; cls: string }> = {
  done: { emoji: "✅", label: "Done", cls: "bg-emerald-100 text-emerald-700" },
  in_progress: { emoji: "🟡", label: "In progress", cls: "bg-amber-100 text-amber-700" },
  open: { emoji: "⬜", label: "Open", cls: "bg-slate-100 text-slate-500" },
}

export function CoverageMatrix({ coverage }: Props) {
  const done = coverage.filter((c) => c.status === "done").length
  const total = coverage.length

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-slate-900">🎯 Coverage matrix</h3>
        <span className="text-xs font-medium text-slate-500">
          {done}/{total} filled · pre-launch target 8/{total}
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Persona × provider cells we want to validate before public launch. Open cells are where we
        need external beta testers.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Persona</th>
              <th className="py-2 pr-3 font-medium">Provider tier</th>
              <th className="py-2 pr-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => {
              const badge = STATUS_BADGE[c.status]
              return (
                <tr key={c.cell_number} className="border-b border-slate-100">
                  <td className="py-2 pr-3 text-slate-400">#{c.cell_number}</td>
                  <td className="py-2 pr-3 text-slate-800">{c.persona_label}</td>
                  <td className="py-2 pr-3 text-slate-600">{c.provider_label}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                    >
                      {badge.emoji} {badge.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
