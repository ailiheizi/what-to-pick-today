import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_KINDS, MAX_BACKOFF_MS, backoffMs, classifyError } from '../src/lib/harness/errors.ts'

const shape = (verdict) => {
  assert.ok(ERROR_KINDS.includes(verdict.kind), `unknown kind: ${verdict.kind}`)
  assert.equal(typeof verdict.retryable, 'boolean')
  assert.ok(['none', 'inline', 'chat', 'settings'].includes(verdict.surface))
  assert.equal(typeof verdict.message, 'string')
  assert.ok(verdict.message.length > 0)
  // User-facing copy is Chinese in this codebase.
  assert.match(verdict.message, /[一-龥]/)
  return verdict
}

test('user-initiated stop is aborted: never retryable, never surfaced', () => {
  const thrown = new DOMException('生成已停止', 'AbortError')
  const verdict = shape(classifyError(thrown))

  assert.equal(verdict.kind, 'aborted')
  assert.equal(verdict.retryable, false)
  assert.equal(verdict.surface, 'none')
})

test('abort is detected through every shape the harness produces', () => {
  const cases = [
    new DOMException('生成已停止', 'AbortError'),
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    Object.assign(new Error('canceled'), { code: 'ABORT_ERR' }),
    { name: 'AbortError', message: 'aborted' },
    '生成已停止',
    // LangGraph wraps the node failure but keeps the abort as the cause.
    new Error('Graph execution failed', { cause: new DOMException('生成已停止', 'AbortError') }),
  ]

  for (const value of cases) {
    const verdict = shape(classifyError(value))
    assert.equal(verdict.kind, 'aborted', `expected aborted for ${String(value)}`)
    assert.equal(verdict.retryable, false)
    assert.equal(verdict.surface, 'none')
    assert.equal(backoffMs(verdict.kind, 0, () => 1), 0)
  }
})

test('401 and 403 classify as auth and route the user to settings', () => {
  for (const status of [401, 403]) {
    const verdict = shape(classifyError({ status, statusText: 'Unauthorized' }))
    assert.equal(verdict.kind, 'auth')
    assert.equal(verdict.retryable, false)
    assert.equal(verdict.surface, 'settings')
    assert.equal(verdict.status, status)
  }

  const fromText = shape(classifyError(new Error('模型 API 401: invalid api key')))
  assert.equal(fromText.kind, 'auth')

  const missingKey = shape(classifyError(new Error('请先配置 AI API Key')))
  assert.equal(missingKey.kind, 'auth')
  assert.equal(missingKey.surface, 'settings')
})

test('429 classifies as rate_limit and parses numeric Retry-After', () => {
  const verdict = shape(classifyError({ status: 429, headers: { 'Retry-After': '30' } }))

  assert.equal(verdict.kind, 'rate_limit')
  assert.equal(verdict.retryable, true)
  assert.equal(verdict.retryAfterMs, 30_000)
  assert.match(verdict.message, /30 秒/)
})

test('Retry-After is read from Headers-like objects and HTTP-dates', () => {
  const headers = new Headers({ 'retry-after': '12' })
  const fromHeaders = shape(classifyError({ status: 429, headers }))
  assert.equal(fromHeaders.retryAfterMs, 12_000)

  const future = new Date(Date.now() + 45_000).toUTCString()
  const fromDate = shape(classifyError({ status: 429, response: { headers: { 'retry-after': future } } }))
  assert.equal(fromDate.kind, 'rate_limit')
  assert.ok(fromDate.retryAfterMs >= 43_000 && fromDate.retryAfterMs <= 45_000, `got ${fromDate.retryAfterMs}`)

  const past = new Date(Date.now() - 10_000).toUTCString()
  assert.equal(classifyError({ status: 429, headers: { 'retry-after': past } }).retryAfterMs, 0)
})

test('unusable Retry-After values are dropped instead of trusted', () => {
  for (const raw of ['soon', '', '-5', '99999999']) {
    const verdict = shape(classifyError({ status: 429, headers: { 'retry-after': raw } }))
    assert.equal(verdict.kind, 'rate_limit')
    assert.equal(verdict.retryAfterMs, undefined, `expected no retryAfterMs for ${JSON.stringify(raw)}`)
    assert.doesNotMatch(verdict.message, /秒/)
  }
})

test('rate limiting is also recognised without a status code', () => {
  const verdict = shape(classifyError(new Error('Rate limit exceeded, please slow down')))
  assert.equal(verdict.kind, 'rate_limit')
  assert.equal(verdict.retryable, true)
})

