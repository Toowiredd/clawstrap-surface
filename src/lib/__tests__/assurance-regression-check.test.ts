import { describe, expect, it } from 'vitest'

import { evaluateAssuranceSignals } from '../../../scripts/assurance-regression-check.mjs'

function makeHealthyPayloads(): { health: any; capabilities: any } {
  return {
    health: {
      checks: [
        { name: 'Gateway', status: 'healthy', message: 'Gateway is running' },
        { name: 'Runtime Process Load', status: 'healthy', message: 'Relevant=4, Node=2, Gateway=1' },
      ],
    },
    capabilities: {
      gateway: true,
      openclawAuthMismatch: false,
      anthropicLikelyMissingInActiveProfile: false,
    },
  }
}

describe('assurance-regression-check', () => {
  it('passes when gateway status, auth profile, and process pressure are healthy', () => {
    const { health, capabilities } = makeHealthyPayloads()
    const result = evaluateAssuranceSignals(health, capabilities)

    expect(result.ok).toBe(true)
    expect(result.checks.map((check: any) => check.id)).toEqual([
      'gateway_consistency',
      'auth_profile_alignment',
      'process_pressure_signal',
    ])
  })

  it('fails on gateway mismatch between health and capabilities', () => {
    const { health, capabilities } = makeHealthyPayloads()
    capabilities.gateway = false

    const result = evaluateAssuranceSignals(health, capabilities)
    const gatewayCheck = result.checks.find((check: any) => check.id === 'gateway_consistency') as any

    expect(result.ok).toBe(false)
    expect(gatewayCheck.ok).toBe(false)
    expect(gatewayCheck.message).toContain('Gateway mismatch')
  })

  it('fails when auth/profile mismatch flags are raised', () => {
    const { health, capabilities } = makeHealthyPayloads()
    capabilities.openclawAuthMismatch = true

    const result = evaluateAssuranceSignals(health, capabilities)
    const authCheck = result.checks.find((check: any) => check.id === 'auth_profile_alignment') as any

    expect(result.ok).toBe(false)
    expect(authCheck.ok).toBe(false)
    expect(authCheck.message).toContain('Auth/profile mismatch')
  })

  it('flags process pressure as potential false positive when samples are probe-only', () => {
    const { health, capabilities } = makeHealthyPayloads()
    health.checks[1] = {
      name: 'Runtime Process Load',
      status: 'warning',
      detail: {
        detail: {
          sampleCommands: [
            { command: 'openclaw gateway status --json' },
            { command: 'openclaw models status --probe --probe-provider anthropic' },
            { command: 'node scripts/mc-cli.cjs status health --json' },
          ],
        },
      },
    }

    const result = evaluateAssuranceSignals(health, capabilities)
    const processCheck = result.checks.find((check: any) => check.id === 'process_pressure_signal') as any

    expect(result.ok).toBe(false)
    expect(processCheck.ok).toBe(false)
    expect(processCheck.message).toContain('probe-induced')
    expect(processCheck.detail.probeOnly).toBe(true)
  })

  it('flags process pressure as real when non-probe commands are present', () => {
    const { health, capabilities } = makeHealthyPayloads()
    health.checks[1] = {
      name: 'Runtime Process Load',
      status: 'critical',
      detail: {
        detail: {
          sampleCommands: [
            { command: 'node clawstrap-surface/node_modules/.bin/next dev --hostname 127.0.0.1 --port 3000' },
            { command: 'node clawstrap-governor/dist/index.js' },
          ],
        },
      },
    }

    const result = evaluateAssuranceSignals(health, capabilities)
    const processCheck = result.checks.find((check: any) => check.id === 'process_pressure_signal') as any

    expect(result.ok).toBe(false)
    expect(processCheck.ok).toBe(false)
    expect(processCheck.message).toContain('critical')
    expect(processCheck.detail.probeOnly).toBe(false)
  })
})
