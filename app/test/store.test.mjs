import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyError } from '../src/lib/harness/errors.ts'
import { useStore } from '../src/lib/store.ts'

// The store is a module singleton shared with every other test in this suite,
// so each case snapshots it up front and restores with the `true` replace flag
// (the idiom already used in harness.test.mjs) rather than resetting fields by
// hand — a missed field would leak into whichever test ran next.
function withStore(seed, body) {
  const previous = useStore.getState()
  try {
    useStore.setState({
      phase: 'generating',
      harnessMode: 'kimi',
      harnessError: null,
      settingsOpen: false,
      chat: [],
      slots: [],
      ...seed,
    })
    body()
  } finally {
    useStore.setState(previous, true)
  }
}

/** A slot holding one in-flight candidate, shaped like `component.queued` builds it. */
function slotWith(candidateId, status = 'streaming') {
  return {
    def: {
      id: 'counter', role: '计数器', width: 'fluid', inputs: [], outputs: [], dependencies: [], previewH: 320,
      candidates: [],
    },
    status: 'generating',
    candidates: [{
      def: { id: candidateId, label: 'Motion Agent · 活泼版', style: 'expressive', blurb: '', Component: () => null },
      status, code: '', progress: 0, streamMs: 0, anim: 'anim-pop', seed: 1,
    }],
  }
}

function envelope(event) {
  return { sessionId: 'test', sequence: 1, timestamp: Date.now(), motionCue: 'pop', event }
}

const emit = (event) => useStore.getState().applyHarnessEvent(envelope(event))
const sysText = () => useStore.getState().chat.filter((m) => m.role === 'sys').map((m) => m.text).join('\n')
const candidate = () => useStore.getState().slots[0].candidates[0]

test('a completed plan waits at the blueprint gate before any candidate is queued', () => {
  const plan = {
    project: { name: 'Weather', description: '' },
    pages: [{ id: 'home', name: 'Home', route: '/', slots: ['current', 'forecast'] }],
    visualDirections: [],
    components: ['current', 'forecast'].map((id) => ({
      id, role: id, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
    })),
  }
  withStore({}, () => {
    emit({ type: 'plan.completed', plan })
    assert.equal(useStore.getState().phase, 'blueprint')
    assert.equal(useStore.getState().slots.length, 2)
    assert.equal(useStore.getState().slots.every((slot) => slot.candidates.length === 0), true)

    useStore.getState().confirmBlueprint()
    assert.equal(useStore.getState().phase, 'direction')
    assert.equal(useStore.getState().slots.every((slot) => slot.candidates.length === 0), true)
  })
})

test('a user-initiated abort never surfaces as an error', () => {
  withStore({ slots: [slotWith('counter-a')] }, () => {
    emit({ type: 'task.failed', taskId: 'build:counter-a', error: '生成已停止' })

    // Nothing global, nothing in the transcript: a Stop is a normal terminal
    // path, and previously it painted the same red banner as a real crash.
    assert.equal(useStore.getState().harnessError, null)
    assert.equal(sysText(), '')
    assert.equal(useStore.getState().settingsOpen, false)
    // The card is left exactly as it was, not marked failed.
    assert.equal(candidate().status, 'streaming')
    assert.equal(candidate().error, undefined)
  })
})

test('an AbortError object is recognised as an abort, not an unknown failure', () => {
  withStore({ slots: [slotWith('counter-a')] }, () => {
    // The harness aborts with `new DOMException('生成已停止', 'AbortError')`;
    // session.ts flattens it to `error.message` before publishing.
    const aborted = new Error('The operation was aborted.')
    aborted.name = 'AbortError'
    emit({ type: 'task.failed', taskId: 'build:counter-a', error: classifyError(aborted).message })

    assert.equal(useStore.getState().harnessError, null)
    assert.equal(candidate().status, 'streaming')
  })
})

test('an auth failure routes to the settings surface and opens the modal', () => {
  withStore({}, () => {
    emit({ type: 'task.failed', taskId: 'plan', error: '模型 API 鉴权失败：401 Unauthorized' })

    const error = useStore.getState().harnessError
    assert.equal(error.kind, 'auth')
    assert.equal(error.surface, 'settings')
    assert.equal(error.retryable, false)
    // A stale key is not fixable by waiting, so the user is taken straight to
    // the place where they can fix it.
    assert.equal(useStore.getState().settingsOpen, true)
  })
})

