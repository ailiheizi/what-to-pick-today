import assert from 'node:assert/strict'
import test from 'node:test'
import { commit, createRepository } from '../src/lib/harness/revisions.ts'
import { useStore } from '../src/lib/store.ts'

function unwrap(result) {
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.value
}

function slot(id) {
  return {
    def: { id, role: id, width: 'fluid', inputs: [], outputs: [], dependencies: [], previewH: 200, candidates: [] },
    status: 'ready',
    candidates: [{
      def: { id: `${id}-a`, label: `${id} A`, style: 'expressive', blurb: '', Component: () => null },
      status: 'rendered', code: '', progress: 1, streamMs: 0, anim: 'anim-pop', seed: 1,
    }],
    tryOnId: `${id}-a`,
  }
}

function generatedArtifact(id, source) {
  return {
    id, componentId: 'hero', variant: 'expressive', files: [{ path: `src/${id}.tsx`, content: source }],
    entryFile: `src/${id}.tsx`, previewProps: {}, notes: [], runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }
}

function root() {
  return unwrap(createRepository({
    revisionId: 'root-test', branchId: 'direction:apple', branchName: 'Apple',
    directionId: 'apple', label: '选定 Apple', ts: 1,
  }))
}

async function withRevisionStore(body) {
  const previous = useStore.getState()
  try {
    useStore.setState({
      phase: 'idle', harnessMode: 'demo', scenario: null, directionId: 'apple',
      slots: [slot('hero'), slot('pricing')], activeSlotId: 'hero', revisionRepo: root(),
      history: [], chat: [], bursts: {}, harnessError: null,
    })
    await body()
  } finally {
    useStore.setState(previous, true)
  }
}

test('candidate confirmations commit whole-page revisions and DAG undo/redo restores selections', async () => {
  await withRevisionStore(async () => {
    useStore.getState().confirmCandidate('hero', 'hero-a')
    useStore.getState().confirmCandidate('pricing', 'pricing-a')

    let state = useStore.getState()
    assert.equal(Object.keys(state.revisionRepo.revisions).length, 3)
    assert.deepEqual(state.revisionRepo.revisions[state.revisionRepo.currentRevisionId].selections, {
      hero: 'hero-a', pricing: 'pricing-a',
    })

    state.undo()
    await new Promise((resolve) => setTimeout(resolve, 0))
    state = useStore.getState()
    assert.equal(state.slots[0].selectedId, 'hero-a')
    assert.equal(state.slots[1].selectedId, undefined)
    assert.equal(state.directionId, 'apple')

    state.redo()
    await new Promise((resolve) => setTimeout(resolve, 0))
    state = useStore.getState()
    assert.equal(state.slots[1].selectedId, 'pricing-a')
  })
})

test('revision navigation is serialized so two rapid undo clicks move only one node', async () => {
  await withRevisionStore(async () => {
    useStore.getState().confirmCandidate('hero', 'hero-a')
    useStore.getState().confirmCandidate('pricing', 'pricing-a')
    useStore.getState().undo()
    useStore.getState().undo()
    assert.equal(useStore.getState().revisionBusy, true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(useStore.getState().slots[0].selectedId, 'hero-a')
    assert.equal(useStore.getState().slots[1].selectedId, undefined)
  })
})

test('undo to an empty root keeps later rendered alternatives, while redo restores the selected snapshot and completion phase', async () => {
  await withRevisionStore(async () => {
    const rootRepo = root()
    const explorerSnapshot = generatedArtifact('hero-explorer', 'explorer snapshot')
    const selected = commit(rootRepo, {
      id: 'selected-explorer', directionId: 'apple', selections: { hero: 'hero-explorer' },
      artifacts: { 'hero-explorer': explorerSnapshot }, label: '选择 Explorer', ts: 2, reason: 'select',
    })
    assert.equal(selected.ok, true)
    const candidates = [
      generatedArtifact('hero-motion', 'motion current'),
      generatedArtifact('hero-product', 'product current'),
      generatedArtifact('hero-explorer', 'explorer later mutation'),
    ].map((artifact) => ({
      def: { id: artifact.id, label: artifact.id, style: 'expressive', blurb: '', Component: () => null },
      status: 'rendered', code: artifact.files[0].content, progress: 1, streamMs: 0, anim: 'anim-pop', seed: 1, artifact,
    }))
    useStore.setState({
      phase: 'done', revisionRepo: selected.value, directionId: 'apple',
      slots: [{ ...slot('hero'), status: 'selected', selectedId: 'hero-explorer', tryOnId: 'hero-explorer', candidates }],
    })

    useStore.getState().undo()
    await new Promise((resolve) => setTimeout(resolve, 0))
    let state = useStore.getState()
    assert.equal(state.slots[0].selectedId, undefined)
    assert.equal(state.phase, 'generating')
    assert.deepEqual(state.slots[0].candidates.map((candidate) => candidate.status), ['rendered', 'rendered', 'rendered'])
    assert.equal(state.slots[0].candidates[1].artifact.files[0].content, 'product current')

    state.redo()
    await new Promise((resolve) => setTimeout(resolve, 0))
    state = useStore.getState()
    assert.equal(state.slots[0].selectedId, 'hero-explorer')
    assert.equal(state.phase, 'done')
    assert.equal(state.slots[0].candidates[2].artifact.files[0].content, 'explorer snapshot')
    assert.equal(state.slots[0].candidates[1].artifact.files[0].content, 'product current')
  })
})

test('restoring history appends a restore revision instead of deleting newer work', async () => {
  await withRevisionStore(async () => {
    useStore.getState().confirmCandidate('hero', 'hero-a')
    const heroRevision = useStore.getState().revisionRepo.currentRevisionId
    useStore.getState().confirmCandidate('pricing', 'pricing-a')
    const newerRevision = useStore.getState().revisionRepo.currentRevisionId

    useStore.getState().restoreRevision(heroRevision)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const state = useStore.getState()
    const restored = state.revisionRepo.revisions[state.revisionRepo.currentRevisionId]
    assert.equal(restored.restoredFrom, heroRevision)
    assert.equal(state.revisionRepo.revisions[newerRevision].id, newerRevision)
    assert.equal(state.slots[1].selectedId, undefined)
  })
})

test('visual direction switches fork named design branches and can return to their heads', async () => {
  await withRevisionStore(async () => {
    useStore.getState().confirmCandidate('hero', 'hero-a')
    const appleHead = useStore.getState().revisionRepo.currentRevisionId

    useStore.getState().switchBranch('hacker')
    await new Promise((resolve) => setTimeout(resolve, 0))
    let state = useStore.getState()
    assert.equal(state.directionId, 'hacker')
    assert.ok(state.revisionRepo.branches['direction:hacker'])
    assert.equal(state.slots[0].selectedId, 'hero-a')

    state.switchBranch('apple')
    await new Promise((resolve) => setTimeout(resolve, 0))
    state = useStore.getState()
    assert.equal(state.directionId, 'apple')
    assert.equal(state.revisionRepo.currentRevisionId, appleHead)
    assert.equal(state.slots[0].selectedId, 'hero-a')
  })
})
