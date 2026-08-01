import assert from 'node:assert/strict'
import test from 'node:test'
import { createCompositionSandboxDocument, createSandboxDocument, isSandboxRuntimeMessage, isSandboxSelectionMessage } from '../src/lib/harness/sandbox-runtime.ts'

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
  assert.match(document, /postHeight\('ready'\)/)
  assert.match(document, /ResizeObserver/)
  assert.match(document, /measureHeight/)
  assert.match(document, /normalizeScrollableRoot/)
  assert.match(document, /overflow-y','visible','important'/)
  assert.match(document, /type,height/)
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
  assert.equal(isSandboxRuntimeMessage({ ...message, data: { ...message.data, type: 'ready', height: 480 } }, currentFrame, 'token-1', 'attempt-2'), true)
  assert.equal(isSandboxRuntimeMessage({ ...message, data: { ...message.data, type: 'resize', height: 720 } }, currentFrame, 'token-1', 'attempt-2'), true)
  assert.equal(isSandboxRuntimeMessage({ ...message, data: { ...message.data, type: 'resize' } }, currentFrame, 'token-1', 'attempt-2'), false)
  assert.equal(isSandboxRuntimeMessage({ ...message, data: { ...message.data, type: 'resize', height: -1 } }, currentFrame, 'token-1', 'attempt-2'), false)
  assert.equal(isSandboxRuntimeMessage({ ...message, data: { ...message.data, type: 'ready', height: '720' } }, currentFrame, 'token-1', 'attempt-2'), false)
})

test('composition sandbox renders siblings in one React tree and wires semantic outputs to inputs', async () => {
  const source = candidate(`
    export default function UserList({ onSelectUser }) { return <button onClick={() => onSelectUser?.('u-1')}>Select</button> }
  `)
  const target = {
    ...candidate(`export default function Permissions({ selectedUser }) { return <div>{selectedUser}</div> }`),
    id: 'permissions-candidate',
    componentId: 'permissions',
    entryFile: 'src/Permissions.tsx',
    previewProps: { selectedUser: 'u-0' },
    files: [{ path: 'src/Permissions.tsx', content: `export default function Permissions({ selectedUser }) { return <div>{selectedUser}</div> }` }],
  }
  const document = await createCompositionSandboxDocument([
    {
      candidate: source,
      contract: { id: 'users', role: '用户列表', slot: 'users', width: 'fluid', inputs: [], outputs: [{ name: 'onUserSelected', payload: 'string' }], dependencies: ['react'], designTokens: [] },
    },
    {
      candidate: target,
      contract: { id: 'permissions', role: '权限编辑', slot: 'permissions', width: 'fluid', inputs: [{ name: 'selectedUser', type: 'string', required: true }], outputs: [], dependencies: ['react'], designTokens: [] },
      active: true,
    },
  ], { '--dna-bg': '#000' }, 'composition-token', 'composition-revision', 'freeform', 'md3')

  assert.equal((document.match(/createRoot\(/g) ?? []).length, 1)
  assert.match(document, /signal_0/)
  assert.match(document, /set_signal_0/)
  assert.match(document, /"onUserSelected":\(\.\.\.args\)=>set_signal_0/)
  assert.match(document, /"onSelectUser":\(\.\.\.args\)=>set_signal_0/)
  assert.match(document, /data-composition-slot/)
  assert.match(document, /composition-slot is-active/)
  assert.doesNotMatch(document, /height:auto!important|background-color:transparent!important/)
  assert.match(document, /min-height:0!important;min-width:0;max-width:100%/)
  assert.match(document, /ResizeObserver/)
  assert.match(document, /measureHeight/)
  assert.match(document, /data-direction[^\n]+md3/)
  assert.match(document, /repeat\(auto-fit,minmax\(min\(100%,360px\),1fr\)\)/)
  assert.match(document, /data-layout="dashboard"[^\n]+grid-template-columns/)
  assert.match(document, /data-layout="dashboard"[^\n]+data-slot-kind="sidebar"[^\n]+position:sticky/)
  assert.match(document, /data\.type!==['"]active-slot['"]/)
  assert.match(document, /classList\.toggle\(['"]is-active['"]/)
  assert.match(document, /slot\.dataset\.compositionSlot/)
})

test('composition sandbox classifies semantic header and sidebar slots for page layout', async () => {
  const topNav = candidate(`export default function TopNav(){return <nav>导航</nav>}`)
  topNav.id = 'top-nav-candidate'
  topNav.componentId = 'top-nav'
  const sideNav = candidate(`export default function SideNav(){return <aside>菜单</aside>}`)
  sideNav.id = 'side-nav-candidate'
  sideNav.componentId = 'side-navigation'
  const document = await createCompositionSandboxDocument([
    { candidate: topNav, contract: { id: 'top-nav', role: '顶部导航栏', slot: 'top-navigation', width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [] } },
    { candidate: sideNav, contract: { id: 'side-navigation', role: '功能侧边栏', slot: 'navigation-panel', width: 'fixed', inputs: [], outputs: [], dependencies: ['react'], designTokens: [] } },
  ], {}, 'semantic-token', 'semantic-revision', 'dashboard', 'md3')
  assert.match(document, /'data-slot-kind':"header"/)
  assert.match(document, /'data-slot-kind':"sidebar"/)
})
