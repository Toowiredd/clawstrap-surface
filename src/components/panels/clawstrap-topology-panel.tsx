'use client'

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// ─── LAYER & CONNECTION DEFINITIONS ─────────────────────────────

const LAYERS = {
  entry:     { label: 'Entry Points',      color: '#60a5fa', fill: '#1e3a5f' },
  brain:     { label: 'Brain Tier',        color: '#a78bfa', fill: '#2d2150' },
  workhorse: { label: 'Workhorse Tier',    color: '#34d399', fill: '#0f3d2d' },
  pipeline:  { label: 'Pipelines',         color: '#fb923c', fill: '#3d2a10' },
  bridge:    { label: 'Bridges',           color: '#f472b6', fill: '#3d1530' },
  orchestr:  { label: 'Orchestration',     color: '#22d3ee', fill: '#0a2f3d' },
  template:  { label: 'Templates',         color: '#fbbf24', fill: '#3d3010' },
  persona:   { label: 'Personas',          color: '#f87171', fill: '#3d1515' },
  external:  { label: 'External Services', color: '#6b7280', fill: '#1f2128' },
} as const

type LayerKey = keyof typeof LAYERS

const CONN_STYLES = {
  control:   { color: '#60a5fa', dash: undefined,  label: 'Control Flow' },
  data:      { color: '#34d399', dash: '6 3',      label: 'Data Flow' },
  delegates: { color: '#fb923c', dash: '8 4',      label: 'Delegation' },
  memory:    { color: '#f472b6', dash: '4 4',      label: 'Memory I/O' },
  gates:     { color: '#f87171', dash: undefined,   label: 'Approval Gates' },
  toolcall:  { color: '#a78bfa', dash: '3 3',      label: 'Tool Calls' },
} as const

type ConnType = keyof typeof CONN_STYLES

// ─── BUILD STATUS ───────────────────────────────────────────────

type BuildStatus = 'built' | 'wired' | 'in-progress' | 'planned'

const STATUS_COLORS: Record<BuildStatus, { bg: string; border: string; text: string }> = {
  built:        { bg: 'bg-green-900/30',  border: 'border-green-500/50',  text: 'text-green-400' },
  wired:        { bg: 'bg-cyan-900/30',   border: 'border-cyan-500/50',   text: 'text-cyan-400' },
  'in-progress':{ bg: 'bg-amber-900/30',  border: 'border-amber-500/50',  text: 'text-amber-400' },
  planned:      { bg: 'bg-zinc-800/50',   border: 'border-zinc-600/50',   text: 'text-zinc-400' },
}

const STATUS_LABELS: Record<BuildStatus, string> = {
  built: 'BUILT',
  wired: 'WIRED',
  'in-progress': 'WIP',
  planned: 'PLANNED',
}

// ─── TOPOLOGY DATA ──────────────────────────────────────────────

interface TopoNode {
  id: string
  label: string
  sub: string
  layer: LayerKey
  status: BuildStatus
  detail?: string
}

