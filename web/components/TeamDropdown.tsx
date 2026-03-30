'use client'

import Link from 'next/link'
import { useRef, useState, useEffect } from 'react'

const AGENTS = [
  { label: 'Il Capitano',   href: '/capitano',  color: '#ff9100', emoji: '👨‍✈️' },
  { label: 'Lo Scout',      href: '/scout',     color: '#2196f3', emoji: '🕵️' },
  { label: "L'Analista",    href: '/analista',  color: '#00e676', emoji: '👨‍🔬' },
  { label: 'Lo Scorer',     href: '/scorer',    color: '#b388ff', emoji: '👨‍💻' },
  { label: 'Lo Scrittore',  href: '/scrittore', color: '#ffd600', emoji: '👨‍🏫' },
  { label: 'Il Critico',    href: '/critico',   color: '#f44336', emoji: '👨‍⚖️' },
  { label: "L'Assistente",  href: '/assistente',color: '#00e676', emoji: '🤖' },
]

export default function TeamDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="px-3 py-1.5 text-[11px] font-semibold tracking-widest uppercase hover:bg-[var(--color-card)] rounded transition-colors no-underline flex items-center gap-1"
        style={{
          color: '#ffc107',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Team
        <span
          style={{
            display: 'inline-block',
            fontSize: '8px',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
            marginLeft: '2px',
            opacity: 0.7,
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            minWidth: '180px',
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          {AGENTS.map(agent => (
            <Link
              key={agent.href}
              href={agent.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 no-underline transition-colors hover:bg-[var(--color-card)]"
              style={{ color: 'var(--color-muted)' }}
            >
              <span style={{ fontSize: '14px', lineHeight: 1 }}>{agent.emoji}</span>
              <span
                className="text-[11px] font-semibold tracking-wide"
                style={{ color: agent.color }}
              >
                {agent.label}
              </span>
            </Link>
          ))}

          <div style={{ borderTop: '1px solid var(--color-border)', margin: '2px 0' }} />

          <Link
            href="/team"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 no-underline transition-colors hover:bg-[var(--color-card)]"
          >
            <span style={{ fontSize: '14px', lineHeight: 1 }}>🗂️</span>
            <span
              className="text-[11px] font-semibold tracking-wide"
              style={{ color: '#ffc107' }}
            >
              Panoramica Team
            </span>
          </Link>
        </div>
      )}
    </div>
  )
}
