'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type DiffStat = { files: number; insertions: number; deletions: number }
type Branch = { name: string; lastCommit: string; lastCommitDate: string; author: string; ahead: number; behind: number; diffStat: DiffStat; isCurrent: boolean }

function AheadBehind({ ahead, behind }: { ahead: number; behind: number }) {
  if (ahead === 0 && behind === 0) return <span className="text-[10px] text-[var(--color-dim)]">in sync</span>
  return (
    <div className="flex gap-1.5">
      {ahead > 0 && <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--color-green)' }}>+{ahead}</span>}
      {behind > 0 && <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--color-red)' }}>-{behind}</span>}
    </div>
  )
}

function DiffBar({ stat }: { stat: DiffStat }) {
  if (stat.files === 0) return <span className="text-[9px] text-[var(--color-dim)]">-</span>
  return (
    <span className="text-[9px] font-mono">
      <span className="text-[var(--color-muted)]">{stat.files}f</span>
      {stat.insertions > 0 && <span className="text-[var(--color-green)] ml-1">+{stat.insertions}</span>}
      {stat.deletions > 0 && <span className="text-[var(--color-red)] ml-1">-{stat.deletions}</span>}
    </span>
  )
}

function BranchRow({ b }: { b: Branch }) {
  const isMain = b.name === 'main' || b.name === 'master'
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="w-36 flex-shrink-0 flex items-center gap-2">
        <span className="text-[11px] font-mono font-semibold" style={{ color: isMain ? 'var(--color-yellow)' : b.isCurrent ? 'var(--color-green)' : 'var(--color-bright)' }}>{b.name}</span>
        {b.isCurrent && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--color-green)' }} />}
      </div>
      <div className="flex-1 min-w-0 truncate">
        <span className="text-[10px] text-[var(--color-muted)]">{b.lastCommit}</span>
      </div>
      <span className="w-16 text-[9px] text-[var(--color-dim)] flex-shrink-0 text-right">{b.lastCommitDate}</span>
      <span className="w-16 text-[10px] text-[var(--color-dim)] flex-shrink-0 font-mono">{b.author}</span>
      <div className="w-16 flex-shrink-0 text-right"><AheadBehind ahead={b.ahead} behind={b.behind} /></div>
      <div className="w-28 flex-shrink-0 text-right"><DiffBar stat={b.diffStat} /></div>
    </div>
  )
}

export default function GitPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [totalAhead, setTotalAhead] = useState(0)

  const fetchGit = useCallback(async () => {
    const res = await fetch('/api/git').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setBranches(data.branches ?? [])
    setCurrentBranch(data.currentBranch ?? '')
    setTotalAhead(data.totalCommitsAhead ?? 0)
  }, [])

  useEffect(() => { fetchGit() }, [fetchGit])

  const activeBranches = branches.filter(b => b.ahead > 0 || b.name === 'main' || b.name === 'master')

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Git</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Git</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {branches.length} branch · {activeBranches.length} attivi · {totalAhead} commit ahead totali · branch corrente: <span className="font-mono text-[var(--color-green)]">{currentBranch}</span>
        </p>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-4 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="w-36 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">BRANCH</span>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">ULTIMO COMMIT</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">QUANDO</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">AUTORE</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">+/-</span>
          <span className="w-28 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">DIFF</span>
        </div>
        {branches.length === 0
          ? <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun branch trovato.</p></div>
          : branches.map(b => <BranchRow key={b.name} b={b} />)
        }
      </div>
    </div>
  )
}
