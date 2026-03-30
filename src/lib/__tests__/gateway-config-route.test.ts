import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const mutationLimiter = vi.fn()
const logAuditEvent = vi.fn()
const callOpenClawGateway = vi.fn()
const fetchMock = vi.fn()

const config = {
  gatewayHost: '127.0.0.1',
  gatewayPort: 18789,
  openclawConfigPath: '',
}

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/config', () => ({
  config,
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter,
}))

vi.mock('@/lib/db', () => ({
  logAuditEvent,
}))

vi.mock('@/lib/gateway-runtime', () => ({
  getDetectedGatewayToken: vi.fn(() => ''),
}))

vi.mock('@/lib/openclaw-gateway', () => ({
  callOpenClawGateway,
}))

vi.mock('@/lib/validation', () => ({
  validateBody: vi.fn(),
  gatewayConfigUpdateSchema: {},
}))

describe('PUT /api/gateway-config?action=apply', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRole.mockReturnValue({ user: { id: 1, username: 'admin', role: 'admin' } })
    mutationLimiter.mockReturnValue(null)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies config through gateway RPC when available', async () => {
    callOpenClawGateway.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === 'config.get') {
        return { hash: 'abc123', raw: '{ gateway: { port: 18789 } }' }
      }
      if (method === 'config.apply') {
        expect(params).toEqual({
          raw: '{ gateway: { port: 18789 } }',
          baseHash: 'abc123',
        })
        return { ok: true, restart: { ok: true } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const { PUT } = await import('@/app/api/gateway-config/route')
    const request = new NextRequest('http://localhost/api/gateway-config?action=apply', {
      method: 'PUT',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, restart: { ok: true } })
    expect(callOpenClawGateway).toHaveBeenCalledTimes(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to legacy HTTP apply endpoint when RPC path fails', async () => {
    callOpenClawGateway.mockRejectedValue(new Error('unknown method: config.get'))
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ applied: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { PUT } = await import('@/app/api/gateway-config/route')
    const request = new NextRequest('http://localhost/api/gateway-config?action=apply', {
      method: 'PUT',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })

    const response = await PUT(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, applied: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18789/api/config/apply',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
