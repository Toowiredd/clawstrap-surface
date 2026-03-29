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

// ─── Typed query functions ─────────────────────────────────────────────────────

export const governorApi = {
  health: () => get<{ ok: boolean; ts: number }>('health'),
  visions: () => get<GovernorVision[]>('visions'),
  vision: (id: string) => get<GovernorVision>(`visions/${id}`),
  tasks: (visionId?: string) =>
    visionId ? get<GovernorTask[]>(`tasks/${visionId}`) : get<GovernorTask[]>('tasks'),
  decisions: (visionId?: string) =>
    visionId ? get<GovernorDecision[]>(`decisions/${visionId}`) : get<GovernorDecision[]>('decisions'),
  questions: (visionId?: string) =>
    visionId ? get<GovernorQuestion[]>(`questions/${visionId}`) : get<GovernorQuestion[]>('questions'),
  risks: (visionId?: string) =>
    visionId ? get<GovernorRisk[]>(`risks/${visionId}`) : get<GovernorRisk[]>('risks'),
  gates: (visionId?: string) =>
    visionId ? get<GovernorGate[]>(`gates/${visionId}`) : get<GovernorGate[]>('gates'),
  graph: (visionId?: string) =>
    visionId ? get<GovernorGraph>(`graph/${visionId}`) : get<GovernorGraph>('graph'),
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
      const data = JSON.parse(msg.data) as GovernorEvent
      onEvent(data)
    } catch {
      // ignore parse errors
    }
  }

  if (onError) es.onerror = onError

  return () => es.close()
}
