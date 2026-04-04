import { NextResponse } from 'next/server'
import * as fs from 'node:fs'
import * as path from 'node:path'

export const dynamic = 'force-dynamic'

const CHANGELOG_PATH = path.join(process.cwd(), '..', 'CHANGELOG.md')

export type VersionType = 'major' | 'minor' | 'patch'

export interface ChangeCategory {
  name: string
  entries: string[]
}

export interface Release {
  version: string
  date: string
  type: VersionType
  categories: ChangeCategory[]
  totalEntries: number
}

function versionType(v: string): VersionType {
  const [major, minor, patch] = v.split('.').map(Number)
  if (patch === 0 && minor === 0) return 'major'
  if (patch === 0) return 'minor'
  return 'patch'
}

/**
 * Parsa CHANGELOG.md — formato Keep a Changelog:
 * ## [x.y.z] — YYYY-MM-DD
 * ### Categoria
 * - entry
 */
function parseChangelog(raw: string): Release[] {
  const releases: Release[] = []
  const releaseBlocks = raw.split(/^## /m).slice(1)

  for (const block of releaseBlocks) {
    const lines = block.split('\n')
    const header = lines[0] ?? ''

    // Parsa "[1.0.0] — 2026-04-04" oppure "1.0.0 — 2026-04-04"
    const vMatch = header.match(/\[?(\d+\.\d+\.\d+)\]?/)
    const dMatch = header.match(/(\d{4}-\d{2}-\d{2})/)
    if (!vMatch) continue

    const version = vMatch[1]!
    const date    = dMatch?.[1] ?? ''
    const categories: ChangeCategory[] = []
    let current: ChangeCategory | null = null

    for (const line of lines.slice(1)) {
      const catMatch = line.match(/^### (.+)/)
      if (catMatch) {
        if (current) categories.push(current)
        current = { name: catMatch[1]!.trim(), entries: [] }
        continue
      }
      const entryMatch = line.match(/^- (.+)/)
      if (entryMatch && current) {
        current.entries.push(entryMatch[1]!.trim())
      }
    }
    if (current) categories.push(current)

    const totalEntries = categories.reduce((s, c) => s + c.entries.length, 0)
    releases.push({ version: version!, date, type: versionType(version!), categories, totalEntries })
  }

  return releases
}

/** GET — releases parsate da CHANGELOG.md */
export async function GET() {
  try {
    const raw = fs.readFileSync(CHANGELOG_PATH, 'utf-8')
    const releases = parseChangelog(raw)
    return NextResponse.json({ releases, total: releases.length })
  } catch {
    return NextResponse.json({ releases: [], total: 0, error: 'CHANGELOG.md non trovato' })
  }
}
