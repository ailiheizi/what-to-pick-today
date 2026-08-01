import assert from 'node:assert/strict'
import test from 'node:test'
import { HarnessEventStream } from '../src/lib/harness/events.ts'
import { runComponentAgentGraph } from '../src/lib/harness/generation-graph.ts'
import { BrowserKimiClient, extractStreamingJsonString, parseJson } from '../src/lib/harness/kimi.ts'
import { isAllowedLocalProxyOrigin, isLocalModelProxyBase, rewriteModelProxyPath, splitModelApiBase } from '../src/lib/harness/local-proxy.ts'
import { createAtomicPlan, normalizePlanCohesion, normalizePlanEventOutputs } from '../src/lib/harness/plan-cohesion.ts'
import { builderMessages } from '../src/lib/harness/prompts.ts'
import { parseCandidate, parsePlan } from '../src/lib/harness/schemas.ts'
import { TaskScheduler } from '../src/lib/harness/scheduler.ts'
import { HarnessSession } from '../src/lib/harness/session.ts'
import { createSandboxDocument } from '../src/lib/harness/sandbox-runtime.ts'
import { isModelApiConfigured, loadKimiSettings, saveKimiSettings } from '../src/lib/harness/settings.ts'
import { useStore } from '../src/lib/store.ts'
import { migrateLocalEnvContent } from '../../scripts/migrate-local-env.mjs'

test('scheduler enforces concurrency and retries failed work', async () => {
  const controller = new AbortController()
  let active = 0
  let peak = 0
  let attempts = 0
  const retries = []
  const scheduler = new TaskScheduler({
    concurrency: 2,
    retries: 1,
    signal: controller.signal,
    onRetry: (id, attempt) => retries.push(`${id}:${attempt}`),
  })
  for (let index = 0; index < 4; index += 1) {
    scheduler.add({
      id: `task-${index}`,
      run: async (_signal, attempt) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 4))
        active -= 1
        if (index === 0 && attempt === 0) {
          attempts += 1
          throw new Error('retry me')
        }
        return index
      },
    })
  }
  const results = await scheduler.run()
  assert.equal(peak, 2)
  assert.equal(attempts, 1)
  assert.deepEqual(retries, ['task-0:1'])
  assert.deepEqual([...results].sort(), [0, 1, 2, 3])
})

test('LangGraph fans specialist component agents out and reduces their results', async () => {
  const controller = new AbortController()
  const started = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const run = runComponentAgentGraph([
    { id: 'product-job', variant: 'conservative', run: async () => { started.push('product'); await gate; return 'product-result' } },
    { id: 'explorer-job', variant: 'experimental', run: async () => { started.push('explorer'); await gate; return 'explorer-result' } },
  ], { signal: controller.signal, concurrency: 2, retries: 0 })

  for (let attempt = 0; attempt < 10 && started.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.deepEqual(new Set(started), new Set(['product', 'explorer']))
  release()
  assert.deepEqual(new Set(await run), new Set(['product-result', 'explorer-result']))
})

test('LangGraph keeps successful agents when one specialist fails', async () => {
  const controller = new AbortController()
  const failures = []
  const results = await runComponentAgentGraph([
    { id: 'motion-job', variant: 'expressive', run: async () => 'motion-result' },
    { id: 'product-job', variant: 'conservative', run: async () => { throw new Error('product unavailable') } },
    { id: 'explorer-job', variant: 'experimental', run: async () => 'explorer-result' },
  ], {
    signal: controller.signal,
    concurrency: 3,
    retries: 0,
    onFailed: (jobId, error) => failures.push(`${jobId}:${error.message}`),
  })

  // Parallel graph completion order is intentionally not part of the contract.
  assert.deepEqual(new Set(results), new Set(['motion-result', 'explorer-result']))
  assert.deepEqual(failures, ['product-job:product unavailable'])
})

test('event stream replays ordered events with stable motion cues', () => {
  const stream = new HarnessEventStream('session-test')
  stream.publish({ type: 'plan.started' }, 'planning')
  stream.publish({ type: 'generation.completed', ready: 2, expected: 2 }, 'ready')
  const restored = new HarnessEventStream('session-test', stream.all())
  assert.deepEqual(restored.after(1), [stream.all()[1]])
  assert.equal(restored.all()[0].motionCue, stream.all()[0].motionCue)
  assert.deepEqual(restored.all().map((item) => item.sequence), [1, 2])
})

test('kimi client parses fragmented SSE into JSON', async () => {
  const encoder = new TextEncoder()
  const chunks = [
    'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"true}"}}]}\n\ndata: [DONE]\n\n',
  ]
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  }), { status: 200 })
  const client = new BrowserKimiClient({ apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', temperature: 0 }, fetchImpl)
  const result = await client.completeJson([], { signal: new AbortController().signal })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(parseJson('prefix {"value":1} suffix'), { value: 1 })
})

test('kimi client preserves the browser fetch receiver', async () => {
  const fetchImpl = function () {
    assert.equal(this, globalThis)
    return Promise.resolve(new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata: [DONE]\n\n'))
  }
  const client = new BrowserKimiClient({ apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', temperature: 0 }, fetchImpl)
  const result = await client.completeJson([], { signal: new AbortController().signal })
  assert.deepEqual(result, { ok: true })
})

test('deepseek requests use native JSON mode and role-specific temperature', async () => {
  let requestBody
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body)
    return new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata: [DONE]\n\n')
  }
  const client = new BrowserKimiClient({
    apiKey: 'test', baseUrl: 'https://example.test/v1',
    model: 'deepseek-v4-flash', temperature: 0.7,
  }, fetchImpl)
  await client.completeJson([], {
    signal: new AbortController().signal,
    model: 'deepseek-v4-flash',
    maxTokens: 6000,
    temperature: 0.15,
    jsonMode: true,
  })
  assert.deepEqual(requestBody.response_format, { type: 'json_object' })
  assert.equal(requestBody.temperature, 0.15)
  assert.equal(requestBody.max_tokens, 6000)
})

test('qwen requests retain configured temperature and omit deepseek-only JSON mode', async () => {
  let requestBody
  const fetchImpl = async (_url, init) => {
    requestBody = JSON.parse(init.body)
    return new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata: [DONE]\n\n')
  }
  const client = new BrowserKimiClient({
    apiKey: 'test', baseUrl: 'https://example.test/v1',
    model: 'qwen3.6-flash', temperature: 0.7,
  }, fetchImpl)
  await client.completeJson([], { signal: new AbortController().signal, model: 'qwen3.6-flash' })
  assert.equal(requestBody.temperature, 0.7)
  assert.equal(requestBody.response_format, undefined)
})

test('local model proxy supports keyless browser requests and safe upstream rewriting', async () => {
  assert.equal(isLocalModelProxyBase('/api/model'), true)
  assert.equal(isLocalModelProxyBase('http://127.0.0.1:7100/api/model/'), true)
  assert.equal(isLocalModelProxyBase('https://example.test/api/model'), false)
  assert.deepEqual(splitModelApiBase('https://provider.test/v1/'), { target: 'https://provider.test', prefix: '/v1' })
  assert.equal(rewriteModelProxyPath('/api/model/chat/completions?stream=1', '/v1'), '/v1/chat/completions?stream=1')
  assert.equal(isAllowedLocalProxyOrigin(undefined, '127.0.0.1:7100'), true)
  assert.equal(isAllowedLocalProxyOrigin('http://127.0.0.1:7100', '127.0.0.1:7100'), true)
  assert.equal(isAllowedLocalProxyOrigin('https://malicious.example', '127.0.0.1:7100'), false)

  const fetchImpl = async (url, init) => {
    assert.equal(url, '/api/model/chat/completions')
    assert.equal(init.headers.authorization, undefined)
    return new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata: [DONE]\n\n')
  }
  const client = new BrowserKimiClient({ apiKey: '', baseUrl: '/api/model', model: 'test', temperature: 0 }, fetchImpl)
  const result = await client.completeJson([], { signal: new AbortController().signal })
  assert.deepEqual(result, { ok: true })
})

test('local proxy counts as a complete API configuration without a browser key', () => {
  assert.equal(isModelApiConfigured({
    apiKey: '', baseUrl: '/api/model', model: 'planner', codeModel: 'builder', temperature: 0.7,
  }), true)
  assert.equal(isModelApiConfigured({
    apiKey: '', baseUrl: 'https://provider.test/v1', model: 'planner', codeModel: 'builder', temperature: 0.7,
  }), false)
  assert.equal(isModelApiConfigured({
    apiKey: 'configured', baseUrl: 'https://provider.test/v1', model: '', codeModel: 'builder', temperature: 0.7,
  }), false)
})

test('role routing overrides survive settings persistence', () => {
  const localValues = new Map()
  const sessionValues = new Map()
  const storage = (values) => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  })
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage(localValues) })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage(sessionValues) })
  try {
    saveKimiSettings({
      apiKey: 'temporary', baseUrl: 'https://example.test/v1',
      model: 'reasoning', codeModel: 'code', temperature: 0.4,
      roles: {
        draft: { model: 'fast-draft' },
        reviewer: { model: 'strong-reviewer', maxTokens: 4321 },
      },
    })
    const restored = loadKimiSettings()
    assert.deepEqual(restored.roles, {
      draft: { model: 'fast-draft' },
      reviewer: { model: 'strong-reviewer', maxTokens: 4321 },
    })
    assert.equal(restored.apiKey, 'temporary')
  } finally {
    if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
    else delete globalThis.localStorage
    if (previousSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', previousSessionStorage)
    else delete globalThis.sessionStorage
  }
})

