'use client'

import React from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type KbdSize = 'sm' | 'md' | 'lg'

export interface KbdProps {
  children: React.ReactNode
  size?:    KbdSize
  className?: string
}

export interface KbdComboProps {
  keys:       string[]
  size?:      KbdSize
  separator?: string   // default '+'
  className?: string
}

// ── Size maps ──────────────────────────────────────────────────────────────

const SIZE_CLS: Record<KbdSize, string> = {
  sm: 'text-[8px] px-1 py-0.5 min-w-[16px]',
  md: 'text-[10px] px-1.5 py-0.5 min-w-[20px]',
  lg: 'text-[11px] px-2 py-1 min-w-[24px]',
}

// ── Key aliases ────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  ctrl:    'Ctrl',
  control: 'Ctrl',
  cmd:     '⌘',
  command: '⌘',
  meta:    '⌘',
  alt:     'Alt',
  option:  '⌥',
  shift:   '⇧',
  enter:   '↵',
  return:  '↵',
  tab:     '⇥',
  escape:  'Esc',
  esc:     'Esc',
  up:      '↑',
  down:    '↓',
  left:    '←',
  right:   '→',
  delete:  '⌫',
  backspace: '⌫',
  space:   '␣',
}

function resolveKey(k: string): string {
  return ALIASES[k.toLowerCase()] ?? k
}

// ── Kbd ────────────────────────────────────────────────────────────────────

export function Kbd({ children, size = 'md', className = '' }: KbdProps) {
  return (
    <kbd
      className={`inline-flex items-center justify-center rounded font-mono font-semibold leading-none select-none ${SIZE_CLS[size]} ${className}`}
      style={{
        background:   'var(--color-row)',
        color:        'var(--color-muted)',
        border:       '1px solid var(--color-border)',
        borderBottom: '2px solid var(--color-border)',
        boxShadow:    '0 1px 0 var(--color-border)',
      }}
    >
      {children}
    </kbd>
  )
}

// ── KbdCombo ───────────────────────────────────────────────────────────────

export function KbdCombo({ keys, size = 'md', separator = '+', className = '' }: KbdComboProps) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {keys.map((k, i) => (
        <React.Fragment key={i}>
          <Kbd size={size}>{resolveKey(k)}</Kbd>
          {i < keys.length - 1 && (
            <span className="text-[9px] select-none" style={{ color: 'var(--color-dim)', margin: '0 1px' }}>
              {separator}
            </span>
          )}
        </React.Fragment>
      ))}
    </span>
  )
}

// ── ShortcutRow — label + shortcut allineati ───────────────────────────────

export interface ShortcutRowProps {
  label:     string
  keys:      string[]
  size?:     KbdSize
}

export function ShortcutRow({ label, keys, size = 'sm' }: ShortcutRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <KbdCombo keys={keys} size={size} />
    </div>
  )
}

// ── ShortcutList — lista shortcuts in un panel ─────────────────────────────

export interface ShortcutItem { label: string; keys: string[] }

export function ShortcutList({ items, title }: { items: ShortcutItem[]; title?: string }) {
  return (
    <div className="flex flex-col">
      {title && (
        <p className="text-[9px] font-semibold tracking-widest uppercase mb-2"
          style={{ color: 'var(--color-dim)' }}>
          {title}
        </p>
      )}
      <div className="flex flex-col divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {items.map((item, i) => (
          <ShortcutRow key={i} label={item.label} keys={item.keys} />
        ))}
      </div>
    </div>
  )
}

// ── Preset shortcuts ───────────────────────────────────────────────────────

export const SHORTCUTS = {
  save:          ['Ctrl', 'S'],
  undo:          ['Ctrl', 'Z'],
  redo:          ['Ctrl', 'Shift', 'Z'],
  copy:          ['Ctrl', 'C'],
  paste:         ['Ctrl', 'V'],
  cut:           ['Ctrl', 'X'],
  selectAll:     ['Ctrl', 'A'],
  find:          ['Ctrl', 'F'],
  commandPalette: ['Ctrl', 'K'],
  newItem:       ['Ctrl', 'N'],
  close:         ['Esc'],
  submit:        ['Ctrl', 'Enter'],
} as const
