import {
  Configuration,
  WellKnownApi,
  AssetsApi,
  AssetApi,
  ConversationsApi,
  ConversationApi,
  ConversationMessagesApi,
  ModelsApi,
  AnnotationsApi,
  QGPTApi,
  SearchApi,
  WorkstreamEventsApi,
  WorkstreamSummariesApi,
} from '@pieces.app/pieces-os-client'

const PIECES_OS_URL = process.env.PIECES_OS_URL ?? 'http://localhost:1000'

let _config: Configuration | null = null
let _wellKnownApi: WellKnownApi | null = null
let _assetsApi: AssetsApi | null = null
let _assetApi: AssetApi | null = null
let _conversationsApi: ConversationsApi | null = null
let _conversationApi: ConversationApi | null = null
let _conversationMessagesApi: ConversationMessagesApi | null = null
let _modelsApi: ModelsApi | null = null
let _annotationsApi: AnnotationsApi | null = null
let _qgptApi: QGPTApi | null = null
let _searchApi: SearchApi | null = null
let _workstreamEventsApi: WorkstreamEventsApi | null = null
let _workstreamSummariesApi: WorkstreamSummariesApi | null = null

function getConfig(): Configuration {
  if (!_config) {
    _config = new Configuration({ basePath: PIECES_OS_URL })
  }
  return _config
}

export function getPiecesApi() {
  const config = getConfig()

  if (!_wellKnownApi) _wellKnownApi = new WellKnownApi(config)
  if (!_assetsApi) _assetsApi = new AssetsApi(config)
  if (!_assetApi) _assetApi = new AssetApi(config)
  if (!_conversationsApi) _conversationsApi = new ConversationsApi(config)
  if (!_conversationApi) _conversationApi = new ConversationApi(config)
  if (!_conversationMessagesApi) _conversationMessagesApi = new ConversationMessagesApi(config)
  if (!_modelsApi) _modelsApi = new ModelsApi(config)
  if (!_annotationsApi) _annotationsApi = new AnnotationsApi(config)
  if (!_qgptApi) _qgptApi = new QGPTApi(config)
  if (!_searchApi) _searchApi = new SearchApi(config)
  if (!_workstreamEventsApi) _workstreamEventsApi = new WorkstreamEventsApi(config)
  if (!_workstreamSummariesApi) _workstreamSummariesApi = new WorkstreamSummariesApi(config)

  return {
    wellKnown: _wellKnownApi,
    assets: _assetsApi,
    asset: _assetApi,
    conversations: _conversationsApi,
    conversation: _conversationApi,
    conversationMessages: _conversationMessagesApi,
    models: _modelsApi,
    annotations: _annotationsApi,
    qgpt: _qgptApi,
    search: _searchApi,
    workstreamEvents: _workstreamEventsApi,
    workstreamSummaries: _workstreamSummariesApi,
  }
}