test('session sends every harness role through its resolved model route', async () => {
  const direction = {
    id: 'routing-test', name: '路由测试', description: '',
    visualDNA: {
      concept: 'clear', mood: ['focused'], colors: {}, typography: {},
      geometry: { radius: '16px', border: 'soft', density: 'normal' },
      motion: { personality: 'subtle', duration: '200ms', easing: 'ease-out' },
      compositionRules: ['clear hierarchy'],
    },
  }
  const plan = {
    project: { name: 'Routing', description: 'role routing integration' },
    pages: [{ id: 'home', name: 'Home', route: '/', slots: ['dashboard'] }],
    visualDirections: [direction],
    components: [{
      id: 'dashboard', role: '复杂管理控制台', slot: 'dashboard', width: 'fluid',
      inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
    }],
  }
  const calls = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    const input = typeof body.messages[1].content === 'string'
      ? JSON.parse(body.messages[1].content)
      : null
    let role
    let result
    if (system.includes('Planner')) {
      role = 'planner'
      result = plan
    } else if (system.includes('UI Draft Renderer')) {
      role = 'draft'
      result = { previewHtml: '<main>draft</main>' }
    } else if (system.includes('局部 Fixer')) {
      role = 'fixer'
      result = {
        files: input.candidate.files,
        entryFile: input.candidate.entryFile,
        previewProps: input.candidate.previewProps,
        notes: ['fixed'],
      }
    } else if (system.includes('Revision Builder')) {
      role = 'fixer'
      result = {
        files: input.currentCandidate.files,
        entryFile: input.currentCandidate.entryFile,
        previewProps: input.currentCandidate.previewProps,
        notes: ['revised'],
      }
    } else if (system.includes('Reviewer')) {
      role = 'reviewer'
      result = { summary: '通过', patches: [] }
    } else {
      role = 'builder'
      const file = input.outputSchema.files[0]
      result = {
        previewHtml: '<main>built</main>',
        files: [{ path: file.path, content: 'export default function View(){ return null }' }],
        entryFile: file.path,
        previewProps: {},
        notes: [],
      }
    }
    calls.push({ role, model: body.model, maxTokens: body.max_tokens, system })
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const session = new HarnessSession('制作一个包含知识库、成员和权限的复杂企业管理控制台', {
    kimi: {
      apiKey: 'test', baseUrl: 'https://example.test/v1',
      model: 'legacy-reasoning', codeModel: 'legacy-code', temperature: 0,
      roles: {
        planner: { model: 'planner-model', maxTokens: 1111 },
        draft: { model: 'draft-model', maxTokens: 2222 },
        builder: { model: 'builder-model', maxTokens: 3333 },
        fixer: { model: 'fixer-model', maxTokens: 4444 },
        reviewer: { model: 'reviewer-model', maxTokens: 5555 },
      },
    },
    fetchImpl,
    persist: false,
    candidateCount: 1,
    runtime: { compile: async () => ({ ok: true }) },
  })

  await session.start()
  await session.chooseDirection(direction.id)
  const candidate = session.candidates[0]
  await session.reportCompile(candidate.id, { ok: false, errors: ['force fixer route'] })
  await session.select(candidate.componentId, candidate.id)
  await session.revise('调整信息层级')
  await session.review()

  const expected = {
    planner: ['planner-model', 1111],
    draft: ['draft-model', 2222],
    builder: ['builder-model', 3333],
    fixer: ['fixer-model', 4444],
    reviewer: ['reviewer-model', 5555],
  }
  for (const [role, [model, maxTokens]] of Object.entries(expected)) {
    const roleCalls = calls.filter((call) => call.role === role)
    assert.ok(roleCalls.length > 0, `${role} should make at least one request`)
    assert.equal(roleCalls.every((call) => call.model === model && call.maxTokens === maxTokens), true)
  }
  assert.equal(calls.filter((call) => call.system.includes('Revision Builder')).every((call) => call.model === 'fixer-model' && call.maxTokens === 4444), true)
})

test('legacy local credentials migrate to dotenv without exposing or dropping values', () => {
  const modelKey = `sk-${'a'.repeat(24)}`
  const resendKey = `re_${'b'.repeat(24)}`
  const legacy = `resend token:${resendKey}\n\napikey:\nproxy.example.test\n${modelKey}`
  const result = migrateLocalEnvContent(legacy)
  assert.equal(result.changed, true)
  assert.match(result.content, /^AI_PROXY_BASE_URL=https:\/\/proxy\.example\.test\/v1$/m)
  assert.match(result.content, new RegExp(`^AI_PROXY_API_KEY=${modelKey}$`, 'm'))
  assert.match(result.content, new RegExp(`^RESEND_API_KEY=${resendKey}$`, 'm'))
  assert.doesNotMatch(result.content, /resend token|^apikey:/im)

  const secondPass = migrateLocalEnvContent(result.content)
  assert.equal(secondPass.changed, false)
  assert.equal(secondPass.content, result.content)
})

test('streaming JSON strings expose a usable partial HTML draft', () => {
  const partial = extractStreamingJsonString(
    '{"previewHtml":"<div class=\\"card\\">你好\\n世界\\u0021',
    'previewHtml',
  )
  assert.equal(partial.found, true)
  assert.equal(partial.complete, false)
  assert.equal(partial.value, '<div class="card">你好\n世界!')

  const complete = extractStreamingJsonString(
    '{"previewHtml":"<main>ready<\\/main>","files":[]}',
    'previewHtml',
  )
  assert.deepEqual(complete, { found: true, complete: true, value: '<main>ready</main>' })
  assert.deepEqual(extractStreamingJsonString('{"files":[]}', 'previewHtml'), { found: false, complete: false, value: '' })
})

