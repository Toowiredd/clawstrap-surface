import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'
import { mutationLimiter } from '@/lib/rate-limit'
import { validateBody, updateSettingsSchema } from '@/lib/validation'

interface SettingRow {
  key: string
  value: string
  description: string | null
  category: string
  updated_by: string | null
  updated_at: number
}

const SECURITY_PROFILE_SETTING_KEY = 'profiles.hook_profile'
const LEGACY_SECURITY_PROFILE_SETTING_KEYS = ['hook_profile', 'security_profile', 'security.hook_profile'] as const

function normalizeSettingKey(key: string): string {
  return LEGACY_SECURITY_PROFILE_SETTING_KEYS.includes(key as (typeof LEGACY_SECURITY_PROFILE_SETTING_KEYS)[number])
    ? SECURITY_PROFILE_SETTING_KEY
    : key
}

// Default settings definitions (category, description, default value)
const settingDefinitions: Record<string, { category: string; description: string; default: string }> = {
  // Retention
  'retention.activities_days': { category: 'retention', description: 'Days to keep activity records', default: String(config.retention.activities) },
  'retention.audit_log_days': { category: 'retention', description: 'Days to keep audit log entries', default: String(config.retention.auditLog) },
  'retention.logs_days': { category: 'retention', description: 'Days to keep log files', default: String(config.retention.logs) },
  'retention.notifications_days': { category: 'retention', description: 'Days to keep notifications', default: String(config.retention.notifications) },
  'retention.pipeline_runs_days': { category: 'retention', description: 'Days to keep pipeline run history', default: String(config.retention.pipelineRuns) },
  'retention.token_usage_days': { category: 'retention', description: 'Days to keep token usage data', default: String(config.retention.tokenUsage) },
  'retention.gateway_sessions_days': { category: 'retention', description: 'Days to keep inactive gateway session metadata', default: String(config.retention.gatewaySessions) },

  // Gateway
  'gateway.host': { category: 'gateway', description: 'Gateway hostname', default: config.gatewayHost },
  'gateway.port': { category: 'gateway', description: 'Gateway port number', default: String(config.gatewayPort) },

  // Chat
  'chat.coordinator_target_agent': {
    category: 'chat',
    description: 'Optional coordinator routing target (agent name or openclawId). When set, coordinator inbox messages are forwarded to this agent before default/main-session fallback.',
    default: '',
  },

  // Security Profiles
  [SECURITY_PROFILE_SETTING_KEY]: {
    category: 'profiles',
    description: 'Controls hook profile strictness for security scanning (minimal, standard, strict).',
    default: 'standard',
  },

  // General
  'general.site_name': { category: 'general', description: 'Clawstrap display name', default: 'Clawstrap' },
  'general.auto_cleanup': { category: 'general', description: 'Enable automatic data cleanup', default: 'false' },
  'general.auto_backup': { category: 'general', description: 'Enable automatic daily backups', default: 'false' },
  'general.backup_retention_count': { category: 'general', description: 'Number of backup files to keep', default: '10' },

  // Subscription overrides
  'subscription.plan_override': { category: 'general', description: 'Override auto-detected subscription plan (e.g. max, max_5x, pro)', default: '' },
  'subscription.codex_plan': { category: 'general', description: 'Codex/OpenAI subscription plan (e.g. chatgpt, plus, pro)', default: '' },

  // Interface
  'general.interface_mode': { category: 'general', description: 'Interface complexity (essential or full)', default: 'essential' },

  // Onboarding
  'onboarding.completed': { category: 'onboarding', description: 'Whether onboarding has been completed', default: 'false' },
  'onboarding.completed_at': { category: 'onboarding', description: 'Timestamp when onboarding was completed', default: '' },
  'onboarding.skipped': { category: 'onboarding', description: 'Whether onboarding was skipped', default: 'false' },
  'onboarding.completed_steps': { category: 'onboarding', description: 'JSON array of completed step IDs', default: '[]' },
  'onboarding.checklist_dismissed': { category: 'onboarding', description: 'Whether the onboarding checklist has been dismissed', default: 'false' },
}

