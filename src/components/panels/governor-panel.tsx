'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  governorApi,
  subscribeGovernorEvents,
  type GovernorGraph,
  type GovernorGraphNode,
  type GovernorVision,
  type GovernorTask,
  type GovernorDecision,
  type GovernorQuestion,
  type GovernorRisk,
  type GovernorGate,
  type GovernorEvent,
} from '@/lib/governor'

const ENABLE_GRAPH_3D_PREVIEW = process.env.NEXT_PUBLIC_GOVERNOR_GRAPH_3D_PREVIEW === '1'

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  // Tasks / visions
  proposed:        'bg-slate-700 text-slate-300',
  active:          'bg-blue-900 text-blue-300',
  blocked:         'bg-red-900 text-red-300',
  done:            'bg-green-900 text-green-300',
  cancelled:       'bg-zinc-700 text-zinc-400',
  waiting_approval:'bg-yellow-900 text-yellow-300',
  at_risk:         'bg-orange-900 text-orange-300',
  // Decisions
  approved:        'bg-green-900 text-green-300',
  deferred:        'bg-slate-700 text-slate-300',
  overridden:      'bg-purple-900 text-purple-300',
  // Questions / gates / risks
  open:            'bg-yellow-900 text-yellow-300',
  answered:        'bg-green-900 text-green-300',
  pending:         'bg-amber-900 text-amber-300',
  rejected:        'bg-red-900 text-red-300',
  mitigated:       'bg-teal-900 text-teal-300',
  resolved:        'bg-green-900 text-green-300',
  accepted:        'bg-slate-700 text-slate-300',
  // Severity
  critical:        'bg-red-800 text-red-200',
  high:            'bg-orange-800 text-orange-200',
  medium:          'bg-yellow-800 text-yellow-200',
  low:             'bg-slate-700 text-slate-300',
}