test('5xx is retryable transport, other 4xx is permanent', () => {
  for (const status of [500, 502, 503]) {
    const verdict = shape(classifyError({ status }))
    assert.equal(verdict.kind, 'transport')
    assert.equal(verdict.retryable, true)
    assert.equal(verdict.status, status)
  }

  for (const status of [400, 404, 422]) {
    const verdict = shape(classifyError({ status, message: `模型 API ${status}: bad request` }))
    assert.equal(verdict.kind, 'transport')
    assert.equal(verdict.retryable, false, `${status} must not be retried`)
  }
})

test('network failures classify as retryable transport', () => {
  const verdict = shape(classifyError(new TypeError('Failed to fetch')))
  assert.equal(verdict.kind, 'transport')
  assert.equal(verdict.retryable, true)
  assert.equal(verdict.surface, 'chat')

  assert.equal(classifyError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })).kind, 'transport')
})

test('timeouts classify as retryable timeout', () => {
  const cases = [
    new DOMException('timed out', 'TimeoutError'),
    new Error('沙箱编译超时，请检查网络或生成代码'),
    Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }),
    { status: 408 },
  ]

  for (const value of cases) {
    const verdict = shape(classifyError(value))
    assert.equal(verdict.kind, 'timeout', `expected timeout for ${String(value)}`)
    assert.equal(verdict.retryable, true)
  }
})

test('schema and JSON failures classify as invalid_output on the candidate card', () => {
  const cases = [
    new Error('模型 API 没有返回可解析的 JSON'),
    new Error('entryFile 不在生成文件列表中'),
    new Error('不安全的生成文件路径：/etc/passwd'),
    new Error('模型改变了候选文件边界，已拒绝应用'),
    Object.assign(new Error('Invalid input'), { name: 'ZodError', issues: [{ path: ['files'], message: 'Required' }] }),
  ]

  for (const value of cases) {
    const verdict = shape(classifyError(value))
    assert.equal(verdict.kind, 'invalid_output', `expected invalid_output for ${value.message}`)
    assert.equal(verdict.retryable, true)
    assert.equal(verdict.surface, 'inline')
  }
})

test('compile failures classify as compile and keep the error list', () => {
  const fromResult = shape(classifyError({ ok: false, errors: ['Unexpected token (3:12)', 'Cannot find name React'] }))
  assert.equal(fromResult.kind, 'compile')
  assert.equal(fromResult.retryable, true)
  assert.equal(fromResult.surface, 'inline')
  assert.deepEqual(fromResult.errors, ['Unexpected token (3:12)', 'Cannot find name React'])

  assert.equal(classifyError(new SyntaxError('Unexpected token (3:12)')).kind, 'compile')
  assert.equal(classifyError('Sandbox runtime error').kind, 'compile')
})

test('blocked dependencies classify as dependency_blocked and never retry', () => {
  const verdict = shape(classifyError('Dependency is not allowed: framer-motion'))
  assert.equal(verdict.kind, 'dependency_blocked')
  assert.equal(verdict.retryable, false)
  assert.equal(verdict.surface, 'inline')
  assert.equal(verdict.dependency, 'framer-motion')
  assert.match(verdict.message, /framer-motion/)

  const thrown = shape(classifyError(new Error('Dependency is not allowed: three')))
  assert.equal(thrown.kind, 'dependency_blocked')
  assert.equal(thrown.dependency, 'three')

  // The candidate schema rejects the same thing with Chinese copy.
  const fromSchema = shape(classifyError(new Error('组件 hero 使用了未授权依赖：d3')))
  assert.equal(fromSchema.kind, 'dependency_blocked')
  assert.equal(fromSchema.dependency, 'd3')
})

test('a blocked dependency reported as a compile result still classifies as dependency_blocked', () => {
  const verdict = shape(classifyError({ ok: false, errors: ['Dependency is not allowed: lodash'] }))
  assert.equal(verdict.kind, 'dependency_blocked')
  assert.equal(verdict.retryable, false)
})

test('unrecognised failures classify as unknown without pretending to be retryable', () => {
  const verdict = shape(classifyError(new Error('something the harness has never seen')))
  assert.equal(verdict.kind, 'unknown')
  assert.equal(verdict.retryable, false)
  assert.equal(verdict.surface, 'chat')
  assert.match(verdict.message, /something the harness has never seen/)
})

