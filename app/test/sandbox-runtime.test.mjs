import assert from 'node:assert/strict'
import test from 'node:test'
import { createSandboxDocument, isSandboxRuntimeMessage, isSandboxSelectionMessage } from '../src/lib/harness/sandbox-runtime.ts'

function candidate(content) {
  return {
    id: 'sandbox-runtime',
    componentId: 'card',
    variant: 'expressive',
    entryFile: 'src/Card.tsx',
    previewProps: { label: '</script><script>unsafe()</script>' },
    notes: [],
    runtimeStatus: 'source_ready',
    compileErrors: [],
    fixAttempts: 0,
    files: [{ path: 'src/Card.tsx', content }],
  }
}

test('sandbox transpiles TypeScript plus JSX with Babel 8 options', async () => {
  const document = await createSandboxDocument(candidate(`
    import React from 'react'
    type Props = { label?: string }
    export default function Card({ label = 'Pick' }: Props): React.ReactNode {
      return <button aria-label={label}>{label}</button>
    }
  `), {}, 'tsx-token')

  assert.doesNotMatch(document, /type Props/)
  assert.doesNotMatch(document, /allExtensions|isTSX/)
  assert.match(document, /React\.createElement/)
  assert.match(document, /await Promise\.all/)
  assert.match(document, /type:'ready'/)
  assert.match(document, /revisionId:"sandbox-runtime"/)
})

test('sandbox escapes user-controlled script endings', async () => {
  const document = await createSandboxDocument(candidate(`
    export default function Card() { return <div>{'</script>'}</div> }
  `), {}, 'escape-token')

  assert.doesNotMatch(document, /<\/script><script>unsafe\(\)<\/script>/)
  assert.ok(document.includes(String.raw`\u003c/script>`))
})

test('sandbox selection bridge reports pointerdown without blocking component interaction', async () => {
  const document = await createSandboxDocument(candidate(`
    export default function Card() { return <button>Increment</button> }
  `), {}, 'selection-token', {
    slotId: 'counter',
    candidateId: 'counter-motion',
    revisionId: 'revision-2',
  })

  assert.match(document, /addEventListener\('pointerdown'/)
  assert.match(document, /type:'selection'/)
  assert.match(document, /slotId:"counter"/)
  assert.match(document, /candidateId:"counter-motion"/)
  assert.match(document, /revisionId:"revision-2"/)
  assert.doesNotMatch(document, /preventDefault|stopPropagation|stopImmediatePropagation/)
})

test('sandbox selection messages require the current iframe, token and revision', () => {
  const currentFrame = {}
  const oldFrame = {}
  const message = {
    source: currentFrame,
    data: {
      source: 'wtpt-sandbox',
      type: 'selection',
      token: 'current-token',
      revisionId: 'current-revision',
      slotId: 'counter',
      candidateId: 'counter-motion',
    },
  }

  assert.equal(isSandboxSelectionMessage(message, currentFrame, 'current-token', 'current-revision'), true)
  assert.equal(isSandboxSelectionMessage(message, oldFrame, 'current-token', 'current-revision'), false)
  assert.equal(isSandboxSelectionMessage(message, currentFrame, 'old-token', 'current-revision'), false)
  assert.equal(isSandboxSelectionMessage(message, currentFrame, 'current-token', 'old-revision'), false)
})

test('sandbox runtime messages require the current iframe, token and revision', () => {
  const currentFrame = {}
  const message = {
    source: currentFrame,
    data: {
      source: 'wtpt-sandbox', type: 'error', token: 'token-1', revisionId: 'attempt-2', error: 'boom',
    },
  }

  assert.equal(isSandboxRuntimeMessage(message, currentFrame, 'token-1', 'attempt-2'), true)
  assert.equal(isSandboxRuntimeMessage(message, {}, 'token-1', 'attempt-2'), false)
  assert.equal(isSandboxRuntimeMessage(message, currentFrame, 'token-old', 'attempt-2'), false)
  assert.equal(isSandboxRuntimeMessage(message, currentFrame, 'token-1', 'attempt-old'), false)
  assert.equal(isSandboxRuntimeMessage({ ...message, data: { ...message.data, type: 'selection' } }, currentFrame, 'token-1', 'attempt-2'), false)
})
