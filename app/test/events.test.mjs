import test from 'node:test'
import assert from 'node:assert/strict'
import { HarnessEventStream } from '../src/lib/harness/events.ts'

function artifact(id, files = [{ path: 'src/Card.tsx', content: 'export default () => null' }]) {
  return {
    id,
    componentId: 'card',
    variant: 'expressive',
    entryFile: files[0].path,
    previewProps: {},
    notes: [],
    runtimeStatus: 'source_ready',
    compileErrors: [],
    fixAttempts: 0,
    files,
  }
}

test('live subscribers receive every streaming preview verbatim', () => {
  const stream = new HarnessEventStream('session-live')
  const seen = []
  stream.subscribe((envelope) => seen.push(envelope.event))

  for (let index = 0; index < 50; index += 1) {
    stream.publish({
      type: 'preview.updated', componentId: 'card', candidateId: 'card-a',
      html: `<div>${'x'.repeat(index)}</div>`, complete: false,
    }, 'generating')
  }

  const previews = seen.filter((event) => event.type === 'preview.updated')
  assert.equal(previews.length, 50)
  // The last delta must arrive with its payload intact for the sketch to animate.
  assert.equal(previews.at(-1).html, `<div>${'x'.repeat(49)}</div>`)
})

test('only the newest preview per candidate is retained', () => {
  const stream = new HarnessEventStream('session-preview')
  for (let index = 0; index < 30; index += 1) {
    stream.publish({
      type: 'preview.updated', componentId: 'card', candidateId: 'card-a',
      html: `<p>${index}</p>`, complete: false,
    }, 'generating')
  }
  stream.publish({
    type: 'preview.updated', componentId: 'card', candidateId: 'card-b',
    html: '<p>other</p>', complete: false,
  }, 'generating')

  const retained = stream.all().filter((envelope) => envelope.event.type === 'preview.updated')
  assert.equal(retained.length, 2)
  const forA = retained.find((envelope) => envelope.event.candidateId === 'card-a')
  assert.equal(forA.event.html, '<p>29</p>')
})

test('source.ready drops the streaming trace for its candidate', () => {
  const stream = new HarnessEventStream('session-ready')
  stream.publish({
    type: 'preview.updated', componentId: 'card', candidateId: 'card-a', html: '<p>draft</p>', complete: true,
  }, 'generating')
  stream.publish({
    type: 'code.delta', candidateId: 'card-a', path: 'src/Card.tsx', delta: 'export default',
  }, 'generating')
  stream.publish({
    type: 'preview.updated', componentId: 'card', candidateId: 'card-b', html: '<p>keep</p>', complete: false,
  }, 'generating')

  stream.publish({ type: 'source.ready', candidate: artifact('card-a') }, 'compiling')

  const kinds = stream.all().map((envelope) => envelope.event)
  assert.equal(kinds.some((event) => event.type !== 'source.ready' && event.candidateId === 'card-a'), false)
  // A sibling candidate still streaming must not be collateral damage.
  assert.equal(kinds.some((event) => event.type === 'preview.updated' && event.candidateId === 'card-b'), true)
  assert.equal(kinds.some((event) => event.type === 'source.ready'), true)
})

test('code.delta payloads are not retained verbatim', () => {
  const stream = new HarnessEventStream('session-delta')
  const slice = 'a'.repeat(1200)
  for (let index = 0; index < 20; index += 1) {
    stream.publish({
      type: 'code.delta', candidateId: 'card-a', path: 'src/Card.tsx', delta: slice,
    }, 'generating')
  }

  const retained = stream.all().filter((envelope) => envelope.event.type === 'code.delta')
  assert.equal(retained.length, 1)
  assert.equal(retained[0].event.delta, '')
  assert.equal(retained[0].event.path, 'src/Card.tsx')
})

