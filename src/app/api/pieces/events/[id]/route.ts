import { NextRequest, NextResponse } from 'next/server'
import { ResponseError } from '@pieces.app/pieces-os-client'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'
import { normalizePiecesEvent } from '@/lib/pieces-ui'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  const { id } = await params

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 })
  }

  try {
    const { workstreamEvent } = getPiecesApi()
    const event = await workstreamEvent.workstreamEventsSpecificWorkstreamEventSnapshot(
      { workstreamEvent: id },
      { signal: AbortSignal.timeout(8_000) }
    )
    return NextResponse.json({ event: normalizePiecesEvent(event), raw: event })
  } catch (err) {
    if (err instanceof ResponseError && err.response.status === 404) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    logger.error({ err, id }, 'GET /api/pieces/events/[id] error')
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 })
  }
}