test('schemas reject unsafe files and unapproved dependencies', () => {
  const basePlan = {
    project: { name: 'Test', description: '' },
    pages: [{ id: 'home', name: 'Home', route: '/', slots: ['one', 'two', 'three'] }],
    visualDirections: Array.from({ length: 3 }, (_, index) => ({
      id: `style-${index}`,
      name: `Style ${index}`,
      description: '',
      visualDNA: {
        concept: '', mood: [], colors: {}, typography: {},
        geometry: { radius: '24px', border: 'none', density: 'normal' },
        motion: { personality: 'playful', duration: '300ms', easing: 'ease' },
        compositionRules: [],
      },
    })),
    components: ['one', 'two', 'three'].map((id) => ({
      id, role: id, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
    })),
  }
  assert.equal(parsePlan(basePlan).components.length, 3)
  const manyComponents = Array.from({ length: 12 }, (_, index) => ({
    id: `section-${index}`, role: `Section ${index}`, slot: `section-${index}`,
    width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
  }))
  assert.equal(parsePlan({
    ...basePlan,
    pages: [{ ...basePlan.pages[0], slots: manyComponents.map(({ id }) => id) }],
    components: manyComponents,
  }).components.length, 12)
  assert.throws(() => parsePlan({
    ...basePlan,
    components: basePlan.components.map((item, index) => index ? item : { ...item, dependencies: ['evil-package'] }),
  }), /未授权依赖/)
  assert.throws(() => parseCandidate({
    files: [{ path: '../secret.tsx', content: 'x' }], entryFile: '../secret.tsx', previewProps: {}, notes: [],
  }, { id: 'candidate', componentId: 'one', variant: 'conservative' }), /不安全/)
})

test('atomic widget planning keeps one shared state boundary', () => {
  const plan = createAtomicPlan('精致苹果风计数器，包含数字、减一、重置、加一')
  assert.ok(plan)
  assert.equal(plan.components.length, 1)
  assert.equal(plan.components[0].id, 'counter')
  assert.equal(plan.components[0].role, '完整计数器')
  assert.deepEqual(plan.pages[0].slots, ['counter'])
  assert.ok(plan.components[0].dependencies.includes('motion'))

  assert.equal(createAtomicPlan('做一个产品落地页，包含 hero、功能和价格区块'), null)
  assert.equal(createAtomicPlan('做一个数据分析 dashboard，包含导航、图表和活动列表'), null)
})

test('cross-slot value outputs are normalized into explicit React callbacks', () => {
  const plan = {
    project: { name: 'RBAC', description: '' }, pages: [], visualDirections: [],
    components: [
      {
        id: 'users', role: '用户列表', slot: 'users', width: 'fluid', inputs: [],
        outputs: [{ name: 'selectedUser', payload: 'string' }, { name: 'onRoleSelected', payload: 'string' }],
        dependencies: ['react'], designTokens: [],
      },
      {
        id: 'permissions', role: '权限编辑', slot: 'permissions', width: 'fluid',
        inputs: [{ name: 'selectedUser', type: 'string', required: true }], outputs: [], dependencies: ['react'], designTokens: [],
      },
    ],
  }

  const normalized = normalizePlanEventOutputs(plan)
  assert.deepEqual(normalized.components[0].outputs.map(({ name }) => name), ['onSelectedUserChange', 'onRoleSelected'])
  assert.equal(plan.components[0].outputs[0].name, 'selectedUser')
})

test('cross-slot signal types are normalized to the producer payload before generation', () => {
  const plan = {
    project: { name: 'RBAC', description: '' }, pages: [], visualDirections: [],
    components: [
      {
        id: 'users', role: '用户列表', slot: 'users', width: 'fixed', inputs: [],
        outputs: [{ name: 'onUserSelected', payload: 'string' }], dependencies: ['react'], designTokens: [],
      },
      {
        id: 'permissions', role: '权限编辑', slot: 'permissions', width: 'fluid',
        inputs: [{ name: 'selectedUser', type: 'object', required: true }], outputs: [], dependencies: ['react'], designTokens: [],
      },
    ],
  }

  const normalized = normalizePlanCohesion(plan, '团队权限管理页')
  assert.equal(normalized.components[1].inputs[0].type, 'string')
  assert.equal(plan.components[1].inputs[0].type, 'object')
})

test('restoring an old snapshot upgrades value-like event outputs', () => {
  const now = Date.now()
  const direction = {
    id: 'apple', name: '苹果风', description: '',
    visualDNA: { concept: '', mood: [], colors: {}, typography: {}, geometry: { radius: '', border: '', density: '' }, motion: { personality: '', duration: '', easing: '' }, compositionRules: [] },
  }
  const session = new HarnessSession('RBAC', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 }, persist: false,
  }, {
    version: 1, sessionId: 'legacy-binding', requirement: 'RBAC', phase: 'selecting', createdAt: now, updatedAt: now,
    plan: {
      project: { name: 'RBAC', description: '' }, pages: [], visualDirections: [direction],
      components: [
        { id: 'users', role: '用户', slot: 'users', width: 'fluid', inputs: [], outputs: [{ name: 'selectedUser', payload: 'string' }], dependencies: ['react'], designTokens: [] },
        { id: 'permissions', role: '权限', slot: 'permissions', width: 'fluid', inputs: [{ name: 'selectedUser', type: 'string', required: true }], outputs: [], dependencies: ['react'], designTokens: [] },
      ],
    },
    direction, candidates: [{
      id: 'legacy-users', componentId: 'users', variant: 'expressive',
      files: [{ path: 'src/users.tsx', content: `export default function Users({ onSelectUser }) { return <button onClick={() => onSelectUser('u-1')}>选择</button> }` }],
      entryFile: 'src/users.tsx', previewProps: {}, notes: [], runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
    }], selections: {}, review: null, events: [],
  })

  assert.equal(session.plan.components[0].outputs[0].name, 'onSelectedUserChange')
  assert.match(session.candidates[0].files[0].content, /onSelectUser/)
})

test('remote plans merge split counter parts without losing their contracts', () => {
  const input = {
    project: { name: 'Counter', description: 'Split by remote planner' },
    pages: [{ id: 'home', name: 'Home', route: '/', slots: ['display', 'controls'] }],
    visualDirections: [],
    components: [
      {
        id: 'display', role: '计数显示', slot: 'page-main', width: 'fixed',
        inputs: [{ name: 'value', type: 'number', required: true }],
        outputs: [], dependencies: ['react'], designTokens: ['text', 'surface'],
      },
      {
        id: 'controls', role: '计数控制', slot: 'page-main', width: 'fluid',
        inputs: [{ name: 'value', type: 'number', required: true }],
        outputs: [{ name: 'change', payload: 'number' }],
        dependencies: ['react', 'motion'], designTokens: ['surface', 'motion'],
      },
    ],
  }

  const normalized = normalizePlanCohesion(input, '苹果风计数器，包含减一、重置、加一')
  assert.equal(normalized.components.length, 1)
  assert.equal(normalized.components[0].id, 'counter')
  assert.equal(normalized.components[0].width, 'fluid')
  assert.deepEqual(normalized.components[0].inputs.map(({ name }) => name), ['value'])
  assert.deepEqual(normalized.components[0].outputs.map(({ name }) => name), ['change'])
  assert.deepEqual(normalized.components[0].dependencies, ['react', 'motion'])
  assert.deepEqual(normalized.components[0].designTokens, ['text', 'surface', 'motion'])
  assert.deepEqual(normalized.pages[0].slots, ['counter'])
  assert.deepEqual(input.pages[0].slots, ['display', 'controls'])
})

test('cohesion normalization does not merge page-level sections', () => {
  const dashboard = {
    project: { name: 'Dashboard', description: '' },
    pages: [{ id: 'home', name: 'Home', route: '/', slots: ['nav', 'chart', 'activity'] }],
    visualDirections: [],
    components: ['nav', 'chart', 'activity'].map((id) => ({
      id, role: id, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
    })),
  }
  const normalized = normalizePlanCohesion(dashboard, '做一个数据分析 dashboard，包含导航、图表和活动列表')
  assert.equal(normalized, dashboard)
  assert.equal(normalized.components.length, 3)
  assert.deepEqual(normalized.pages[0].slots, ['nav', 'chart', 'activity'])
})