test('lifecycle events survive compaction untouched', () => {
  const stream = new HarnessEventStream('session-lifecycle')
  stream.publish({ type: 'plan.started' }, 'planning')
  stream.publish({
    type: 'component.queued', componentId: 'card', candidateId: 'card-a', variant: 'expressive',
    agent: { id: 'motion', name: 'Motion Agent', role: '动效', mission: '动效反馈' },
  }, 'generating')
  stream.publish({ type: 'preview.updated', componentId: 'card', candidateId: 'card-a', html: '<p>x</p>', complete: false }, 'generating')
  stream.publish({ type: 'compile.succeeded', candidateId: 'card-a' }, 'ready')
  stream.publish({ type: 'render.ready', candidateId: 'card-a' }, 'ready')
  stream.publish({ type: 'generation.completed', ready: 1, expected: 1 }, 'ready')

  const types = stream.all().map((envelope) => envelope.event.type)
  for (const expected of ['plan.started', 'component.queued', 'compile.succeeded', 'render.ready', 'generation.completed']) {
    assert.equal(types.includes(expected), true, `${expected} must be retained`)
  }
})

test('sequences stay monotonic and cursor replay still works', () => {
  const stream = new HarnessEventStream('session-cursor')
  stream.publish({ type: 'plan.started' }, 'planning')
  for (let index = 0; index < 10; index += 1) {
    stream.publish({
      type: 'preview.updated', componentId: 'card', candidateId: 'card-a', html: `<p>${index}</p>`, complete: false,
    }, 'generating')
  }
  const marker = stream.publish({ type: 'compile.started', candidateId: 'card-a' }, 'compiling')
  stream.publish({ type: 'render.ready', candidateId: 'card-a' }, 'ready')

  const sequences = stream.all().map((envelope) => envelope.sequence)
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b))
  assert.equal(new Set(sequences).size, sequences.length)

  const replayed = []
  stream.subscribe((envelope) => replayed.push(envelope.event.type), marker.sequence)
  assert.deepEqual(replayed, ['render.ready'])
})

test('restoring a compacted history does not reissue sequence numbers', () => {
  const first = new HarnessEventStream('session-restore')
  first.publish({ type: 'plan.started' }, 'planning')
  for (let index = 0; index < 25; index += 1) {
    first.publish({
      type: 'preview.updated', componentId: 'card', candidateId: 'card-a', html: `<p>${index}</p>`, complete: false,
    }, 'generating')
  }
  const restored = first.all()
  // Compaction means fewer retained entries than sequences ever issued.
  assert.ok(restored.length < 26)

  const second = new HarnessEventStream('session-restore', restored)
  const next = second.publish({ type: 'render.ready', candidateId: 'card-a' }, 'ready')
  const highest = Math.max(...restored.map((envelope) => envelope.sequence))
  assert.equal(next.sequence, highest + 1)
  assert.equal(new Set(second.all().map((envelope) => envelope.sequence)).size, second.all().length)
})

test('a 200-delta generation stays compact', () => {
  const stream = new HarnessEventStream('session-volume')
  let published = 0
  const bump = () => { published += 1 }

  stream.publish({ type: 'plan.started' }, 'planning'); bump()
  for (let index = 0; index < 200; index += 1) {
    stream.publish({
      type: 'preview.updated', componentId: 'card', candidateId: 'card-a',
      html: `<div>${'y'.repeat(index)}</div>`, complete: false,
    }, 'generating'); bump()
  }
  for (let index = 0; index < 200; index += 1) {
    stream.publish({
      type: 'code.delta', candidateId: 'card-a', path: 'src/Card.tsx', delta: 'z'.repeat(1200),
    }, 'generating'); bump()
  }

  assert.equal(published, 401)
  // Before compaction this retained all 401 envelopes plus ~240KB of payload.
  assert.ok(stream.all().length <= 3, `expected <= 3 retained, got ${stream.all().length}`)
  const bytes = JSON.stringify(stream.all()).length
  assert.ok(bytes < 5000, `expected a small snapshot, got ${bytes} bytes`)
})
