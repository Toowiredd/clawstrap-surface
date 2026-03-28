import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter, mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getPiecesApi } from '@/lib/pieces'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const { conversation } = getPiecesApi()

    const conv = await conversation.conversationGetSpecificConversation({
      conversation: id,
    })

    const messages = await conversation.conversationSpecificConversationMessages({
      conversation: id,
    })

    return NextResponse.json({
      conversation: conv,
      messages: messages.iterable ?? [],
    })
  } catch (err) {
    logger.error({ err }, 'GET /api/pieces/conversations/[id] error')
    return NextResponse.json({ error: 'Failed to fetch conversation' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const body = await request.json()
    const { message } = body as { message: string }

    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const { qgpt } = getPiecesApi()

    // Use QGPT relevance with question:true for copilot-style responses
    const result = await qgpt.relevance({
      qGPTRelevanceInput: {
        query: message,
        options: { question: true },
      },
    })

    return NextResponse.json({ result })
  } catch (err) {
    logger.error({ err }, 'POST /api/pieces/conversations/[id] error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const { conversations } = getPiecesApi()

    await conversations.conversationsDeleteSpecificConversation({
      conversation: id,
    })

    return NextResponse.json({ success: true, deleted: id })
  } catch (err) {
    logger.error({ err }, 'DELETE /api/pieces/conversations/[id] error')
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 })
  }
}
