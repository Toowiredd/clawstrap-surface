import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config as appConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/governor/[...path]
 *
 * Transparent proxy to the clawstrap-governor HTTP server.
 * Handles both regular JSON REST and SSE streaming (/events).
 *
 * Auth: viewer or higher required (surface auth gate).
 * Governor itself has no auth — the surface acts as the auth boundary.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const resolvedParams = await params
  const pathStr = resolvedParams.path.join('/')
  const { search } = new URL(request.url)
  const upstreamUrl = `${appConfig.governorUrl}/${pathStr}${search}`

  const isSSE =
    pathStr === 'events' || request.headers.get('accept')?.includes('text/event-stream')

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: isSSE
        ? { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }
        : { Accept: 'application/json' },
      // Signal passthrough: abort upstream when client disconnects
      signal: request.signal,
    })

    if (!upstream.ok && !isSSE) {
      const text = await upstream.text()
      return NextResponse.json(
        { error: `Governor returned ${upstream.status}`, detail: text },
        { status: upstream.status },
      )
    }

    if (isSSE) {
      // Pipe the governor SSE stream directly to the client
      return new NextResponse(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    const data: unknown = await upstream.json()
    return NextResponse.json(data, { status: upstream.status })
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort) return new NextResponse(null, { status: 499 })
    return NextResponse.json(
      { error: 'Governor unavailable', detail: String(err) },
      { status: 503 },
    )
  }
}