const TOPO_NODES: TopoNode[] = [
  // Entry points
  { id: 'readme',     label: 'README.md',     sub: 'Router',                  layer: 'entry',     status: 'built' },
  { id: 'bootstrap',  label: 'BOOTSTRAP.md',  sub: 'Setup & Validate',        layer: 'entry',     status: 'built' },
  { id: 'review',     label: 'REVIEW.md',     sub: 'Comparative Review',      layer: 'entry',     status: 'built' },
  { id: 'delivery',   label: 'DELIVERY.md',   sub: 'Linear Pipeline',         layer: 'entry',     status: 'built' },
  { id: 'autonomous', label: 'AUTONOMOUS.md', sub: 'Multi-Lane Convergence',  layer: 'entry',     status: 'built' },

  // Brain tier agents
  { id: 'commander',   label: 'Commander',   sub: 'Arbiter',          layer: 'brain',     status: 'built',
    detail: 'Final arbiter. Approves architecture + code review. Synthesizes multi-lane reviews.' },
  { id: 'coordinator', label: 'Coordinator', sub: 'Project Manager',  layer: 'brain',     status: 'built',
    detail: 'Breaks work into ordered tasks with acceptance criteria. Tracks dependencies.' },
  { id: 'architect',   label: 'Architect',   sub: 'System Designer',  layer: 'brain',     status: 'built',
    detail: 'Produces specs: API contracts, data models, tech stack choices.' },
  { id: 'qa',          label: 'QA',          sub: 'Quality Guardian', layer: 'brain',     status: 'built',
    detail: 'Code review, security checks, edge cases. Blocks bad code before merge.' },

  // Workhorse tier agents
  { id: 'coder',      label: 'Coder',      sub: 'Primary Dev',    layer: 'workhorse', status: 'built',
    detail: 'Primary implementation. Writes code, tests, commits to feature branches.' },
  { id: 'coder2',     label: 'Coder-2',    sub: 'Parallel Dev',   layer: 'workhorse', status: 'built',
    detail: 'Independent parallel lane. Same standards as Coder.' },
  { id: 'devops',     label: 'DevOps',     sub: 'Infrastructure', layer: 'workhorse', status: 'built',
    detail: 'Docker, CI/CD, deployment. Creates repos, builds images, cuts releases.' },
  { id: 'researcher', label: 'Researcher', sub: 'Intelligence',   layer: 'workhorse', status: 'built',
    detail: 'Technical research and evaluation. Cannibalization analysis.' },

  // Pipelines
  { id: 'prod-pipe',   label: 'Product Pipeline', sub: '8-step serial',      layer: 'pipeline', status: 'built',
    detail: 'research → architect (gate) → coordinator → devops → coder(s) → qa (gate) → devops → commander' },
  { id: 'review-pipe', label: 'Solution Review',  sub: '6-lane → synthesis', layer: 'pipeline', status: 'built',
    detail: '5 parallel specialist lanes → Commander synthesis. Produces baseline + matrix + decisions + backlog.' },

  // Bridges
  { id: 'gh-bridge',     label: 'GitHub Bridge',  sub: '15+ typed tools', layer: 'bridge', status: 'wired',
    detail: 'TypeBox-typed gh CLI wrapper: repo_create, pr_create/review/merge, issue_create, workflow_run.' },
  { id: 'pieces-bridge', label: 'Pieces Bridge',  sub: '39 MCP tools',    layer: 'bridge', status: 'wired',
    detail: 'MCP proxy to Pieces OS. 2 LTM + 14 FTS + 5 vector + 2 temporal + 16 batch snapshot tools.' },

  // External services
  { id: 'github',      label: 'GitHub',          sub: 'Pro+ ($43/mo)',    layer: 'external', status: 'built' },
  { id: 'pieces-os',   label: 'Pieces OS',       sub: 'Pro ($19/mo)',     layer: 'external', status: 'built' },
  { id: 'openrouter',  label: 'OpenRouter',      sub: 'Model routing',    layer: 'external', status: 'built' },
  { id: 'copilot',     label: 'GitHub Copilot',  sub: 'Pro+ models',      layer: 'external', status: 'built' },
  { id: 'openclaw-gw', label: 'OpenClaw Gateway',sub: 'Port 18789',       layer: 'external', status: 'built' },

  // Orchestration
  { id: 'phases',            label: 'Phases',           sub: '10 sequential',      layer: 'orchestr', status: 'built' },
  { id: 'worktree-contract', label: 'Worktree Contract',sub: 'Lane isolation',     layer: 'orchestr', status: 'built' },
  { id: 'exec-modes',       label: 'Execution Modes',   sub: '3 runtime modes',    layer: 'orchestr', status: 'built' },
  { id: 'topo-policy',      label: 'Topology Policy',   sub: 'Lane taxonomy',      layer: 'orchestr', status: 'built' },

  // Templates
  { id: 't-initiative',  label: 'Initiative',  sub: 'Control + lanes',      layer: 'template', status: 'built' },
  { id: 't-lane',        label: 'Lane',        sub: 'Boundaries + contract',layer: 'template', status: 'built' },
  { id: 't-laneindex',   label: 'Lane Index',  sub: 'Collision watch',      layer: 'template', status: 'built' },
  { id: 't-checkpoint',  label: 'Checkpoint',  sub: 'Durable state',        layer: 'template', status: 'built' },
  { id: 't-candidate',   label: 'Candidate',   sub: 'Competing solutions',  layer: 'template', status: 'built' },
  { id: 't-integration', label: 'Integration', sub: 'Promotion queue',      layer: 'template', status: 'built' },

  // Personas
  { id: 'p-conductor',  label: 'Conductor',       sub: 'Phase orchestration',   layer: 'persona', status: 'built' },
  { id: 'p-reuse',      label: 'Reuse Strategist', sub: 'Cannibalization scan', layer: 'persona', status: 'built' },
  { id: 'p-builder',    label: 'Builder',          sub: 'Scoped implementation', layer: 'persona', status: 'built' },
  { id: 'p-polish',     label: 'Polish Critic',    sub: 'Final quality pass',   layer: 'persona', status: 'built' },
  { id: 'p-integrator', label: 'Integrator',       sub: 'Drift detection',      layer: 'persona', status: 'built' },

  // Review outputs
  { id: 'review-brief', label: 'Review Brief', sub: 'Review findings', layer: 'pipeline', status: 'built' },
  { id: 'context-pack', label: 'Context Pack', sub: 'Supporting data', layer: 'pipeline', status: 'built' },
  { id: 'runbook',      label: 'Runbook',      sub: 'Execution guide', layer: 'pipeline', status: 'built' },

  // Bootstrap
  { id: 'bs-env',     label: 'Validate Env',    sub: 'OpenClaw, gh, Pieces', layer: 'entry', status: 'built' },
  { id: 'bs-plugins', label: 'Enable Plugins',  sub: 'lobster, bridges',     layer: 'entry', status: 'built' },

  // Control Surface (new — this app!)
  { id: 'ctrl-surface', label: 'Control Surface', sub: 'This Dashboard', layer: 'orchestr', status: 'wired',
    detail: 'Clawstrap Control Surface. Next.js 16 + @xyflow/react + Pieces SDK + SQLite. You are here.' },
]

