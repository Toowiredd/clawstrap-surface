import { NextRequest, NextResponse } from 'next/server'
import net from 'node:net'
import os from 'node:os'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { runCommand, runOpenClaw, runClawdbot } from '@/lib/command'
import { config } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { getAllGatewaySessions, getAgentLiveStatuses } from '@/lib/sessions'
import { requireRole } from '@/lib/auth'
import { MODEL_CATALOG } from '@/lib/models'
import { logger } from '@/lib/logger'
import { detectProviderSubscriptions, getPrimarySubscription } from '@/lib/provider-subscriptions'
import { APP_VERSION } from '@/lib/version'
import { isHermesInstalled, scanHermesSessions } from '@/lib/hermes-sessions'
import { registerMcAsDashboard } from '@/lib/gateway-runtime'

export async function GET(request: NextRequest) {
  // Docker/Kubernetes health probes must work without auth/cookies.
  const preAction = new URL(request.url).searchParams.get('action') || 'overview'
  if (preAction === 'health') {
    const health = await performHealthCheck()
    return NextResponse.json(health)
  }

  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'overview'

    if (action === 'overview') {
      const status = await getSystemStatus(auth.user.workspace_id ?? 1)
      return NextResponse.json(status)
    }

    if (action === 'dashboard') {
      const data = await getDashboardData(auth.user.workspace_id ?? 1)
      return NextResponse.json(data)
    }

    if (action === 'gateway') {
      const gatewayStatus = await getGatewayStatus()
      return NextResponse.json(gatewayStatus)
    }

    if (action === 'models') {
      const models = await getAvailableModels()
      return NextResponse.json({ models })
    }

    if (action === 'health') {
      const health = await performHealthCheck()
      return NextResponse.json(health)
    }

    if (action === 'capabilities') {
      const capabilities = await getCapabilities(request)
      return NextResponse.json(capabilities)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Status API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Aggregate all dashboard data in a single request.
 * Combines system health, DB stats, audit summary, and recent activity.
 */
async function getDashboardData(workspaceId: number) {
  const [system, dbStats] = await Promise.all([
    getSystemStatus(workspaceId),
    getDbStats(workspaceId),
  ])

  return { ...system, db: dbStats }
}

async function getMemorySnapshot() {
  const totalBytes = os.totalmem()
  let availableBytes = os.freemem()

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await runCommand('vm_stat', [], { timeoutMs: 3000 })
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/i)
      const pageSize = parseInt(pageSizeMatch?.[1] || '4096', 10)
      const pageLabels = ['Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable']

      const availablePages = pageLabels.reduce((sum, label) => {
        const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const match = stdout.match(new RegExp(`${escapedLabel}:\\s+([\\d.]+)`, 'i'))
        const pages = parseInt((match?.[1] || '0').replace(/\./g, ''), 10)
        return sum + (Number.isFinite(pages) ? pages : 0)
      }, 0)

      const vmAvailableBytes = availablePages * pageSize
      if (vmAvailableBytes > 0) {
        availableBytes = Math.min(vmAvailableBytes, totalBytes)
      }
    } catch {
      // Fall back to os.freemem()
    }
  } else {
    try {
      const { stdout } = await runCommand('free', ['-b'], { timeoutMs: 3000 })
      const memLine = stdout.split('\n').find((line) => line.startsWith('Mem:'))
      if (memLine) {
        const parts = memLine.trim().split(/\s+/)
        const available = parseInt(parts[6] || parts[3] || '0', 10)
        if (Number.isFinite(available) && available > 0) {
          availableBytes = Math.min(available, totalBytes)
        }
      }
    } catch {
      // Fall back to os.freemem()
    }
  }

  const usedBytes = Math.max(0, totalBytes - availableBytes)
  const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usagePercent,
  }
}

interface AuthProfilesSnapshot {
  stateDir: string
  authProfilesPath: string
  exists: boolean
  profileCount: number
  anthropicProfiles: number
  readError?: string
}

interface OpenClawProfileStateSignal {
  status: 'ok' | 'warning'
  mismatchDetected: boolean
  reason: string
  evidence: {
    envOpenclawHome: string | null
    envOpenclawStateDir: string | null
    configuredStateDir: string | null
    configuredConfigPath: string | null
    cliDerivedStateDirFromHome: string | null
    configuredAuthProfiles: AuthProfilesSnapshot | null
    cliDerivedAuthProfiles: AuthProfilesSnapshot | null
  }
  actions: string[]
}

interface RuntimeProcessRow {
  pid: string
  name: string
  command: string
}

interface RuntimeProcessPressureSignal {
  status: 'healthy' | 'warning' | 'critical'
  message: string
  detail: {
    mode: 'development' | 'production'
    totalRelevantProcesses: number
    nodeProcesses: number
    totalSystemNodeProcesses: number
    gatewayProcesses: number
    surfaceProcesses: number
    governorProcesses: number
    warningThresholds: {
      totalRelevantProcesses: number
      nodeProcesses: number
      gatewayProcesses: number
    }
    criticalThresholds: {
      totalRelevantProcesses: number
      nodeProcesses: number
      gatewayProcesses: number
    }
    sampleCommands: Array<{ pid: string; name: string; command: string }>
  }
  actions: string[]
}

function isTransientRuntimeProbe(row: RuntimeProcessRow): boolean {
  const commandLower = row.command.toLowerCase()
  const nameLower = row.name.toLowerCase()
  const isPowerShellProbe =
    /\b(powershell|pwsh)(\.exe)?\b/.test(nameLower) &&
    (
      commandLower.includes('get-ciminstance win32_process') ||
      commandLower.includes('get-nettcpconnection') ||
      commandLower.includes('convertto-json')
    )
  const isMissionControlCliProbe =
    /\bnode(\.exe)?\b/.test(commandLower) &&
    /scripts[\\/](mc-cli|mc-tui|mc-mcp-server)\.cjs/.test(commandLower)

  return isPowerShellProbe || isMissionControlCliProbe
}

