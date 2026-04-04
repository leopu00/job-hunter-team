'use client'

import { useMemo, useRef, useState } from 'react'

export interface TreeNode {
  id: string
  label: string
  icon?: string
  children?: TreeNode[]
}

export interface TreeViewProps {
  nodes: TreeNode[]
  expandedIds?: Set<string>
  onToggle?: (id: string) => void
  selectedId?: string
  onSelect?: (node: TreeNode) => void
  searchable?: boolean
  /** Indentazione per livello in px */
  indent?: number
}

/* ── Filtro ricorsivo ── */
function filterNodes(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes
  return nodes.reduce<TreeNode[]>((acc, node) => {
    const filteredChildren = node.children ? filterNodes(node.children, query) : []
    const match = node.label.toLowerCase().includes(query.toLowerCase())
    if (match || filteredChildren.length > 0) acc.push({ ...node, children: filteredChildren })
    return acc
  }, [])
}

/* ── Flatten per keyboard nav ── */
function flatVisible(nodes: TreeNode[], expanded: Set<string>): string[] {
  const result: string[] = []
  const walk = (ns: TreeNode[]) => ns.forEach(n => {
    result.push(n.id)
    if (n.children?.length && expanded.has(n.id)) walk(n.children)
  })
  walk(nodes)
  return result
}

/* ── Nodo singolo ── */
function TreeNodeRow({ node, depth, expanded, selected, onToggle, onSelect, focusedId, setFocused, indent }: {
  node: TreeNode; depth: number; expanded: Set<string>; selected?: string
  onToggle: (id: string) => void; onSelect: (n: TreeNode) => void
  focusedId: string | null; setFocused: (id: string) => void; indent: number
}) {
  const hasChildren = !!node.children?.length
  const isExpanded  = expanded.has(node.id)
  const isSelected  = selected === node.id
  const isFocused   = focusedId === node.id

  const icon = node.icon ?? (hasChildren ? (isExpanded ? '📂' : '📁') : '📄')

  return (
    <>
      <div
        tabIndex={isFocused ? 0 : -1}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={() => { if (hasChildren) onToggle(node.id); onSelect(node); setFocused(node.id) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingLeft: depth * indent + 8, paddingRight: 8,
          paddingTop: 5, paddingBottom: 5,
          borderRadius: 6, cursor: 'pointer',
          background: isSelected ? 'rgba(0,232,122,0.10)' : isFocused ? 'var(--color-row)' : 'transparent',
          border: isSelected ? '1px solid rgba(0,232,122,0.25)' : '1px solid transparent',
          transition: 'background 0.1s',
          outline: 'none',
        }}
        onFocus={() => setFocused(node.id)}>
        {/* Chevron */}
        <span style={{
          fontSize: 8, width: 10, flexShrink: 0, color: 'var(--color-dim)',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s', display: 'inline-block',
          visibility: hasChildren ? 'visible' : 'hidden',
        }}>▶</span>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 11, color: isSelected ? 'var(--color-green)' : 'var(--color-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.label}
        </span>
        {hasChildren && (
          <span style={{ fontSize: 9, color: 'var(--color-dim)' }}>{node.children!.length}</span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && node.children!.map(child => (
        <TreeNodeRow key={child.id} node={child} depth={depth + 1} expanded={expanded}
          selected={selected} onToggle={onToggle} onSelect={onSelect}
          focusedId={focusedId} setFocused={setFocused} indent={indent} />
      ))}
    </>
  )
}

/* ── TreeView ── */
export default function TreeView({
  nodes, expandedIds, onToggle, selectedId, onSelect,
  searchable = false, indent = 16,
}: TreeViewProps) {
  const [internalExpanded, setInternalExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch]   = useState('')
  const [focusedId, setFocused] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const expanded = expandedIds ?? internalExpanded
  const toggle   = onToggle ?? ((id: string) => setInternalExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }))
  const select   = onSelect ?? (() => {})

  const filtered = useMemo(() => filterNodes(nodes, search), [nodes, search])
  // Auto-expand tutti se c'è ricerca
  const effectiveExpanded = search
    ? new Set(filtered.flatMap(function walk(n): string[] { return [n.id, ...(n.children?.flatMap(walk) ?? [])] }))
    : expanded

  const flat = useMemo(() => flatVisible(filtered, effectiveExpanded), [filtered, effectiveExpanded])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!focusedId) return
    const idx = flat.indexOf(focusedId)
    if (e.key === 'ArrowDown') { e.preventDefault(); if (idx < flat.length - 1) setFocused(flat[idx + 1]) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx > 0) setFocused(flat[idx - 1]) }
    if (e.key === 'ArrowRight') { e.preventDefault(); toggle(focusedId) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); toggle(focusedId) }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const n = flat[idx]; if (n) select({ id: n, label: '', ...nodes.find(x => x.id === n) }) }
  }

  return (
    <div ref={containerRef} role="tree" onKeyDown={handleKeyDown} style={{ outline: 'none' }}>
      {searchable && (
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca..."
          style={{ width: '100%', marginBottom: 8, padding: '5px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-row)', color: 'var(--color-bright)', outline: 'none', boxSizing: 'border-box' }} />
      )}
      {filtered.length === 0
        ? <div style={{ fontSize: 11, color: 'var(--color-dim)', padding: '12px 8px' }}>Nessun risultato</div>
        : filtered.map(node => (
          <TreeNodeRow key={node.id} node={node} depth={0} expanded={effectiveExpanded}
            selected={selectedId} onToggle={toggle} onSelect={select}
            focusedId={focusedId} setFocused={setFocused} indent={indent} />
        ))}
    </div>
  )
}
