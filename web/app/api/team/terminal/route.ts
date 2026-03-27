import { NextRequest, NextResponse } from 'next/server'
import { runBash } from '@/lib/shell'

const VALID_SESSION = /^[A-Z][A-Z0-9_-]*$/i

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get('session') ?? ''
  if (!VALID_SESSION.test(session)) {
    return NextResponse.json({ error: 'invalid session' }, { status: 400 })
  }

  try {
    const { stdout } = await runBash(
      `tmux capture-pane -t "${session}" -p -S -200 2>/dev/null || echo ""`
    )
    return NextResponse.json({ output: stdout })
  } catch {
    return NextResponse.json({ output: '' })
  }
}