function normalizePathForCompare(inputPath: string): string {
  const resolved = path.resolve(inputPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function snapshotAuthProfiles(stateDir: string): AuthProfilesSnapshot {
  const authProfilesPath = path.join(stateDir, 'agents', 'main', 'agent', 'auth-profiles.json')
  const snapshot: AuthProfilesSnapshot = {
    stateDir,
    authProfilesPath,
    exists: existsSync(authProfilesPath),
    profileCount: 0,
    anthropicProfiles: 0,
  }

  if (!snapshot.exists) return snapshot

  try {
    const parsed = JSON.parse(readFileSync(authProfilesPath, 'utf-8')) as {
      profiles?: Record<string, { provider?: string } | undefined>
    }
    const profiles =
      parsed && typeof parsed === 'object' && parsed.profiles && typeof parsed.profiles === 'object'
        ? parsed.profiles
        : {}
    snapshot.profileCount = Object.keys(profiles).length
    snapshot.anthropicProfiles = Object.entries(profiles).reduce((count, [name, profile]) => {
      const providerFromRecord = typeof profile?.provider === 'string' ? profile.provider.trim().toLowerCase() : ''
      const providerFromName = name.includes(':') ? name.split(':')[0].trim().toLowerCase() : ''
      const provider = providerFromRecord || providerFromName
      return provider === 'anthropic' ? count + 1 : count
    }, 0)
  } catch (error: any) {
    snapshot.readError = error?.message || 'Failed to parse auth-profiles.json'
  }

  return snapshot
}

function detectOpenClawProfileStateMismatch(): OpenClawProfileStateSignal {
  const envOpenclawHome = String(process.env.OPENCLAW_HOME || process.env.CLAWDBOT_HOME || '').trim()
  const envOpenclawStateDir = String(process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR || '').trim()
  const configuredStateDir = String(config.openclawStateDir || '').trim()
  const configuredConfigPath = String(config.openclawConfigPath || '').trim()
  const cliDerivedStateDirFromHome = envOpenclawHome ? path.join(envOpenclawHome, '.openclaw') : ''

  const normalizedConfiguredStateDir = configuredStateDir ? normalizePathForCompare(configuredStateDir) : ''
  const normalizedCliDerivedStateDir = cliDerivedStateDirFromHome
    ? normalizePathForCompare(cliDerivedStateDirFromHome)
    : ''

  const openclawHomeLooksLikeStateDir =
    Boolean(envOpenclawHome) && path.basename(normalizePathForCompare(envOpenclawHome)) === '.openclaw'
  const homeDerivedDiffersFromConfigured =
    Boolean(normalizedConfiguredStateDir) &&
    Boolean(normalizedCliDerivedStateDir) &&
    normalizedConfiguredStateDir !== normalizedCliDerivedStateDir

  const configuredAuthProfiles = configuredStateDir ? snapshotAuthProfiles(configuredStateDir) : null
  const cliDerivedAuthProfiles =
    homeDerivedDiffersFromConfigured && cliDerivedStateDirFromHome
      ? snapshotAuthProfiles(cliDerivedStateDirFromHome)
      : null

  const anthropicMissingInCliDerived =
    (configuredAuthProfiles?.anthropicProfiles || 0) > 0 &&
    (cliDerivedAuthProfiles?.anthropicProfiles || 0) === 0
  const mismatchDetected =
    !envOpenclawStateDir &&
    homeDerivedDiffersFromConfigured &&
    openclawHomeLooksLikeStateDir

  const reason = mismatchDetected
    ? anthropicMissingInCliDerived
      ? 'OPENCLAW_HOME points at a state-dir path, so active OpenClaw CLI resolves a nested state-dir and misses Anthropic auth profiles.'
      : 'OPENCLAW_HOME points at a state-dir path, so active OpenClaw CLI resolves a nested state-dir that differs from Mission Control state-dir.'
    : 'OpenClaw profile/state-dir wiring appears consistent.'

  const actions = mismatchDetected
    ? [
        `Set OPENCLAW_STATE_DIR to ${configuredStateDir || '<state-dir>'} and OPENCLAW_CONFIG_PATH to ${configuredConfigPath || '<state-dir>/openclaw.json'}.`,
        `Or set OPENCLAW_HOME to the parent home directory (${configuredStateDir ? path.dirname(configuredStateDir) : '<home-dir>'}), not the .openclaw state-dir itself.`,
        'Re-run `openclaw gateway install --force` from the corrected environment profile so service and CLI use the same state-dir.',
      ]
    : []

  return {
    status: mismatchDetected ? 'warning' : 'ok',
    mismatchDetected,
    reason,
    evidence: {
      envOpenclawHome: envOpenclawHome || null,
      envOpenclawStateDir: envOpenclawStateDir || null,
      configuredStateDir: configuredStateDir || null,
      configuredConfigPath: configuredConfigPath || null,
      cliDerivedStateDirFromHome: cliDerivedStateDirFromHome || null,
      configuredAuthProfiles,
      cliDerivedAuthProfiles,
    },
    actions,
  }
}

function truncateCommand(command: string, maxLength = 180): string {
  if (command.length <= maxLength) return command
  return `${command.slice(0, maxLength - 3)}...`
}

async function getRuntimeProcessRows(): Promise<RuntimeProcessRow[]> {
  if (process.platform === 'win32') {
    const processCmd =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"
    const { stdout } = await runCommand('powershell.exe', ['-NoProfile', '-Command', processCmd], { timeoutMs: 5000 })
    const parsed = JSON.parse(stdout || '[]')
    const entries = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
    return entries
      .map((row: any) => {
        const pid = row?.ProcessId != null ? String(row.ProcessId).trim() : ''
        const name = String(row?.Name || '').trim()
        const command = String(row?.CommandLine || row?.Name || '').trim()
        return { pid, name, command }
      })
      .filter((row: RuntimeProcessRow) => Boolean(row.pid) && Boolean(row.command))
  }

  const { stdout } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], { timeoutMs: 3000 })
  return stdout
    .split('\n')
    .filter(line => line.trim())
    .filter(line => !line.trim().toLowerCase().startsWith('pid '))
    .map(line => {
      const parts = line.trim().split(/\s+/)
      const pid = String(parts[0] || '').trim()
      const name = String(parts[1] || '').trim()
      const command = String(parts.slice(2).join(' ') || parts[1] || '').trim()
      return { pid, name, command }
    })
    .filter(row => Boolean(row.pid) && Boolean(row.command))
}

