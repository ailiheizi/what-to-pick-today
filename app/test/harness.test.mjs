import assert from 'node:assert/strict'
import test from 'node:test'
import { HarnessEventStream } from '../src/lib/harness/events.ts'
import { BrowserKimiClient, extractStreamingJsonString, parseJson } from '../src/lib/harness/kimi.ts'
import { isAllowedLocalProxyOrigin, isLocalModelProxyBase, rewriteModelProxyPath, splitModelApiBase } from '../src/lib/harness/local-proxy.ts'
import { createAtomicPlan, normalizePlanCohesion } from '../src/lib/harness/plan-cohesion.ts'
import { parseCandidate, parsePlan } from '../src/lib/harness/schemas.ts'
import { TaskScheduler } from '../src/lib/harness/scheduler.ts'
import { HarnessSession } from '../src/lib/harness/session.ts'
import { createSandboxDocument } from '../src/lib/harness/sandbox-runtime.ts'
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
    kimi: { apiKey: 'test', baseUrl: 'https://example.test/v1', model: 'test', temperature: 0 },
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
