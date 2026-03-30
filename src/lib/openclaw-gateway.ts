import { existsSync } from 'node:fs'
import path from 'node:path'
import { runCommand, runOpenClaw } from './command'
import { config } from './config'

export function parseGatewayJsonOutput(raw: string): unknown | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const objectStart = trimmed.indexOf('{')
  const arrayStart = trimmed.indexOf('[')
  const hasObject = objectStart >= 0
  const hasArray = arrayStart >= 0

  let start = -1
  let end = -1

  if (hasObject && hasArray) {
    if (objectStart < arrayStart) {
      start = objectStart
      end = trimmed.lastIndexOf('}')
    } else {
      start = arrayStart
      end = trimmed.lastIndexOf(']')
    }
  } else if (hasObject) {
    start = objectStart
    end = trimmed.lastIndexOf('}')
  } else if (hasArray) {
    start = arrayStart
    end = trimmed.lastIndexOf(']')
  }

  if (start < 0 || end < start) return null

  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function callOpenClawGateway<T = unknown>(
  method: string,
  params: unknown,
  timeoutMs = 10000,
  options?: { url?: string; token?: string; password?: string },
): Promise<T> {
  const args = [
    'gateway',
    'call',
    method,
    '--timeout',
    String(Math.max(1000, Math.floor(timeoutMs))),
    '--params',
    JSON.stringify(params ?? {}),
    '--json',
  ]
  if (options?.url) args.push('--url', options.url)
  if (options?.token) args.push('--token', options.token)
  if (options?.password) args.push('--password', options.password)
  const result = await runOpenClawWithFallback(args, timeoutMs)

  const payload = parseGatewayJsonOutput(result.stdout)
  if (payload == null) {
    throw new Error(`Invalid JSON response from gateway method ${method}`)
  }

  return payload as T
}

async function runOpenClawWithFallback(args: string[], timeoutMs: number) {
  const openclawEnv = getOpenClawGatewayEnv()
  try {
    return await runOpenClaw(args, { timeoutMs: timeoutMs + 2000, env: openclawEnv })
  } catch (err) {
    if (!isSpawnNotFoundError(err)) throw err
  }

  for (const pathPrefix of getOpenClawPathFallbacks()) {
    try {
      const envPath = `${pathPrefix}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`
      return await runCommand('openclaw', args, {
        timeoutMs: timeoutMs + 2000,
        cwd: process.cwd(),
        env: { ...openclawEnv, PATH: envPath },
      })
    } catch (err) {
      if (!isSpawnNotFoundError(err)) throw err
    }
  }

  for (const bin of getOpenClawAbsoluteFallbacks()) {
    try {
      return await runCommand(bin, args, {
        timeoutMs: timeoutMs + 2000,
        cwd: process.cwd(),
        env: openclawEnv,
      })
    } catch (err) {
      if (!isSpawnNotFoundError(err)) throw err
    }
  }

  for (const script of getOpenClawNodeScriptFallbacks()) {
    try {
      return await runCommand(process.execPath, [script, ...args], {
        timeoutMs: timeoutMs + 2000,
        cwd: process.cwd(),
        env: openclawEnv,
      })
    } catch (err) {
      if (!isSpawnNotFoundError(err)) throw err
    }
  }

  throw new Error('spawn openclaw ENOENT')
}

function isSpawnNotFoundError(err: unknown): boolean {
  if (!err) return false
  const code = (err as any).code
  const message = String((err as any).message || '')
  return code === 'ENOENT' || code === 'EINVAL' || message.includes('ENOENT') || message.includes('EINVAL')
}

function getOpenClawPathFallbacks(): string[] {
  const dirs = new Set<string>()

  if (process.platform === 'win32') {
    for (const appData of getAppDataRoots()) {
      dirs.add(`${appData}\\npm`)
    }
  }

  return [...dirs].filter((dir) => existsSync(dir))
}

function getOpenClawAbsoluteFallbacks(): string[] {
  if (process.platform === 'win32') return []
  const bins = ['/usr/local/bin/openclaw', '/opt/homebrew/bin/openclaw', '/usr/bin/openclaw']
  return bins.filter((bin) => existsSync(bin))
}

function getOpenClawNodeScriptFallbacks(): string[] {
  const scripts = new Set<string>()
  if (process.platform === 'win32') {
    for (const appData of getAppDataRoots()) {
      scripts.add(`${appData}\\npm\\node_modules\\openclaw\\dist\\index.js`)
    }
  } else {
    scripts.add('/usr/local/lib/node_modules/openclaw/dist/index.js')
    scripts.add('/opt/homebrew/lib/node_modules/openclaw/dist/index.js')
    scripts.add('/usr/lib/node_modules/openclaw/dist/index.js')
  }
  return [...scripts].filter((script) => existsSync(script))
}

function getAppDataRoots(): string[] {
  const roots = new Set<string>()

  if (process.env.APPDATA) roots.add(process.env.APPDATA)
  if (process.env.USERPROFILE) roots.add(`${process.env.USERPROFILE}\\AppData\\Roaming`)
  if (process.env.HOME) roots.add(`${process.env.HOME}\\AppData\\Roaming`)
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    roots.add(`${process.env.HOMEDRIVE}${process.env.HOMEPATH}\\AppData\\Roaming`)
  }

  // OPENCLAW_CONFIG_PATH usually points to "<home>\\.openclaw\\openclaw.json".
  const cfgPath = process.env.OPENCLAW_CONFIG_PATH || ''
  const cfgDir = dirnameLike(cfgPath)
  const cfgHome = dirnameLike(cfgDir)
  if (cfgHome) roots.add(`${cfgHome}\\AppData\\Roaming`)

  const stateDir = process.env.OPENCLAW_STATE_DIR || ''
  const stateHome = dirnameLike(stateDir)
  if (stateHome) roots.add(`${stateHome}\\AppData\\Roaming`)

  return [...roots].filter((root) => existsSync(root))
}

function dirnameLike(input: string): string {
  const normalized = String(input || '').replace(/[\\/]+/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return ''
  return normalized.slice(0, idx).replace(/\//g, '\\')
}

function getOpenClawGatewayEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (config.openclawStateDir) {
    env.OPENCLAW_STATE_DIR = config.openclawStateDir
    env.OPENCLAW_HOME = path.dirname(path.resolve(config.openclawStateDir))
  }
  if (config.openclawConfigPath) {
    env.OPENCLAW_CONFIG_PATH = config.openclawConfigPath
  }

  return env
}
