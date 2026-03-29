/**
 * governor.ts — typed client for the clawstrap-governor REST API.
 *
 * All requests go through /api/governor/[...path] which proxies to
 * GOVERNOR_URL (http://localhost:3001 by default) and applies surface auth.
 */

// ─── Domain types (mirrors clawstrap-governor schema) ─────────────────────────

export interface GovernorVision {
  id: string
  user_id: string
  title: string
  raw_intent: string
  status: 'proposed' | 'active' | 'paused' | 'complete' | 'archived'
  created_at: number
  updated_at: number
}

export interface GovernorTask {
  id: string
  spec_id: string
  vision_id: string | null
  title: string
  description: string
  status: 'proposed' | 'active' | 'blocked' | 'done' | 'cancelled' | 'waiting_approval' | 'at_risk'
  attention: 'none' | 'watch' | 'needs_input' | 'urgent'
  confidence: 'low' | 'medium' | 'high'
  phase: number
  claimed_by: string | null
  claimed_at: number | null
  created_at: number
  updated_at: number
}

export interface GovernorDecision {
  id: string
  vision_id: string | null
  spec_id: string | null
  task_id: string | null
  title: string
  description: string
  decision_type: 'architectural' | 'product' | 'workflow' | 'scope'
  outcome: 'approved' | 'blocked' | 'deferred' | 'overridden'
  rationale: string
  made_by: string
  requires_approval: number
  created_at: number
}

export interface GovernorQuestion {
  id: string
  vision_id: string | null
  spec_id: string | null
  task_id: string | null
  body: string
  why_it_matters: string
  consequence_of_delay: string
  status: 'open' | 'answered' | 'dismissed' | 'expired'
  attention: 'none' | 'watch' | 'needs_input' | 'urgent'
  answer: string | null
  created_at: number
  updated_at: number
}

export interface GovernorRisk {
  id: string
  vision_id: string | null
  spec_id: string | null
  task_id: string | null
  title: string
  description: string
  risk_type: 'complexity' | 'blocker' | 'uncertainty' | 'regression' | 'assumption'
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'active' | 'mitigated' | 'resolved' | 'accepted' | 'archived'
  attention: 'none' | 'watch' | 'needs_input' | 'urgent'
  created_at: number
  updated_at: number
}

export interface GovernorGate {
  id: string
  entity_type: string
  entity_id: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  requested_at: number
  resolved_at: number | null
  resolved_by: string | null
  resolution_note: string | null
}

export interface GovernorGraphNode {
  id: string
  node_type: string
  label: string
  status: string
  attention: string
  importance: number
  vision_id: string | null
  updated_at: number
}

