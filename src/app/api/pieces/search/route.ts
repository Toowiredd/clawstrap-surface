import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'
import { answerText, normalizePiecesAsset } from '@/lib/pieces-ui'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const mode = searchParams.get('mode') ?? 'hybrid'

    if (!query) {
      return NextResponse.json({ error: 'q query parameter is required' }, { status: 400 })
    }

    const { qgpt, search } = getPiecesApi()

    const [ftsResult, neuralResult, relevanceResult] = await Promise.all([
      mode === 'full_text' || mode === 'hybrid'
        ? search.fullTextSearch({ query })
        : Promise.resolve({ iterable: [] }),
      mode === 'neural' || mode === 'hybrid'
        ? search.neuralCodeSearch({ query })
        : Promise.resolve({ iterable: [] }),
      mode === 'relevance' || mode === 'hybrid'
        ? qgpt.relevance({
            qGPTRelevanceInput: {
              query,
              options: { question: true },
            },
          })
        : Promise.resolve(null),
    ])

    const merged = new Map<string, ReturnType<typeof normalizePiecesAsset>>()

    for (const asset of [...(ftsResult.iterable ?? []), ...(neuralResult.iterable ?? [])]) {
      const normalized = normalizePiecesAsset(asset)
      merged.set(normalized.id, normalized)
    }

    return NextResponse.json({
      query,
      mode,
      answer: relevanceResult ? answerText(relevanceResult) : undefined,
      answers: relevanceResult?.answer?.answers?.iterable ?? [],
      relevant: relevanceResult?.relevant?.iterable ?? [],
      assets: Array.from(merged.values()),
    })
  } catch (err) {
    logger.error({ err }, 'GET /api/pieces/search error')
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