// Node positions — grouped by layer band
const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  // Entry (y: 0-200)
  readme:     { x: 500, y: 0 },
  bootstrap:  { x: 100, y: 120 },
  review:     { x: 350, y: 120 },
  delivery:   { x: 600, y: 120 },
  autonomous: { x: 870, y: 120 },
  'bs-env':     { x: 100, y: 240 },
  'bs-plugins': { x: 100, y: 320 },

  // Brain tier (y: 350-500)
  commander:   { x: 460, y: 370 },
  coordinator: { x: 240, y: 370 },
  architect:   { x: 680, y: 370 },
  qa:          { x: 360, y: 480 },

  // Workhorse tier (y: 450-550)
  coder:      { x: 570, y: 480 },
  coder2:     { x: 740, y: 480 },
  devops:     { x: 120, y: 480 },
  researcher: { x: 80, y: 370 },

  // Pipelines (y: 600-750)
  'prod-pipe':    { x: 400, y: 620 },
  'review-pipe':  { x: 660, y: 620 },
  'review-brief': { x: 660, y: 730 },
  'context-pack': { x: 660, y: 800 },
  runbook:        { x: 500, y: 730 },

  // Bridges (y: 580-700)
  'gh-bridge':     { x: -80, y: 600 },
  'pieces-bridge': { x: -80, y: 700 },

  // External (y: 550-800)
  github:       { x: -280, y: 600 },
  'pieces-os':  { x: -280, y: 700 },
  openrouter:   { x: -280, y: 800 },
  copilot:      { x: -280, y: 500 },
  'openclaw-gw':{ x: -80, y: 500 },

  // Orchestration (y: 350-600)
  phases:              { x: 1050, y: 350 },
  'worktree-contract': { x: 1050, y: 440 },
  'exec-modes':        { x: 1050, y: 530 },
  'topo-policy':       { x: 1050, y: 620 },

  // Templates (y: 350-600)
  't-initiative':  { x: 1300, y: 350 },
  't-lane':        { x: 1300, y: 430 },
  't-laneindex':   { x: 1300, y: 510 },
  't-checkpoint':  { x: 1300, y: 590 },
  't-candidate':   { x: 1500, y: 390 },
  't-integration': { x: 1500, y: 470 },

  // Personas (y: 700-900)
  'p-conductor':  { x: 1050, y: 740 },
  'p-reuse':      { x: 1050, y: 820 },
  'p-builder':    { x: 1260, y: 740 },
  'p-polish':     { x: 1260, y: 820 },
  'p-integrator': { x: 1155, y: 900 },

  // Control Surface
  'ctrl-surface': { x: 870, y: 250 },
}

interface TopoConnection {
  from: string
  to: string
  type: ConnType
  label?: string
}