export interface GovernorGraph {
  nodes: GovernorGraphNode[]
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

const BASE = '/api/governor'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Governor API error ${res.status} on /${path}`)
  return res.json() as Promise<T>
}

type WireRecord = Record<string, unknown>

function toRecord(input: unknown): WireRecord | null {
  return input && typeof input === 'object' ? (input as WireRecord) : null
}

function pick(raw: WireRecord, snake: string, camel: string): unknown {
  return raw[snake] ?? raw[camel]
}

function readString(raw: WireRecord, snake: string, camel: string): string | null {
  const value = pick(raw, snake, camel)
  return typeof value === 'string' ? value : null
}

function readNumber(raw: WireRecord, snake: string, camel: string): number | null {
  const value = pick(raw, snake, camel)
  return typeof value === 'number' ? value : null
}

function readNullableString(raw: WireRecord, snake: string, camel: string): string | null {
  const value = pick(raw, snake, camel)
  return typeof value === 'string' ? value : null
}

function normalizeVision(input: unknown): GovernorVision | null {
  const raw = toRecord(input)
  if (!raw) return null

  const id = readString(raw, 'id', 'id')
  const user_id = readString(raw, 'user_id', 'userId')
  const title = readString(raw, 'title', 'title')
  const raw_intent = readString(raw, 'raw_intent', 'rawIntent')
  const status = readString(raw, 'status', 'status')
  const created_at = readNumber(raw, 'created_at', 'createdAt')
  const updated_at = readNumber(raw, 'updated_at', 'updatedAt')

  if (!id || !user_id || !title || !raw_intent || !status || created_at === null || updated_at === null) {
    return null
  }

  return {
    id,
    user_id,
    title,
    raw_intent,
    status: status as GovernorVision['status'],
    created_at,
    updated_at,
  }
}

function normalizeTask(input: unknown): GovernorTask | null {
  const raw = toRecord(input)
  if (!raw) return null

  const id = readString(raw, 'id', 'id')
  const spec_id = readString(raw, 'spec_id', 'specId')
  const title = readString(raw, 'title', 'title')
  const description = readString(raw, 'description', 'description')
  const status = readString(raw, 'status', 'status')
  const attention = readString(raw, 'attention', 'attention')
  const confidence = readString(raw, 'confidence', 'confidence')
  const phase = readNumber(raw, 'phase', 'phase')
  const created_at = readNumber(raw, 'created_at', 'createdAt')
  const updated_at = readNumber(raw, 'updated_at', 'updatedAt')
  const vision_id = readNullableString(raw, 'vision_id', 'visionId')
  const claimed_by = readNullableString(raw, 'claimed_by', 'claimedBy')
  const claimed_at = readNumber(raw, 'claimed_at', 'claimedAt')

  if (
    !id ||
    !spec_id ||
    !title ||
    !description ||
    !status ||
    !attention ||
    !confidence ||
    phase === null ||
    created_at === null ||
    updated_at === null
  ) {
    return null
  }

  return {
    id,
    spec_id,
    vision_id,
    title,
    description,
    status: status as GovernorTask['status'],
    attention: attention as GovernorTask['attention'],
    confidence: confidence as GovernorTask['confidence'],
    phase,
    claimed_by,
    claimed_at,
    created_at,
    updated_at,
  }
}

function normalizeDecision(input: unknown): GovernorDecision | null {
  const raw = toRecord(input)
  if (!raw) return null

  const id = readString(raw, 'id', 'id')
  const title = readString(raw, 'title', 'title')
  const description = readString(raw, 'description', 'description')
  const decision_type = readString(raw, 'decision_type', 'decisionType')
  const outcome = readString(raw, 'outcome', 'outcome')
  const rationale = readString(raw, 'rationale', 'rationale')
  const made_by = readString(raw, 'made_by', 'madeBy')
  const requires_approval = readNumber(raw, 'requires_approval', 'requiresApproval')
  const created_at = readNumber(raw, 'created_at', 'createdAt')
  const vision_id = readNullableString(raw, 'vision_id', 'visionId')
  const spec_id = readNullableString(raw, 'spec_id', 'specId')
  const task_id = readNullableString(raw, 'task_id', 'taskId')

  if (
    !id ||
    !title ||
    !description ||
    !decision_type ||
    !outcome ||
    !rationale ||
    !made_by ||
    requires_approval === null ||
    created_at === null
  ) {
    return null
  }

  return {
    id,
    vision_id,
    spec_id,
    task_id,
    title,
    description,
    decision_type: decision_type as GovernorDecision['decision_type'],
    outcome: outcome as GovernorDecision['outcome'],
    rationale,
    made_by,
    requires_approval,
    created_at,
  }
}

function normalizeQuestion(input: unknown): GovernorQuestion | null {
  const raw = toRecord(input)
  if (!raw) return null

  const id = readString(raw, 'id', 'id')
  const body = readString(raw, 'body', 'body')
  const why_it_matters = readString(raw, 'why_it_matters', 'whyItMatters')
  const consequence_of_delay = readString(raw, 'consequence_of_delay', 'consequenceOfDelay')
  const status = readString(raw, 'status', 'status')
  const attention = readString(raw, 'attention', 'attention')
  const answer = readNullableString(raw, 'answer', 'answer')
  const created_at = readNumber(raw, 'created_at', 'createdAt')
  const updated_at = readNumber(raw, 'updated_at', 'updatedAt')
  const vision_id = readNullableString(raw, 'vision_id', 'visionId')
  const spec_id = readNullableString(raw, 'spec_id', 'specId')
  const task_id = readNullableString(raw, 'task_id', 'taskId')

  if (
    !id ||
    !body ||
    !why_it_matters ||
    !consequence_of_delay ||
    !status ||
    !attention ||
    created_at === null ||
    updated_at === null
  ) {
    return null
  }

  return {
    id,
    vision_id,
    spec_id,
    task_id,
    body,
    why_it_matters,
    consequence_of_delay,
    status: status as GovernorQuestion['status'],
    attention: attention as GovernorQuestion['attention'],
    answer,
    created_at,
    updated_at,
  }
}

function normalizeRisk(input: unknown): GovernorRisk | null {
  const raw = toRecord(input)
  if (!raw) return null

  const id = readString(raw, 'id', 'id')
  const title = readString(raw, 'title', 'title')
  const description = readString(raw, 'description', 'description')
  const risk_type = readString(raw, 'risk_type', 'riskType')
  const severity = readString(raw, 'severity', 'severity')
  const status = readString(raw, 'status', 'status')
  const attention = readString(raw, 'attention', 'attention')
  const created_at = readNumber(raw, 'created_at', 'createdAt')
  const updated_at = readNumber(raw, 'updated_at', 'updatedAt')
  const vision_id = readNullableString(raw, 'vision_id', 'visionId')
  const spec_id = readNullableString(raw, 'spec_id', 'specId')
  const task_id = readNullableString(raw, 'task_id', 'taskId')

  if (
    !id ||
    !title ||
    !description ||
    !risk_type ||
    !severity ||
    !status ||
    !attention ||
    created_at === null ||
    updated_at === null
  ) {
    return null
  }

  return {
    id,
    vision_id,
    spec_id,
    task_id,
    title,
    description,
    risk_type: risk_type as GovernorRisk['risk_type'],
    severity: severity as GovernorRisk['severity'],
    status: status as GovernorRisk['status'],
    attention: attention as GovernorRisk['attention'],
    created_at,
    updated_at,
  }
}

function normalizeGate(input: unknown): GovernorGate | null {
  const raw = toRecord(input)
  if (!raw) return null

  const id = readString(raw, 'id', 'id')
  const entity_type = readString(raw, 'entity_type', 'entityType')
  const entity_id = readString(raw, 'entity_id', 'entityId')
  const reason = readString(raw, 'reason', 'reason')
  const status = readString(raw, 'status', 'status')
  const requested_at = readNumber(raw, 'requested_at', 'requestedAt')
  const resolved_at = readNumber(raw, 'resolved_at', 'resolvedAt')
  const resolved_by = readNullableString(raw, 'resolved_by', 'resolvedBy')
  const resolution_note = readNullableString(raw, 'resolution_note', 'resolutionNote')

  if (!id || !entity_type || !entity_id || !reason || !status || requested_at === null) {
    return null
  }

  return {
    id,
    entity_type,
    entity_id,
    reason,
    status: status as GovernorGate['status'],
    requested_at,
    resolved_at,
    resolved_by,
    resolution_note,
  }
}

function normalizeGraphNode(input: unknown): GovernorGraphNode | null {
  const raw = toRecord(input)
  if (!raw) return null

  const id = readString(raw, 'id', 'id')
  const node_type = readString(raw, 'node_type', 'nodeType')
  const label = readString(raw, 'label', 'label')
  const status = readString(raw, 'status', 'status')
  const attention = readString(raw, 'attention', 'attention')
  const importance = readNumber(raw, 'importance', 'importance')
  const updated_at = readNumber(raw, 'updated_at', 'updatedAt')
  const vision_id = readNullableString(raw, 'vision_id', 'visionId')

  if (!id || !node_type || !label || !status || !attention || importance === null || updated_at === null) {
    return null
  }

  return {
    id,
    node_type,
    label,
    status,
    attention,
    importance,
    vision_id,
    updated_at,
  }
}

function normalizeList<T>(input: unknown, normalize: (value: unknown) => T | null): T[] {
  if (!Array.isArray(input)) return []
  const out: T[] = []
  for (const item of input) {
    const next = normalize(item)
    if (next) out.push(next)
  }
  return out
}

// ─── Typed query functions ─────────────────────────────────────────────────────

export const governorApi = {
  health: () => get<{ ok: boolean; ts: number }>('health'),
  visions: async () => normalizeList(await get<unknown>('visions'), normalizeVision),
  vision: async (id: string) => {
    const normalized = normalizeVision(await get<unknown>(`visions/${id}`))
    if (!normalized) throw new Error(`Governor vision payload malformed for ${id}`)
    return normalized
  },
  tasks: (visionId?: string) =>
    visionId
      ? get<unknown>(`tasks/${visionId}`).then((rows) => normalizeList(rows, normalizeTask))
      : get<unknown>('tasks').then((rows) => normalizeList(rows, normalizeTask)),
  decisions: (visionId?: string) =>
    visionId
      ? get<unknown>(`decisions/${visionId}`).then((rows) => normalizeList(rows, normalizeDecision))
      : get<unknown>('decisions').then((rows) => normalizeList(rows, normalizeDecision)),
  questions: (visionId?: string) =>
    visionId
      ? get<unknown>(`questions/${visionId}`).then((rows) => normalizeList(rows, normalizeQuestion))
      : get<unknown>('questions').then((rows) => normalizeList(rows, normalizeQuestion)),
  risks: (visionId?: string) =>
    visionId
      ? get<unknown>(`risks/${visionId}`).then((rows) => normalizeList(rows, normalizeRisk))
      : get<unknown>('risks').then((rows) => normalizeList(rows, normalizeRisk)),
  gates: (visionId?: string) =>
    visionId
      ? get<unknown>(`gates/${visionId}`).then((rows) => normalizeList(rows, normalizeGate))
      : get<unknown>('gates').then((rows) => normalizeList(rows, normalizeGate)),
  graph: async (visionId?: string) => {
    const raw = await (visionId ? get<unknown>(`graph/${visionId}`) : get<unknown>('graph'))
    const record = toRecord(raw)
    const nodes = normalizeList(record?.nodes, normalizeGraphNode)
    return { nodes }
  },
}

// ─── SSE hook ──────────────────────────────────────────────────────────────────

export interface GovernorEvent {
  id: string
  event_class: string
  event_type: string
  entity_type: string
  entity_id: string
  actor: string | null
  vision_id: string | null
  payload: Record<string, unknown>
  created_at: number
}

type GovernorEventWire = {
  id?: unknown
  event_class?: unknown
  event_type?: unknown
  entity_type?: unknown
  entity_id?: unknown
  actor?: unknown
  vision_id?: unknown
  payload?: unknown
  created_at?: unknown
  eventClass?: unknown
  eventType?: unknown
  entityType?: unknown
  entityId?: unknown
  visionId?: unknown
  createdAt?: unknown
}

/**
 * Normalizes governor SSE payloads from either snake_case or camelCase into a
 * stable surface-facing GovernorEvent shape.
 */
export function normalizeGovernorEvent(input: unknown): GovernorEvent | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as GovernorEventWire

  const id = raw.id
  const eventClass = raw.event_class ?? raw.eventClass
  const eventType = raw.event_type ?? raw.eventType
  const entityType = raw.entity_type ?? raw.entityType
  const entityId = raw.entity_id ?? raw.entityId
  const createdAt = raw.created_at ?? raw.createdAt
  const visionId = raw.vision_id ?? raw.visionId ?? null

  if (
    typeof id !== 'string' ||
    typeof eventClass !== 'string' ||
    typeof eventType !== 'string' ||
    typeof entityType !== 'string' ||
    typeof entityId !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return null
  }

  return {
    id,
    event_class: eventClass,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    actor: typeof raw.actor === 'string' ? raw.actor : null,
    vision_id: typeof visionId === 'string' ? visionId : null,
    payload:
      raw.payload && typeof raw.payload === 'object'
        ? (raw.payload as Record<string, unknown>)
        : {},
    created_at: createdAt,
  }
}

/**
 * Subscribe to the governor's SSE event stream.
 * Returns a cleanup function to close the connection.
 */
export function subscribeGovernorEvents(
  onEvent: (event: GovernorEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const es = new EventSource(`${BASE}/events`)

  es.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as unknown
      const data = normalizeGovernorEvent(parsed)
      if (data) onEvent(data)
    } catch {
      // ignore parse errors
    }
  }

  if (onError) es.onerror = onError

  return () => es.close()
}
