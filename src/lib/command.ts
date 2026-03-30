import { spawn } from 'node:child_process'
import { config } from './config'
import path from 'node:path'

interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  input?: string
}

interface CommandResult {
  stdout: string
  stderr: string
  code: number | null
}

export function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false
    })

    let stdout = ''
    let stderr = ''
    let timeoutId: NodeJS.Timeout | undefined

    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        child.kill('SIGKILL')
      }, options.timeoutMs)
    }

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId)
      reject(error)
    })

    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (code === 0) {
        resolve({ stdout, stderr, code })
        return
      }
      const error = new Error(
        `Command failed (${command} ${args.join(' ')}): ${stderr || stdout}`
      )
      ;(error as any).stdout = stdout
      ;(error as any).stderr = stderr
      ;(error as any).code = code
      reject(error)
    })

    if (options.input) {
      child.stdin.write(options.input)
      child.stdin.end()
    }
  })
}

export function runOpenClaw(args: string[], options: CommandOptions = {}) {
  const env = withOpenClawEnv(options.env)
  return runCommand(config.openclawBin, args, {
    ...options,
    env,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}

export function runClawdbot(args: string[], options: CommandOptions = {}) {
  const env = withOpenClawEnv(options.env)
  return runCommand(config.clawdbotBin, args, {
    ...options,
    env,
    cwd: options.cwd || config.openclawStateDir || process.cwd()
  })
}

function withOpenClawEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(base || process.env) }

  if (config.openclawStateDir) {
    env.OPENCLAW_STATE_DIR = config.openclawStateDir
  }
  if (config.openclawConfigPath) {
    env.OPENCLAW_CONFIG_PATH = config.openclawConfigPath
  }

  // Keep OPENCLAW_HOME aligned to the parent home dir, never the ".openclaw"
  // state dir itself, to avoid nested "<state>/.openclaw" resolution.
  if (config.openclawStateDir) {
    const normalizedState = path.resolve(config.openclawStateDir)
    const desiredHome = path.dirname(normalizedState)
    const currentHome = String(env.OPENCLAW_HOME || '').trim()

    if (!currentHome) {
      env.OPENCLAW_HOME = desiredHome
    } else {
      const normalizedHome = path.resolve(currentHome)
      const homeLooksLikeStateDir =
        normalizedHome.toLowerCase() === normalizedState.toLowerCase() ||
        path.basename(normalizedHome).toLowerCase() === '.openclaw'
      if (homeLooksLikeStateDir) {
        env.OPENCLAW_HOME = desiredHome
      }
    }
  }

  return env
}
