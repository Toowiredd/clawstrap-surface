type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000)
  }

  const record = asRecord(value)
  if (!record) return undefined

  const nestedValue = record.value
  if (nestedValue instanceof Date) return Math.floor(nestedValue.getTime() / 1000)
  if (typeof nestedValue === 'string' || typeof nestedValue === 'number') return timestampValue(nestedValue)

  return undefined
}

function isoValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  const record = asRecord(value)
  if (!record) return undefined
  const nestedValue = record.value
  if (nestedValue instanceof Date) return nestedValue.toISOString()
  if (typeof nestedValue === 'string') return nestedValue
  if (typeof nestedValue === 'number') return new Date(nestedValue).toISOString()
  return undefined
}

function previewText(value: string | undefined, max = 280): string | undefined {
  if (!value) return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

function fragmentRaw(fragment: unknown): string | undefined {
  const record = asRecord(fragment)
  const stringRecord = asRecord(record?.string)
  return readString(stringRecord?.raw)
}

function flattenedIterable(value: unknown): unknown[] {
  const record = asRecord(value)
  const iterable = record?.iterable
  return Array.isArray(iterable) ? iterable : []
}

export interface PiecesAssetSummary {
  id: string
  name: string
  createdAt?: number
  createdAtIso?: string
  updatedAt?: number
  updatedAtIso?: string
  preview?: string
  content?: string
  classification?: string
  application?: string
  raw: unknown
}

export interface PiecesConversationSummary {
  id: string
  name: string
  createdAt?: number
  updatedAt?: number
  updatedAtIso?: string
  messageCount: number
  type?: string
  raw: unknown
}

export interface PiecesMessageSummary {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  createdAtIso?: string
  model?: string
  raw: unknown
}

export interface PiecesEventSummary {
  id: string
  type: string
  actor: string
  description: string
  createdAt: number
  createdAtIso?: string
  application?: string
  windowTitle?: string
  browserUrl?: string
  raw: unknown
}

export interface PiecesWorkstreamSummary {
  id: string
  name: string
  createdAt: number
  createdAtIso?: string
  updatedAt?: number
  updatedAtIso?: string
  preview?: string
  eventCount: number
  assetCount: number
  conversationCount: number
  raw: unknown
}

export function normalizePiecesAsset(asset: unknown): PiecesAssetSummary {
  const record = asRecord(asset) ?? {}
  const metadata = asRecord(record.metadata)
  const format = asRecord(record.format)
  const fragment = asRecord(format?.fragment)
  const classification = asRecord(format?.classification)
  const application = asRecord(record.application)
  const createdAt = timestampValue(record.created)
  const updatedAt = timestampValue(record.updated)
  const content = fragmentRaw(fragment)

  return {
    id: readString(record.id) ?? `asset-${Math.random().toString(36).slice(2)}`,
    name: readString(metadata?.name) ?? readString(record.name) ?? 'Untitled snippet',
    createdAt,
    createdAtIso: isoValue(record.created),
    updatedAt,
    updatedAtIso: isoValue(record.updated),
    preview: previewText(content),
    content,
    classification: readString(classification?.specific) ?? readString(classification?.generic),
    application: readString(application?.name),
    raw: asset,
  }
}

export function normalizePiecesConversation(conversation: unknown): PiecesConversationSummary {
  const record = asRecord(conversation) ?? {}
  const messageCount = flattenedIterable(record.messages).length
  const createdAt = timestampValue(record.created)
  const updatedAt = timestampValue(record.updated)

  return {
    id: readString(record.id) ?? `conversation-${Math.random().toString(36).slice(2)}`,
    name: readString(record.name) ?? 'Pieces conversation',
    createdAt,
    updatedAt,
    updatedAtIso: isoValue(record.updated),
    messageCount,
    type: readString(record.type),
    raw: conversation,
  }
}

export function normalizePiecesMessage(message: unknown): PiecesMessageSummary {
  const record = asRecord(message) ?? {}
  const conversation = asRecord(record.conversation)
  const model = asRecord(record.model)
  const fragment = asRecord(record.fragment)
  const rawContent = fragmentRaw(fragment) ?? ''
  const createdAt = timestampValue(record.created) ?? Math.floor(Date.now() / 1000)
  const roleRaw = readString(record.role) ?? 'UNKNOWN'
  const role = roleRaw === 'ASSISTANT' ? 'assistant' : roleRaw === 'SYSTEM' ? 'system' : 'user'

  return {
    id: readString(record.id) ?? `message-${Math.random().toString(36).slice(2)}`,
    conversationId: readString(conversation?.id) ?? '',
    role,
    content: rawContent,
    createdAt,
    createdAtIso: isoValue(record.created),
    model: readString(model?.name),
    raw: message,
  }
}

export function normalizePiecesEvent(event: unknown): PiecesEventSummary {
  const record = asRecord(event) ?? {}
  const application = asRecord(record.application)
  const trigger = asRecord(record.trigger)
  const createdAt = timestampValue(record.created) ?? Math.floor(Date.now() / 1000)
  const applicationName = readString(application?.name)
  const triggerName = readString(trigger?.type) ?? readString(trigger?.event)
  const readable = readString(record.readable)
  const windowTitle = readString(record.windowTitle)
  const browserUrl = readString(record.browserUrl)

  return {
    id: readString(record.id) ?? `event-${Math.random().toString(36).slice(2)}`,
    type: triggerName ?? 'pieces_event',
    actor: applicationName ?? 'Pieces OS',
    description: readable ?? windowTitle ?? browserUrl ?? 'Pieces activity captured',
    createdAt,
    createdAtIso: isoValue(record.created),
    application: applicationName,
    windowTitle,
    browserUrl,
    raw: event,
  }
}

export function normalizePiecesSummary(summary: unknown): PiecesWorkstreamSummary {
  const record = asRecord(summary) ?? {}
  const annotations = flattenedIterable(record.annotations)
  const firstAnnotation = asRecord(annotations[0])
  const annotationText = fragmentRaw(asRecord(firstAnnotation?.format)?.fragment)
  const createdAt = timestampValue(record.created) ?? Math.floor(Date.now() / 1000)

  return {
    id: readString(record.id) ?? `summary-${Math.random().toString(36).slice(2)}`,
    name: readString(record.name) ?? 'Pieces summary',
    createdAt,
    createdAtIso: isoValue(record.created),
    updatedAt: timestampValue(record.updated),
    updatedAtIso: isoValue(record.updated),
    preview: previewText(annotationText),
    eventCount: flattenedIterable(record.events).length,
    assetCount: flattenedIterable(record.assets).length,
    conversationCount: flattenedIterable(record.conversations).length,
    raw: summary,
  }
}

export function answerText(result: unknown): string | undefined {
  const record = asRecord(result)
  const answer = asRecord(record?.answer)
  const answers = flattenedIterable(answer?.answers)
  const lines = answers
    .map((item) => {
      if (typeof item === 'string') return item
      const itemRecord = asRecord(item)
      return readString(itemRecord?.text) ?? readString(itemRecord?.value)
    })
    .filter((line): line is string => !!line)

  if (lines.length === 0) return undefined
  return lines.join('\n\n').trim() || undefined
}
