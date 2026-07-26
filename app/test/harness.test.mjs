import assert from 'node:assert/strict'
import test from 'node:test'
import { HarnessEventStream } from '../src/lib/harness/events.ts'
import { BrowserKimiClient, parseJson } from '../src/lib/harness/kimi.ts'
import { parseCandidate, parsePlan } from '../src/lib/harness/schemas.ts'
import { TaskScheduler } from '../src/lib/harness/scheduler.ts'
import { HarnessSession } from '../src/lib/harness/session.ts'
import { createSandboxDocument } from '../src/lib/harness/sandbox-runtime.ts'

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
    else {
      const input = JSON.parse(body.messages[1].content)
      const file = input.outputSchema.files[0]
      result = {
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
  const generatedPlan = await session.start()
  await session.chooseDirection(generatedPlan.visualDirections[0].id)
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
