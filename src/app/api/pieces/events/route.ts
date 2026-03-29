import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'
import { normalizePiecesEvent } from '@/lib/pieces-ui'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') ?? 50)))
    const { workstreamEvents } = getPiecesApi()

    const snapshot = await workstreamEvents.workstreamEventsSnapshot(
      {},
      { signal: AbortSignal.timeout(5_000) }
    )
    const events = (snapshot.iterable ?? [])
      .map(normalizePiecesEvent)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)

    return NextResponse.json({ events, total: snapshot.iterable?.length ?? events.length })
  } catch (err) {
    // Workstream events snapshot can be very large; timeout is expected on large installations.
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    if (!isTimeout) logger.error({ err }, 'GET /api/pieces/events error')
    return NextResponse.json({ events: [], total: 0, partial: true })
  }
}