test('a transport failure surfaces in chat and leaves settings alone', () => {
  withStore({}, () => {
    emit({ type: 'task.failed', taskId: 'plan', error: 'Failed to fetch' })

    const error = useStore.getState().harnessError
    assert.equal(error.kind, 'transport')
    assert.equal(error.surface, 'chat')
    assert.equal(error.retryable, true)
    assert.match(sysText(), /网络连接异常/)
    // A network blip is not a credentials problem; opening settings here would
    // send the user to change a key that is perfectly fine.
    assert.equal(useStore.getState().settingsOpen, false)
  })
})

test('the user-facing message is the classified Chinese copy, not the raw error', () => {
  const raw = 'TypeError: Failed to fetch at https://api.example.com/v1/chat/completions'
  withStore({}, () => {
    emit({ type: 'task.failed', taskId: 'plan', error: raw })

    const error = useStore.getState().harnessError
    assert.equal(error.message, '网络连接异常，无法访问模型服务，稍后会自动重试。')
    assert.equal(error.message.includes('Failed to fetch'), false)
    // The raw text stays reachable for debugging, but only under `detail`.
    assert.equal(error.detail, raw)
    assert.equal(sysText().includes(raw), false)
    assert.match(sysText(), /网络连接异常/)
  })
})

test('a rate limit reports its retry window without the store retrying', () => {
  withStore({}, () => {
    emit({ type: 'task.failed', taskId: 'plan', error: '模型 API 429 rate limit exceeded, retry-after: 30' })

    const error = useStore.getState().harnessError
    assert.equal(error.kind, 'rate_limit')
    assert.equal(error.surface, 'chat')
    assert.match(error.message, /限流/)
    // Presentation only: the store must not flip itself back into generating or
    // schedule work. Backoff belongs to the session layer.
    assert.equal(useStore.getState().phase, 'generating')
  })
})

test('a per-candidate build failure lands inline and keeps the banner off', () => {
  withStore({ slots: [slotWith('counter-a')] }, () => {
    emit({ type: 'task.failed', taskId: 'build:counter-a', error: '未授权依赖: lodash' })

    // `dependency_blocked` is inline: one card is bad, the rest of the slot is
    // still usable, so the failure is pinned to the card that produced it.
    assert.equal(candidate().status, 'failed')
    assert.equal(candidate().errorKind, 'dependency_blocked')
    assert.match(candidate().error, /未授权依赖/)
    assert.equal(useStore.getState().harnessError, null)
    assert.equal(sysText(), '')
  })
})

test('compile failures show classified copy inline while repair is still running', () => {
  withStore({ slots: [slotWith('counter-a', 'compiling')] }, () => {
    emit({ type: 'compile.failed', candidateId: 'counter-a', errors: ['SyntaxError: Unexpected token <'] })

    // Still repairable, so the card keeps compiling ("正在自动修复") instead of
    // reading as dead, and it shows the Chinese message rather than the dump.
    assert.equal(candidate().status, 'compiling')
    assert.equal(candidate().errorKind, 'compile')
    assert.equal(candidate().error, '生成的组件代码没能编译通过，可以让 Fixer 再试一次。')
    assert.equal(useStore.getState().harnessError, null)

    emit({ type: 'repair.exhausted', candidateId: 'counter-a', errors: ['SyntaxError: Unexpected token <'] })
    // Out of attempts: now the card is genuinely failed.
    assert.equal(candidate().status, 'failed')
    assert.equal(candidate().errorKind, 'compile')
  })
})

test('a blocked import inside compiler output is not reported as a compile error', () => {
  withStore({ slots: [slotWith('counter-a', 'compiling')] }, () => {
    emit({ type: 'repair.exhausted', candidateId: 'counter-a', errors: ['dependency is not allowed: three'] })

    // Retrying reproduces a policy rejection exactly, so telling the user to
    // "让 Fixer 再试一次" would be a dead end.
    assert.equal(candidate().errorKind, 'dependency_blocked')
    assert.match(candidate().error, /未授权依赖/)
  })
})

test('cancellation parks in-flight cards as stopped rather than failed-looking', () => {
  withStore({ slots: [slotWith('counter-a')] }, () => {
    emit({ type: 'generation.cancelled' })

    assert.equal(candidate().errorKind, 'aborted')
    assert.equal(candidate().error, '生成已停止。')
    // No global banner: the user asked for this.
    assert.equal(useStore.getState().harnessError, null)
  })
})