test('atomic session planning skips the remote planner request', async () => {
  let fetchCalls = 0
  const session = new HarnessSession('做一个带弹性动画的计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('atomic planning should not call fetch')
    },
    persist: false,
  })
  const completedPlans = []
  session.subscribe(({ event }) => {
    if (event.type === 'plan.completed') completedPlans.push(event.plan)
  })

  const plan = await session.start()
  assert.equal(fetchCalls, 0)
  assert.equal(session.phase, 'awaiting_direction')
  assert.equal(plan.components.length, 1)
  assert.equal(completedPlans.length, 1)
  assert.equal(completedPlans[0], plan)
})

test('candidate generation exposes the full team and starts every specialist at once', async () => {
  let releaseLeadWave
  const leadWaveGate = new Promise((resolve) => { releaseLeadWave = resolve })
  const started = []
  const rendered = []
  const queuedAgents = []
  const lifecycle = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    const input = JSON.parse(body.messages[1].content)
    let result
    if (system.includes('UI Draft Renderer')) {
      result = { previewHtml: '<main>draft</main>' }
    } else {
      started.push(input.variant)
      await leadWaveGate
      const file = input.outputSchema.files[0]
      result = {
        previewHtml: `<main>${input.variant}</main>`,
        files: [{ path: file.path, content: 'export default function View(){ return null }' }],
        entryFile: file.path,
        previewProps: {},
        notes: [],
      }
    }
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const session = new HarnessSession('做一个计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 3,
    runtime: { compile: async () => ({ ok: true }) },
  })
  session.subscribe(({ event }) => {
    lifecycle.push(event.type)
    if (event.type === 'render.ready') rendered.push(event.candidateId)
    if (event.type === 'component.queued') queuedAgents.push(`${event.variant}:${event.agent.id}`)
  })
  await session.start()
  const generation = session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'playful', mood: ['lively'], colors: {}, typography: {},
      geometry: { radius: '24px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' },
      compositionRules: [],
    },
  })
  // Every specialist must be in flight before any of them finishes. Serializing
  // them into waves left later agents visibly "queued" for the entire duration
  // of the first build, which reads as a stalled product.
  for (let attempt = 0; attempt < 40 && started.length < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.deepEqual(new Set(started), new Set(['expressive', 'conservative', 'experimental']))
  assert.equal(rendered.length, 0)
  assert.deepEqual(new Set(queuedAgents), new Set(['expressive:motion', 'conservative:product', 'experimental:explorer']))
  assert.equal(lifecycle.indexOf('component.started') > lifecycle.lastIndexOf('component.queued'), true)

  releaseLeadWave()
  await generation
  assert.deepEqual(new Set(started), new Set(['expressive', 'conservative', 'experimental']))
  assert.deepEqual(new Set(queuedAgents), new Set(['expressive:motion', 'conservative:product', 'experimental:explorer']))
  assert.equal(rendered.length, 3)
  assert.equal(session.candidates.length, 3)
  assert.deepEqual(new Set(session.candidates.map(({ variant, agent }) => `${variant}:${agent.id}`)), new Set([
    'expressive:motion', 'conservative:product', 'experimental:explorer',
  ]))
})

test('default generation ships one lead candidate and expands two alternatives on demand', async () => {
  const variants = []
  const sse = (result) => `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    if (system.includes('UI Draft Renderer')) return new Response(sse({ previewHtml: '<main>draft</main>' }))
    const input = JSON.parse(body.messages[1].content)
    variants.push(input.variant)
    const file = input.outputSchema.files[0]
    return new Response(sse({
      previewHtml: '<main>ready</main>', files: [{ path: file.path, content: 'export default function View(){ return null }' }],
      entryFile: file.path, previewProps: {}, notes: [],
    }))
  }
  const session = new HarnessSession('做一个计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl, persist: false, runtime: { compile: async () => ({ ok: true }) },
  })
  await session.start()
  await session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: { concept: 'test', mood: [], colors: {}, typography: {}, geometry: { radius: '24px', border: 'soft', density: 'normal' }, motion: { personality: 'spring', duration: '300ms', easing: 'ease' }, compositionRules: [] },
  })
  assert.deepEqual(variants, ['expressive'])
  await session.generateCandidates(undefined, 2)
  assert.deepEqual(variants, ['expressive', 'conservative', 'experimental'])
})

test('multi-component generation gives every slot a lead candidate before second variants', async () => {
  let releaseBuilders
  const builderGate = new Promise((resolve) => { releaseBuilders = resolve })
  const started = []
  const dna = {
    concept: 'playful', mood: [], colors: {}, typography: {},
    geometry: { radius: '24px', border: 'soft', density: 'normal' },
    motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' },
    compositionRules: [],
  }
  const plan = {
    project: { name: 'Weather', description: '' },
    pages: [{ id: 'home', name: 'Home', route: '/', slots: ['current', 'forecast'] }],
    visualDirections: [{ id: 'test', name: 'Test', description: '', visualDNA: dna }],
    components: [
      { id: 'current', role: '当前天气', slot: 'current', width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [] },
      { id: 'forecast', role: '七天预报', slot: 'forecast', width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [] },
    ],
  }
  const sse = (result) => `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    if (system.includes('Planner')) return new Response(sse(plan))
    if (system.includes('UI Draft Renderer')) return new Response(sse({ previewHtml: '<main>draft</main>' }))
    const input = JSON.parse(body.messages[1].content)
    started.push(`${input.componentContract.id}:${input.variant}`)
    await builderGate
    const file = input.outputSchema.files[0]
    return new Response(sse({
      previewHtml: '<main>ready</main>',
      files: [{ path: file.path, content: 'export default function View(){ return null }' }],
      entryFile: file.path, previewProps: {}, notes: [],
    }))
  }
  const session = new HarnessSession('制作天气页面', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 3,
    concurrency: 2,
    runtime: { compile: async () => ({ ok: true }) },
  })
  const generatedPlan = await session.start()
  const generation = session.chooseDirection(generatedPlan.visualDirections[0].id)
  for (let attempt = 0; attempt < 40 && started.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  assert.deepEqual(started, ['current:expressive', 'forecast:expressive'])
  releaseBuilders()
  await generation
  assert.equal(session.candidates.length, 6)
})