async function detectRuntimeProcessPressure(): Promise<RuntimeProcessPressureSignal> {
  const isDev = process.env.NODE_ENV !== 'production'
  const rows = await getRuntimeProcessRows()
  const cwdLower = process.cwd().toLowerCase()
  const stableRows = rows.filter((row) => !isTransientRuntimeProbe(row))

  const totalSystemNodeProcesses = stableRows.filter((row) =>
    /\bnode(\.exe)?\b/i.test(row.command) || /\bnode(\.exe)?\b/i.test(row.name)
  ).length

  const relevant = stableRows.filter((row) => {
    const commandLower = row.command.toLowerCase()
    const isWorkspaceProcess = commandLower.includes(cwdLower)
    const isMissionControlOrGatewayProcess =
      /openclaw|clawdbot|clawstrap-surface|clawstrap-governor|\bnext(?:-server)?\b/.test(commandLower)
    return (
      isWorkspaceProcess ||
      isMissionControlOrGatewayProcess
    )
  })

  const nodeProcesses = relevant.filter((row) =>
    /\bnode(\.exe)?\b/i.test(row.command) || /\bnode(\.exe)?\b/i.test(row.name)
  ).length
  const gatewayProcesses = relevant.filter((row) =>
    /[\\/]openclaw[\\/]dist[\\/]index\.js\s+gateway(?:\s|$)/i.test(row.command) ||
    /\bopenclaw(?:\.cmd|\.exe)?\b.*\bgateway\b.*--port/i.test(row.command) ||
    /\bclawdbot(?:\.cmd|\.exe)?\b.*\bgateway\b/i.test(row.command)
  ).length
  const surfaceProcesses = relevant.filter((row) =>
    /clawstrap-surface|\bnext(?:-server)?\b|next dev/i.test(row.command)
  ).length
  const governorProcesses = relevant.filter((row) =>
    /clawstrap-governor/i.test(row.command)
  ).length
  const totalRelevantProcesses = relevant.length

  const warningThresholds = {
    totalRelevantProcesses: isDev ? 12 : 8,
    nodeProcesses: isDev ? 8 : 5,
    gatewayProcesses: 2,
  }
  const criticalThresholds = {
    totalRelevantProcesses: isDev ? 20 : 12,
    nodeProcesses: isDev ? 12 : 8,
    gatewayProcesses: isDev ? 3 : 2,
  }

  let status: RuntimeProcessPressureSignal['status'] = 'healthy'
  const reasons: string[] = []
  if (
    totalRelevantProcesses >= criticalThresholds.totalRelevantProcesses ||
    nodeProcesses >= criticalThresholds.nodeProcesses ||
    gatewayProcesses >= criticalThresholds.gatewayProcesses
  ) {
    status = 'critical'
    if (totalRelevantProcesses >= criticalThresholds.totalRelevantProcesses) {
      reasons.push(`relevant process count ${totalRelevantProcesses} >= ${criticalThresholds.totalRelevantProcesses}`)
    }
    if (nodeProcesses >= criticalThresholds.nodeProcesses) {
      reasons.push(`node process count ${nodeProcesses} >= ${criticalThresholds.nodeProcesses}`)
    }
    if (gatewayProcesses >= criticalThresholds.gatewayProcesses) {
      reasons.push(`gateway process count ${gatewayProcesses} >= ${criticalThresholds.gatewayProcesses}`)
    }
  } else if (
    totalRelevantProcesses >= warningThresholds.totalRelevantProcesses ||
    nodeProcesses >= warningThresholds.nodeProcesses ||
    gatewayProcesses >= warningThresholds.gatewayProcesses
  ) {
    status = 'warning'
    if (totalRelevantProcesses >= warningThresholds.totalRelevantProcesses) {
      reasons.push(`relevant process count ${totalRelevantProcesses} >= ${warningThresholds.totalRelevantProcesses}`)
    }
    if (nodeProcesses >= warningThresholds.nodeProcesses) {
      reasons.push(`node process count ${nodeProcesses} >= ${warningThresholds.nodeProcesses}`)
    }
    if (gatewayProcesses >= warningThresholds.gatewayProcesses) {
      reasons.push(`gateway process count ${gatewayProcesses} >= ${warningThresholds.gatewayProcesses}`)
    }
  }

  const message =
    status === 'healthy'
      ? `Relevant=${totalRelevantProcesses}, Node=${nodeProcesses}, Gateway=${gatewayProcesses}`
      : `Runtime process pressure: ${reasons.join('; ')}`

  const actions: string[] = []
  if (status !== 'healthy') {
    actions.push('Restart Mission Control dev server and verify process counts drop after one boot cycle.')
  }
  if (gatewayProcesses >= warningThresholds.gatewayProcesses) {
    actions.push('Check for duplicate gateway instances with `openclaw gateway status` and terminate orphan gateway processes before reinstalling service.')
  }
  if (nodeProcesses >= warningThresholds.nodeProcesses) {
    actions.push('Inspect long-running pollers/listeners for duplicate initialization after module reload.')
  }

  return {
    status,
    message,
    detail: {
      mode: isDev ? 'development' : 'production',
      totalRelevantProcesses,
      nodeProcesses,
      totalSystemNodeProcesses,
      gatewayProcesses,
      surfaceProcesses,
      governorProcesses,
      warningThresholds,
      criticalThresholds,
      sampleCommands: relevant.slice(0, 8).map((row) => ({
        pid: row.pid,
        name: row.name,
        command: truncateCommand(row.command),
      })),
    },
    actions,
  }
}

