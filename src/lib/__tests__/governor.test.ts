import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { governorApi, normalizeGovernorEvent } from '../governor'

describe('normalizeGovernorEvent', () => {
  it('normalizes snake_case payloads', () => {
    const event = normalizeGovernorEvent({
      id: 'evt_1',
      event_class: 'governance',
      event_type: 'governance.gate_opened',
      entity_type: 'approval_gate',
      entity_id: 'gate_1',
      actor: 'system',
      vision_id: 'vis_1',
      payload: { after: { status: 'pending' } },
      created_at: 123,
    })

    expect(event).toEqual({
      id: 'evt_1',
      event_class: 'governance',
      event_type: 'governance.gate_opened',
      entity_type: 'approval_gate',
      entity_id: 'gate_1',
      actor: 'system',
      vision_id: 'vis_1',
      payload: { after: { status: 'pending' } },
      created_at: 123,
    })
  })

  it('normalizes camelCase payloads emitted by governor SSE', () => {
    const event = normalizeGovernorEvent({
      id: 'evt_2',
      eventClass: 'planning',
      eventType: 'planning.task_created',
      entityType: 'task_record',
      entityId: 'task_1',
      actor: 'agent',
      visionId: 'vis_2',
      payload: { after: { status: 'proposed' } },
      createdAt: 456,
    })

    expect(event).toEqual({
      id: 'evt_2',
      event_class: 'planning',
      event_type: 'planning.task_created',
      entity_type: 'task_record',
      entity_id: 'task_1',
      actor: 'agent',
      vision_id: 'vis_2',
      payload: { after: { status: 'proposed' } },
      created_at: 456,
    })
  })

  it('returns null for malformed payloads', () => {
    expect(normalizeGovernorEvent({ eventClass: 'governance' })).toBeNull()
    expect(normalizeGovernorEvent('not-an-object')).toBeNull()
  })

  it('normalizes an event from an SSE data frame emitted by governor transport', () => {
    const wirePayload = {
      id: 'evt_sse_1',
      eventClass: 'planning',
      eventType: 'planning.task_created',
      entityType: 'task_record',
      entityId: 'task_sse_1',
      actor: 'system',
      visionId: 'vis_sse_1',
      payload: { after: { status: 'proposed' } },
      createdAt: 999,
    }
    const sseFrame = `data: ${JSON.stringify(wirePayload)}\n\n`
    const dataLine = sseFrame.split('\n').find((line) => line.startsWith('data: '))
    const parsed = dataLine ? JSON.parse(dataLine.slice(6)) : null

    expect(normalizeGovernorEvent(parsed)).toEqual({
      id: 'evt_sse_1',
      event_class: 'planning',
      event_type: 'planning.task_created',
      entity_type: 'task_record',
      entity_id: 'task_sse_1',
      actor: 'system',
      vision_id: 'vis_sse_1',
      payload: { after: { status: 'proposed' } },
      created_at: 999,
    })
  })
})

