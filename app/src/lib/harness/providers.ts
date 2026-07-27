export const MODEL_PROVIDER_IDS = [
  'deepseek',
  'openai',
  'openrouter',
  'moonshot',
  'local-proxy',
  'custom',
] as const

export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number]

export type ProviderPreset = {
  id: ModelProviderId
  name: string
  baseUrl: string
  model: string
  codeModel: string
  description: string
  requiresApiKey: boolean
  /** The local Vite proxy is useful during development, but cannot run on a static Vercel deployment. */
  developmentOnly?: boolean
}

/**
 * OpenAI-compatible endpoints that can be selected without asking the user to
 * remember provider URLs. `custom` deliberately leaves every field blank.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    codeModel: 'deepseek-chat',
    description: '浏览器可直连，性价比高',
    requiresApiKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    codeModel: 'gpt-4.1',
    description: 'OpenAI 官方兼容接口',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    codeModel: 'openai/gpt-4.1',
    description: '一个 Key 访问多家模型',
    requiresApiKey: true,
  },
  {
    id: 'moonshot',
    name: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
    codeModel: 'kimi-k2.5',
    description: 'Moonshot 官方 OpenAI 兼容接口',
    requiresApiKey: true,
  },
  {
    id: 'local-proxy',
    name: '本地开发代理',
    baseUrl: '/api/model',
    model: '',
    codeModel: '',
    description: '仅本地开发使用，由 Vite 代理转发',
    requiresApiKey: false,
    developmentOnly: true,
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    codeModel: '',
    description: '手动填写兼容服务地址和模型',
    requiresApiKey: true,
  },
] as const

/** @deprecated Prefer the shorter `PROVIDER_PRESETS` public name. */
export const MODEL_PROVIDER_PRESETS = PROVIDER_PRESETS
export type ModelProviderPreset = ProviderPreset

export function getModelProviderPreset(id: ModelProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
    ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
}

export type ModelListErrorCode =
  | 'invalid_url'
  | 'auth'
  | 'rate_limit'
  | 'http'
  | 'network'
  | 'invalid_response'

export class ModelListError extends Error {
  readonly code: ModelListErrorCode
  readonly status?: number

  constructor(code: ModelListErrorCode, message: string, status?: number, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ModelListError'
    this.code = code
    this.status = status
  }
}

export type FetchModelListOptions = {
  baseUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

function modelsUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new ModelListError('invalid_url', '请先填写 API Base URL。')

  if (normalized.startsWith('/')) return `${normalized}/models`

  try {
    const url = new URL(normalized)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    return `${normalized}/models`
  } catch (error) {
    throw new ModelListError('invalid_url', 'API Base URL 格式不正确，请填写 http(s) 地址或本地代理路径。', undefined, { cause: error })
  }
}

function responseMessage(status: number) {
  if (status === 401 || status === 403) {
    return new ModelListError('auth', 'API Key 无效，或当前账号无权读取模型列表。', status)
  }
  if (status === 429) {
    return new ModelListError('rate_limit', '请求模型列表过于频繁，请稍后再试。', status)
  }
  return new ModelListError('http', `获取模型列表失败（HTTP ${status}），你仍可手动填写模型名称。`, status)
}

/** Fetch and normalize the standard OpenAI-compatible `GET /models` response. */
export async function fetchModelList({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  signal,
}: FetchModelListOptions): Promise<string[]> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (apiKey.trim()) headers.authorization = `Bearer ${apiKey.trim()}`

  let response: Response
  try {
    response = await fetchImpl.call(globalThis, modelsUrl(baseUrl), {
      method: 'GET',
      headers,
      signal,
    })
  } catch (error) {
    if (error instanceof ModelListError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ModelListError(
      'network',
      '无法连接模型服务，可能是网络或浏览器跨域（CORS）限制；你仍可手动填写模型名称。',
      undefined,
      { cause: error },
    )
  }

  if (!response.ok) throw responseMessage(response.status)

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new ModelListError(
      'invalid_response',
      '模型服务没有返回标准 JSON；你仍可手动填写模型名称。',
      response.status,
      { cause: error },
    )
  }

  const data = typeof payload === 'object' && payload !== null
    ? (payload as { data?: unknown }).data
    : undefined
  if (!Array.isArray(data)) {
    throw new ModelListError(
      'invalid_response',
      '模型服务未返回标准的 data 模型列表；你仍可手动填写模型名称。',
      response.status,
    )
  }

  return [...new Set(data.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const id = (item as { id?: unknown }).id
    return typeof id === 'string' && id.trim() ? [id.trim()] : []
  }))].sort((left, right) => left.localeCompare(right, 'en'))
}
