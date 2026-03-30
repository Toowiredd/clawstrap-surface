// @vitest-environment node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSelfBuildPromptPreamble,
  collectSelfBuildSignals,
  evaluateSelfBuildGuard,
  loadSelfBuildIntelligence,
  resolveMissionControlRepoRoot,
} from '@/lib/self-build-intelligence'

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

describe('self-build-intelligence', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves the repo root from parent directories when env is unset', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-root-'))
    fs.writeFileSync(path.join(tempRoot, 'PRODUCT-SPEC-FRESH.md'), '# spec')
    const nested = path.join(tempRoot, 'clawstrap-surface')
    fs.mkdirSync(path.join(nested, 'src'), { recursive: true })

    expect(resolveMissionControlRepoRoot(nested)).toBe(tempRoot)
  })

  it('loads intelligence artifacts and hashes their content', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-load-'))
    fs.writeFileSync(path.join(tempRoot, 'PRODUCT-SPEC-FRESH.md'), '# spec')
    fs.writeFileSync(path.join(tempRoot, 'SYSTEM-ARCHITECTURE-ONTOLOGY-FRESH.md'), '# ontology')
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'activation-gate.json'), {
      mode_recommendation: 'guarded',
      hard_failures: [],
      required_context_files: ['PRODUCT-SPEC-FRESH.md'],
    })
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'run-manifest.json'), {
      generated_at: '2026-03-30T00:00:00Z',
      required_context_files: ['PRODUCT-SPEC-FRESH.md', 'SYSTEM-ARCHITECTURE-ONTOLOGY-FRESH.md'],
      anti_randomness_rules: ['Bound the slice'],
      decision_questions: ['What evidence proves this?'],
      no_go_conditions: ['Surface down'],
      recommended_self_build_loop: ['Restate the initiative'],
      self_improvement_loop: ['Detect the exposed platform gap'],
      final_solution_requirements: ['User outcome is complete and evidenced'],
      institutionalization_requirements: ['Update tests when the run exposes a missing guard'],
    })

    const bundle = loadSelfBuildIntelligence(tempRoot)

    expect(bundle).not.toBeNull()
    expect(bundle?.configHash).toMatch(/^[a-f0-9]{64}$/)
    expect(bundle?.runManifest.generated_at).toBe('2026-03-30T00:00:00Z')
  })

  it('blocks guarded multi-step self-build execution', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-guard-'))
    fs.writeFileSync(path.join(tempRoot, 'PRODUCT-SPEC-FRESH.md'), '# spec')
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'activation-gate.json'), {
      mode_recommendation: 'guarded',
      hard_failures: [],
      required_context_files: ['PRODUCT-SPEC-FRESH.md'],
    })
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'run-manifest.json'), {
      required_context_files: ['PRODUCT-SPEC-FRESH.md'],
      anti_randomness_rules: ['Bound the slice'],
      decision_questions: ['What evidence proves this?'],
      recommended_self_build_loop: ['Restate the initiative'],
      self_improvement_loop: ['Detect the exposed platform gap'],
      final_solution_requirements: ['User outcome is complete and evidenced'],
      institutionalization_requirements: ['Update tests when the run exposes a missing guard'],
    })

    const bundle = loadSelfBuildIntelligence(tempRoot)
    expect(bundle).not.toBeNull()

    const violations = evaluateSelfBuildGuard(bundle!, { stepCount: 2 })

    expect(violations).toContain('Self-build gate is guarded; multi-step autonomous pipeline execution is blocked until runtime truth is stronger.')
  })

  it('blocks manifests missing the true self-improvement contract', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-loop-'))
    fs.writeFileSync(path.join(tempRoot, 'PRODUCT-SPEC-FRESH.md'), '# spec')
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'activation-gate.json'), {
      mode_recommendation: 'full-lane-ready',
      hard_failures: [],
      required_context_files: ['PRODUCT-SPEC-FRESH.md'],
    })
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'run-manifest.json'), {
      required_context_files: ['PRODUCT-SPEC-FRESH.md'],
      anti_randomness_rules: ['Bound the slice'],
      decision_questions: ['What evidence proves this?'],
      recommended_self_build_loop: ['Restate the initiative'],
    })

    const bundle = loadSelfBuildIntelligence(tempRoot)
    expect(bundle).not.toBeNull()

    const violations = evaluateSelfBuildGuard(bundle!)

    expect(violations).toContain('Self-build manifest is missing the true self-improvement loop.')
    expect(violations).toContain('Self-build manifest is missing final solution requirements.')
  })

  it('detects self-build intent and emits a contract preamble', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-prompt-'))
    fs.writeFileSync(path.join(tempRoot, 'PRODUCT-SPEC-FRESH.md'), '# spec')
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'activation-gate.json'), {
      mode_recommendation: 'guarded',
      hard_failures: [],
      required_context_files: ['PRODUCT-SPEC-FRESH.md'],
    })
    writeJson(path.join(tempRoot, 'reviews', 'self-build-intelligence', 'run-manifest.json'), {
      generated_at: '2026-03-30T00:00:00Z',
      required_context_files: ['PRODUCT-SPEC-FRESH.md'],
      anti_randomness_rules: ['Do not improvise'],
      decision_questions: ['Which product outcome moves?'],
      no_go_conditions: ['Governor down'],
      recommended_self_build_loop: ['Restate the initiative'],
      self_improvement_loop: ['Detect the exposed platform gap'],
      final_solution_requirements: ['User outcome is complete and evidenced'],
      institutionalization_requirements: ['Update tests when the run exposes a missing guard'],
      carry_forward_rules: ['Do not call a solution final if it relies on undocumented operator memory'],
      harvest_questions: ['What made this initiative harder than it should have been?'],
    })

    const bundle = loadSelfBuildIntelligence(tempRoot)!
    const signals = collectSelfBuildSignals({
      name: 'Self-build initiative',
      description: 'Use PRODUCT-SPEC-FRESH and roadmap truth',
      tags: ['autonomous'],
    })

    expect(signals).toContain('self-build')
    expect(signals).toContain('mission-control-contract')

    const preamble = buildSelfBuildPromptPreamble(bundle, signals, 'task')
    expect(preamble).toContain('SELF-BUILD CONTRACT (TASK)')
    expect(preamble).toContain('Do not improvise outside this contract.')
    expect(preamble).toContain('PRODUCT-SPEC-FRESH.md')
    expect(preamble).toContain('True self-improvement loop:')
    expect(preamble).toContain('Final solution requirements:')
  })
})
