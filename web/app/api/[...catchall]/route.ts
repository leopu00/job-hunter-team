import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const handler = (req: NextRequest) =>
  NextResponse.json(
    { error: 'Not Found', path: req.nextUrl.pathname, method: req.method, ts: Date.now() },
    { status: 404 }
  )

export const GET     = handler
export const POST    = handler
export const PUT     = handler
export const PATCH   = handler
export const DELETE  = handler
export const OPTIONS = handler
