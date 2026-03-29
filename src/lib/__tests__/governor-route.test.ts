import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const fetchMock = vi.fn()
const config = {
  governorUrl: 'http://governor.test',
}

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/config', () => ({
  config,
}))

describe('GET /api/governor/[...path]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({ user: { id: 1, role: 'viewer', workspace_id: 1 } })
    config.governorUrl = 'http://governor.test'
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the auth error when requireRole fails', async () => {
    requireRole.mockReturnValue({ error: 'Authentication required', status: 401 })

    const { GET } = await import('@/app/api/governor/[...path]/route')
    const request = new NextRequest('http://localhost/api/governor/status')
    const response = await GET(request, { params: Promise.resolve({ path: ['status'] }) })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes through successful upstream JSON status and body', async () => {
    const payload = { ok: true, count: 2, items: ['a', 'b'] }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const { GET } = await import('@/app/api/governor/[...path]/route')
    const request = new NextRequest('http://localhost/api/governor/runs/list?limit=10')
    const response = await GET(request, { params: Promise.resolve({ path: ['runs', 'list'] }) })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://governor.test/runs/list?limit=10',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    )
  })

  it('returns upstream status and error wrapper for non-OK JSON responses', async () => {
    fetchMock.mockResolvedValue(
      new Response('upstream exploded', {
        status: 502,
      }),
    )

    const { GET } = await import('@/app/api/governor/[...path]/route')
    const request = new NextRequest('http://localhost/api/governor/health')
    const response = await GET(request, { params: Promise.resolve({ path: ['health'] }) })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: 'Governor returned 502',
      detail: 'upstream exploded',
    })
  })

  it('proxies SSE events with event-stream headers and status 200', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: ping\n\n'))
        controller.close()
      },
    })
    fetchMock.mockResolvedValue(new Response(stream, { status: 500 }))

    const { GET } = await import('@/app/api/governor/[...path]/route')
    const request = new NextRequest('http://localhost/api/governor/events')
    const response = await GET(request, { params: Promise.resolve({ path: ['events'] }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('connection')).toBe('keep-alive')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://governor.test/events',
      expect.objectContaining({
        headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      }),
    )
  })

  it('returns 499 when upstream fetch aborts', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    fetchMock.mockRejectedValue(abortError)

    const { GET } = await import('@/app/api/governor/[...path]/route')
    const request = new NextRequest('http://localhost/api/governor/runs')
    const response = await GET(request, { params: Promise.resolve({ path: ['runs'] }) })

    expect(response.status).toBe(499)
  })

  it('returns 503 with detail when upstream fetch fails generically', async () => {
    fetchMock.mockRejectedValue(new Error('dial tcp ECONNREFUSED'))

    const { GET } = await import('@/app/api/governor/[...path]/route')
    const request = new NextRequest('http://localhost/api/governor/runs')
    const response = await GET(request, { params: Promise.resolve({ path: ['runs'] }) })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Governor unavailable',
      detail: 'Error: dial tcp ECONNREFUSED',
    })
  })
})
