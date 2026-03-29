import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'
import { normalizePiecesAsset } from '@/lib/pieces-ui'
import {
  ApplicationNameEnum,
  PlatformEnum,
  PrivacyEnum,
  SeedTypeEnum,
} from '@pieces.app/pieces-os-client'
import type { ClassificationSpecificEnum } from '@pieces.app/pieces-os-client'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const { assets } = getPiecesApi()

    if (query) {
      const results = await assets.searchAssets({ query })
      const normalized = (results.iterable ?? []).map(normalizePiecesAsset)
      return NextResponse.json({ assets: normalized, total: normalized.length, query })
    }

    const snapshot = await assets.assetsSnapshot({})
    const items = (snapshot.iterable ?? []).map(normalizePiecesAsset)
    return NextResponse.json({ assets: items, total: items.length })
  } catch (err) {
    logger.error({ err }, 'GET /api/pieces/assets error')
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { content, name, language } = body as {
      content: string
      name?: string
      language?: string
    }

    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    const { assets } = getPiecesApi()

    const classification: { specific?: ClassificationSpecificEnum } = {}
    if (language) {
      classification.specific = language as ClassificationSpecificEnum
    }

    const created = await assets.assetsCreateNewAsset({
      seed: {
        asset: {
          application: {
            id: 'DEFAULT',
            name: ApplicationNameEnum.OpenSource,
            version: '1.0.0',
            platform: PlatformEnum.Web,
            onboarded: false,
            privacy: PrivacyEnum.Open,
          },
          format: {
            fragment: {
              string: { raw: content },
            },
            classification: Object.keys(classification).length > 0 ? classification : undefined,
          },
          metadata: name ? { name } : undefined,
        },
        type: SeedTypeEnum.SeededAsset,
      },
    })

    return NextResponse.json({ asset: created }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/pieces/assets error')
    return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 })
  }
}