test('a user-triggered reroll replaces one candidate in place with a fresh attempt', async () => {
  let builderCall = 0
  const events = []
  const sse = (result) => `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    if (system.includes('UI Draft Renderer')) return new Response(sse({ previewHtml: '<main>draft</main>' }))
    builderCall += 1
    const input = JSON.parse(body.messages[1].content)
    const file = input.outputSchema.files[0]
    return new Response(sse({
      previewHtml: `<main>build-${builderCall}</main>`,
      files: [{ path: file.path, content: `export default function View(){ return ${builderCall} }` }],
      entryFile: file.path, previewProps: {}, notes: [],
    }))
  }
  const session = new HarnessSession('做一个计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 1,
    runtime: { compile: async () => ({ ok: true }) },
  })
  session.subscribe(({ event }) => events.push(event))
  await session.start()
  await session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'playful', mood: [], colors: {}, typography: {},
      geometry: { radius: '24px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' },
      compositionRules: [],
    },
  })
  const before = session.candidates[0]
  const replacement = await session.rerollCandidate(before.id)

  assert.ok(replacement)
  assert.equal(replacement.id, before.id)
  assert.equal(replacement.componentId, before.componentId)
  assert.equal(replacement.variant, before.variant)
  assert.notEqual(replacement.attemptId, before.attemptId)
  assert.equal(replacement.runtimeStatus, 'rendered')
  assert.equal(session.candidates.length, 1)
  assert.equal(events.some((event) => event.type === 'candidate.rerolling' && event.candidateId === before.id), true)
})

test('stopping generation suppresses late source and render events', async () => {
  let releaseBuilders
  const builderGate = new Promise((resolve) => { releaseBuilders = resolve })
  const events = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    const input = JSON.parse(body.messages[1].content)
    let result
    if (system.includes('UI Draft Renderer')) {
      result = { previewHtml: '<main>draft</main>' }
    } else {
      // Deliberately ignore AbortSignal to reproduce providers that finish a
      // buffered response after the user has pressed Stop.
      await builderGate
      const file = input.outputSchema.files[0]
      result = {
        previewHtml: `<main>${input.variant}</main>`,
        files: [{ path: file.path, content: 'export default function View(){ return null }' }],
        entryFile: file.path,
        previewProps: {},
        notes: [],
      }
    }
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const session = new HarnessSession('做一个计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 3,
    runtime: { compile: async () => ({ ok: true }) },
  })
  session.subscribe(({ event }) => events.push(event.type))
  await session.start()
  const generation = session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'playful', mood: [], colors: {}, typography: {},
      geometry: { radius: '24px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' },
      compositionRules: [],
    },
  })
  for (let attempt = 0; attempt < 20 && !events.includes('component.started'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  session.stopGeneration()
  const cancelledAt = events.lastIndexOf('generation.cancelled')
  releaseBuilders()
  await generation

  assert.notEqual(cancelledAt, -1)
  assert.equal(events.slice(cancelledAt + 1).includes('source.ready'), false)
  assert.equal(events.slice(cancelledAt + 1).includes('render.ready'), false)
})

test('committing the final slot keeps it active for visible confirmation', () => {
  const previous = useStore.getState()
  const candidateId = 'counter-expressive'
  useStore.setState({
    phase: 'idle',
    harnessMode: 'demo',
    activeSlotId: 'counter',
    slots: [{
      def: {
        id: 'counter', role: '完整计数器', width: 'fluid', inputs: [], outputs: [], dependencies: [], previewH: 320,
        candidates: [],
      },
      status: 'ready',
      candidates: [{
        def: {
          id: candidateId, label: 'Motion Agent · 活泼版', style: 'expressive', blurb: '', Component: () => null,
        },
        status: 'rendered', code: '', progress: 1, streamMs: 0, anim: 'anim-pop', seed: 1,
      }],
      tryOnId: candidateId,
    }],
  })

  useStore.getState().confirmCandidate('counter', candidateId)
  assert.equal(useStore.getState().slots[0].selectedId, candidateId)
  assert.equal(useStore.getState().activeSlotId, 'counter')
  useStore.setState(previous, true)
})

test('committing a middle slot advances forward instead of jumping back', async () => {
  const previous = useStore.getState()
  const slot = (id, status) => ({
    def: {
      id, role: id, width: 'fluid', inputs: [], outputs: [], dependencies: [], previewH: 320, candidates: [],
    },
    status,
    candidates: [{
      def: { id: `${id}-cand`, label: `${id} 活泼版`, style: 'expressive', blurb: '', Component: () => null },
      status: 'rendered', code: '', progress: 1, streamMs: 0, anim: 'anim-pop', seed: 1,
    }],
    tryOnId: `${id}-cand`,
  })

  // "hero" is deliberately left unselected and sits *above* the slot being
  // confirmed, so searching from the top of the list would bounce back to it.
  useStore.setState({
    phase: 'idle',
    harnessMode: 'demo',
    activeSlotId: 'stats',
    slots: [slot('hero', 'ready'), slot('stats', 'ready'), slot('table', 'ready')],
  })

  useStore.getState().confirmCandidate('stats', 'stats-cand')
  assert.equal(useStore.getState().slots[1].selectedId, 'stats-cand')
  // The confirmed card must linger so the success animation is visible.
  assert.equal(useStore.getState().activeSlotId, 'stats')

  await new Promise((resolve) => setTimeout(resolve, 900))
  assert.equal(useStore.getState().activeSlotId, 'table')

  // Nothing unselected remains after "table", so it may fall back to the
  // earlier skipped slot rather than stranding the user.
  useStore.getState().confirmCandidate('table', 'table-cand')
  await new Promise((resolve) => setTimeout(resolve, 900))
  assert.equal(useStore.getState().activeSlotId, 'hero')
  useStore.setState(previous, true)
})

test('an explicit slot pick cancels the pending auto-advance', async () => {
  const previous = useStore.getState()
  const slot = (id, status) => ({
    def: {
      id, role: id, width: 'fluid', inputs: [], outputs: [], dependencies: [], previewH: 320, candidates: [],
    },
    status,
    candidates: [{
      def: { id: `${id}-cand`, label: `${id} 活泼版`, style: 'expressive', blurb: '', Component: () => null },
      status: 'rendered', code: '', progress: 1, streamMs: 0, anim: 'anim-pop', seed: 1,
    }],
    tryOnId: `${id}-cand`,
  })

  useStore.setState({
    phase: 'idle',
    harnessMode: 'demo',
    activeSlotId: 'stats',
    slots: [slot('hero', 'ready'), slot('stats', 'ready'), slot('table', 'ready')],
  })

  useStore.getState().confirmCandidate('stats', 'stats-cand')
  useStore.getState().setActiveSlot('hero')
  await new Promise((resolve) => setTimeout(resolve, 900))
  // The user's own choice must survive the auto-advance timer firing.
  assert.equal(useStore.getState().activeSlotId, 'hero')
  useStore.setState(previous, true)
})

test('builder variants require structural and motion differences', () => {
  const direction = {
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'playful', mood: [], colors: {}, typography: {},
      geometry: { radius: '24px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' },
      compositionRules: [],
    },
  }
  const component = {
    id: 'counter', role: '完整计数器', slot: 'page-main', width: 'fluid',
    inputs: [], outputs: [], dependencies: ['react', 'motion'], designTokens: [],
  }
  const plan = {
    project: { name: 'Counter', description: '' }, pages: [], visualDirections: [direction], components: [component],
  }
  const messagesByVariant = ['conservative', 'expressive', 'experimental'].map((variant) =>
    builderMessages({ requirement: '计数器', plan, direction, component, variant }))
  const profiles = messagesByVariant.map((messages) => {
    return JSON.parse(messages[1].content).variantProfile
  })
  const builderContext = JSON.parse(messagesByVariant[0][1].content).compositionContext
  assert.equal(new Set(profiles.map(({ composition }) => composition)).size, 3)
  assert.equal(new Set(profiles.map(({ interaction }) => interaction)).size, 3)
  assert.match(profiles[2].composition, /不得只是换颜色/)
  assert.match(messagesByVariant[0][0].content, /Product Agent/)
  assert.match(messagesByVariant[1][0].content, /Motion Agent/)
  assert.match(messagesByVariant[2][0].content, /Explorer Agent/)
  assert.equal(builderContext.currentResponsibility.id, 'counter')
  assert.deepEqual(builderContext.siblingResponsibilities, [])
})

test('full browser session plans, builds, compiles, selects and reviews', async () => {
  const dna = {
    concept: 'Material You', mood: ['playful'], colors: { primary: '#6750a4' }, typography: {},
    geometry: { radius: '28px', border: 'tonal', density: 'normal' },
    motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' },
    compositionRules: ['rounded'],
  }
  const plan = {
    project: { name: 'Test', description: 'Harness test' },
    pages: [{ id: 'home', name: 'Home', route: '/', slots: ['one', 'two', 'three'] }],
    visualDirections: ['md3', 'apple', 'hacker'].map((id) => ({ id, name: id, description: id, visualDNA: dna })),
    components: ['one', 'two', 'three'].map((id) => ({
      id, role: id, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
    })),
  }
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    let result
    if (system.includes('Planner')) result = plan
    else if (system.includes('Reviewer')) result = { summary: '通过', patches: [] }
    else if (system.includes('UI Draft Renderer')) {
      result = { previewHtml: '<main style="padding:24px">Fast API draft is visible</main>' }
    }
    else {
      const input = JSON.parse(body.messages[1].content)
      const file = input.outputSchema.files[0]
      result = {
        previewHtml: '<main style="padding:24px;border-radius:24px;background:var(--dna-surface)">Streaming API preview is visible</main>',
        files: [{ path: file.path, content: 'export default function View(){ return null }' }],
        entryFile: file.path,
        previewProps: {},
        notes: [],
      }
    }
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const session = new HarnessSession('做一个测试页面', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 2,
    runtime: { compile: async () => ({ ok: true }) },
  })
  const streamedPreviews = []
  session.subscribe((envelope) => {
    if (envelope.event.type === 'preview.updated') streamedPreviews.push(envelope.event.html)
  })
  const generatedPlan = await session.start()
  await session.chooseDirection(generatedPlan.visualDirections[0].id)
  assert.ok(streamedPreviews.some((html) => html.includes('Fast API draft')))
  assert.ok(streamedPreviews.some((html) => html.includes('Streaming API preview')))
  assert.equal(session.candidates.length, 6)
  for (const component of generatedPlan.components) {
    const candidate = session.candidates.find((item) => item.componentId === component.id)
    assert.equal(candidate.runtimeStatus, 'rendered')
    await session.select(component.id, candidate.id)
  }
  const review = await session.review()
  assert.equal(session.phase, 'complete')
  assert.equal(review.summary, '通过')
})

test('final reviewer reads selected source, safely revises at most three slots and keeps failed originals', async () => {
  const dna = {
    concept: 'Cohesive', mood: ['clear'], colors: {}, typography: {},
    geometry: { radius: '20px', border: 'soft', density: 'normal' },
    motion: { personality: 'subtle', duration: '200ms', easing: 'ease-out' },
    compositionRules: ['shared rhythm'],
  }
  const direction = { id: 'cohesive', name: '统一', description: '', visualDNA: dna }
  const components = ['one', 'two', 'three', 'four'].map((id) => ({
    id, role: `${id} 区域`, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
  }))
  const plan = {
    project: { name: '审查测试', description: '' },
    pages: [{ id: 'home', name: '首页', route: '/', slots: components.map(({ id }) => id) }],
    visualDirections: [direction], components,
  }
  const candidates = components.map(({ id }) => ({
    id: `${id}-candidate`, componentId: id, variant: 'expressive',
    files: [{ path: `src/${id}.tsx`, content: `export default function ${id}(){ return '${id}-original' }` }],
    entryFile: `src/${id}.tsx`, previewProps: {}, notes: [], runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }))
  let reviewerRequest
  const revisionTargets = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    let result
    if (system.includes('Reviewer')) {
      reviewerRequest = JSON.parse(body.messages[1].content)
      result = {
        summary: '统一整页节奏',
        patches: [{ type: 'css', target: 'page', reason: '统一槽位间距', value: { instruction: '将根容器间距统一为 24px' } }],
      }
    } else {
      const input = JSON.parse(body.messages[1].content)
      const id = input.componentContract.id
      revisionTargets.push(id)
      result = {
        files: [{ path: input.currentCandidate.files[0].path, content: `export default function ${id}(){ return '${id}-revised' }` }],
        entryFile: input.currentCandidate.entryFile, previewProps: input.currentCandidate.previewProps, notes: ['review revision'],
      }
    }
    const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const now = Date.now()
  const session = new HarnessSession('做一个中文页面', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl, persist: false, retries: 0, concurrency: 4,
    runtime: {
      compile: async (candidate) => candidate.componentId === 'two'
        ? { ok: false, errors: ['two revision rejected'] }
        : { ok: true },
    },
  }, {
    version: 1, sessionId: 'review-session', requirement: '做一个中文页面', phase: 'selecting',
    createdAt: now, updatedAt: now, plan, direction, candidates,
    selections: Object.fromEntries(components.map(({ id }) => [id, `${id}-candidate`])), review: null, events: [],
  })

  const review = await session.review()

  assert.equal(session.phase, 'complete')
  assert.equal(reviewerRequest.selectedCandidates.length, 4)
  assert.match(reviewerRequest.selectedCandidates[0].files[0].content, /one-original/)
  assert.deepEqual(new Set(revisionTargets), new Set(['one', 'two', 'three']))
  assert.deepEqual(new Set(review.appliedComponentIds), new Set(['one', 'three']))
  assert.deepEqual(review.failedComponentIds, ['two'])
  assert.match(session.candidates.find(({ componentId }) => componentId === 'one').files[0].content, /one-revised/)
  assert.match(session.candidates.find(({ componentId }) => componentId === 'two').files[0].content, /two-original/)
  assert.match(session.candidates.find(({ componentId }) => componentId === 'four').files[0].content, /four-original/)
  assert.ok(session.events.all().some(({ event }) => event.type === 'review.completed'))
})

test('switching visual direction performs structural candidate revisions instead of token-only recoloring', async () => {
  const oldDirection = {
    id: 'apple', name: '苹果风', description: '',
    visualDNA: {
      concept: 'glass', mood: ['light'], colors: {}, typography: {},
      geometry: { radius: '24px', border: 'soft', density: 'comfortable' },
      motion: { personality: 'smooth', duration: '300ms', easing: 'ease' },
      compositionRules: ['floating cards'],
    },
  }
  const hackerDirection = {
    id: 'hacker', name: '黑客风', description: '',
    visualDNA: {
      concept: 'terminal grid', mood: ['dense'], colors: {}, typography: {},
      geometry: { radius: '2px', border: 'line', density: 'compact' },
      motion: { personality: 'mechanical', duration: '120ms', easing: 'linear' },
      compositionRules: ['1px 细线分隔', '高密度终端布局'],
    },
  }
  const components = ['users', 'permissions'].map((id) => ({
    id, role: id, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
  }))
  const candidates = components.map(({ id }) => ({
    id: `${id}-candidate`, componentId: id, variant: 'expressive',
    files: [{ path: `src/${id}.tsx`, content: `export default function View(){return <div>${id}-apple</div>}` }],
    entryFile: `src/${id}.tsx`, previewProps: {}, notes: [], runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }))
  const revisionRequests = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const input = JSON.parse(body.messages[1].content)
    revisionRequests.push(input)
    const id = input.componentContract.id
    const result = {
      files: [{ path: input.currentCandidate.files[0].path, content: `export default function View(){return <section>${id}-hacker-layout</section>}` }],
      entryFile: input.currentCandidate.entryFile, previewProps: {}, notes: [],
    }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`)
  }
  const now = Date.now()
  const session = new HarnessSession('RBAC 管理面板', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl, persist: false, retries: 0, runtime: { compile: async () => ({ ok: true }) },
  }, {
    version: 1, sessionId: 'restyle-session', requirement: 'RBAC 管理面板', phase: 'selecting',
    createdAt: now, updatedAt: now,
    plan: { project: { name: 'RBAC', description: '' }, pages: [{ id: 'home', name: '首页', route: '/', slots: components.map(({ id }) => id) }], visualDirections: [oldDirection, hackerDirection], components },
    direction: oldDirection, candidates, selections: {}, review: null, events: [],
  })

  const revised = await session.restyleCandidates(hackerDirection, candidates.map(({ id }) => id))

  assert.equal(session.direction.id, 'hacker')
  assert.equal(revised.length, 2)
  assert.equal(revisionRequests.length, 2)
  for (const request of revisionRequests) {
    assert.equal(request.visualDNA.concept, 'terminal grid')
    assert.ok(request.layoutGrammar.some((rule) => /终端工作区/.test(rule)))
    assert.match(request.instruction, /不是换色任务/)
    assert.match(request.instruction, /根布局、信息分组、控件形态/)
    assert.match(request.instruction, /强制布局语法/)
    assert.match(request.instruction, /至少改变一个主要分组/)
    assert.match(request.instruction, /禁止 min-h-screen、100vh/)
  }
  assert.ok(session.candidates.every((item) => item.files[0].content.includes('hacker-layout')))
})