function Badge({ label }: { label: string }) {
  const cls = STATUS_COLORS[label] ?? 'bg-slate-700 text-slate-300'
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${cls}`}>
      {label}
    </span>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{title}</h3>
        <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{count}</span>
      </div>
      {children}
    </div>
  )
}

// ─── Row components ───────────────────────────────────────────────────────────

function TaskRow({ task }: { task: GovernorTask }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-slate-800 last:border-0">
      <Badge label={task.status} />
      <span className="flex-1 text-sm text-slate-200 truncate">{task.title}</span>
      {task.claimed_by && (
        <span className="text-xs text-slate-500 font-mono">{task.claimed_by}</span>
      )}
      <span className="text-xs text-slate-600">ph{task.phase}</span>
    </div>
  )
}

function DecisionRow({ dec }: { dec: GovernorDecision }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-slate-800 last:border-0">
      <Badge label={dec.outcome} />
      <span className="flex-1 text-sm text-slate-200 truncate">{dec.title}</span>
      <span className="text-xs text-slate-500 font-mono">{dec.made_by}</span>
    </div>
  )
}

function QuestionRow({ q }: { q: GovernorQuestion }) {
  return (
    <div className="py-1.5 border-b border-slate-800 last:border-0">
      <div className="flex items-center gap-2">
        <Badge label={q.status} />
        <Badge label={q.attention} />
        <span className="flex-1 text-sm text-slate-200 truncate">{q.body}</span>
      </div>
      {q.answer && (
        <p className="text-xs text-slate-400 mt-1 pl-1 border-l-2 border-green-700 ml-1">
          {q.answer}
        </p>
      )}
    </div>
  )
}

function RiskRow({ risk }: { risk: GovernorRisk }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-slate-800 last:border-0">
      <Badge label={risk.severity} />
      <Badge label={risk.status} />
      <span className="flex-1 text-sm text-slate-200 truncate">{risk.title}</span>
    </div>
  )
}

function GateRow({ gate }: { gate: GovernorGate }) {
  return (
    <div className="py-1.5 border-b border-slate-800 last:border-0">
      <div className="flex items-center gap-2">
        <Badge label={gate.status} />
        <span className="flex-1 text-sm text-slate-200 truncate">{gate.reason}</span>
      </div>
      <p className="text-xs text-slate-500 mt-0.5 font-mono">{gate.entity_type}:{gate.entity_id}</p>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface GovernorState {
  visions: GovernorVision[]
  tasks: GovernorTask[]
  decisions: GovernorDecision[]
  questions: GovernorQuestion[]
  risks: GovernorRisk[]
  gates: GovernorGate[]
  graph: GovernorGraph
  events: GovernorEvent[]
  online: boolean | null
  lastRefresh: number | null
}

const EMPTY_STATE: GovernorState = {
  visions: [],
  tasks: [],
  decisions: [],
  questions: [],
  risks: [],
  gates: [],
  graph: {
    nodes: [],
    edges: [],
    contract_version: 'graph.legacy',
    generated_at: 0,
    stats: { node_count: 0, edge_count: 0, orphan_edges: 0 },
  },
  events: [],
  online: null,
  lastRefresh: null,
}

type GraphViewMode = '2d' | '3d-preview'
type GraphUrgencyClass = 'urgent' | 'needs_input' | 'blocked' | 'at_risk' | 'pending'

const HOTSPOT_STATUSES = new Set(['blocked', 'at_risk', 'pending'])
const HOTSPOT_ATTENTION = new Set(['urgent', 'needs_input'])
const GRAPH_URGENCY_CLASS_ORDER: GraphUrgencyClass[] = ['urgent', 'needs_input', 'blocked', 'at_risk', 'pending']

function isHotspotNode(node: GovernorGraphNode) {
  return HOTSPOT_STATUSES.has(node.status) || HOTSPOT_ATTENTION.has(node.attention)
}

function getGraphUrgencyClass(node: GovernorGraphNode): GraphUrgencyClass {
  if (node.attention === 'urgent') return 'urgent'
  if (node.attention === 'needs_input') return 'needs_input'
  if (node.status === 'blocked') return 'blocked'
  if (node.status === 'at_risk') return 'at_risk'
  return 'pending'
}

export function GovernorPanel() {
  const [state, setState] = useState<GovernorState>(EMPTY_STATE)
  const [selectedVisionId, setSelectedVisionId] = useState<string | null>(null)
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>('2d')
  const [graphTypeFilter, setGraphTypeFilter] = useState<string>('all')
  const [graphUrgencyFilter, setGraphUrgencyFilter] = useState<'all' | GraphUrgencyClass>('all')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (visionId?: string | null) => {
    try {
      await governorApi.health()

      const [visions, tasks, decisions, questions, risks, gates, graph] = await Promise.all([
        governorApi.visions(),
        governorApi.tasks(visionId ?? undefined),
        governorApi.decisions(visionId ?? undefined),
        governorApi.questions(visionId ?? undefined),
        governorApi.risks(visionId ?? undefined),
        governorApi.gates(visionId ?? undefined),
        governorApi.graph(visionId ?? undefined),
      ])

      setState((prev) => ({
        ...prev,
        visions,
        tasks,
        decisions,
        questions,
        risks,
        gates,
        graph,
        online: true,
        lastRefresh: Date.now(),
      }))
    } catch {
      setState((prev) => ({ ...prev, online: false }))
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + 30s polling
  useEffect(() => {
    refresh(selectedVisionId)
    const timer = setInterval(() => refresh(selectedVisionId), 30_000)
    return () => clearInterval(timer)
  }, [refresh, selectedVisionId])

  // SSE subscription — incremental updates without full reload
  useEffect(() => {
    const unsub = subscribeGovernorEvents(
      (event) => {
        setState((prev) => ({
          ...prev,
          events: [event, ...prev.events].slice(0, 50),
        }))
        // Trigger a background refresh on any state-mutating event
        refresh(selectedVisionId)
      },
    )
    return unsub
  }, [refresh, selectedVisionId])

  const activeTasks = state.tasks.filter((t) => ['active', 'proposed', 'blocked', 'at_risk', 'waiting_approval'].includes(t.status))
  const openQuestions = state.questions.filter((q) => q.status === 'open')
  const activeRisks = state.risks.filter((r) => r.status === 'active')
  const pendingGates = state.gates.filter((g) => g.status === 'pending')

  const hotspotNodes = state.graph.nodes.filter(isHotspotNode)
  const graphTypeOptions = [...new Set(hotspotNodes.map((node) => node.node_type))].sort((a, b) => a.localeCompare(b))
  const graphUrgencyOptions = GRAPH_URGENCY_CLASS_ORDER.filter((urgency) =>
    hotspotNodes.some((node) => getGraphUrgencyClass(node) === urgency),
  )

  const graphHotspots = hotspotNodes
    .filter((node) => graphTypeFilter === 'all' || node.node_type === graphTypeFilter)
    .filter((node) => graphUrgencyFilter === 'all' || getGraphUrgencyClass(node) === graphUrgencyFilter)
    .slice(0, 12)

  const hotspotsByType = hotspotNodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.node_type] = (acc[node.node_type] ?? 0) + 1
    return acc
  }, {})

  const hotspotsByUrgency = hotspotNodes.reduce<Record<GraphUrgencyClass, number>>((acc, node) => {
    const urgency = getGraphUrgencyClass(node)
    acc[urgency] = (acc[urgency] ?? 0) + 1
    return acc
  }, {
    urgent: 0,
    needs_input: 0,
    blocked: 0,
    at_risk: 0,
    pending: 0,
  })

  const renderGraphNodeRow = (node: GovernorGraphNode) => (
    <div key={node.id} className="py-1.5 border-b border-slate-800 last:border-0">
      <div className="flex items-center gap-2">
        <Badge label={node.status} />
        <Badge label={node.attention} />
        <span className="text-xs text-slate-500 font-mono uppercase">{node.node_type}</span>
        <span className="flex-1 text-sm text-slate-200 truncate">{node.label}</span>
      </div>
      <p className="text-xs text-slate-500 font-mono mt-0.5">{node.id}</p>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-[#0f1117] text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Governor</h2>
          <span
            className={`h-2 w-2 rounded-full ${
              state.online === null ? 'bg-slate-600' : state.online ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          {state.online === false && (
            <span className="text-xs text-red-400">Offline — start governor on :3001</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Vision selector */}
          <select
            className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300"
            value={selectedVisionId ?? ''}
            onChange={(e) => setSelectedVisionId(e.target.value || null)}
          >
            <option value="">All visions</option>
            {state.visions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </select>

          <button
            onClick={() => refresh(selectedVisionId)}
            className="text-xs text-slate-400 hover:text-slate-200 bg-slate-800 px-2 py-1 rounded border border-slate-700"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Stat bar */}
      <div className="flex gap-4 px-4 py-2 border-b border-slate-800 text-xs text-slate-400">
        <span><span className="text-white font-mono">{activeTasks.length}</span> active tasks</span>
        <span><span className="text-yellow-400 font-mono">{openQuestions.length}</span> open questions</span>
        <span><span className="text-orange-400 font-mono">{activeRisks.length}</span> active risks</span>
        <span><span className="text-amber-400 font-mono">{pendingGates.length}</span> pending gates</span>
        <span><span className="text-blue-400 font-mono">{state.decisions.length}</span> decisions</span>
        <span><span className="text-cyan-400 font-mono">{state.graph.stats.node_count}</span> graph nodes</span>
        <span><span className="text-fuchsia-400 font-mono">{state.graph.stats.edge_count}</span> graph edges</span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            Connecting to governor…
          </div>
        ) : state.online === false ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-500">
            <p className="text-sm">Governor is not running.</p>
            <p className="text-xs font-mono">cd clawstrap-governor && npm start</p>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column */}
            <div>
              <Section title="Active Tasks" count={activeTasks.length}>
                {activeTasks.length === 0 ? (
                  <p className="text-xs text-slate-500">No active tasks.</p>
                ) : (
                  activeTasks.map((t) => <TaskRow key={t.id} task={t} />)
                )}
              </Section>

              <Section title="Open Questions" count={openQuestions.length}>
                {openQuestions.length === 0 ? (
                  <p className="text-xs text-slate-500">No open questions.</p>
                ) : (
                  openQuestions.map((q) => <QuestionRow key={q.id} q={q} />)
                )}
              </Section>

              <Section title="Pending Approval Gates" count={pendingGates.length}>
                {pendingGates.length === 0 ? (
                  <p className="text-xs text-slate-500">No gates pending.</p>
                ) : (
                  pendingGates.map((g) => <GateRow key={g.id} gate={g} />)
                )}
              </Section>
            </div>

            {/* Right column */}
            <div>
              <Section title="Mission Graph" count={state.graph.stats.node_count}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-500 font-mono">
                    contract {state.graph.contract_version} · {graphViewMode}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setGraphViewMode('2d')}
                      className={`text-xs px-2 py-1 rounded border ${graphViewMode === '2d' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                    >
                      2D
                    </button>
                    {ENABLE_GRAPH_3D_PREVIEW && (
                      <button
                        onClick={() => setGraphViewMode('3d-preview')}
                        className={`text-xs px-2 py-1 rounded border ${graphViewMode === '3d-preview' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                      >
                        3D-preview
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-500 mb-2">
                  {graphViewMode === '2d'
                    ? '2D operator view: hotspot-first list for rapid scan.'
                    : '3D-preview mode: preview semantics only in this panel (lineage/hotspot intent), not final 3D scene rendering.'}
                </div>
                <div className="mb-2 text-xs border border-slate-800 rounded bg-slate-900/40 px-2 py-1 text-slate-400">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-slate-500">by type</span>
                    {Object.entries(hotspotsByType)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([nodeType, count]) => (
                        <span key={`type-${nodeType}`} className="font-mono text-slate-300">
                          {nodeType}:{count}
                        </span>
                      ))}
                    <span className="text-slate-600">|</span>
                    <span className="text-slate-500">by urgency</span>
                    {GRAPH_URGENCY_CLASS_ORDER.filter((urgency) => hotspotsByUrgency[urgency] > 0).map((urgency) => (
                      <span key={`urgency-${urgency}`} className="font-mono text-slate-300">
                        {urgency}:{hotspotsByUrgency[urgency]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">filters</span>
                  <select
                    className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300"
                    value={graphTypeFilter}
                    onChange={(e) => setGraphTypeFilter(e.target.value)}
                  >
                    <option value="all">type: all</option>
                    {graphTypeOptions.map((nodeType) => (
                      <option key={nodeType} value={nodeType}>
                        type: {nodeType}
                      </option>
                    ))}
                  </select>
                  <select
                    className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300"
                    value={graphUrgencyFilter}
                    onChange={(e) => setGraphUrgencyFilter(e.target.value as 'all' | GraphUrgencyClass)}
                  >
                    <option value="all">class: all</option>
                    {graphUrgencyOptions.map((urgency) => (
                      <option key={urgency} value={urgency}>
                        class: {urgency}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-slate-500 mb-2">
                  focus: {selectedVisionId ?? 'all'} · hotspots: {graphHotspots.length}/{hotspotNodes.length}
                </div>
                {graphHotspots.length === 0 ? (
                  <p className="text-xs text-slate-500">No graph hotspots right now.</p>
                ) : (
                  graphHotspots.map(renderGraphNodeRow)
                )}
              </Section>

              <Section title="Active Risks" count={activeRisks.length}>
                {activeRisks.length === 0 ? (
                  <p className="text-xs text-slate-500">No active risks.</p>
                ) : (
                  activeRisks.map((r) => <RiskRow key={r.id} risk={r} />)
                )}
              </Section>

              <Section title="Recent Decisions" count={state.decisions.length}>
                {state.decisions.length === 0 ? (
                  <p className="text-xs text-slate-500">No decisions recorded.</p>
                ) : (
                  state.decisions.slice(0, 10).map((d) => <DecisionRow key={d.id} dec={d} />)
                )}
              </Section>

              {/* Live event feed */}
              {state.events.length > 0 && (
                <Section title="Live Events" count={state.events.length}>
                  {state.events.slice(0, 10).map((ev, i) => (
                    <div key={i} className="py-1 border-b border-slate-800 last:border-0 text-xs font-mono text-slate-400">
                      <span className="text-slate-500">{new Date(ev.created_at).toLocaleTimeString()}</span>
                      {' '}
                      <span className="text-blue-400">{ev.event_type}</span>
                      {' '}
                      <span className="text-slate-300">{ev.entity_id}</span>
                    </div>
                  ))}
                </Section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