const TOPO_CONNECTIONS: TopoConnection[] = [
  // Entry routing
  { from: 'readme', to: 'bootstrap',  type: 'control', label: 'setup' },
  { from: 'readme', to: 'review',     type: 'control', label: 'decide' },
  { from: 'readme', to: 'delivery',   type: 'control', label: 'ship' },
  { from: 'readme', to: 'autonomous', type: 'control', label: 'converge' },

  // Bootstrap
  { from: 'bootstrap', to: 'bs-env',      type: 'control' },
  { from: 'bs-env',    to: 'bs-plugins',  type: 'control' },
  { from: 'bs-plugins',to: 'openclaw-gw', type: 'toolcall', label: 'enable' },

  // Delivery → pipeline → agents
  { from: 'delivery',  to: 'prod-pipe',   type: 'control',   label: 'execute' },
  { from: 'prod-pipe', to: 'researcher',  type: 'delegates', label: '1.research' },
  { from: 'prod-pipe', to: 'architect',   type: 'delegates', label: '2.design' },
  { from: 'architect', to: 'commander',   type: 'gates',     label: 'arch gate' },
  { from: 'prod-pipe', to: 'coordinator', type: 'delegates', label: '3.tasks' },
  { from: 'prod-pipe', to: 'devops',      type: 'delegates', label: '4.repo' },
  { from: 'prod-pipe', to: 'coder',       type: 'delegates', label: '5.code' },
  { from: 'prod-pipe', to: 'coder2',      type: 'delegates', label: '5b.parallel' },
  { from: 'coder',     to: 'qa',          type: 'data',      label: 'PR' },
  { from: 'coder2',    to: 'qa',          type: 'data',      label: 'PR' },
  { from: 'qa',        to: 'commander',   type: 'gates',     label: 'code gate' },
  { from: 'prod-pipe', to: 'commander',   type: 'delegates', label: '8.verify' },

  // Review flow
  { from: 'review',      to: 'review-pipe', type: 'control',   label: 'execute' },
  { from: 'review-pipe', to: 'architect',   type: 'delegates', label: 'arch lane' },
  { from: 'review-pipe', to: 'devops',      type: 'delegates', label: 'delivery lane' },
  { from: 'review-pipe', to: 'qa',          type: 'delegates', label: 'code lane' },
  { from: 'review-pipe', to: 'coordinator', type: 'delegates', label: 'workspace lane' },
  { from: 'review-pipe', to: 'researcher',  type: 'delegates', label: 'cannibalise' },
  { from: 'review-pipe', to: 'commander',   type: 'delegates', label: 'synthesis' },
  { from: 'review-pipe', to: 'review-brief',type: 'data',      label: 'output' },
  { from: 'review-pipe', to: 'context-pack',type: 'data' },
  { from: 'review-pipe', to: 'runbook',     type: 'data' },

  // Autonomous → orchestration
  { from: 'autonomous', to: 'phases',            type: 'control', label: 'drive' },
  { from: 'phases',     to: 'worktree-contract', type: 'control' },
  { from: 'phases',     to: 'exec-modes',        type: 'control' },
  { from: 'phases',     to: 'topo-policy',       type: 'control' },

  // Orchestration → templates
  { from: 'topo-policy',       to: 't-initiative',  type: 'data' },
  { from: 'worktree-contract', to: 't-lane',        type: 'data' },
  { from: 'topo-policy',       to: 't-laneindex',   type: 'data' },
  { from: 'exec-modes',        to: 't-checkpoint',  type: 'data' },
  { from: 'topo-policy',       to: 't-candidate',   type: 'data' },
  { from: 'topo-policy',       to: 't-integration', type: 'data' },

  // Orchestration → personas
  { from: 'phases', to: 'p-conductor',  type: 'delegates', label: 'phase 0-9' },
  { from: 'phases', to: 'p-reuse',      type: 'delegates', label: 'phase 1' },
  { from: 'phases', to: 'p-builder',    type: 'delegates', label: 'phase 4' },
  { from: 'phases', to: 'p-polish',     type: 'delegates', label: 'phase 9' },
  { from: 'phases', to: 'p-integrator', type: 'delegates', label: 'phase 5-8' },

  // Bridge → external
  { from: 'gh-bridge',     to: 'github',    type: 'toolcall', label: 'gh CLI' },
  { from: 'pieces-bridge', to: 'pieces-os', type: 'toolcall', label: 'MCP :39301' },
  { from: 'openclaw-gw',   to: 'copilot',   type: 'toolcall', label: 'brain tier' },
  { from: 'openclaw-gw',   to: 'openrouter', type: 'toolcall', label: 'workhorse' },

  // Agent → bridge
  { from: 'coder',      to: 'gh-bridge',     type: 'toolcall', label: 'PR' },
  { from: 'devops',     to: 'gh-bridge',     type: 'toolcall', label: 'repo/deploy' },
  { from: 'qa',         to: 'gh-bridge',     type: 'toolcall', label: 'review' },
  { from: 'commander',  to: 'pieces-bridge', type: 'memory',   label: 'save/query' },
  { from: 'researcher', to: 'pieces-bridge', type: 'memory',   label: 'search' },

  // Gateway → agents
  { from: 'openclaw-gw', to: 'commander',   type: 'control' },
  { from: 'openclaw-gw', to: 'coordinator', type: 'control' },
  { from: 'openclaw-gw', to: 'architect',   type: 'control' },
  { from: 'openclaw-gw', to: 'researcher',  type: 'control' },

  // Control surface connections
  { from: 'ctrl-surface', to: 'pieces-os',  type: 'data',    label: 'REST :1000' },
  { from: 'ctrl-surface', to: 'openclaw-gw',type: 'toolcall',label: 'adapter' },
  { from: 'ctrl-surface', to: 'phases',     type: 'data',    label: 'status' },
]