test('every declared kind is reachable from a realistic thrown value', () => {
  const samples = {
    auth: { status: 401 },
    rate_limit: { status: 429 },
    transport: { status: 503 },
    timeout: new DOMException('timed out', 'TimeoutError'),
    aborted: new DOMException('生成已停止', 'AbortError'),
    invalid_output: new Error('模型 API 没有返回可解析的 JSON'),
    compile: new SyntaxError('Unexpected token (1:1)'),
    dependency_blocked: 'Dependency is not allowed: three',
    unknown: new Error('n/a'),
  }

  assert.deepEqual(Object.keys(samples).sort(), [...ERROR_KINDS].sort())
  for (const [kind, value] of Object.entries(samples)) {
    assert.equal(shape(classifyError(value)).kind, kind)
  }
})

test('classifyError never throws on malformed or hostile input', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'message', {
    enumerable: true,
    get() {
      throw new Error('boom')
    },
  })
  const cyclic = new Error('cyclic')
  cyclic.cause = cyclic

  const values = [
    null,
    undefined,
    '',
    '   ',
    0,
    NaN,
    false,
    Symbol('nope'),
    [],
    [null, undefined],
    {},
    { message: null },
    { message: { nested: true } },
    { status: 'not-a-number' },
    { status: 999 },
    { status: 42 },
    Object.create(null),
    new Map(),
    () => {},
    hostile,
    cyclic,
  ]

  // Some of these cannot be stringified at all, so label them positionally.
  values.forEach((value, index) => {
    let verdict
    assert.doesNotThrow(() => {
      verdict = classifyError(value)
    }, `threw on values[${index}]`)
    shape(verdict)
  })
})

test('backoff grows exponentially and is capped', () => {
  const zero = () => 0
  const growth = [0, 1, 2, 3].map((attempt) => backoffMs('transport', attempt, zero))

  assert.deepEqual(growth, [400, 800, 1600, 3200])
  for (let index = 1; index < growth.length; index += 1) {
    assert.ok(growth[index] > growth[index - 1], 'backoff must grow with attempt')
  }

  for (const attempt of [8, 12, 40, 1000]) {
    assert.ok(backoffMs('transport', attempt, () => 1) <= MAX_BACKOFF_MS)
    assert.ok(backoffMs('rate_limit', attempt, () => 1) <= MAX_BACKOFF_MS)
  }
  assert.equal(backoffMs('transport', 1000, () => 1), MAX_BACKOFF_MS)
})

test('backoff jitter is bounded and deterministic for a given random source', () => {
  const low = backoffMs('rate_limit', 2, () => 0)
  const high = backoffMs('rate_limit', 2, () => 1)
  const mid = backoffMs('rate_limit', 2, () => 0.5)

  assert.equal(high, 8000)
  assert.equal(low, high / 2)
  assert.ok(mid > low && mid < high)

  // Same seed sequence, same output.
  const seeded = () => 0.25
  assert.equal(backoffMs('rate_limit', 3, seeded), backoffMs('rate_limit', 3, seeded))

  let calls = 0
  backoffMs('transport', 1, () => {
    calls += 1
    return 0.5
  })
  assert.equal(calls, 1, 'the injected random source must actually be used')
})

test('backoff returns 0 for kinds that must never auto-retry', () => {
  for (const kind of ['aborted', 'auth', 'dependency_blocked', 'unknown']) {
    for (const attempt of [0, 1, 5]) {
      assert.equal(backoffMs(kind, attempt, () => 1), 0, `${kind} must not schedule a retry`)
    }
  }
})

test('backoff tolerates malformed attempt values and a broken random source', () => {
  assert.equal(backoffMs('transport', -3, () => 0), 400)
  assert.equal(backoffMs('transport', 1.9, () => 0), 800)
  assert.equal(backoffMs('transport', NaN, () => 0), 400)
  assert.equal(backoffMs('transport', Infinity, () => 0), 400)
  assert.equal(
    backoffMs('transport', 0, () => {
      throw new Error('bad rng')
    }),
    400,
  )
  assert.equal(backoffMs('transport', 0, () => 5), 800, 'out-of-range jitter is clamped')
  assert.equal(backoffMs('nope', 0, () => 1), 0)
})

test('backoff falls back to Math.random when no source is supplied', () => {
  const original = Math.random
  Math.random = () => 1
  try {
    assert.equal(backoffMs('transport', 0), 800)
  } finally {
    Math.random = original
  }
})
