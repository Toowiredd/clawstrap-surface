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
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')

    if (!query) {
      return NextResponse.json({ error: 'q query parameter is required' }, { status: 400 })
    }

    const { qgpt } = getPiecesApi()

    const result = await qgpt.relevance({
      qGPTRelevanceInput: {
        query,
        options: { question: true },
      },
    })

    return NextResponse.json({
      query,
      answers: result.answer?.answers?.iterable ?? [],
      relevant: result.relevant?.iterable ?? [],
    })
  } catch (err) {
    logger.error({ err }, 'GET /api/pieces/search error')
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