// ─── CUSTOM NODE COMPONENT ──────────────────────────────────────

interface ClawstrapNodeData {
  topoNode: TopoNode
  searchMatch?: boolean
  searchActive?: boolean
  [key: string]: unknown
}

function ClawstrapNodeInner({ data }: NodeProps & { data: ClawstrapNodeData }) {
  const { topoNode, searchMatch, searchActive } = data
  const layer = LAYERS[topoNode.layer]
  const statusStyle = STATUS_COLORS[topoNode.status]

  const dimmed = searchActive && !searchMatch

  return (
    <div
      className={`rounded-lg border-2 px-3 py-2 min-w-[140px] max-w-[200px] transition-all hover:brightness-110 ${statusStyle.border}`}
      style={{
        backgroundColor: layer.fill,
        opacity: dimmed ? 0.3 : 1,
        boxShadow: searchMatch ? `0 0 12px 2px ${layer.color}88` : undefined,
        borderColor: searchMatch ? layer.color : undefined,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-semibold text-sm truncate"
          style={{ color: layer.color }}
        >
          {topoNode.label}
        </span>
        <span className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full border ${statusStyle.bg} ${statusStyle.border} ${statusStyle.text}`}>
          {STATUS_LABELS[topoNode.status]}
        </span>
      </div>
      <div className="text-xs text-zinc-400 mt-0.5 truncate">
        {topoNode.sub}
      </div>
    </div>
  )
}

const ClawstrapNode = memo(ClawstrapNodeInner)

// ─── PRESETS ────────────────────────────────────────────────────

interface Preset {
  label: string
  layers: LayerKey[]
  conns: ConnType[]
  center?: { x: number; y: number; zoom: number }
}

const PRESETS: Record<string, Preset> = {
  full: {
    label: 'Full System',
    layers: Object.keys(LAYERS) as LayerKey[],
    conns: Object.keys(CONN_STYLES) as ConnType[],
  },
  agents: {
    label: 'Agent Network',
    layers: ['brain', 'workhorse', 'external', 'bridge'],
    conns: ['control', 'delegates', 'toolcall', 'memory', 'gates'],
    center: { x: 300, y: 400, zoom: 0.9 },
  },
  delivery: {
    label: 'Delivery Flow',
    layers: ['entry', 'pipeline', 'brain', 'workhorse'],
    conns: ['control', 'delegates', 'data', 'gates'],
    center: { x: 400, y: 350, zoom: 0.7 },
  },
  orchestration: {
    label: 'Orchestration',
    layers: ['orchestr', 'template', 'persona', 'entry'],
    conns: ['control', 'data', 'delegates'],
    center: { x: 1100, y: 500, zoom: 0.7 },
  },
  infra: {
    label: 'Infrastructure',
    layers: ['external', 'bridge', 'orchestr'],
    conns: ['toolcall', 'control', 'data'],
    center: { x: 0, y: 600, zoom: 0.8 },
  },
}

// ─── PANEL COMPONENT ────────────────────────────────────────────

const nodeTypes = { clawstrap: ClawstrapNode }

function TopologyInner() {
  const [activeLayers, setActiveLayers] = useState<Set<LayerKey>>(new Set(Object.keys(LAYERS) as LayerKey[]))
  const [activeConns, setActiveConns] = useState<Set<ConnType>>(new Set(Object.keys(CONN_STYLES) as ConnType[]))
  const [activePreset, setActivePreset] = useState('full')
  const [selectedNode, setSelectedNode] = useState<TopoNode | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const reactFlowInstance = useReactFlow()

  // Compute which nodes match the search
  const searchMatchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    return new Set(
      TOPO_NODES
        .filter(n => n.label.toLowerCase().includes(q) || n.sub.toLowerCase().includes(q))
        .map(n => n.id)
    )
  }, [searchQuery])

  // Build filtered xyflow nodes
  const { flowNodes, flowEdges } = useMemo(() => {
    const visibleNodeIds = new Set(
      TOPO_NODES.filter(n => activeLayers.has(n.layer)).map(n => n.id)
    )

    const flowNodes: Node[] = TOPO_NODES
      .filter(n => visibleNodeIds.has(n.id))
      .map(n => ({
        id: n.id,
        type: 'clawstrap',
        position: NODE_POSITIONS[n.id] ?? { x: 0, y: 0 },
        data: {
          topoNode: n,
          searchActive: searchMatchIds !== null,
          searchMatch: searchMatchIds !== null && searchMatchIds.has(n.id),
        },
        style: { background: 'transparent', border: 'none' },
      }))

    const flowEdges: Edge[] = TOPO_CONNECTIONS
      .filter(c => activeConns.has(c.type) && visibleNodeIds.has(c.from) && visibleNodeIds.has(c.to))
      .map((c, i) => {
        const style = CONN_STYLES[c.type]
        return {
          id: `e-${i}-${c.from}-${c.to}`,
          source: c.from,
          target: c.to,
          type: 'smoothstep',
          animated: c.type === 'gates',
          label: c.label,
          labelStyle: { fill: '#94a3b8', fontSize: 10, fontFamily: 'monospace' },
          labelBgStyle: { fill: '#1a1d27', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          style: {
            stroke: style.color,
            strokeWidth: c.type === 'gates' ? 2.5 : 1.5,
            strokeDasharray: style.dash,
          },
          markerEnd: { type: 'arrowclosed' as const, color: style.color },
        }
      })

    return { flowNodes, flowEdges }
  }, [activeLayers, activeConns, searchMatchIds])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flowEdges)

  useEffect(() => {
    setNodes(flowNodes)
    setEdges(flowEdges)
  }, [flowNodes, flowEdges, setNodes, setEdges])

  // Preset switching — with fitView after applying
  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS[key]
    if (!preset) return
    setActivePreset(key)
    setActiveLayers(new Set(preset.layers))
    setActiveConns(new Set(preset.conns))
    // Defer fitView to after nodes update in the next render cycle
    setTimeout(() => {
      reactFlowInstance.fitView({ padding: 0.15 })
    }, 50)
  }, [reactFlowInstance])

  const toggleLayer = useCallback((layer: LayerKey) => {
    setActiveLayers(prev => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
    setActivePreset('')
  }, [])

  const toggleConn = useCallback((conn: ConnType) => {
    setActiveConns(prev => {
      const next = new Set(prev)
      if (next.has(conn)) next.delete(conn)
      else next.add(conn)
      return next
    })
    setActivePreset('')
  }, [])

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    const topo = TOPO_NODES.find(n => n.id === node.id)
    setSelectedNode(topo ?? null)
  }, [])

  // Handle Escape to clear search
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('')
      searchInputRef.current?.blur()
    }
  }, [])

  // Stats
  const stats = useMemo(() => {
    const counts: Record<BuildStatus, number> = { built: 0, wired: 0, 'in-progress': 0, planned: 0 }
    TOPO_NODES.forEach(n => counts[n.status]++)
    return counts
  }, [])

  const hasVisibleNodes = flowNodes.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-semibold text-foreground">Clawstrap Topology</h2>
          <p className="text-xs text-muted-foreground">
            Multi-agent product factory — {TOPO_NODES.length} components, {TOPO_CONNECTIONS.length} connections
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          {(Object.entries(stats) as [BuildStatus, number][]).map(([status, count]) => (
            <span key={status} className={`px-2 py-1 rounded-full border ${STATUS_COLORS[status].bg} ${STATUS_COLORS[status].border} ${STATUS_COLORS[status].text}`}>
              {STATUS_LABELS[status]} {count}
            </span>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex">
        {/* Sidebar controls */}
        <div className="w-56 border-r border-border p-3 overflow-y-auto flex-shrink-0 space-y-4">
          {/* Search */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Search</h3>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Filter nodes..."
              className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-void-cyan/50 focus:ring-1 focus:ring-void-cyan/30"
            />
            {searchMatchIds !== null && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {searchMatchIds.size} match{searchMatchIds.size !== 1 ? 'es' : ''} — Esc to clear
              </p>
            )}
          </div>

          {/* Presets */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">View Presets</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                    activePreset === key
                      ? 'border-void-cyan bg-void-cyan/10 text-void-cyan'
                      : 'border-border bg-card text-muted-foreground hover:border-void-cyan/50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Layers */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Layers</h3>
            <div className="space-y-1">
              {(Object.entries(LAYERS) as [LayerKey, typeof LAYERS[LayerKey]][]).map(([key, layer]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer text-xs py-0.5">
                  <input
                    type="checkbox"
                    checked={activeLayers.has(key)}
                    onChange={() => toggleLayer(key)}
                    className="accent-void-cyan"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className="text-foreground">{layer.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Connection types */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Connections</h3>
            <div className="space-y-1">
              {(Object.entries(CONN_STYLES) as [ConnType, typeof CONN_STYLES[ConnType]][]).map(([key, conn]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer text-xs py-0.5">
                  <input
                    type="checkbox"
                    checked={activeConns.has(key)}
                    onChange={() => toggleConn(key)}
                    className="accent-void-cyan"
                  />
                  <span
                    className="w-5 h-0.5 flex-shrink-0"
                    style={{ backgroundColor: conn.color }}
                  />
                  <span className="text-foreground">{conn.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Graph canvas */}
        <div className="flex-1 relative">
          {!hasVisibleNodes ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">No visible nodes</p>
                <p className="text-xs text-muted-foreground/60">Enable layers in the sidebar or select a preset to populate the topology.</p>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.15}
              maxZoom={2}
              className="bg-transparent"
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Controls
                style={{
                  background: 'hsl(var(--surface-1))',
                  border: '1px solid hsl(var(--surface-3))',
                  borderRadius: '10px',
                }}
              />
              <Background
                variant={BackgroundVariant.Dots}
                gap={40}
                size={0.6}
                color="hsl(var(--void-cyan) / 0.08)"
              />
              <MiniMap
                nodeColor={(node) => {
                  const topo = TOPO_NODES.find(n => n.id === node.id)
                  return topo ? LAYERS[topo.layer].color : '#333'
                }}
                maskColor="rgba(0,0,0,0.7)"
                style={{ background: '#1a1d27', border: '1px solid #2e3347' }}
              />

              {/* Detail panel */}
              {selectedNode && (
                <Panel position="top-right" className="!m-3">
                  <div className="bg-card border border-border rounded-lg p-4 max-w-xs shadow-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-sm" style={{ color: LAYERS[selectedNode.layer].color }}>
                        {selectedNode.label}
                      </span>
                      <button
                        onClick={() => setSelectedNode(null)}
                        className="text-muted-foreground hover:text-foreground text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      {selectedNode.sub} · {LAYERS[selectedNode.layer].label}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded-full border ${STATUS_COLORS[selectedNode.status].bg} ${STATUS_COLORS[selectedNode.status].border} ${STATUS_COLORS[selectedNode.status].text}`}>
                        {STATUS_LABELS[selectedNode.status]}
                      </span>
                    </div>
                    {selectedNode.detail && (
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        {selectedNode.detail}
                      </p>
                    )}
                  </div>
                </Panel>
              )}
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  )
}

export function ClawstrapTopologyPanel() {
  return (
    <ReactFlowProvider>
      <TopologyInner />
    </ReactFlowProvider>
  )
}
