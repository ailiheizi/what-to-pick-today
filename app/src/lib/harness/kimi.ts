import type { KimiSettings } from './types.ts'
import { isLocalModelProxyBase } from './local-proxy.ts'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
}

type CompletionOptions = {
  signal: AbortSignal
  onDelta?: (delta: string) => void
  model?: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
}

export type StreamingJsonString = {
  found: boolean
  complete: boolean
  value: string
}

/**
 * Extract a JSON string while the surrounding JSON document is still streaming.
 * The returned value is safe to use as a draft; an incomplete escape at the tail
 * is ignored until the next SSE delta arrives.
 */
export function extractStreamingJsonString(text: string, fieldName: string): StreamingJsonString {
  const fieldAt = text.indexOf(JSON.stringify(fieldName))
  if (fieldAt < 0) return { found: false, complete: false, value: '' }
  let cursor = fieldAt + JSON.stringify(fieldName).length
  while (/\s/.test(text[cursor] ?? '')) cursor += 1
  if (text[cursor] !== ':') return { found: true, complete: false, value: '' }
  cursor += 1
  while (/\s/.test(text[cursor] ?? '')) cursor += 1
  if (text[cursor] !== '"') return { found: true, complete: false, value: '' }
  cursor += 1

  let value = ''
  decode: while (cursor < text.length) {
    const char = text[cursor]
    cursor += 1
    if (char === '"') return { found: true, complete: true, value }
    if (char !== '\\') {
      value += char
      continue
    }
    if (cursor >= text.length) break
    const escaped = text[cursor]
    cursor += 1
    if (escaped === 'u') {
      if (cursor + 4 > text.length) break decode
      const hex = text.slice(cursor, cursor + 4)
      if (!/^[0-9a-f]{4}$/i.test(hex)) break decode
      value += String.fromCharCode(Number.parseInt(hex, 16))
      cursor += 4
      continue
    }
    const escapes: Record<string, string> = {
      '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
    }
    value += escapes[escaped] ?? escaped
  }
  return { found: true, complete: false, value }
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('模型 API 没有返回可解析的 JSON')
  }
}

function responseError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    return new Error(`模型 API ${status}: ${parsed.error?.message ?? body}`)
  } catch {
    return new Error(`模型 API ${status}: ${body}`)
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
    if (!this.#settings.apiKey.trim() && !isLocalModelProxyBase(this.#settings.baseUrl)) throw new Error('请先配置 AI API Key')
    const model = options.model ?? this.#settings.model
    const temperature = options.temperature
      ?? (['kimi-k2.5', 'kimi-k3'].includes(model) ? 1 : this.#settings.temperature)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.#settings.apiKey.trim()) headers.authorization = `Bearer ${this.#settings.apiKey}`
    const response = await this.#fetch(`${this.#settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature,
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
      signal: options.signal,
    })

    if (!response.ok) throw responseError(response.status, await response.text())
    if (!response.body) throw new Error('模型 API 返回了空响应')

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