test('a successful render clears every trace of a previous failure', () => {
  withStore({ slots: [slotWith('counter-a', 'compiling')] }, () => {
    emit({ type: 'compile.failed', candidateId: 'counter-a', errors: ['SyntaxError: boom'] })
    assert.ok(candidate().error)

    emit({ type: 'render.ready', candidateId: 'counter-a' })
    assert.equal(candidate().status, 'rendered')
    assert.equal(candidate().error, undefined)
    assert.equal(candidate().errorKind, undefined)
    assert.equal(candidate().errorDetail, undefined)
  })
})

test('diversity events mark a candidate and rerolling clears the warning in place', () => {
  withStore({ slots: [slotWith('counter-a', 'rendered')] }, () => {
    emit({
      type: 'candidate.duplicate', componentId: 'counter', candidateId: 'counter-a',
      score: 0.92, reason: '布局和信息层级高度相似',
    })
    assert.deepEqual(candidate().duplicate, { score: 0.92, reason: '布局和信息层级高度相似' })

    emit({ type: 'candidate.rerolling', componentId: 'counter', candidateId: 'counter-a' })
    assert.equal(candidate().status, 'streaming')
    assert.equal(candidate().duplicate, undefined)
    assert.equal(candidate().artifact, undefined)
    assert.equal(candidate().code, '')
  })
})

test('a repair keeps the last rendered artifact visible until the replacement renders', () => {
  const oldArtifact = {
    id: 'counter-a', componentId: 'counter', variant: 'expressive', attemptId: 'old-attempt',
    files: [{ path: 'src/View.tsx', content: 'old' }], entryFile: 'src/View.tsx', previewProps: {}, notes: [],
    runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }
  const fixedArtifact = { ...oldArtifact, attemptId: 'fixed-attempt', files: [{ path: 'src/View.tsx', content: 'fixed' }], runtimeStatus: 'source_ready' }
  const slot = slotWith('counter-a', 'rendered')
  slot.candidates[0].artifact = oldArtifact

  withStore({ slots: [slot] }, () => {
    emit({ type: 'repair.completed', candidate: fixedArtifact })
    assert.equal(candidate().status, 'compiling')
    assert.equal(candidate().artifact, fixedArtifact)
    assert.equal(candidate().lastGoodArtifact, oldArtifact)

    emit({ type: 'render.ready', candidateId: 'counter-a' })
    assert.equal(candidate().status, 'rendered')
    assert.equal(candidate().lastGoodArtifact, undefined)
  })
})

test('a revision failure is pinned to its candidate and labelled in chat', () => {
  withStore({ slots: [slotWith('counter-a', 'compiling')] }, () => {
    emit({ type: 'revision.failed', candidateId: 'counter-a', error: '模型返回了空响应' })

    assert.equal(candidate().errorKind, 'invalid_output')
    assert.match(candidate().error, /不符合约定格式/)
    // invalid_output is inline, so the card carries it and the banner stays clean.
    assert.equal(useStore.getState().harnessError, null)
  })
})

test('stopping generation clears a stale error banner', () => {
  withStore({
    harnessError: { kind: 'transport', surface: 'chat', message: '网络连接异常。', retryable: true },
  }, () => {
    useStore.getState().stopGeneration()

    // Otherwise the stop screen would still be showing the previous crash and
    // the user would read the stop itself as the failure.
    assert.equal(useStore.getState().harnessError, null)
    assert.equal(useStore.getState().stopped, true)
  })
})

test('each error kind produces a distinguishable presentation', () => {
  const seen = new Map()
  for (const raw of ['生成已停止', '401 Unauthorized', 'Failed to fetch', '未授权依赖: three', 'request timed out']) {
    withStore({ slots: [slotWith('counter-a')] }, () => {
      emit({ type: 'task.failed', taskId: 'build:counter-a', error: raw })
      const state = useStore.getState()
      seen.set(raw, {
        kind: state.harnessError?.kind ?? candidate().errorKind ?? 'none',
        banner: state.harnessError !== null,
        settings: state.settingsOpen,
        chat: sysText() !== '',
      })
    })
  }

  assert.deepEqual(seen.get('生成已停止'), { kind: 'none', banner: false, settings: false, chat: false })
  assert.deepEqual(seen.get('401 Unauthorized'), { kind: 'auth', banner: true, settings: true, chat: true })
  assert.deepEqual(seen.get('Failed to fetch'), { kind: 'transport', banner: true, settings: false, chat: true })
  assert.deepEqual(seen.get('未授权依赖: three'), { kind: 'dependency_blocked', banner: false, settings: false, chat: false })
  assert.deepEqual(seen.get('request timed out'), { kind: 'timeout', banner: true, settings: false, chat: true })
})