function getDbStats(workspaceId: number) {
  try {
    const db = getDatabase()
    const now = Math.floor(Date.now() / 1000)
    const day = now - 86400
    const week = now - 7 * 86400

    // Task breakdown
    const taskStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM tasks WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>
    const tasksByStatus: Record<string, number> = {}
    let totalTasks = 0
    for (const row of taskStats) {
      tasksByStatus[row.status] = row.count
      totalTasks += row.count
    }

    // Agent breakdown
    const agentStats = db.prepare(`
      SELECT status, COUNT(*) as count FROM agents WHERE workspace_id = ? GROUP BY status
    `).all(workspaceId) as Array<{ status: string; count: number }>
    const agentsByStatus: Record<string, number> = {}
    let totalAgents = 0
    for (const row of agentStats) {
      agentsByStatus[row.status] = row.count
      totalAgents += row.count
    }

    // Audit events (24h / 7d)
    const auditDay = (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(day) as any).c
    const auditWeek = (db.prepare('SELECT COUNT(*) as c FROM audit_log WHERE created_at > ?').get(week) as any).c

    // Security events (login failures in last 24h)
    const loginFailures = (db.prepare(
      "SELECT COUNT(*) as c FROM audit_log WHERE action = 'login_failed' AND created_at > ?"
    ).get(day) as any).c

    // Activities (24h)
    const activityDay = (
      db.prepare('SELECT COUNT(*) as c FROM activities WHERE created_at > ? AND workspace_id = ?').get(day, workspaceId) as any
    ).c

    // Notifications (unread)
    const unreadNotifs = (
      db.prepare('SELECT COUNT(*) as c FROM notifications WHERE read_at IS NULL AND workspace_id = ?').get(workspaceId) as any
    ).c

    // Pipeline runs (active + recent)
    let pipelineActive = 0
    let pipelineRecent = 0
    try {
      pipelineActive = (db.prepare("SELECT COUNT(*) as c FROM pipeline_runs WHERE status = 'running'").get() as any).c
      pipelineRecent = (db.prepare('SELECT COUNT(*) as c FROM pipeline_runs WHERE created_at > ?').get(day) as any).c
    } catch {
      // Pipeline tables may not exist yet
    }

    // Latest backup
    let latestBackup: { name: string; size: number; age_hours: number } | null = null
    try {
      const { readdirSync } = require('fs')
      const { join, dirname } = require('path')
      const backupDir = join(dirname(config.dbPath), 'backups')
      const files = readdirSync(backupDir)
        .filter((f: string) => f.endsWith('.db'))
        .map((f: string) => {
          const stat = statSync(join(backupDir, f))
          return { name: f, size: stat.size, mtime: stat.mtimeMs }
        })
        .sort((a: any, b: any) => b.mtime - a.mtime)
      if (files.length > 0) {
        latestBackup = {
          name: files[0].name,
          size: files[0].size,
          age_hours: Math.round((Date.now() - files[0].mtime) / 3600000),
        }
      }
    } catch {
      // No backups dir
    }

    // DB file size
    let dbSizeBytes = 0
    try {
      dbSizeBytes = statSync(config.dbPath).size
    } catch {
      // ignore
    }

    // Webhook configs count
    let webhookCount = 0
    try {
      webhookCount = (db.prepare('SELECT COUNT(*) as c FROM webhooks').get() as any).c
    } catch {
      // table may not exist
    }

    return {
      tasks: { total: totalTasks, byStatus: tasksByStatus },
      agents: { total: totalAgents, byStatus: agentsByStatus },
      audit: { day: auditDay, week: auditWeek, loginFailures },
      activities: { day: activityDay },
      notifications: { unread: unreadNotifs },
      pipelines: { active: pipelineActive, recentDay: pipelineRecent },
      backup: latestBackup,
      dbSizeBytes,
      webhookCount,
    }
  } catch (err) {
    logger.error({ err }, 'getDbStats error')
    return null
  }
}

