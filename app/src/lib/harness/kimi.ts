import type { KimiSettings } from './types.ts'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
}

type CompletionOptions = {
  signal: AbortSignal
  onDelta?: (delta: string) => void
  model?: string
  maxTokens?: number
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Kimi 没有返回可解析的 JSON')
  }
}

function responseError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    return new Error(`Kimi API ${status}: ${parsed.error?.message ?? body}`)
  } catch {
    return new Error(`Kimi API ${status}: ${body}`)
  }
}

export class BrowserKimiClient {
  #settings: KimiSettings
  #fetch: typeof fetch

  constructor(settings: KimiSettings, fetchImpl: typeof fetch = fetch) {
    this.#settings = settings
    // Window.fetch is Web-IDL bound and throws "Illegal invocation" when it is
    // stored on another object and later called as that object's method.
    this.#fetch = (input, init) => fetchImpl.call(globalThis, input, init)
  }

  async completeJson(messages: ChatMessage[], options: CompletionOptions): Promise<unknown> {
    if (!this.#settings.apiKey.trim()) throw new Error('请先配置 Kimi API Key')
    const model = options.model ?? this.#settings.model
    const response = await this.#fetch(`${this.#settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#settings.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: ['kimi-k2.5', 'kimi-k3'].includes(model) ? 1 : this.#settings.temperature,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
      signal: options.signal,
    })

    if (!response.ok) throw responseError(response.status, await response.text())
    if (!response.body) throw new Error('Kimi 返回了空响应')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''

    const consume = (line: string) => {
      const normalized = line.trim()
      if (!normalized.startsWith('data:')) return
      const data = normalized.slice(5).trim()
      if (!data || data === '[DONE]') return
      try {
        const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
        const delta = payload.choices?.[0]?.delta?.content ?? ''
        if (!delta) return
        content += delta
        options.onDelta?.(delta)
      } catch {
        // A partial or provider-specific SSE line is ignored; complete JSON is validated below.
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(consume)
    }
    if (buffer.trim()) consume(buffer)
    return parseJson(content)
  }
}

export { parseJson }
