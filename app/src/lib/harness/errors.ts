/**
 * Generation harness error classification.
 *
 * Every layer of the harness (model client, LangGraph agent nodes, schema
 * parsing, sandbox compilation) throws plain values: `Error`, `DOMException`,
 * API response shapes, and occasionally raw strings. This module folds all of
 * them into one discriminated union so a caller can pick a recovery path
 * (retry, re-prompt, ask for credentials, or stop) without re-reading error
 * text at every call site.
 *
 * The module is intentionally standalone: no harness imports, no DOM access,
 * no network. The only ambient reads are `Math.random` (overridable, for
 * backoff jitter) and `Date.now` (only when a `Retry-After` HTTP-date is seen).
 */

export const ERROR_KINDS = [
  'auth',
  'rate_limit',
  'transport',
  'timeout',
  'aborted',
  'invalid_output',
  'compile',
  'dependency_blocked',
  'unknown',
] as const

export type ErrorKind = (typeof ERROR_KINDS)[number]

/**
 * Where the verdict belongs in the UI.
 * - `none`: user-initiated stop; showing anything would be noise.
 * - `inline`: belongs on the candidate card that produced it.
 * - `chat`: belongs in the system chat transcript.
 * - `settings`: the user must change configuration before retrying.
 */
export type ErrorSurface = 'none' | 'inline' | 'chat' | 'settings'

type Verdict<K extends ErrorKind, Extra = Record<never, never>> = {
  kind: K
  /** Whether replaying the exact same request could plausibly succeed. */
  retryable: boolean
  surface: ErrorSurface
  /** User-facing Chinese copy, safe to render directly. */
  message: string
  /** Raw untranslated text, for logs only. Never render on its own. */
  detail?: string
} & Extra

export type ErrorVerdict =
  | Verdict<'auth', { status?: number }>
  | Verdict<'rate_limit', { status?: number; retryAfterMs?: number }>
  | Verdict<'transport', { status?: number }>
  | Verdict<'timeout'>
  | Verdict<'aborted'>
  | Verdict<'invalid_output'>
  | Verdict<'compile', { errors?: string[] }>
  | Verdict<'dependency_blocked', { dependency?: string }>
  | Verdict<'unknown', { status?: number }>

/** Upper bound for a single backoff wait, before jitter is applied. */
export const MAX_BACKOFF_MS = 30_000

/** Retry-After values above this are treated as unusable and dropped. */
const MAX_RETRY_AFTER_MS = 3_600_000

const DETAIL_LIMIT = 200

/** Seed delay per kind. Zero means "never worth an automatic retry". */
const BASE_BACKOFF_MS: Record<ErrorKind, number> = {
  auth: 0,
  rate_limit: 2_000,
  transport: 800,
  timeout: 1_200,
  aborted: 0,
  invalid_output: 400,
  compile: 400,
  dependency_blocked: 0,
  unknown: 0,
}