async function getSystemStatus(workspaceId: number) {
  const status: any = {
    timestamp: Date.now(),
    uptime: 0,
    memory: { total: 0, used: 0, available: 0 },
    disk: { total: 0, used: 0, available: 0 },
    sessions: { total: 0, active: 0 },
    processes: []
  }

  try {
    // System uptime (cross-platform)
    if (process.platform === 'darwin') {
      const { stdout } = await runCommand('sysctl', ['-n', 'kern.boottime'], {
        timeoutMs: 3000
      })
      // Output format: { sec = 1234567890, usec = 0 } ...
      const match = stdout.match(/sec\s*=\s*(\d+)/)
      if (match) {
        status.uptime = Date.now() - parseInt(match[1]) * 1000
      }
    } else if (process.platform === 'win32') {
      const { stdout } = await runCommand(
        'powershell.exe',
        ['-Command', '(Get-Date) - (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime | Select-Object -ExpandProperty TotalMilliseconds'],
        { timeoutMs: 5000 }
      )
      const ms = parseFloat(stdout.trim())
      if (!isNaN(ms)) {
        status.uptime = Math.round(ms)
      }
    } else {
      const { stdout } = await runCommand('uptime', ['-s'], {
        timeoutMs: 3000
      })
      const bootTime = new Date(stdout.trim())
      status.uptime = Date.now() - bootTime.getTime()
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting uptime')
  }

  try {
    // Memory info (cross-platform)
    const snapshot = await getMemorySnapshot()
    status.memory = {
      total: Math.round(snapshot.totalBytes / (1024 * 1024)),
      used: Math.round(snapshot.usedBytes / (1024 * 1024)),
      available: Math.round(snapshot.availableBytes / (1024 * 1024)),
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting memory info')
  }

  try {
    // Disk info
    const { stdout: diskOutput } = await runCommand('df', ['-h', '/'], {
      timeoutMs: 3000
    })
    const lastLine = diskOutput.trim().split('\n').pop() || ''
    // Parse from the right: df columns end with "Use% Mounted-on", so fixed positions from end
    // Handles filesystem names with spaces (e.g. "C:/Program Files/Git" on Windows)
    const diskParts = lastLine.trim().split(/\s+/)
    if (diskParts.length >= 5) {
      const len = diskParts.length
      status.disk = {
        total: diskParts[len - 5],
        used: diskParts[len - 4],
        available: diskParts[len - 3],
        usage: diskParts[len - 2]
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Error getting disk info')
  }

  try {
    // Runtime process summary (gateway + surface + governor), cross-platform.
    const processMap = new Map<string, { pid: string; command: string; roles: string[] }>()
    const upsertProcess = (pid: string, command?: string, role?: string) => {
      const normalizedPid = String(pid || '').trim()
      if (!normalizedPid) return

      const normalizedCommand = String(command || '').trim()
      const existing = processMap.get(normalizedPid)
      if (!existing) {
        processMap.set(normalizedPid, {
          pid: normalizedPid,
          command: normalizedCommand || 'unknown',
          roles: role ? [role] : [],
        })
        return
      }

      if (normalizedCommand && (existing.command === 'unknown' || existing.command.startsWith('listener:'))) {
        existing.command = normalizedCommand
      }
      if (role && !existing.roles.includes(role)) {
        existing.roles.push(role)
      }
    }

    if (process.platform === 'win32') {
      const listenerPidSet = new Set<string>()
      const listenerCmd =
        "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3000,3001 } | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress"
      const { stdout: listenerStdout } = await runCommand('powershell.exe', ['-NoProfile', '-Command', listenerCmd], {
        timeoutMs: 4000,
      })
      const listenerParsed = JSON.parse(listenerStdout || '[]')
      const listeners = Array.isArray(listenerParsed) ? listenerParsed : (listenerParsed ? [listenerParsed] : [])
      for (const row of listeners) {
        const pid = row?.OwningProcess != null ? String(row.OwningProcess) : ''
        const port = row?.LocalPort != null ? String(row.LocalPort) : ''
        if (!pid || !port) continue
        listenerPidSet.add(pid)
        const role = port === '3001' ? 'governor-listener' : port === '3000' ? 'surface-listener' : 'listener'
        upsertProcess(pid, `listener:${port}`, role)
      }

      const processCmd =
        "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"
      const { stdout } = await runCommand('powershell.exe', ['-NoProfile', '-Command', processCmd], { timeoutMs: 5000 })
      const parsed = JSON.parse(stdout || '[]')
      const entries = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
      for (const row of entries) {
        const pid = row?.ProcessId != null ? String(row.ProcessId) : ''
        const command = String(row?.CommandLine || '').trim()
        if (!pid || !command) continue
        if (listenerPidSet.has(pid) || /openclaw|clawdbot|clawstrap-surface|clawstrap-governor/i.test(command)) {
          upsertProcess(pid, command)
        }
      }
    } else {
      const { stdout: processOutput } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], { timeoutMs: 3000 })
      const parsedRows = processOutput.split('\n')
        .filter(line => line.trim())
        .filter(line => !line.trim().toLowerCase().startsWith('pid '))
        .map(line => {
          const parts = line.trim().split(/\s+/)
          return {
            pid: parts[0],
            command: parts.slice(2).join(' ')
          }
        })
        .filter((proc) => /clawdbot|openclaw|clawstrap-surface|clawstrap-governor/i.test(proc.command))
      for (const proc of parsedRows) {
        upsertProcess(proc.pid, proc.command)
      }
    }

    status.processes = Array.from(processMap.values()).map((row) => ({
      pid: row.pid,
      command: row.roles.length > 0 ? `${row.command} [${row.roles.join(', ')}]` : row.command,
    }))
  } catch (error) {
    logger.error({ err: error }, 'Error getting process info')
  }

  try {
    // Read sessions directly from agent session stores on disk
    const gatewaySessions = getAllGatewaySessions()
    status.sessions = {
      total: gatewaySessions.length,
      active: gatewaySessions.filter((s) => s.active).length,
    }

    // Sync agent statuses in DB from live session data
    try {
      const db = getDatabase()
      const liveStatuses = getAgentLiveStatuses()
      const now = Math.floor(Date.now() / 1000)
      // Match by: exact name, lowercase, or normalized (spaces→hyphens)
      const updateStmt = db.prepare(
        `UPDATE agents SET status = ?, last_seen = ?, updated_at = ?
         WHERE workspace_id = ?
           AND (LOWER(name) = LOWER(?)
           OR LOWER(REPLACE(name, ' ', '-')) = LOWER(?))`
      )
      for (const [agentName, info] of liveStatuses) {
        updateStmt.run(
          info.status,
          Math.floor(info.lastActivity / 1000),
          now,
          workspaceId,
          agentName,
          agentName
        )
      }
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Error syncing agent statuses')
    }
  } catch (error) {
    logger.error({ err: error }, 'Error reading session stores')
  }

  return status
}

async function getGatewayStatus() {
  const gatewayStatus: any = {
    running: false,
    port: config.gatewayPort,
    pid: null,
    uptime: 0,
    version: null,
    connections: 0
  }

  try {
    if (process.platform === 'win32') {
      const psCmd = "$p = Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -match 'openclaw.+gateway') -or ($_.CommandLine -match '\\\\gateway\\.cmd') }; if ($p) { $p | Select-Object ProcessId, CommandLine | ConvertTo-Json -Depth 3 -Compress }"
      const { stdout } = await runCommand('powershell', ['-NoProfile', '-Command', psCmd], {
        timeoutMs: 4000
      })
      if (stdout?.trim()) {
        const parsed = JSON.parse(stdout.trim())
        const first = Array.isArray(parsed) ? parsed[0] : parsed
        const pid = first?.ProcessId ? String(first.ProcessId) : null
        if (pid) {
          gatewayStatus.running = true
          gatewayStatus.pid = pid
        }
      }
    } else {
      const { stdout } = await runCommand('ps', ['-A', '-o', 'pid,comm,args'], {
        timeoutMs: 3000
      })
      const match = stdout
        .split('\n')
        .find((line) => /clawdbot-gateway|openclaw-gateway|openclaw.*gateway/i.test(line))
      if (match) {
        const parts = match.trim().split(/\s+/)
        gatewayStatus.running = true
        gatewayStatus.pid = parts[0]
      }
    }
  } catch (error) {
    // Fall through to socket-level port check below.
  }

  try {
    gatewayStatus.port_listening = await isPortOpen(config.gatewayHost, config.gatewayPort)
    if (gatewayStatus.port_listening) {
      gatewayStatus.running = true
    }
  } catch (error) {
    logger.error({ err: error }, 'Error checking port')
  }

  try {
    const { stdout } = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    gatewayStatus.version = stdout.trim()
  } catch (error) {
    try {
      const { stdout } = await runClawdbot(['--version'], { timeoutMs: 3000 })
      gatewayStatus.version = stdout.trim()
    } catch (innerError) {
      gatewayStatus.version = 'unknown'
    }
  }

  return gatewayStatus
}

async function getAvailableModels() {
  // This would typically query the gateway or config files
  // Model catalog is the single source of truth
  const models = [...MODEL_CATALOG]

  try {
    // Check which Ollama models are available locally
    const { stdout: ollamaOutput } = await runCommand('ollama', ['list'], {
      timeoutMs: 5000
    })
    const ollamaModels = ollamaOutput.split('\n')
      .slice(1) // Skip header
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/)
        return {
          alias: parts[0],
          name: `ollama/${parts[0]}`,
          provider: 'ollama',
          description: 'Local model',
          costPer1k: 0.0,
          size: parts[1] || 'unknown'
        }
      })

    // Add Ollama models that aren't already in the list
    ollamaModels.forEach(model => {
      if (!models.find(m => m.name === model.name)) {
        models.push(model)
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'Error checking Ollama models')
  }

  return models
}

async function resolveGatewayCapability() {
  // Probe configured gateways (if any).
  // A DB row alone isn't enough — the gateway must actually be reachable.
  let configuredGatewayReachable = false
  try {
    const db = getDatabase()
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='gateways'"
    ).get() as { name?: string } | undefined
    if (table?.name) {
      const rows = db.prepare('SELECT host, port FROM gateways').all() as { host: string; port: number }[]
      if (rows.length > 0) {
        const probes = rows.map(r => isPortOpen(r.host, Number(r.port)))
        const results = await Promise.all(probes)
        configuredGatewayReachable = results.some(Boolean)
      }
    }
  } catch {
    // ignore — fallback below still handles default gateway probes/process state
  }

  const gatewayStatus = await getGatewayStatus()
  const gatewayReachable = configuredGatewayReachable || Boolean(gatewayStatus.port_listening)
  const gatewayProcessDetected = Boolean(gatewayStatus.pid)
  const gatewayLikelyStaleProcess = gatewayProcessDetected && !gatewayReachable
  return {
    gateway: gatewayReachable,
    configuredGatewayReachable,
    gatewayReachable,
    gatewayProcessDetected,
    gatewayLikelyStaleProcess,
    gatewayStatus,
  }
}

