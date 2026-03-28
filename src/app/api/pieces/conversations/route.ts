import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'
import { ConversationTypeEnum } from '@pieces.app/pieces-os-client'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { conversations } = getPiecesApi()
    const snapshot = await conversations.conversationsSnapshot({})
    const items = snapshot.iterable ?? []
    return NextResponse.json({ conversations: items, total: items.length })
  } catch (err) {
    logger.error({ err }, 'GET /api/pieces/conversations error')
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const body = await request.json()
    const { name } = body as { name?: string }

    const { conversations } = getPiecesApi()
    const created = await conversations.conversationsCreateSpecificConversation({
      seededConversation: {
        name: name ?? undefined,
        type: ConversationTypeEnum.Copilot,
      },
    })

    return NextResponse.json({ conversation: created }, { status: 201 })
  } catch (err) {
    logger.error({ err }, 'POST /api/pieces/conversations error')
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}