describe('governorApi mapping', () => {
  const fetchMock = vi.fn()

  function mockJson(body: unknown): void {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => body,
    })
  }

  function expectFetchPath(path: string): void {
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`/api/governor/${path}`, { cache: 'no-store' })
  }

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps visions camelCase payloads and filters malformed items', async () => {
    mockJson([
      {
        id: 'vis_1',
        userId: 'user_1',
        title: 'Vision A',
        rawIntent: 'Ship feature A',
        status: 'active',
        createdAt: 100,
        updatedAt: 200,
      },
      { id: 'bad_vision' },
    ])

    const visions = await governorApi.visions()

    expect(visions).toEqual([
      {
        id: 'vis_1',
        user_id: 'user_1',
        title: 'Vision A',
        raw_intent: 'Ship feature A',
        status: 'active',
        created_at: 100,
        updated_at: 200,
      },
    ])
    expectFetchPath('visions')
  })

  it('throws on malformed single vision payload', async () => {
    mockJson({
      id: 'vis_bad',
      title: 'Invalid',
    })

    await expect(governorApi.vision('vis_bad')).rejects.toThrow(
      'Governor vision payload malformed for vis_bad',
    )
    expectFetchPath('visions/vis_bad')
  })

  it('maps tasks camelCase payloads and filters malformed items', async () => {
    mockJson([
      {
        id: 'task_1',
        specId: 'spec_1',
        visionId: 'vis_1',
        title: 'Task A',
        description: 'Do work',
        status: 'active',
        attention: 'watch',
        confidence: 'high',
        phase: 2,
        claimedBy: 'agent_1',
        claimedAt: 111,
        createdAt: 300,
        updatedAt: 400,
      },
      { id: 'task_bad', title: 'Missing fields' },
    ])

    const tasks = await governorApi.tasks()

    expect(tasks).toEqual([
      {
        id: 'task_1',
        spec_id: 'spec_1',
        vision_id: 'vis_1',
        title: 'Task A',
        description: 'Do work',
        status: 'active',
        attention: 'watch',
        confidence: 'high',
        phase: 2,
        claimed_by: 'agent_1',
        claimed_at: 111,
        created_at: 300,
        updated_at: 400,
      },
    ])
    expectFetchPath('tasks')
  })

  it('preserves unknown future task statuses instead of dropping valid rows', async () => {
    mockJson([
      {
        id: 'task_future_1',
        specId: 'spec_1',
        visionId: 'vis_1',
        title: 'Future task',
        description: 'Future workflow state',
        status: 'queued_for_merge',
        attention: 'watch',
        confidence: 'medium',
        phase: 3,
        createdAt: 310,
        updatedAt: 410,
        futureFlag: true,
      },
    ])

    const tasks = await governorApi.tasks()

    expect(tasks).toHaveLength(1)
    expect((tasks[0] as { status: string }).status).toBe('queued_for_merge')
    expectFetchPath('tasks')
  })

  it('maps decisions camelCase payloads and filters malformed items', async () => {
    mockJson([
      {
        id: 'dec_1',
        visionId: 'vis_1',
        specId: 'spec_1',
        taskId: 'task_1',
        title: 'Decision A',
        description: 'Use approach A',
        decisionType: 'architectural',
        outcome: 'approved',
        rationale: 'Best tradeoff',
        madeBy: 'owner',
        requiresApproval: 1,
        createdAt: 500,
      },
      { id: 'dec_bad', title: 'Missing fields' },
    ])

    const decisions = await governorApi.decisions()

    expect(decisions).toEqual([
      {
        id: 'dec_1',
        vision_id: 'vis_1',
        spec_id: 'spec_1',
        task_id: 'task_1',
        title: 'Decision A',
        description: 'Use approach A',
        decision_type: 'architectural',
        outcome: 'approved',
        rationale: 'Best tradeoff',
        made_by: 'owner',
        requires_approval: 1,
        created_at: 500,
      },
    ])
    expectFetchPath('decisions')
  })

  it('maps questions camelCase payloads and filters malformed items', async () => {
    mockJson([
      {
        id: 'q_1',
        visionId: 'vis_1',
        specId: 'spec_1',
        taskId: 'task_1',
        body: 'Need approval?',
        whyItMatters: 'Blocks release',
        consequenceOfDelay: 'Miss deadline',
        status: 'open',
        attention: 'needs_input',
        answer: null,
        createdAt: 600,
        updatedAt: 700,
      },
      { id: 'q_bad', body: 'Missing fields' },
    ])

    const questions = await governorApi.questions()

    expect(questions).toEqual([
      {
        id: 'q_1',
        vision_id: 'vis_1',
        spec_id: 'spec_1',
        task_id: 'task_1',
        body: 'Need approval?',
        why_it_matters: 'Blocks release',
        consequence_of_delay: 'Miss deadline',
        status: 'open',
        attention: 'needs_input',
        answer: null,
        created_at: 600,
        updated_at: 700,
      },
    ])
    expectFetchPath('questions')
  })

  it('maps risks camelCase payloads and filters malformed items', async () => {
    mockJson([
      {
        id: 'risk_1',
        visionId: 'vis_1',
        specId: 'spec_1',
        taskId: 'task_1',
        title: 'Risk A',
        description: 'Dependency unknown',
        riskType: 'uncertainty',
        severity: 'high',
        status: 'active',
        attention: 'urgent',
        createdAt: 800,
        updatedAt: 900,
      },
      { id: 'risk_bad', title: 'Missing fields' },
    ])

    const risks = await governorApi.risks()

    expect(risks).toEqual([
      {
        id: 'risk_1',
        vision_id: 'vis_1',
        spec_id: 'spec_1',
        task_id: 'task_1',
        title: 'Risk A',
        description: 'Dependency unknown',
        risk_type: 'uncertainty',
        severity: 'high',
        status: 'active',
        attention: 'urgent',
        created_at: 800,
        updated_at: 900,
      },
    ])
    expectFetchPath('risks')
  })

  it('preserves nullable lineage for questions and risks', async () => {
    mockJson([
      {
        id: 'q_lineage_1',
        visionId: null,
        specId: 'spec_lineage_1',
        taskId: null,
        body: 'Lineage question',
        whyItMatters: 'lineage parity',
        consequenceOfDelay: 'drift',
        status: 'open',
        attention: 'watch',
        createdAt: 610,
        updatedAt: 710,
      },
    ])

    const questions = await governorApi.questions()
    expect(questions[0]).toMatchObject({
      vision_id: null,
      spec_id: 'spec_lineage_1',
      task_id: null,
    })

    mockJson([
      {
        id: 'risk_lineage_1',
        visionId: null,
        specId: null,
        taskId: 'task_lineage_1',
        title: 'Lineage risk',
        description: 'lineage parity',
        riskType: 'uncertainty',
        severity: 'medium',
        status: 'active',
        attention: 'watch',
        createdAt: 810,
        updatedAt: 910,
      },
    ])

    const risks = await governorApi.risks()
    expect(risks[0]).toMatchObject({
      vision_id: null,
      spec_id: null,
      task_id: 'task_lineage_1',
    })
  })

  it('treats missing optional fields as null for task, question, and gate payloads', async () => {
    mockJson([
      {
        id: 'task_opt_1',
        specId: 'spec_opt_1',
        visionId: 'vis_opt_1',
        title: 'Task optional fields',
        description: 'optional shape drift',
        status: 'active',
        attention: 'watch',
        confidence: 'high',
        phase: 1,
        createdAt: 320,
        updatedAt: 420,
      },
    ])
    const tasks = await governorApi.tasks()
    expect(tasks[0]).toMatchObject({
      claimed_by: null,
      claimed_at: null,
    })

    mockJson([
      {
        id: 'q_opt_1',
        visionId: 'vis_opt_1',
        specId: null,
        taskId: null,
        body: 'Optional answer',
        whyItMatters: 'forward compat',
        consequenceOfDelay: 'unclear state',
        status: 'open',
        attention: 'watch',
        createdAt: 620,
        updatedAt: 720,
      },
    ])
    const questions = await governorApi.questions()
    expect(questions[0]).toMatchObject({
      answer: null,
    })

    mockJson([
      {
        id: 'gate_opt_1',
        entityType: 'task',
        entityId: 'task_opt_1',
        reason: 'optional fields omitted',
        status: 'pending',
        requestedAt: 1010,
      },
    ])
    const gates = await governorApi.gates()
    expect(gates[0]).toMatchObject({
      resolved_at: null,
      resolved_by: null,
      resolution_note: null,
    })
  })

  it('maps gates camelCase payloads and filters malformed items', async () => {
    mockJson([
      {
        id: 'gate_1',
        entityType: 'task_record',
        entityId: 'task_1',
        reason: 'Need signoff',
        status: 'pending',
        requestedAt: 1000,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      },
      { id: 'gate_bad', reason: 'Missing fields' },
    ])

    const gates = await governorApi.gates()

    expect(gates).toEqual([
      {
        id: 'gate_1',
        entity_type: 'task_record',
        entity_id: 'task_1',
        reason: 'Need signoff',
        status: 'pending',
        requested_at: 1000,
        resolved_at: null,
        resolved_by: null,
        resolution_note: null,
      },
    ])
    expectFetchPath('gates')
  })

  it('maps graph nodes from camelCase payloads and filters malformed items', async () => {
    mockJson({
      nodes: [
        {
          id: 'node_1',
          nodeType: 'task',
          label: 'Task node',
          status: 'active',
          attention: 'watch',
          importance: 0.9,
          visionId: 'vis_1',
          updatedAt: 1234,
        },
        { id: 'node_bad', label: 'Missing fields' },
      ],
    })

    const graph = await governorApi.graph()

    expect(graph).toEqual({
      nodes: [
        {
          id: 'node_1',
          node_type: 'task',
          label: 'Task node',
          status: 'active',
          attention: 'watch',
          importance: 0.9,
          vision_id: 'vis_1',
          updated_at: 1234,
        },
      ],
    })
    expectFetchPath('graph')
  })

  it('preserves lineage nulls from snake_case governance payloads', async () => {
    mockJson([
      {
        id: 'dec_2',
        vision_id: null,
        spec_id: null,
        task_id: null,
        title: 'Decision B',
        description: 'Fallback path',
        decision_type: 'workflow',
        outcome: 'deferred',
        rationale: 'Waiting input',
        made_by: 'agent',
        requires_approval: 0,
        created_at: 501,
      },
    ])

    const decisions = await governorApi.decisions()
    expect(decisions[0]).toMatchObject({
      vision_id: null,
      spec_id: null,
      task_id: null,
    })
  })
})
