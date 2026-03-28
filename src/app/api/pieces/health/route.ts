import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { wellKnown } = getPiecesApi()

    const [health, version] = await Promise.all([
      wellKnown.getWellKnownHealth().catch(() => null),
      wellKnown.getWellKnownVersion().catch(() => null),
    ])

    if (health === null && version === null) {
      return NextResponse.json({ status: 'unreachable' })
    }

    return NextResponse.json({
      status: 'ok',
      health: health ?? undefined,
      version: version ?? undefined,
    })
  } catch (err) {
    logger.error({ err }, 'Pieces health check failed')
    return NextResponse.json({ status: 'unreachable' })
  }
}
