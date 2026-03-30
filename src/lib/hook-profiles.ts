/**
 * Hook Profiles — security hook configuration levels.
 *
 * Three profiles control how aggressively security hooks run:
 * - minimal: lightweight, no blocking
 * - standard: default, scans secrets and audits MCP calls
 * - strict: blocks on secret detection, tighter rate limits
 *
 * Profile is stored in the settings table under key 'profiles.hook_profile'
 * (legacy fallback keys are still supported for compatibility).
 */

import { getDatabase } from '@/lib/db'

export type HookProfileLevel = 'minimal' | 'standard' | 'strict'

export interface HookProfile {
  level: HookProfileLevel
  scanSecrets: boolean
  auditMcpCalls: boolean
  blockOnSecretDetection: boolean
  rateLimitMultiplier: number
}

const HOOK_PROFILE_SETTING_KEY = 'profiles.hook_profile'
const LEGACY_HOOK_PROFILE_SETTING_KEYS = ['hook_profile', 'security_profile', 'security.hook_profile'] as const

const PROFILES: Record<HookProfileLevel, HookProfile> = {
  minimal: {
    level: 'minimal',
    scanSecrets: false,
    auditMcpCalls: false,
    blockOnSecretDetection: false,
    rateLimitMultiplier: 2.0,
  },
  standard: {
    level: 'standard',
    scanSecrets: true,
    auditMcpCalls: true,
    blockOnSecretDetection: false,
    rateLimitMultiplier: 1.0,
  },
  strict: {
    level: 'strict',
    scanSecrets: true,
    auditMcpCalls: true,
    blockOnSecretDetection: true,
    rateLimitMultiplier: 0.5,
  },
}

export function getActiveProfile(): HookProfile {
  const db = getDatabase()
  const row = db.prepare(
    `
      SELECT value
      FROM settings
      WHERE key IN (?, ?, ?, ?)
      ORDER BY CASE key WHEN ? THEN 0 ELSE 1 END
      LIMIT 1
    `
  ).get(
    HOOK_PROFILE_SETTING_KEY,
    ...LEGACY_HOOK_PROFILE_SETTING_KEYS,
    HOOK_PROFILE_SETTING_KEY
  ) as { value: string } | undefined

  const level = row?.value as HookProfileLevel
  if (level && PROFILES[level]) {
    return PROFILES[level]
  }
  return PROFILES.standard
}

export function shouldScanSecrets(): boolean {
  return getActiveProfile().scanSecrets
}

export function shouldAuditMcpCalls(): boolean {
  return getActiveProfile().auditMcpCalls
}

export function shouldBlockOnSecretDetection(): boolean {
  return getActiveProfile().blockOnSecretDetection
}

export function getRateLimitMultiplier(): number {
  return getActiveProfile().rateLimitMultiplier
}