async function performHealthCheck() {
  const health: any = {
    status: 'healthy',
    version: APP_VERSION,
    uptime: process.uptime(),
    checks: [],
    timestamp: Date.now()
  }

  // Check DB connectivity
  try {
    const db = getDatabase()
    const start = Date.now()
    db.prepare('SELECT 1').get()
    const elapsed = Date.now() - start

    let dbStatus: string
    if (elapsed > 1000) {
      dbStatus = 'warning'
    } else {
      dbStatus = 'healthy'
    }

    health.checks.push({
      name: 'Database',
      status: dbStatus,
      message: dbStatus === 'healthy' ? `DB reachable (${elapsed}ms)` : `DB slow (${elapsed}ms)`
    })
  } catch (error: any) {
    const isNativeModuleError = error?.code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(error?.message || '')
    health.checks.push({
      name: 'Database',
      status: 'unhealthy',
      message: isNativeModuleError
        ? 'better-sqlite3 compiled for wrong Node.js version. Run: pnpm rebuild better-sqlite3'
        : 'DB connectivity failed'
    })
  }

  // Check process memory
  try {
    const mem = process.memoryUsage()
    const rssMB = Math.round(mem.rss / (1024 * 1024))
    const totalSystemMb = Math.round(os.totalmem() / (1024 * 1024))
    const rssPercentOfSystem = totalSystemMb > 0 ? Math.round((rssMB / totalSystemMb) * 100) : 0
    const memorySnapshot = await getMemorySnapshot()
    const systemUsagePercent = memorySnapshot.usagePercent
    const isDev = process.env.NODE_ENV !== 'production'
    // Next.js dev runtime can exceed 2GB RSS on Windows during rebuilds.
    // In dev, use a higher absolute threshold plus a relative system-memory guard.
    const warningThresholdMb = isDev ? 1600 : 400
    const criticalThresholdMb = isDev ? 3200 : 800
    const hardCriticalThresholdMb = isDev ? 5500 : criticalThresholdMb
    const warningPercentOfSystem = isDev ? 30 : 0
    const criticalPercentOfSystem = isDev ? 50 : 0
    const legacyDevCriticalThresholdMb = 2400
    const exceededLegacyDevCritical = isDev && rssMB >= legacyDevCriticalThresholdMb
    let memStatus = 'healthy'

    if (isDev) {
      const criticalByAbsolute = rssMB >= hardCriticalThresholdMb
      const criticalByRelative =
        rssMB >= criticalThresholdMb &&
        (rssPercentOfSystem >= criticalPercentOfSystem || systemUsagePercent >= 95)
      const warningByAbsolute = rssMB >= warningThresholdMb
      const warningByRelative = rssPercentOfSystem >= warningPercentOfSystem || systemUsagePercent >= 90

      if (criticalByAbsolute || criticalByRelative) {
        memStatus = 'critical'
      } else if (warningByAbsolute || warningByRelative) {
        memStatus = 'warning'
      }
    } else {
      if (rssMB >= criticalThresholdMb) {
        memStatus = 'critical'
      } else if (rssMB >= warningThresholdMb) {
        memStatus = 'warning'
      }
    }

    health.checks.push({
      name: 'Process Memory',
      status: memStatus,
      message: `RSS: ${rssMB}MB (${rssPercentOfSystem}% system), Heap: ${Math.round(mem.heapUsed / (1024 * 1024))}/${Math.round(mem.heapTotal / (1024 * 1024))}MB`,
      detail: {
        mode: isDev ? 'development' : 'production',
        rss: mem.rss,
        rssMB,
        totalSystemMb,
        rssPercentOfSystem,
        systemUsagePercent,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        warningThresholdMb,
        criticalThresholdMb,
        hardCriticalThresholdMb: isDev ? hardCriticalThresholdMb : null,
        warningPercentOfSystem: isDev ? warningPercentOfSystem : null,
        criticalPercentOfSystem: isDev ? criticalPercentOfSystem : null,
        legacyDevCriticalThresholdMb: isDev ? legacyDevCriticalThresholdMb : null,
        exceededLegacyDevCritical,
      }
    })
  } catch (error) {
    health.checks.push({
      name: 'Process Memory',
      status: 'error',
      message: 'Failed to check process memory'
    })
  }

  // Check gateway connection
  try {
    const gatewayCapability = await resolveGatewayCapability()
    health.checks.push({
      name: 'Gateway',
      status: gatewayCapability.gatewayReachable ? 'healthy' : 'unhealthy',
      message: gatewayCapability.gatewayReachable
        ? 'Gateway is available'
        : gatewayCapability.gatewayLikelyStaleProcess
          ? 'Gateway process detected but endpoint is not reachable'
          : 'Gateway is not available',
      detail: {
        configuredGatewayReachable: gatewayCapability.configuredGatewayReachable,
        gatewayProcessDetected: gatewayCapability.gatewayProcessDetected,
        gatewayLikelyStaleProcess: gatewayCapability.gatewayLikelyStaleProcess,
        ...gatewayCapability.gatewayStatus,
      },
    })
  } catch (error) {
    health.checks.push({
      name: 'Gateway',
      status: 'error',
      message: 'Failed to check gateway status'
    })
  }

  // Check runtime process pressure (runaway/orphan process detection).
  try {
    const processPressure = await detectRuntimeProcessPressure()
    health.checks.push({
      name: 'Runtime Process Load',
      status: processPressure.status,
      message: processPressure.message,
      detail: processPressure,
    })
  } catch (error) {
    health.checks.push({
      name: 'Runtime Process Load',
      status: 'error',
      message: 'Failed to evaluate runtime process pressure',
    })
  }

  // Check OpenClaw profile/state-dir alignment (detect env/profile mismatch that can hide provider auth).
  try {
    const profileStateSignal = detectOpenClawProfileStateMismatch()
    if (profileStateSignal.mismatchDetected) {
      health.checks.push({
        name: 'OpenClaw Profile State',
        status: 'warning',
        message: profileStateSignal.reason,
        detail: profileStateSignal,
      })
    }
  } catch (error) {
    health.checks.push({
      name: 'OpenClaw Profile State',
      status: 'error',
      message: 'Failed to verify OpenClaw profile/state-dir alignment',
    })
  }

  // Check disk space (cross-platform: use df -h / and parse capacity column)
  try {
    const { stdout } = await runCommand('df', ['-h', '/'], {
      timeoutMs: 3000
    })
    const lines = stdout.trim().split('\n')
    const last = lines[lines.length - 1] || ''
    const parts = last.split(/\s+/)
    // On macOS capacity is col 4 ("85%"), on Linux use% is col 4 as well
    const pctField = parts.find(p => p.endsWith('%')) || '0%'
    const usagePercent = parseInt(pctField.replace('%', '') || '0')

    health.checks.push({
      name: 'Disk Space',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Disk usage: ${usagePercent}%`
    })
  } catch (error) {
    health.checks.push({
      name: 'Disk Space',
      status: 'error',
      message: 'Failed to check disk space'
    })
  }

  // Check memory usage (cross-platform)
  try {
    const usagePercent = (await getMemorySnapshot()).usagePercent

    health.checks.push({
      name: 'Memory Usage',
      status: usagePercent < 90 ? 'healthy' : usagePercent < 95 ? 'warning' : 'critical',
      message: `Memory usage: ${usagePercent}%`
    })
  } catch (error) {
    health.checks.push({
      name: 'Memory Usage',
      status: 'error',
      message: 'Failed to check memory usage'
    })
  }

  // Determine overall health
  const hasError = health.checks.some((check: any) => check.status === 'error')
  const hasCritical = health.checks.some((check: any) => check.status === 'critical')
  const hasWarning = health.checks.some((check: any) => check.status === 'warning')
  const hasDegraded = health.checks.some((check: any) =>
    check.name === 'Database' && check.status === 'warning'
  )

  if (hasError || hasCritical) {
    health.status = 'unhealthy'
  } else if (hasDegraded) {
    health.status = 'degraded'
  } else if (hasWarning) {
    health.status = 'warning'
  }

  return health
}

async function getCapabilities(request?: NextRequest) {
  const gatewayCapability = await resolveGatewayCapability()
  const gateway = gatewayCapability.gateway

  const openclawHome = Boolean(
    (config.openclawStateDir && existsSync(config.openclawStateDir)) ||
    (config.openclawConfigPath && existsSync(config.openclawConfigPath))
  )
  const openclawProfileState = detectOpenClawProfileStateMismatch()
  const anthropicLikelyMissingInActiveProfile =
    openclawProfileState.mismatchDetected &&
    (openclawProfileState.evidence.configuredAuthProfiles?.anthropicProfiles || 0) > 0 &&
    (openclawProfileState.evidence.cliDerivedAuthProfiles?.anthropicProfiles || 0) === 0

  const claudeProjectsPath = path.join(config.claudeHome, 'projects')
  const claudeHome = existsSync(claudeProjectsPath)

  let claudeSessions = 0
  try {
    const db = getDatabase()
    const row = db.prepare(
      "SELECT COUNT(*) as c FROM claude_sessions WHERE is_active = 1"
    ).get() as { c: number } | undefined
    claudeSessions = row?.c ?? 0
  } catch {
    // claude_sessions table may not exist
  }

  const subscriptions = detectProviderSubscriptions().active
  const primary = getPrimarySubscription()
  const subscription = primary ? {
    type: primary.type,
    provider: primary.provider,
  } : null

  // Apply subscription overrides from settings
  try {
    const settingsDb = getDatabase()
    const planOverride = settingsDb.prepare("SELECT value FROM settings WHERE key = 'subscription.plan_override'").get() as { value: string } | undefined
    if (planOverride?.value && subscription) {
      subscription.type = planOverride.value
    }
    const codexPlan = settingsDb.prepare("SELECT value FROM settings WHERE key = 'subscription.codex_plan'").get() as { value: string } | undefined
    if (codexPlan?.value) {
      subscriptions['openai'] = { provider: 'openai', type: codexPlan.value, source: 'env' as const }
    }
  } catch {
    // settings table may not exist yet
  }

  const processUser = process.env.MC_DEFAULT_ORG_NAME || os.userInfo().username

  // Interface mode preference
  let interfaceMode = 'essential'
  try {
    const settingsDb = getDatabase()
    const modeRow = settingsDb.prepare("SELECT value FROM settings WHERE key = 'general.interface_mode'").get() as { value: string } | undefined
    if (modeRow?.value === 'full' || modeRow?.value === 'essential') {
      interfaceMode = modeRow.value
    }
  } catch {
    // settings table may not exist yet
  }

  const hermesInstalled = isHermesInstalled()
  let hermesSessions = 0
  if (hermesInstalled) {
    try {
      hermesSessions = scanHermesSessions(50).filter(s => s.isActive).length
    } catch { /* ignore */ }
  }

  // Auto-register MC as default dashboard when gateway + openclaw home detected
  let dashboardRegistration: { registered: boolean; alreadySet: boolean } | null = null
  if (gateway && openclawHome) {
    try {
      let mcUrl = process.env.MC_BASE_URL || ''
      if (!mcUrl && request) {
        const host = request.headers.get('host')
        const proto = request.headers.get('x-forwarded-proto') || 'http'
        if (host) mcUrl = `${proto}://${host}`
      }
      if (mcUrl) {
        dashboardRegistration = registerMcAsDashboard(mcUrl)
      }
    } catch (err) {
      logger.error({ err }, 'Dashboard registration failed')
    }
  }

  const isDocker = existsSync('/.dockerenv')

  return {
    gateway,
    openclawHome,
    claudeHome,
    claudeSessions,
    hermesInstalled,
    hermesSessions,
    subscription,
    subscriptions,
    processUser,
    interfaceMode,
    dashboardRegistration,
    isDocker,
    openclawProfileState,
    openclawAuthMismatch: openclawProfileState.mismatchDetected,
    anthropicLikelyMissingInActiveProfile,
  }
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timeoutMs = 1500

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeoutMs)

    socket.once('connect', () => {
      cleanup()
      resolve(true)
    })

    socket.once('timeout', () => {
      cleanup()
      resolve(false)
    })

    socket.once('error', () => {
      cleanup()
      resolve(false)
    })

    socket.connect(port, host)
  })
}