test('an incomplete visual direction migration rolls back every candidate and the previous direction', async () => {
  const direction = (id) => ({
    id, name: id, description: '',
    visualDNA: { concept: id, mood: [], colors: {}, typography: {}, geometry: { radius: '', border: '', density: '' }, motion: { personality: '', duration: '', easing: '' }, compositionRules: [] },
  })
  const components = ['users', 'permissions'].map((id) => ({
    id, role: id, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
  }))
  const candidates = components.map(({ id }) => ({
    id: `${id}-candidate`, componentId: id, variant: 'expressive',
    files: [{ path: `src/${id}.tsx`, content: `export default function View(){return <div>${id}-apple</div>}` }],
    entryFile: `src/${id}.tsx`, previewProps: {}, notes: [], runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }))
  const fetchImpl = async (_url, init) => {
    const input = JSON.parse(JSON.parse(init.body).messages[1].content)
    const id = input.componentContract.id
    const result = {
      files: [{ path: input.currentCandidate.entryFile, content: `export default function View(){return <section>${id}-md3</section>}` }],
      entryFile: input.currentCandidate.entryFile, previewProps: {}, notes: [],
    }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(result) } }] })}\n\ndata: [DONE]\n\n`)
  }
  const now = Date.now()
  const oldDirection = direction('apple')
  const session = new HarnessSession('RBAC', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl, persist: false, retries: 0,
    runtime: { compile: async (candidate) => candidate.componentId === 'permissions' ? { ok: false, errors: ['reject'] } : { ok: true } },
  }, {
    version: 1, sessionId: 'restyle-rollback', requirement: 'RBAC', phase: 'selecting', createdAt: now, updatedAt: now,
    plan: { project: { name: 'RBAC', description: '' }, pages: [], visualDirections: [], components },
    direction: oldDirection, candidates, selections: {}, review: null, events: [],
  })

  await assert.rejects(() => session.restyleCandidates(direction('md3'), candidates.map(({ id }) => id)), /已恢复原分支/)
  assert.equal(session.direction.id, 'apple')
  assert.ok(session.candidates.every((candidate) => candidate.files[0].content.includes('-apple')))
})

test('sandbox transpiles TSX and rejects relative module imports', async () => {
  const candidate = {
    id: 'preview', componentId: 'hero', variant: 'expressive', entryFile: 'src/Preview.tsx', previewProps: {}, notes: [],
    runtimeStatus: 'source_ready', compileErrors: [], fixAttempts: 0,
    files: [{ path: 'src/Preview.tsx', content: "import React from 'react'; export default function Preview(): React.ReactNode { return <button className='rounded-full'>Pick</button> }" }],
  }
  const document = await createSandboxDocument(candidate, { '--dna-accent': '#6750a4' }, 'sandbox-test')
  assert.match(document, /wtpt-sandbox/)
  assert.match(document, /rounded-full/)
  await assert.rejects(() => createSandboxDocument({
    ...candidate,
    files: [{ path: 'src/Preview.tsx', content: "import View from './View'; export default View" }],
  }), /相对模块导入/)
})

test('a slow draft cannot overwrite the builder preview it lost the race to', async () => {
  const encoder = new TextEncoder()
  let releaseDraft
  const draftGate = new Promise((resolve) => { releaseDraft = resolve })
  const previews = []
  const sse = (obj) => `data: ${JSON.stringify({ choices: [{ delta: { content: obj } }] })}\n\n`
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    const input = JSON.parse(body.messages[1].content)
    if (system.includes('Planner')) {
      const plan = {
        project: { name: 'p', description: 'd' },
        pages: [{ id: 'home', name: 'Home', route: '/', slots: ['card'] }],
        components: [{
          id: 'card', role: '卡片', slot: 'card', width: 'fluid',
          inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
        }],
        visualDirections: [],
      }
      return new Response(`${sse(JSON.stringify(plan))}data: [DONE]\n\n`)
    }
    if (system.includes('UI Draft Renderer')) {
      // The draft is still streaming when the builder paints, and its document
      // is shorter — exactly the shape that used to clobber the newer preview.
      return new Response(new ReadableStream({
        async start(controller) {
          await draftGate
          controller.enqueue(encoder.encode(sse(`{"previewHtml":"<main>${'draft'.repeat(20)}`)))
          controller.enqueue(encoder.encode(sse('</main>"}')))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }))
    }
    const file = input.outputSchema.files[0]
    const tail = {
      files: [{ path: file.path, content: 'export default function View(){ return null }' }],
      entryFile: file.path, previewProps: {}, notes: [],
    }
    return new Response(new ReadableStream({
      async start(controller) {
        // Builder paints first...
        controller.enqueue(encoder.encode(sse(`{"previewHtml":"<main>${'builder'.repeat(40)}</main>"`)))
        // ...then the draft is unblocked while the builder is still streaming.
        releaseDraft()
        await new Promise((resolve) => setTimeout(resolve, 20))
        controller.enqueue(encoder.encode(sse(`,${JSON.stringify(tail).slice(1)}`)))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }))
  }
  const session = new HarnessSession('做一个卡片', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 1,
    runtime: { compile: async () => ({ ok: true }) },
  })
  session.subscribe(({ event }) => {
    if (event.type === 'preview.updated') previews.push(event.html)
  })
  await session.start()
  await session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'plain', mood: [], colors: {}, typography: {},
      geometry: { radius: '8px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '200ms', easing: 'ease-out' },
      compositionRules: [],
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(previews.length > 0, true)
  assert.equal(previews.some((html) => html.includes('builder')), true)
  // An early draft may legitimately paint first. What must never happen is the
  // draft reclaiming the preview after the builder has taken it over: the
  // builder's document is the one that becomes the component.
  const firstBuilder = previews.findIndex((html) => html.includes('builder'))
  const lateDraft = previews.findIndex((html, index) => index > firstBuilder && html.includes('draft'))
  assert.equal(lateDraft, -1)
  assert.equal(previews.at(-1).includes('builder'), true)
})

