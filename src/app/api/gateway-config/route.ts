import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { validateBody, gatewayConfigUpdateSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { runOpenClaw } from '@/lib/command'

function getConfigPath(): string | null {
  return config.openclawConfigPath || null
}

function gatewayUrl(path: string): string {
  return `http://${config.gatewayHost}:${config.gatewayPort}${path}`
}

function gatewayHeaders(): Record<string, string> {
  const token = getDetectedGatewayToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

function computeHash(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * GET /api/gateway-config - Read the gateway configuration
 * GET /api/gateway-config?action=schema - Get the config JSON schema
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action')

  if (action === 'schema') {
    return getSchema()
  }

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  try {
    const { readFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const hash = computeHash(raw)

    // Redact sensitive fields for display
    const redacted = redactSensitive(JSON.parse(JSON.stringify(parsed)))

    return NextResponse.json({
      path: configPath,
      config: redacted,
      raw_size: raw.length,
      hash,
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return NextResponse.json({ error: 'Config file not found', path: configPath }, { status: 404 })
    }
    return NextResponse.json({ error: `Failed to read config: ${err.message}` }, { status: 500 })
  }
}

async function getSchema(): Promise<NextResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(gatewayUrl('/api/config/schema'), {
      signal: controller.signal,
      headers: gatewayHeaders(),
    })
    clearTimeout(timeout)
    if (!res.ok) {
      return NextResponse.json(
        { error: `Gateway returned ${res.status}` },
        { status: 502 },
      )
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch (err: any) {
    clearTimeout(timeout)
    return NextResponse.json(
      { error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' },
      { status: 502 },
    )
  }
}

/**
 * PUT /api/gateway-config - Update specific config fields
 * PUT /api/gateway-config?action=apply - Hot-apply config via gateway RPC
 * PUT /api/gateway-config?action=update - System update via gateway RPC
 *
 * Body: { updates: { "path.to.key": value, ... }, hash?: string }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const action = request.nextUrl.searchParams.get('action')

  if (action === 'apply') {
    return applyConfig(request, auth)
  }

  if (action === 'update') {
    return updateSystem(request, auth)
  }

  const configPath = getConfigPath()
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  const result = await validateBody(request, gatewayConfigUpdateSchema)
  if ('error' in result) return result.error
  const body = result.data

  // Block writes to sensitive paths
  const blockedPaths = ['gateway.auth.password', 'gateway.auth.secret']
  for (const key of Object.keys(body.updates)) {
    if (blockedPaths.some(bp => key.startsWith(bp))) {
      return NextResponse.json({ error: `Cannot modify protected field: ${key}` }, { status: 403 })
    }
  }

  try {
    const { readFile, writeFile } = require('fs/promises')
    const raw = await readFile(configPath, 'utf-8')

    // Hash-based concurrency check
    const clientHash = (body as any).hash
    if (clientHash) {
      const serverHash = computeHash(raw)
      if (clientHash !== serverHash) {
        return NextResponse.json(
          { error: 'Config has been modified by another user. Please reload and try again.', code: 'CONFLICT' },
          { status: 409 },
        )
      }
    }

    const parsed = JSON.parse(raw)

    for (const dotPath of Object.keys(body.updates)) {
      const [rootKey] = dotPath.split('.')
      if (!rootKey || !(rootKey in parsed)) {
        return NextResponse.json(
          { error: `Unknown config root: ${rootKey || dotPath}` },
          { status: 400 },
        )
      }
    }

    // Apply updates via dot-notation
    const appliedKeys: string[] = []
    for (const [dotPath, value] of Object.entries(body.updates)) {
      setNestedValue(parsed, dotPath, value)
      appliedKeys.push(dotPath)
    }

    // Write back with pretty formatting
    const newRaw = JSON.stringify(parsed, null, 2) + '\n'
    await writeFile(configPath, newRaw)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'gateway_config_update',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { updated_keys: appliedKeys },
      ip_address: ipAddress,
    })

    return NextResponse.json({
      updated: appliedKeys,
      count: appliedKeys.length,
      hash: computeHash(newRaw),
    })
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to update config: ${err.message}` }, { status: 500 })
  }
}

async function applyConfig(request: NextRequest, auth: any): Promise<NextResponse> {
  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  const configPath = getConfigPath()

  const localRaw = await readConfigRaw(configPath)
  const rpcResult = await tryApplyConfigViaRpc(localRaw)
  if (rpcResult.ok) {
    logAuditEvent({
      action: 'gateway_config_apply',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { status: 200, transport: 'rpc' },
      ip_address: ipAddress,
    })
    return NextResponse.json({ ok: true, ...rpcResult.data })
  }

  const legacyResult = await tryApplyConfigViaLegacyHttp()
  if (legacyResult.ok) {
    logAuditEvent({
      action: 'gateway_config_apply',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { status: 200, transport: 'legacy_http', path: legacyResult.path },
      ip_address: ipAddress,
    })
    return NextResponse.json({ ok: true, ...legacyResult.data })
  }

  const cliRestartResult = await tryApplyViaCliRestart()
  if (cliRestartResult.ok) {
    logAuditEvent({
      action: 'gateway_config_apply',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { status: 200, transport: 'cli_restart' },
      ip_address: ipAddress,
    })
    return NextResponse.json({
      ok: true,
      mode: 'cli_restart',
      message: 'Gateway restarted as fallback after apply call failures',
      output: cliRestartResult.stdout,
    })
  }

  logAuditEvent({
    action: 'gateway_config_apply',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { status: 502, transport: 'rpc+legacy_http' },
    ip_address: ipAddress,
  })
  return NextResponse.json(
    { error: `Apply failed: ${rpcResult.error}; ${legacyResult.error}; ${cliRestartResult.error}` },
    { status: 502 },
  )
}

async function readConfigRaw(configPath: string | null): Promise<string | null> {
  if (!configPath) return null
  try {
    const { readFile } = require('fs/promises')
    return await readFile(configPath, 'utf-8')
  } catch {
    return null
  }
}

type RpcApplyResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

async function tryApplyConfigViaRpc(_localRaw: string | null): Promise<RpcApplyResult> {
  type ConfigGetResult = { raw?: string; hash?: string }

  let rpcGetError = ''
  let baseHash: string | undefined
  let effectiveRaw: string | null = null

  try {
    const current = await callOpenClawGateway<ConfigGetResult>('config.get', {}, 10_000)
    if (typeof current?.hash === 'string' && current.hash.length > 0) {
      baseHash = current.hash
    }
    if (typeof current?.raw === 'string' && current.raw.length > 0) {
      // Prefer gateway-provided raw so config.apply receives the exact format
      // and content expected by the running gateway instance.
      effectiveRaw = current.raw
    }
  } catch (err) {
    rpcGetError = stringifyError(err)
  }

  if (!effectiveRaw) {
    return {
      ok: false,
      error: rpcGetError ? `RPC config.get failed: ${rpcGetError}` : 'RPC apply failed: config payload unavailable',
    }
  }

  try {
    const compactRaw = compactJsonIfPossible(effectiveRaw)
    const params: Record<string, unknown> = { raw: compactRaw }
    if (baseHash) params.baseHash = baseHash
    const applied = await callOpenClawGateway<unknown>('config.apply', params, 15_000)
    if (applied && typeof applied === 'object') {
      return { ok: true, data: applied as Record<string, unknown> }
    }
    return { ok: true, data: { result: applied } }
  } catch (err) {
    return { ok: false, error: `RPC config.apply failed: ${stringifyError(err)}` }
  }
}

type LegacyHttpApplyResult =
  | { ok: true; path: string; data: Record<string, unknown> }
  | { ok: false; error: string }

async function tryApplyConfigViaLegacyHttp(): Promise<LegacyHttpApplyResult> {
  const paths = ['/api/config/apply', '/api/config/reload']
  let lastError = 'Gateway unreachable'

  for (const path of paths) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(gatewayUrl(path), {
        method: 'POST',
        signal: controller.signal,
        headers: gatewayHeaders(),
      })

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        return { ok: true, path, data }
      }

      const text = await res.text().catch(() => '')
      if (res.status === 404) {
        lastError = `Legacy apply endpoint not found (${path})`
      } else {
        lastError = `Apply failed (${res.status}): ${text}`
        break
      }
    } catch (err: any) {
      lastError = err?.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable'
      break
    } finally {
      clearTimeout(timeout)
    }
  }

  return { ok: false, error: lastError }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function compactJsonIfPossible(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw))
  } catch {
    return raw
  }
}

type CliRestartResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string }

async function tryApplyViaCliRestart(): Promise<CliRestartResult> {
  try {
    const result = await runOpenClaw(['gateway', 'restart'], { timeoutMs: 20_000 })
    return { ok: true, stdout: `${result.stdout || ''}${result.stderr || ''}`.trim() }
  } catch (err) {
    return { ok: false, error: `CLI restart failed: ${stringifyError(err)}` }
  }
}

async function updateSystem(request: NextRequest, auth: any): Promise<NextResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(gatewayUrl('/api/config/update'), {
      method: 'POST',
      signal: controller.signal,
      headers: gatewayHeaders(),
    })
    clearTimeout(timeout)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'gateway_config_system_update',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { status: res.status },
      ip_address: ipAddress,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `Update failed (${res.status}): ${text}` },
        { status: 502 },
      )
    }
    const data = await res.json().catch(() => ({}))
    return NextResponse.json({ ok: true, ...data })
  } catch (err: any) {
    clearTimeout(timeout)
    return NextResponse.json(
      { error: err.name === 'AbortError' ? 'Gateway timeout' : 'Gateway unreachable' },
      { status: 502 },
    )
  }
}

/** Set a value in a nested object using dot-notation path */
function setNestedValue(obj: any, path: string, value: any) {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined) current[keys[i]] = {}
    current = current[keys[i]]
  }
  current[keys[keys.length - 1]] = value
}

/** Redact sensitive values for display */
function redactSensitive(obj: any, parentKey = ''): any {
  if (typeof obj !== 'object' || obj === null) return obj

  const sensitiveKeys = ['password', 'secret', 'token', 'api_key', 'apiKey']

  for (const key of Object.keys(obj)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      if (typeof obj[key] === 'string' && obj[key].length > 0) {
        obj[key] = '--------'
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      redactSensitive(obj[key], key)
    }
  }

  return obj
}
