import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules()

  const original = {
    MISSION_CONTROL_DATA_DIR: process.env.MISSION_CONTROL_DATA_DIR,
    MISSION_CONTROL_BUILD_DATA_DIR: process.env.MISSION_CONTROL_BUILD_DATA_DIR,
    MISSION_CONTROL_BUILD_DB_PATH: process.env.MISSION_CONTROL_BUILD_DB_PATH,
    MISSION_CONTROL_BUILD_TOKENS_PATH: process.env.MISSION_CONTROL_BUILD_TOKENS_PATH,
    MISSION_CONTROL_DB_PATH: process.env.MISSION_CONTROL_DB_PATH,
    MISSION_CONTROL_TOKENS_PATH: process.env.MISSION_CONTROL_TOKENS_PATH,
    NEXT_PHASE: process.env.NEXT_PHASE,
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  const mod = await import('./config')

  if (original.MISSION_CONTROL_DATA_DIR === undefined) delete process.env.MISSION_CONTROL_DATA_DIR
  else process.env.MISSION_CONTROL_DATA_DIR = original.MISSION_CONTROL_DATA_DIR

  if (original.MISSION_CONTROL_BUILD_DATA_DIR === undefined) delete process.env.MISSION_CONTROL_BUILD_DATA_DIR
  else process.env.MISSION_CONTROL_BUILD_DATA_DIR = original.MISSION_CONTROL_BUILD_DATA_DIR

  if (original.MISSION_CONTROL_BUILD_DB_PATH === undefined) delete process.env.MISSION_CONTROL_BUILD_DB_PATH
  else process.env.MISSION_CONTROL_BUILD_DB_PATH = original.MISSION_CONTROL_BUILD_DB_PATH

  if (original.MISSION_CONTROL_BUILD_TOKENS_PATH === undefined) delete process.env.MISSION_CONTROL_BUILD_TOKENS_PATH
  else process.env.MISSION_CONTROL_BUILD_TOKENS_PATH = original.MISSION_CONTROL_BUILD_TOKENS_PATH

  if (original.MISSION_CONTROL_DB_PATH === undefined) delete process.env.MISSION_CONTROL_DB_PATH
  else process.env.MISSION_CONTROL_DB_PATH = original.MISSION_CONTROL_DB_PATH

  if (original.MISSION_CONTROL_TOKENS_PATH === undefined) delete process.env.MISSION_CONTROL_TOKENS_PATH
  else process.env.MISSION_CONTROL_TOKENS_PATH = original.MISSION_CONTROL_TOKENS_PATH

  if (original.NEXT_PHASE === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = original.NEXT_PHASE

  return mod.config
}

// Use platform-native temp paths to avoid Unix/Windows assertion mismatches
const tmpBase = os.tmpdir()

describe('config data paths', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('derives db and token paths from MISSION_CONTROL_DATA_DIR', async () => {
    const dataDir = path.join(tmpBase, 'mission-control-data')
    const config = await loadConfigWithEnv({
      MISSION_CONTROL_DATA_DIR: dataDir,
      MISSION_CONTROL_DB_PATH: undefined,
      MISSION_CONTROL_TOKENS_PATH: undefined,
    })

    expect(config.dataDir).toBe(dataDir)
    expect(config.dbPath).toBe(path.join(dataDir, 'mission-control.db'))
    expect(config.tokensPath).toBe(path.join(dataDir, 'mission-control-tokens.json'))
  })

  it('respects explicit db and token path overrides', async () => {
    const dataDir = path.join(tmpBase, 'mission-control-data')
    const customDb = path.join(tmpBase, 'custom.db')
    const customTokens = path.join(tmpBase, 'custom-tokens.json')
    const config = await loadConfigWithEnv({
      MISSION_CONTROL_DATA_DIR: dataDir,
      MISSION_CONTROL_DB_PATH: customDb,
      MISSION_CONTROL_TOKENS_PATH: customTokens,
    })

    expect(config.dataDir).toBe(dataDir)
    expect(config.dbPath).toBe(customDb)
    expect(config.tokensPath).toBe(customTokens)
  })

  it('uses a build-scoped worker data dir during next build', async () => {
    const runtimeData = path.join(tmpBase, 'runtime-data')
    const buildScratch = path.join(tmpBase, 'build-scratch')
    const config = await loadConfigWithEnv({
      NEXT_PHASE: 'phase-production-build',
      MISSION_CONTROL_DATA_DIR: runtimeData,
      MISSION_CONTROL_BUILD_DATA_DIR: buildScratch,
      MISSION_CONTROL_DB_PATH: undefined,
      MISSION_CONTROL_TOKENS_PATH: undefined,
    })

    const escaped = buildScratch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(config.dataDir).toMatch(new RegExp(`^${escaped}[\\\\/]worker-\\d+$`))
    expect(config.dbPath).toMatch(new RegExp(`^${escaped}[\\\\/]worker-\\d+[\\\\/]mission-control\\.db$`))
    expect(config.tokensPath).toMatch(new RegExp(`^${escaped}[\\\\/]worker-\\d+[\\\\/]mission-control-tokens\\.json$`))
  })

  it('prefers build-specific db and token overrides during next build', async () => {
    const runtimeData = path.join(tmpBase, 'runtime-data')
    const runtimeDb = path.join(tmpBase, 'runtime.db')
    const runtimeTokens = path.join(tmpBase, 'runtime-tokens.json')
    const buildDb = path.join(tmpBase, 'build.db')
    const buildTokens = path.join(tmpBase, 'build-tokens.json')
    const config = await loadConfigWithEnv({
      NEXT_PHASE: 'phase-production-build',
      MISSION_CONTROL_DATA_DIR: runtimeData,
      MISSION_CONTROL_DB_PATH: runtimeDb,
      MISSION_CONTROL_TOKENS_PATH: runtimeTokens,
      MISSION_CONTROL_BUILD_DB_PATH: buildDb,
      MISSION_CONTROL_BUILD_TOKENS_PATH: buildTokens,
    })

    const expectedBuildRoot = path.join(os.tmpdir(), 'mission-control-build')
    const escaped = expectedBuildRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(config.dataDir).toMatch(new RegExp(`^${escaped}[\\\\/]worker-\\d+$`))
    expect(config.dbPath).toBe(buildDb)
    expect(config.tokensPath).toBe(buildTokens)
  })
})
