#!/usr/bin/env node
import fs from 'node:fs'

const PROBE_PROCESS_PATTERNS = [
  /\bopenclaw(?:\.cmd|\.exe)?\b.*\bgateway\s+status\b/i,
  /\bclawdbot(?:\.cmd|\.exe)?\b.*\bgateway\s+status\b/i,
  /\bopenclaw(?:\.cmd|\.exe)?\b.*\bmodels\s+status\b.*--probe/i,
  /\bclawdbot(?:\.cmd|\.exe)?\b.*\bmodels\s+status\b.*--probe/i,
  /\bmc-cli\.cjs\b.*\bstatus\s+(?:health|capabilities)\b/i,
]

function parseArgs(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      flags[key] = true
      continue
    }
    flags[key] = next
    i += 1
  }
  return flags
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}: ${text.slice(0, 300)}`)
  }
  return JSON.parse(text)
}

function getCheck(health, name) {
  return Array.isArray(health?.checks)
    ? health.checks.find((check) => check?.name === name)
    : undefined
}

function probeLikeCommand(command) {
  return PROBE_PROCESS_PATTERNS.some((pattern) => pattern.test(command))
}

function normalizeSampleCommands(runtimeProcessLoadCheck) {
  const sample = runtimeProcessLoadCheck?.detail?.detail?.sampleCommands
  if (!Array.isArray(sample)) return []
  return sample
    .map((row) => {
      if (typeof row === 'string') return row
      return String(row?.command || '').trim()
    })
    .filter(Boolean)
}

export function evaluateAssuranceSignals(health, capabilities) {
  const checks = []

  const gatewayCheck = getCheck(health, 'Gateway')
  const gatewayHealthUp = gatewayCheck?.status === 'healthy'
  const gatewayCapabilitiesUp = Boolean(capabilities?.gateway)
  const gatewayConsistent = gatewayHealthUp === gatewayCapabilitiesUp
  checks.push({
    id: 'gateway_consistency',
    ok: gatewayConsistent,
    message: gatewayConsistent
      ? `Gateway consistent (health=${gatewayHealthUp}, capabilities=${gatewayCapabilitiesUp})`
      : `Gateway mismatch (health=${gatewayHealthUp}, capabilities=${gatewayCapabilitiesUp})`,
  })

  const authMismatchDetected =
    Boolean(capabilities?.openclawAuthMismatch) ||
    Boolean(capabilities?.anthropicLikelyMissingInActiveProfile)
  checks.push({
    id: 'auth_profile_alignment',
    ok: !authMismatchDetected,
    message: authMismatchDetected
      ? 'Auth/profile mismatch detected by capabilities API'
      : 'Auth/profile alignment healthy',
  })

  const processLoadCheck = getCheck(health, 'Runtime Process Load')
  if (!processLoadCheck) {
    checks.push({
      id: 'process_pressure_signal',
      ok: false,
      message: 'Runtime Process Load check missing from health payload',
    })
  } else if (processLoadCheck.status === 'healthy') {
    checks.push({
      id: 'process_pressure_signal',
      ok: true,
      message: 'Runtime process pressure healthy',
    })
  } else {
    const commands = normalizeSampleCommands(processLoadCheck)
    const probeOnly = commands.length > 0 && commands.every((command) => probeLikeCommand(command))
    checks.push({
      id: 'process_pressure_signal',
      ok: false,
      message: probeOnly
        ? 'Runtime process pressure appears probe-induced (potential false positive)'
        : `Runtime process pressure is ${processLoadCheck.status}`,
      detail: {
        status: processLoadCheck.status,
        sampleCommands: commands,
        probeOnly,
      },
    })
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  }
}

async function loadInputs(flags) {
  const healthFile = flags['health-file']
  const capabilitiesFile = flags['capabilities-file']
  if ((healthFile && !capabilitiesFile) || (!healthFile && capabilitiesFile)) {
    throw new Error('Provide both --health-file and --capabilities-file together.')
  }
  if (healthFile && capabilitiesFile) {
    return {
      health: loadJsonFile(healthFile),
      capabilities: loadJsonFile(capabilitiesFile),
    }
  }

  const baseUrl = String(flags['base-url'] || 'http://127.0.0.1:3000').replace(/\/$/, '')
  const healthUrl = String(flags['health-url'] || `${baseUrl}/api/status?action=health`)
  const capabilitiesUrl = String(flags['capabilities-url'] || `${baseUrl}/api/status?action=capabilities`)
  const apiKey = String(flags['api-key'] || process.env.MC_API_KEY || '').trim()
  const headers = apiKey ? { 'x-api-key': apiKey } : {}

  const [health, capabilities] = await Promise.all([
    fetchJson(healthUrl, headers),
    fetchJson(capabilitiesUrl, headers),
  ])
  return { health, capabilities }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const payloads = await loadInputs(flags)
  const result = evaluateAssuranceSignals(payloads.health, payloads.capabilities)

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log('Assurance regression check')
    for (const check of result.checks) {
      const mark = check.ok ? 'PASS' : 'FAIL'
      console.log(`- [${mark}] ${check.id}: ${check.message}`)
    }
  }

  process.exit(result.ok ? 0 : 1)
}

const invokedPath = process.argv[1] || ''
if (invokedPath.endsWith('assurance-regression-check.mjs')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