const ABORT_TEXT = /abort|已停止|已取消|user cancel|cancell?ed/i
const TIMEOUT_TEXT = /timed?[ _-]?out|timeout|超时|etimedout|esockettimedout/i
const DEPENDENCY_TEXT = /dependency is not allowed[:：]?\s*([^\s'"`,)]+)?|未授权依赖[:：]?\s*([^\s'"`,)]+)?/i
const INVALID_OUTPUT_TEXT =
  /没有返回可解析的\s*json|不可解析|invalid json|json\.parse|json parse|unexpected end of json|zod|schema|校验失败|entryfile|不安全的生成文件路径|不支持的生成文件类型|模型改变了候选文件边界|返回了空响应|不符合.*格式/i
const COMPILE_TEXT = /编译|compile|transpil|babel|unexpected token|sandbox runtime error|syntaxerror/i
const NETWORK_TEXT =
  /failed to fetch|fetch failed|networkerror|network request failed|load failed|econnreset|econnrefused|enotfound|eai_again|socket hang up|网络/i
const AUTH_TEXT =
  /api\s*key|apikey|unauthorized|forbidden|authentication|invalid[_ -]?api[_ -]?key|未授权|鉴权|请先配置/i
const RATE_LIMIT_TEXT = /rate[ _-]?limit|too many requests|quota|限流|请求过于频繁|超出配额/i
const STATUS_IN_TEXT = /(?:模型 api|http|status(?:\s*code)?)\s*[:：]?\s*(\d{3})\b/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** Property reads are guarded: thrown values may carry hostile getters. */
function read(value: unknown, key: string): unknown {
  const record = asRecord(value)
  if (!record) return undefined
  try {
    return record[key]
  } catch {
    return undefined
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return ''
}

function truncate(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  return trimmed.length > DETAIL_LIMIT ? `${trimmed.slice(0, DETAIL_LIMIT)}…` : trimmed
}

/** Pull the most descriptive text out of anything a harness layer can throw. */
function extractMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean).join('; ')
  const direct = asString(read(value, 'message'))
  if (direct) return direct
  const nested = asString(read(read(value, 'error'), 'message'))
  if (nested) return nested
  const errors = read(value, 'errors')
  if (Array.isArray(errors)) {
    const joined = errors.map((item) => asString(item) || asString(read(item, 'message'))).filter(Boolean).join('\n')
    if (joined) return joined
  }
  const statusText = asString(read(value, 'statusText'))
  if (statusText) return statusText
  return ''
}

function extractName(value: unknown): string {
  return asString(read(value, 'name'))
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
}

function extractStatus(value: unknown, message: string): number | undefined {
  const candidates = [
    read(value, 'status'),
    read(value, 'statusCode'),
    read(read(value, 'response'), 'status'),
    read(read(value, 'response'), 'statusCode'),
    read(read(value, 'error'), 'status'),
  ]
  for (const candidate of candidates) {
    if (isHttpStatus(candidate)) return candidate
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate.trim())) {
      const parsed = Number(candidate.trim())
      if (isHttpStatus(parsed)) return parsed
    }
  }
  const matched = STATUS_IN_TEXT.exec(message)
  if (matched) {
    const parsed = Number(matched[1])
    if (isHttpStatus(parsed)) return parsed
  }
  return undefined
}

/** Read one header from a `Headers`-like object or a plain record. */
function readHeader(headers: unknown, name: string): string {
  if (!headers) return ''
  const getter = read(headers, 'get')
  if (typeof getter === 'function') {
    try {
      const found = (getter as (key: string) => unknown).call(headers, name)
      const text = asString(found)
      if (text) return text
    } catch {
      // Fall through to the record lookup below.
    }
  }
  const record = asRecord(headers)
  if (!record) return ''
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === name) {
      const text = asString(read(record, key))
      if (text) return text
    }
  }
  return ''
}

function retryAfterToMs(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000
    return ms >= 0 && ms <= MAX_RETRY_AFTER_MS ? Math.round(ms) : undefined
  }
  // Only an HTTP-date is left. Every legal form carries a day and month name,
  // so requiring a letter keeps `Date.parse` from salvaging junk like "-5"
  // (which it happily reads as a year).
  if (!/[a-z]/i.test(trimmed)) return undefined
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return undefined
  const delta = parsed - Date.now()
  if (delta <= 0) return 0
  return delta <= MAX_RETRY_AFTER_MS ? Math.round(delta) : undefined
}

/**
 * `Retry-After` per RFC 9110: either delta-seconds or an HTTP-date. Also
 * accepts the camelCase mirrors that SDKs tend to attach to error objects.
 */
