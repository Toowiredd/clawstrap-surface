import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface SelfBuildActivationGate {
  generated_at?: string
  idea?: string
  mode_recommendation?: string
  required_context_files?: string[]
  hard_failures?: string[]
  soft_warnings?: string[]
  self_improvement_markdown_path?: string
  self_improvement_json_path?: string
}

export interface SelfBuildRunManifest {
  generated_at?: string
  idea?: string
  recommended_mode?: string
  required_context_files?: string[]
  topology_pass_options?: string[]
  topology_fail_options?: string[]
  anti_randomness_rules?: string[]
  recommended_self_build_loop?: string[]
  self_improvement_loop?: string[]
  final_solution_requirements?: string[]
  institutionalization_requirements?: string[]
  carry_forward_rules?: string[]
  harvest_questions?: string[]
  decision_questions?: string[]
  canonical_sources?: Record<string, string[]>
  no_go_conditions?: string[]
}

export interface SelfBuildIntelligenceBundle {
  repoRoot: string
  activationGatePath: string
  runManifestPath: string
  activationGate: SelfBuildActivationGate
  runManifest: SelfBuildRunManifest
  configHash: string
}

export interface SelfBuildIntentInput {
  name?: string | null
  description?: string | null
  prompt?: string | null
  tags?: string[] | null
}

const SELF_BUILD_SIGNAL_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'self-build', pattern: /\bself[- ]build\b/i },
  { label: 'autonomous', pattern: /\bautonomous\b/i },
  { label: 'initiative', pattern: /\binitiative\b/i },
  { label: 'topology', pattern: /\btopology\b/i },
  { label: 'mission-control-contract', pattern: /\b(product-spec-fresh|system-architecture-ontology-fresh|roadmap-forensic-execution|self-build-enablement|autonomous\.md)\b/i },
  { label: 'governor-contract', pattern: /\bgovernor-as-source-of-truth\b/i },
  { label: 'clawstrap', pattern: /\bclawstrap\b/i },
]

function parseJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath)
  } catch {
    return false
  }
}

