/* @vitest-environment node */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRole = vi.fn()
const runCommand = vi.fn()
const runOpenClaw = vi.fn()
const runClawdbot = vi.fn()
const getDatabase = vi.fn()
const registerMcAsDashboard = vi.fn()

let runtimeProcessRows: Array<{ ProcessId: number; Name: string; CommandLine: string }> = []
let gatewayProcessStdout = ''

vi.mock('node:net', () => {
  class MockSocket {
    private listeners = new Map<string, () => void>()
    setTimeout() {}
    once(event: string, cb: () => void) {
      this.listeners.set(event, cb)
      return this
    }
    removeAllListeners() {
      this.listeners.clear()
      return this
    }
    destroy() {}
    connect() {
      const onError = this.listeners.get('error')
      if (onError) setTimeout(onError, 0)
      return this
    }
  }

  return {
    default: { Socket: MockSocket },
    Socket: MockSocket,
  }
})

vi.mock('@/lib/auth', () => ({
  requireRole,
}))

vi.mock('@/lib/command', () => ({
  runCommand,
  runOpenClaw,
  runClawdbot,
}))

vi.mock('@/lib/config', () => ({
  config: {
    gatewayHost: '127.0.0.1',
    gatewayPort: 18789,
    openclawStateDir: '',
    openclawConfigPath: '',
    claudeHome: 'C:\\Users\\test\\.claude',
    dbPath: 'C:\\tmp\\clawstrap.db',
  },
}))

vi.mock('@/lib/db', () => ({
  getDatabase,
}))

vi.mock('@/lib/sessions', () => ({
  getAllGatewaySessions: vi.fn(() => []),
  getAgentLiveStatuses: vi.fn(() => new Map()),
}))

vi.mock('@/lib/models', () => ({
  MODEL_CATALOG: [],
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/provider-subscriptions', () => ({
  detectProviderSubscriptions: vi.fn(() => ({ active: {} })),
  getPrimarySubscription: vi.fn(() => null),
}))

vi.mock('@/lib/version', () => ({
  APP_VERSION: 'test-version',
}))

vi.mock('@/lib/hermes-sessions', () => ({
  isHermesInstalled: vi.fn(() => false),
  scanHermesSessions: vi.fn(() => []),
}))

vi.mock('@/lib/gateway-runtime', () => ({
  registerMcAsDashboard,
}))

describe('GET /api/status gateway and process pressure consistency', () => {
  const originalEnv = { ...process.env }
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv, NODE_ENV: 'development' }
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    requireRole.mockReturnValue({ user: { workspace_id: 1, role: 'viewer' } })
    runOpenClaw.mockResolvedValue({ stdout: 'openclaw 1.0.0' })
    runClawdbot.mockResolvedValue({ stdout: 'clawdbot 1.0.0' })
    gatewayProcessStdout = JSON.stringify([{ ProcessId: 4242, CommandLine: 'openclaw gateway --port 18789' }])
    runtimeProcessRows = []
    getDatabase.mockReturnValue({
      prepare: (sql: string) => ({
        get: () => {
          if (sql === 'SELECT 1') return { ok: 1 }
          if (sql.includes("name='gateways'")) return { name: 'gateways' }
          if (sql.includes('FROM claude_sessions')) return { c: 0 }
          return undefined
        },
        all: () => {
          if (sql.includes('SELECT host, port FROM gateways')) {
            return [{ host: '127.0.0.1', port: 18789 }]
          }
          return []
        },
      }),
    })
    runCommand.mockImplementation(async (command: string, args: string[]) => {
      const joined = args.join(' ')
      if (command === 'powershell' && joined.includes("openclaw.+gateway")) {
        return { stdout: gatewayProcessStdout }
      }
      if (
        command === 'powershell.exe' &&
        joined.includes('Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress')
      ) {
        return { stdout: JSON.stringify(runtimeProcessRows) }
      }
      if (command === 'df') {
        return { stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev 100G 10G 90G 10% /' }
      }
      if (command === 'free') {
        return { stdout: '              total        used        free      shared  buff/cache   available\nMem:      8000000000 1000000000 5000000000 0 2000000000 6000000000' }
      }
      return { stdout: '' }
    })
  })

  afterEach(() => {
    platformSpy.mockRestore()
    process.env = { ...originalEnv }
  })

  it('keeps gateway health and capabilities aligned when process is present but endpoint probes fail', async () => {
    const { GET } = await import('@/app/api/status/route')

    const capabilitiesRes = await GET(new NextRequest('http://localhost/api/status?action=capabilities'))
    const capabilities = await capabilitiesRes.json()
    const healthRes = await GET(new NextRequest('http://localhost/api/status?action=health'))
    const health = await healthRes.json()

    const gatewayCheck = health.checks.find((check: any) => check.name === 'Gateway')
    expect(capabilities.gateway).toBe(false)
    expect(gatewayCheck?.status).toBe('unhealthy')
    expect(gatewayCheck?.message).toContain('not reachable')
    expect(gatewayCheck?.detail?.gatewayLikelyStaleProcess).toBe(true)
    expect(gatewayCheck?.detail?.running).toBe(true)
    expect(gatewayCheck?.detail?.port_listening).toBe(false)
  })

  it('ignores transient probe commands when evaluating runtime process pressure', async () => {
    runtimeProcessRows = [
      {
        ProcessId: 101,
        Name: 'node.exe',
        CommandLine: 'node C:\\Users\\LEWIS\\clawstrap\\clawstrap-surface\\scripts\\mc-cli.cjs probe status',
      },
      {
        ProcessId: 102,
        Name: 'powershell.exe',
        CommandLine: 'powershell.exe -NoProfile -Command Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
      },
      {
        ProcessId: 103,
        Name: 'node.exe',
        CommandLine: 'node C:\\Users\\LEWIS\\clawstrap\\clawstrap-surface\\node_modules\\next\\dist\\bin\\next dev',
      },
    ]

    const { GET } = await import('@/app/api/status/route')
    const healthRes = await GET(new NextRequest('http://localhost/api/status?action=health'))
    const health = await healthRes.json()
    const runtimeCheck = health.checks.find((check: any) => check.name === 'Runtime Process Load')

    expect(runtimeCheck?.status).toBe('healthy')
    expect(runtimeCheck?.detail?.detail?.nodeProcesses).toBe(1)
    expect(runtimeCheck?.detail?.detail?.totalRelevantProcesses).toBe(1)
  })
})
