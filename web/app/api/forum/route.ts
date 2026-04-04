import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

const FORUM_PATH = path.join(os.homedir(), '.jht', 'forum.log')
const LINE_RE    = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[(\w+)\] (.+)$/

type Message = { id: number; ts: string; author: string; content: string; mentions: string[] }

function parseLine(line: string, id: number): Message | null {
  const m = line.match(LINE_RE)
  if (!m) return null
  const content  = m[3].trim()
  const mentions = (content.match(/@\w+/g) ?? []).map(s => s.slice(1))
  return { id, ts: m[1], author: m[2], content, mentions }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit  = Math.min(Number(searchParams.get('limit') ?? 200), 1000)
  const author = searchParams.get('author') ?? ''

  if (!fs.existsSync(FORUM_PATH)) {
    return NextResponse.json({ messages: [], total: 0, authors: [] })
  }

  let lines: string[]
  try {
    const raw = fs.readFileSync(FORUM_PATH, 'utf-8')
    lines = raw.split('\n').filter(l => l.trim())
  } catch {
    return NextResponse.json({ error: 'Errore lettura forum' }, { status: 500 })
  }

  const all = lines
    .map((l, i) => parseLine(l, i))
    .filter((m): m is Message => m !== null)

  const authors = [...new Set(all.map(m => m.author))].sort()

  const filtered = author
    ? all.filter(m => m.author.toLowerCase() === author.toLowerCase())
    : all

  const messages = filtered.slice(-limit)
  return NextResponse.json({ messages, total: filtered.length, authors })
}
