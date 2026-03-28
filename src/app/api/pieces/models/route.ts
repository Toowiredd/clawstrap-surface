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
    const { models } = getPiecesApi()
    const snapshot = await models.modelsSnapshot()
    const items = snapshot.iterable ?? []
    return NextResponse.json({ models: items, total: items.length })
  } catch (err) {
    logger.error({ err }, 'GET /api/pieces/models error')
    return NextResponse.json({ error: 'Failed to fetch models' }, { status: 500 })
  }
}