test('a superseded generation run cannot emit events or mutate candidates', async () => {
  // The draft stream is fire-and-forget: nothing awaits it and nothing aborts
  // it when its own run ends normally. If its builder failed, `sourceReady` is
  // never latched either, so a slow provider could still paint a sketch into a
  // rail that a *later* run now owns. Only run identity catches this — the
  // abort signal is clean in this scenario.
  const encoder = new TextEncoder()
  let releaseStaleDraft
  const staleDraftGate = new Promise((resolve) => { releaseStaleDraft = resolve })
  const sse = (obj) => `data: ${JSON.stringify({ choices: [{ delta: { content: obj } }] })}\n\n`
  let draftCalls = 0
  let builderCalls = 0
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    const input = JSON.parse(body.messages[1].content)
    if (system.includes('UI Draft Renderer')) {
      draftCalls += 1
      if (draftCalls > 1) {
        return new Response(`${sse(JSON.stringify({ previewHtml: `<main>${'fresh'.repeat(20)}</main>` }))}data: [DONE]\n\n`)
      }
      return new Response(new ReadableStream({
        async start(controller) {
          await staleDraftGate
          controller.enqueue(encoder.encode(sse(JSON.stringify({ previewHtml: `<main>${'STALEDRAFT'.repeat(10)}</main>` }))))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }))
    }
    builderCalls += 1
    // The first run's builder fails, so that run never latches `sourceReady`
    // and never aborts — the exact window the run guard has to close.
    if (builderCalls === 1) return new Response('{"error":{"message":"upstream is down"}}', { status: 503 })
    const file = input.outputSchema.files[0]
    return new Response(`${sse(JSON.stringify({
      previewHtml: `<main>${'fresh'.repeat(20)}</main>`,
      files: [{ path: file.path, content: 'export default function View(){ return null }' }],
      entryFile: file.path, previewProps: {}, notes: [],
    }))}data: [DONE]\n\n`)
  }
  const session = new HarnessSession('做一个计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 1,
    retries: 0,
    runtime: { compile: async () => ({ ok: true }) },
  })
  const seen = []
  session.subscribe(({ event }) => seen.push(event))
  await session.start()
  await session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'plain', mood: [], colors: {}, typography: {},
      geometry: { radius: '8px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '200ms', easing: 'ease-out' },
      compositionRules: [],
    },
  })
  const stale = seen.find((event) => event.type === 'component.queued')
  assert.ok(stale)
  assert.equal(session.candidates.length, 0)

  // A second run takes over the rail while the first run's draft is still open.
  await session.generateCandidates()
  const fresh = seen.filter((event) => event.type === 'component.queued').at(-1)
  assert.notEqual(fresh.candidateId, stale.candidateId)
  const beforeLateDelivery = seen.length

  releaseStaleDraft()
  await new Promise((resolve) => setTimeout(resolve, 40))

  // Nothing the superseded run produces may reach a subscriber...
  assert.deepEqual(seen.slice(beforeLateDelivery), [])
  assert.equal(seen.some((event) => event.type === 'preview.updated' && event.candidateId === stale.candidateId), false)
  // ...and the rail still holds exactly the live run's artifact.
  assert.equal(session.candidates.length, 1)
  assert.equal(session.candidates[0].id, fresh.candidateId)
  assert.equal(session.candidates[0].runtimeStatus, 'rendered')
})