export function resolveMissionControlRepoRoot(cwd: string = process.cwd()): string {
  const fromEnv = String(process.env.MISSION_CONTROL_REPO_ROOT || '').trim()
  const candidates = [
    fromEnv,
    cwd,
    path.resolve(cwd, '..'),
    path.resolve(cwd, '..', '..'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (
      fileExists(path.join(candidate, 'reviews', 'self-build-intelligence', 'run-manifest.json')) ||
      fileExists(path.join(candidate, 'PRODUCT-SPEC-FRESH.md'))
    ) {
      return candidate
    }
  }

  return fromEnv || cwd
}

export function collectSelfBuildSignals(input: SelfBuildIntentInput): string[] {
  const values = [
    input.name || '',
    input.description || '',
    input.prompt || '',
    ...(input.tags || []),
  ]
  const haystack = values.join('\n')
  const matches = new Set<string>()

  for (const signal of SELF_BUILD_SIGNAL_PATTERNS) {
    if (signal.pattern.test(haystack)) {
      matches.add(signal.label)
    }
  }

  return [...matches]
}

export function isSelfBuildIntent(input: SelfBuildIntentInput): boolean {
  return collectSelfBuildSignals(input).length > 0
}

export function loadSelfBuildIntelligence(repoRoot: string = resolveMissionControlRepoRoot()): SelfBuildIntelligenceBundle | null {
  const activationGatePath = path.join(repoRoot, 'reviews', 'self-build-intelligence', 'activation-gate.json')
  const runManifestPath = path.join(repoRoot, 'reviews', 'self-build-intelligence', 'run-manifest.json')

  if (!fileExists(activationGatePath) || !fileExists(runManifestPath)) {
    return null
  }

  const activationGate = parseJsonFile<SelfBuildActivationGate>(activationGatePath)
  const runManifest = parseJsonFile<SelfBuildRunManifest>(runManifestPath)
  const configHash = createHash('sha256')
    .update(JSON.stringify({ activationGate, runManifest }))
    .digest('hex')

  return {
    repoRoot,
    activationGatePath,
    runManifestPath,
    activationGate,
    runManifest,
    configHash,
  }
}

export function requireSelfBuildIntelligence(repoRoot?: string): SelfBuildIntelligenceBundle {
  const bundle = loadSelfBuildIntelligence(repoRoot)
  if (!bundle) {
    throw new Error('Missing self-build intelligence artifacts. Run scripts/build-activation-intelligence.ps1 before autonomous execution.')
  }
  return bundle
}

export function evaluateSelfBuildGuard(
  bundle: SelfBuildIntelligenceBundle,
  opts?: { stepCount?: number },
): string[] {
  const violations: string[] = []
  const gateFailures = bundle.activationGate.hard_failures || []
  const requiredContextFiles = bundle.runManifest.required_context_files || bundle.activationGate.required_context_files || []

  if (gateFailures.length > 0) {
    violations.push(...gateFailures)
  }

  for (const relativePath of requiredContextFiles) {
    const absolutePath = path.join(bundle.repoRoot, relativePath)
    if (!fileExists(absolutePath)) {
      violations.push(`Required self-build context file missing: ${relativePath}`)
    }
  }

  if ((bundle.runManifest.anti_randomness_rules || []).length === 0) {
    violations.push('Self-build manifest is missing anti-randomness rules.')
  }

  if ((bundle.runManifest.decision_questions || []).length === 0) {
    violations.push('Self-build manifest is missing decision questions.')
  }

  if ((bundle.runManifest.self_improvement_loop || []).length === 0) {
    violations.push('Self-build manifest is missing the true self-improvement loop.')
  }

  if ((bundle.runManifest.final_solution_requirements || []).length === 0) {
    violations.push('Self-build manifest is missing final solution requirements.')
  }

  if ((opts?.stepCount || 0) > 1 && bundle.activationGate.mode_recommendation === 'guarded') {
    violations.push('Self-build gate is guarded; multi-step autonomous pipeline execution is blocked until runtime truth is stronger.')
  }

  return violations
}

export function buildSelfBuildPromptPreamble(
  bundle: SelfBuildIntelligenceBundle,
  signals: string[],
  mode: 'task' | 'pipeline',
): string {
  const requiredContext = bundle.runManifest.required_context_files || []
  const rules = bundle.runManifest.anti_randomness_rules || []
  const questions = bundle.runManifest.decision_questions || []
  const noGo = bundle.runManifest.no_go_conditions || []
  const loop = bundle.runManifest.recommended_self_build_loop || []
  const selfImprovementLoop = bundle.runManifest.self_improvement_loop || []
  const finalSolutionRequirements = bundle.runManifest.final_solution_requirements || []
  const institutionalizationRequirements = bundle.runManifest.institutionalization_requirements || []
  const carryForwardRules = bundle.runManifest.carry_forward_rules || []
  const harvestQuestions = bundle.runManifest.harvest_questions || []

  const lines = [
    `SELF-BUILD CONTRACT (${mode.toUpperCase()})`,
    `- Mode: ${bundle.activationGate.mode_recommendation || bundle.runManifest.recommended_mode || 'unknown'}`,
    `- Manifest generated at: ${bundle.runManifest.generated_at || 'unknown'}`,
    `- Intelligence config hash: ${bundle.configHash}`,
    `- Intent signals: ${signals.join(', ') || 'none'}`,
    '- Required context files:',
    ...requiredContext.map((item) => `  - ${item}`),
    '- Anti-randomness rules:',
    ...rules.map((item) => `  - ${item}`),
    '- Mandatory decision questions:',
    ...questions.map((item) => `  - ${item}`),
    '- No-go conditions:',
    ...noGo.map((item) => `  - ${item}`),
    '- Required execution loop:',
    ...loop.map((item, index) => `  ${index + 1}. ${item}`),
    '- True self-improvement loop:',
    ...selfImprovementLoop.map((item, index) => `  ${index + 1}. ${item}`),
    '- Final solution requirements:',
    ...finalSolutionRequirements.map((item) => `  - ${item}`),
    '- Institutionalization requirements:',
    ...institutionalizationRequirements.map((item) => `  - ${item}`),
    '- Carry-forward rules:',
    ...carryForwardRules.map((item) => `  - ${item}`),
    '- Harvest questions:',
    ...harvestQuestions.map((item) => `  - ${item}`),
    'Do not improvise outside this contract. If evidence, topology, runtime truth, and product truth diverge, stop and report the conflict.',
  ]

  return lines.join('\n')
}

export function buildSelfBuildMetadata(bundle: SelfBuildIntelligenceBundle, signals: string[]) {
  return {
    enabled: true,
    mode: bundle.activationGate.mode_recommendation || bundle.runManifest.recommended_mode || 'unknown',
    intent_signals: signals,
    config_hash: bundle.configHash,
    manifest_generated_at: bundle.runManifest.generated_at || null,
    gate_generated_at: bundle.activationGate.generated_at || null,
    manifest_path: bundle.runManifestPath,
    gate_path: bundle.activationGatePath,
    required_context_files: bundle.runManifest.required_context_files || bundle.activationGate.required_context_files || [],
    final_solution_requirements: bundle.runManifest.final_solution_requirements || [],
    institutionalization_requirements: bundle.runManifest.institutionalization_requirements || [],
  }
}