function extractRetryAfterMs(value: unknown, message: string): number | undefined {
  const sources = [
    readHeader(read(value, 'headers'), 'retry-after'),
    readHeader(read(read(value, 'response'), 'headers'), 'retry-after'),
    asString(read(value, 'retryAfter')),
    asString(read(value, 'retry_after')),
  ]
  for (const source of sources) {
    const ms = retryAfterToMs(source)
    if (ms !== undefined) return ms
  }
  const matched = /retry[ _-]?after["'\]:\s]+([0-9]+)/i.exec(message)
  if (matched) return retryAfterToMs(matched[1])
  return undefined
}

function extractDependency(message: string): string | undefined {
  const matched = DEPENDENCY_TEXT.exec(message)
  if (!matched) return undefined
  const name = matched[1] ?? matched[2]
  return name ? name.replace(/[.,;:，。]+$/, '') : undefined
}

function extractCompileErrors(value: unknown): string[] | undefined {
  for (const key of ['errors', 'compileErrors']) {
    const list = read(value, key)
    if (Array.isArray(list)) {
      const texts = list.map((item) => asString(item) || asString(read(item, 'message'))).filter(Boolean)
      if (texts.length) return texts
    }
  }
  return undefined
}

function isAbort(value: unknown, name: string, message: string): boolean {
  if (name === 'AbortError') return true
  const code = read(value, 'code')
  // DOMException.ABORT_ERR === 20; Node's abort errors use the string form.
  if (code === 20 || code === 'ABORT_ERR' || code === 'ABORT_ERROR') return true
  if (read(value, 'aborted') === true) return true
  return ABORT_TEXT.test(message)
}

function isTimeout(value: unknown, name: string, message: string): boolean {
  if (name === 'TimeoutError') return true
  const code = read(value, 'code')
  // DOMException.TIMEOUT_ERR === 23.
  if (code === 23 || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return true
  return TIMEOUT_TEXT.test(message)
}

function verdict(base: ErrorVerdict, detail: string | undefined): ErrorVerdict {
  return detail ? { ...base, detail } : base
}

function fromStatus(status: number, retryAfterMs: number | undefined): ErrorVerdict | null {
  if (status === 401 || status === 403 || status === 407) {
    return {
      kind: 'auth',
      retryable: false,
      surface: 'settings',
      status,
      message: '模型 API 鉴权失败，请检查 API Key 或代理地址后重试。',
    }
  }
  if (status === 429) {
    const seconds = retryAfterMs === undefined ? null : Math.max(1, Math.round(retryAfterMs / 1000))
    return {
      kind: 'rate_limit',
      retryable: true,
      surface: 'chat',
      status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      message: seconds === null ? '模型 API 触发限流，稍后会自动重试。' : `模型 API 触发限流，将在约 ${seconds} 秒后重试。`,
    }
  }
  if (status === 408) {
    return {
      kind: 'timeout',
      retryable: true,
      surface: 'chat',
      message: '模型响应超时，稍后会自动重试。',
    }
  }
  if (status >= 500) {
    return {
      kind: 'transport',
      retryable: true,
      surface: 'chat',
      status,
      message: `模型服务暂时不可用（${status}），稍后会自动重试。`,
    }
  }
  if (status >= 400) {
    return {
      kind: 'transport',
      retryable: false,
      surface: 'chat',
      status,
      message: `模型 API 拒绝了这次请求（${status}），重试不会成功，请检查模型名称与请求配置。`,
    }
  }
  return null
}

function classify(value: unknown, depth: number): ErrorVerdict {
  const message = extractMessage(value)
  const name = extractName(value)
  const detail = truncate(message || name)

  // 1. A user-initiated stop is a normal terminal path, not a failure. The app
  // throws `new DOMException('生成已停止', 'AbortError')`; LangGraph and fetch
  // re-throw the same shape. It must never retry and never surface.
  if (isAbort(value, name, message)) {
    return verdict({ kind: 'aborted', retryable: false, surface: 'none', message: '生成已停止。' }, detail)
  }

  if (isTimeout(value, name, message)) {
    return verdict(
      { kind: 'timeout', retryable: true, surface: 'chat', message: '模型或沙箱响应超时，请重试或减少同时生成的候选数量。' },
      detail,
    )
  }

  // 2. Blocked imports are a hard policy stop: the sandbox allowlist and the
  // candidate schema both reject them, and a retry reproduces them exactly.
  if (DEPENDENCY_TEXT.test(message)) {
    const dependency = extractDependency(message)
    return verdict(
      {
        kind: 'dependency_blocked',
        retryable: false,
        surface: 'inline',
        ...(dependency ? { dependency } : {}),
        message: dependency
          ? `生成的组件使用了未授权依赖「${dependency}」，已拒绝运行。`
          : '生成的组件使用了未授权依赖，已拒绝运行。',
      },
      detail,
    )
  }

  const status = extractStatus(value, message)
  if (status !== undefined) {
    const byStatus = fromStatus(status, extractRetryAfterMs(value, message))
    if (byStatus) return verdict(byStatus, detail)
  }

  // 3. `CompileResult` failures arrive as a value, not a throw, so callers can
  // hand them here directly.
  if (read(value, 'ok') === false) {
    const errors = extractCompileErrors(value)
    return verdict(
      {
        kind: 'compile',
        retryable: true,
        surface: 'inline',
        ...(errors ? { errors } : {}),
        message: '生成的组件代码没能编译通过，可以让 Fixer 再试一次。',
      },
      detail,
    )
  }

  if (name === 'ZodError' || Array.isArray(read(value, 'issues')) || INVALID_OUTPUT_TEXT.test(message)) {
    return verdict(
      {
        kind: 'invalid_output',
        retryable: true,
        surface: 'inline',
        message: '模型返回的内容不符合约定格式，已丢弃这次结果，可以重新生成。',
      },
      detail,
    )
  }

  if (name === 'SyntaxError' || COMPILE_TEXT.test(message)) {
    const errors = extractCompileErrors(value)
    return verdict(
      {
        kind: 'compile',
        retryable: true,
        surface: 'inline',
        ...(errors ? { errors } : {}),
        message: '生成的组件代码没能编译通过，可以让 Fixer 再试一次。',
      },
      detail,
    )
  }

  if (RATE_LIMIT_TEXT.test(message)) {
    const retryAfterMs = extractRetryAfterMs(value, message)
    const seconds = retryAfterMs === undefined ? null : Math.max(1, Math.round(retryAfterMs / 1000))
    return verdict(
      {
        kind: 'rate_limit',
        retryable: true,
        surface: 'chat',
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        message: seconds === null ? '模型 API 触发限流，稍后会自动重试。' : `模型 API 触发限流，将在约 ${seconds} 秒后重试。`,
      },
      detail,
    )
  }

  if (AUTH_TEXT.test(message)) {
    return verdict(
      { kind: 'auth', retryable: false, surface: 'settings', message: '模型 API 鉴权失败，请检查 API Key 或代理地址后重试。' },
      detail,
    )
  }

  if (NETWORK_TEXT.test(message) || (name === 'TypeError' && /fetch/i.test(message))) {
    return verdict(
      { kind: 'transport', retryable: true, surface: 'chat', message: '网络连接异常，无法访问模型服务，稍后会自动重试。' },
      detail,
    )
  }

  // 4. Wrapped failures (`new Error(msg, { cause })`, AggregateError) keep the
  // useful signal one level down. Depth is bounded so cyclic causes terminate.
  if (depth > 0) {
    const cause = read(value, 'cause')
    if (cause !== undefined && cause !== null && cause !== value) {
      const fromCause = classify(cause, depth - 1)
      if (fromCause.kind !== 'unknown') return fromCause
    }
    const nested = read(value, 'errors')
    if (Array.isArray(nested) && nested.length) {
      const fromNested = classify(nested[0], depth - 1)
      if (fromNested.kind !== 'unknown') return fromNested
    }
  }

  return verdict(
    {
      kind: 'unknown',
      retryable: false,
      surface: 'chat',
      ...(status === undefined ? {} : { status }),
      message: detail ? `生成过程中出现未知错误：${detail}` : '生成过程中出现未知错误。',
    },
    detail,
  )
}

/**
 * Classify any thrown value. Never throws: unrecognised, malformed and hostile
 * inputs (null, undefined, strings, plain objects, throwing getters) all fall
 * back to a well-formed `unknown` verdict.
 */
export function classifyError(value: unknown): ErrorVerdict {
  try {
    return classify(value, 2)
  } catch {
    return { kind: 'unknown', retryable: false, surface: 'chat', message: '生成过程中出现未知错误。' }
  }
}

/**
 * Exponential backoff with equal jitter and a hard cap.
 *
 * `attempt` is zero-based (0 is the wait before the first retry). Kinds that
 * are never worth an automatic retry return 0. The jitter source is injectable
 * so tests stay deterministic. When a verdict carries `retryAfterMs`, prefer
 * `Math.max(retryAfterMs, backoffMs(kind, attempt))`.
 */
export function backoffMs(kind: ErrorKind, attempt: number, random: () => number = Math.random): number {
  const base = BASE_BACKOFF_MS[kind] ?? 0
  if (base <= 0) return 0
  const step = Number.isFinite(attempt) ? Math.min(Math.max(Math.floor(attempt), 0), 16) : 0
  const ceiling = Math.min(base * 2 ** step, MAX_BACKOFF_MS)
  let roll = 0
  try {
    const rolled = random()
    if (typeof rolled === 'number' && Number.isFinite(rolled)) roll = Math.min(Math.max(rolled, 0), 1)
  } catch {
    roll = 0
  }
  return Math.round(ceiling / 2 + (ceiling / 2) * roll)
}