/**
 * GET /api/settings - List all settings (grouped by category)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM settings ORDER BY category, key').all() as SettingRow[]
  const stored = new Map(rows.map(r => [r.key, r]))

  // Backward compatibility: surface legacy hook profile keys as the canonical setting key.
  if (!stored.has(SECURITY_PROFILE_SETTING_KEY)) {
    for (const legacyKey of LEGACY_SECURITY_PROFILE_SETTING_KEYS) {
      const legacyRow = stored.get(legacyKey)
      if (!legacyRow) continue
      stored.set(SECURITY_PROFILE_SETTING_KEY, {
        ...legacyRow,
        key: SECURITY_PROFILE_SETTING_KEY,
        category: settingDefinitions[SECURITY_PROFILE_SETTING_KEY].category,
        description: settingDefinitions[SECURITY_PROFILE_SETTING_KEY].description,
      })
      break
    }
  }

  // Merge defaults with stored values
  const settings: Array<{
    key: string
    value: string
    description: string
    category: string
    updated_by: string | null
    updated_at: number | null
    is_default: boolean
  }> = []

  for (const [key, def] of Object.entries(settingDefinitions)) {
    const row = stored.get(key)
    settings.push({
      key,
      value: row?.value ?? def.default,
      description: row?.description ?? def.description,
      category: row?.category ?? def.category,
      updated_by: row?.updated_by ?? null,
      updated_at: row?.updated_at ?? null,
      is_default: !row,
    })
  }

  // Also include any custom settings not in definitions
  for (const row of rows) {
    if (!settingDefinitions[row.key] && !LEGACY_SECURITY_PROFILE_SETTING_KEYS.includes(row.key as (typeof LEGACY_SECURITY_PROFILE_SETTING_KEYS)[number])) {
      settings.push({
        key: row.key,
        value: row.value,
        description: row.description ?? '',
        category: row.category,
        updated_by: row.updated_by,
        updated_at: row.updated_at,
        is_default: false,
      })
    }
  }

  // Group by category
  const grouped: Record<string, typeof settings> = {}
  for (const s of settings) {
    if (!grouped[s.category]) grouped[s.category] = []
    grouped[s.category].push(s)
  }

  return NextResponse.json({ settings, grouped })
}

/**
 * PUT /api/settings - Update one or more settings
 * Body: { settings: { key: value, ... } }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, updateSettingsSchema)
  if ('error' in result) return result.error
  const body = result.data

  const db = getDatabase()
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `)
  const getExisting = db.prepare('SELECT value FROM settings WHERE key = ?')
  const getExistingSecurityProfile = db.prepare(`
    SELECT value
    FROM settings
    WHERE key IN (?, ?, ?, ?)
    ORDER BY CASE key WHEN ? THEN 0 ELSE 1 END
    LIMIT 1
  `)
  const deleteLegacySecurityProfile = db.prepare(`
    DELETE FROM settings
    WHERE key IN (?, ?, ?)
  `)

  const updated: string[] = []
  const changes: Record<string, { old: string | null; new: string }> = {}
  const normalizedSettings = new Map<string, string>()

  for (const [rawKey, value] of Object.entries(body.settings)) {
    normalizedSettings.set(normalizeSettingKey(rawKey), String(value))
  }

  const txn = db.transaction(() => {
    for (const [key, strValue] of normalizedSettings.entries()) {
      const def = settingDefinitions[key]
      const category = def?.category ?? 'custom'
      const description = def?.description ?? null

      // Get old value for audit
      const existing = (
        key === SECURITY_PROFILE_SETTING_KEY
          ? getExistingSecurityProfile.get(
            SECURITY_PROFILE_SETTING_KEY,
            ...LEGACY_SECURITY_PROFILE_SETTING_KEYS,
            SECURITY_PROFILE_SETTING_KEY
          )
          : getExisting.get(key)
      ) as { value: string } | undefined
      changes[key] = { old: existing?.value ?? null, new: strValue }

      upsert.run(key, strValue, description, category, auth.user.username)
      if (key === SECURITY_PROFILE_SETTING_KEY) {
        deleteLegacySecurityProfile.run(...LEGACY_SECURITY_PROFILE_SETTING_KEYS)
      }
      updated.push(key)
    }
  })

  txn()

  // Audit log
  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'settings_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { updated_keys: updated, changes },
    ip_address: ipAddress,
  })

  return NextResponse.json({ updated, count: updated.length })
}

/**
 * DELETE /api/settings?key=... - Reset a setting to default
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
  const key = typeof body?.key === 'string' ? body.key : ''
  const normalizedKey = normalizeSettingKey(key)

  if (!normalizedKey) {
    return NextResponse.json({ error: 'key parameter required' }, { status: 400 })
  }

  const db = getDatabase()
  const existing = (
    normalizedKey === SECURITY_PROFILE_SETTING_KEY
      ? db.prepare(`
          SELECT value
          FROM settings
          WHERE key IN (?, ?, ?, ?)
          ORDER BY CASE key WHEN ? THEN 0 ELSE 1 END
          LIMIT 1
        `).get(
          SECURITY_PROFILE_SETTING_KEY,
          ...LEGACY_SECURITY_PROFILE_SETTING_KEYS,
          SECURITY_PROFILE_SETTING_KEY
        )
      : db.prepare('SELECT value FROM settings WHERE key = ?').get(normalizedKey)
  ) as { value: string } | undefined

  if (!existing) {
    return NextResponse.json({ error: 'Setting not found or already at default' }, { status: 404 })
  }

  if (normalizedKey === SECURITY_PROFILE_SETTING_KEY) {
    db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?, ?)').run(
      SECURITY_PROFILE_SETTING_KEY,
      ...LEGACY_SECURITY_PROFILE_SETTING_KEYS
    )
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run(normalizedKey)
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'settings_reset',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { key: normalizedKey, old_value: existing.value },
    ip_address: ipAddress,
  })

  return NextResponse.json({ reset: normalizedKey, default_value: settingDefinitions[normalizedKey]?.default ?? null })
}
