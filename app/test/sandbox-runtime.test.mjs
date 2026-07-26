import assert from 'node:assert/strict'
import test from 'node:test'
import { createSandboxDocument } from '../src/lib/harness/sandbox-runtime.ts'

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
})

test('sandbox escapes user-controlled script endings', async () => {
  const document = await createSandboxDocument(candidate(`
    export default function Card() { return <div>{'</script>'}</div> }
  `), {}, 'escape-token')

  assert.doesNotMatch(document, /<\/script><script>unsafe\(\)<\/script>/)
  assert.ok(document.includes(String.raw`\u003c/script>`))
})
