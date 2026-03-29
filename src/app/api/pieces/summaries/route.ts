import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'
import { normalizePiecesSummary } from '@/lib/pieces-ui'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim()
    const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') ?? 10)))
    const { workstreamSummaries } = getPiecesApi()

    const result = await workstreamSummaries.workstreamSummariesSnapshot({})

    const iterable = result.iterable ?? []
    const summaries = iterable
      .map(normalizePiecesSummary)
      .filter((summary) => {
        if (!query) return true
        const haystack = [
          summary.name,
          summary.preview,
          summary.id,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(query.toLowerCase())
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)

    return NextResponse.json({ summaries, total: summaries.length, query: query ?? undefined })
  } catch (err) {
    logger.error({ err }, 'GET /api/pieces/summaries error')
    return NextResponse.json({ error: 'Failed to fetch workstream summaries' }, { status: 500 })
  }
}