test('a compile verdict for a replaced artifact is ignored', async () => {
  const sse = (obj) => `data: ${JSON.stringify({ choices: [{ delta: { content: obj } }] })}\n\n`
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    const input = JSON.parse(body.messages[1].content)
    if (system.includes('UI Draft Renderer')) {
      return new Response(`${sse(JSON.stringify({ previewHtml: `<main>${'draft'.repeat(20)}</main>` }))}data: [DONE]\n\n`)
    }
    const file = system.includes('Revision Builder')
      ? { path: input.outputSchema.files[0].path }
      : input.outputSchema.files[0]
    return new Response(`${sse(JSON.stringify({
      previewHtml: `<main>${'build'.repeat(20)}</main>`,
      files: [{ path: file.path, content: 'export default function View(){ return null }' }],
      entryFile: file.path, previewProps: {}, notes: [],
    }))}data: [DONE]\n\n`)
  }
  const session = new HarnessSession('做一个计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 1,
    runtime: { compile: async () => ({ ok: true }) },
  })
  // `subscribe` replays the backlog, so attach once up front and slice at the
  // point of interest rather than attaching a second listener later.
  const seen = []
  session.subscribe(({ event }) => seen.push(event.type))
  await session.start()
  await session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'plain', mood: [], colors: {}, typography: {},
      geometry: { radius: '8px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '200ms', easing: 'ease-out' },
      compositionRules: [],
    },
  })
  const built = session.candidates[0]
  const staleAttemptId = built.attemptId
  assert.equal(typeof staleAttemptId, 'string')

  await session.select(built.componentId, built.id)
  await session.revise('把按钮改大一点')
  const revised = session.candidates[0]
  // The revision replaced the artifact under the same rail slot, so a compile
  // started against the previous source is now describing dead code.
  assert.equal(revised.id, built.id)
  assert.notEqual(revised.attemptId, staleAttemptId)
  assert.equal(revised.runtimeStatus, 'rendered')

  const marker = seen.length
  await session.reportCompile(built.id, { ok: false, errors: ['stale build failed'] }, staleAttemptId)

  // The stale verdict is dropped whole: no events, no status change, no repair.
  assert.deepEqual(seen.slice(marker), [])
  assert.equal(session.candidates[0].runtimeStatus, 'rendered')
  assert.deepEqual(session.candidates[0].compileErrors, [])
  assert.equal(session.candidates[0].attemptId, revised.attemptId)

  // A verdict that names the live attempt still applies normally: it is
  // published and it drives the repair path.
  await session.reportCompile(built.id, { ok: false, errors: ['live build failed'] }, revised.attemptId)
  const applied = seen.slice(marker)
  assert.equal(applied.includes('compile.failed'), true)
  assert.equal(applied.includes('repair.started'), true)
  // The repair mints a fresh attempt identity, retiring the one it replaced.
  assert.notEqual(session.candidates[0].attemptId, revised.attemptId)
})

test('a completed draft cannot overwrite a newer builder preview', async () => {
  // `preview.complete` short-circuits the incremental length gate entirely, so
  // a draft that *finishes* late is the one shape that can repaint the sketch
  // with a shorter, older document after the builder has already taken over.
  const encoder = new TextEncoder()
  let releaseDraft
  // The draft is held until a builder preview has actually been *published*,
  // not merely enqueued. Releasing on enqueue lets the draft win the race and
  // the assertion below then passes vacuously.
  const draftGate = new Promise((resolve) => { releaseDraft = resolve })
  const previews = []
  const sse = (obj) => `data: ${JSON.stringify({ choices: [{ delta: { content: obj } }] })}\n\n`
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    const input = JSON.parse(body.messages[1].content)
    if (system.includes('UI Draft Renderer')) {
      return new Response(new ReadableStream({
        async start(controller) {
          await draftGate
          // Short *and* complete: strictly worse than what the builder painted.
          controller.enqueue(encoder.encode(sse(JSON.stringify({ previewHtml: `<main>${'DRAFTMARK'.repeat(6)}</main>` }))))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }))
    }
    const file = input.outputSchema.files[0]
    const tail = {
      files: [{ path: file.path, content: 'export default function View(){ return null }' }],
      entryFile: file.path, previewProps: {}, notes: [],
    }
    return new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sse(`{"previewHtml":"<main>${'BUILDERMARK'.repeat(40)}</main>"`)))
        await new Promise((resolve) => setTimeout(resolve, 25))
        controller.enqueue(encoder.encode(sse(`,${JSON.stringify(tail).slice(1)}`)))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }))
  }
  const session = new HarnessSession('做一个计数器', {
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', codeModel: 'test', temperature: 0 },
    fetchImpl,
    persist: false,
    candidateCount: 1,
    runtime: { compile: async () => ({ ok: true }) },
  })
  session.subscribe(({ event }) => {
    if (event.type !== 'preview.updated') return
    previews.push(event.html)
    if (event.html.includes('BUILDERMARK')) releaseDraft()
  })
  await session.start()
  await session.chooseVisualDirection({
    id: 'test', name: 'Test', description: '',
    visualDNA: {
      concept: 'plain', mood: [], colors: {}, typography: {},
      geometry: { radius: '8px', border: 'soft', density: 'normal' },
      motion: { personality: 'spring', duration: '200ms', easing: 'ease-out' },
      compositionRules: [],
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 60))

  const firstBuilder = previews.findIndex((html) => html.includes('BUILDERMARK'))
  assert.notEqual(firstBuilder, -1)
  // Once the builder has painted, the draft may never reclaim the preview —
  // its document is not the one that becomes the component.
  assert.equal(previews.slice(firstBuilder).some((html) => html.includes('DRAFTMARK')), false)
  assert.equal(previews.at(-1).includes('BUILDERMARK'), true)
})
