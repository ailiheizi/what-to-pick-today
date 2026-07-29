import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EPHEMERAL_KEYS,
  ancestry,
  canRedo,
  canUndo,
  checkout,
  checkoutBranch,
  childrenOf,
  commit,
  createRepository,
  currentRevision,
  diff,
  fork,
  isEphemeralKey,
  listBranches,
  redo,
  restore,
  undo,
  validateRepository,
} from '../src/lib/harness/revisions.ts'

/** Unwrap a `Result`, failing the test with the structured error if it is not ok. */
function unwrap(result) {
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

/** Assert a `Result` failed with a specific code, and hand back the error. */
function expectError(result, code) {
  assert.equal(result.ok, false, 'expected a failure result')
  assert.equal(result.error.code, code)
  return result.error
}

function root() {
  return unwrap(
    createRepository({
      revisionId: 'r0',
      branchId: 'main',
      branchName: '主线',
      directionId: 'apple',
      label: '选定视觉底板',
      ts: 1000,
    }),
  )
}

/** r0 → r1 → r2 on `main`. */
function linear() {
  const r1 = unwrap(
    commit(root(), {
      id: 'r1',
      directionId: 'apple',
      selections: { hero: 'hero-a' },
      label: '扣合 hero',
      ts: 2000,
      reason: 'select',
    }),
  )
  return unwrap(
    commit(r1, {
      id: 'r2',
      directionId: 'apple',
      selections: { hero: 'hero-a', pricing: 'pricing-a' },
      label: '扣合 pricing',
      ts: 3000,
      reason: 'select',
    }),
  )
}

/**
 * r0 → r1 → r2 on `main`, and r1 → a1 on `alt`.
 * r1 is the fork point with two children on two different branches.
 */
function forked() {
  const forkedRepo = unwrap(fork(linear(), { branchId: 'alt', name: '实验分支', fromRevisionId: 'r1', ts: 4000 }))
  return unwrap(
    commit(forkedRepo, {
      id: 'a1',
      directionId: 'brutal',
      selections: { hero: 'hero-b', pricing: 'pricing-b' },
      label: '实验分支扣合',
      ts: 5000,
      reason: 'select',
    }),
  )
}

test('commit builds a linear chain and advances only the branch head', () => {
  const repo = linear()

  assert.deepEqual(
    unwrap(ancestry(repo, 'r2')).map((revision) => revision.id),
    ['r0', 'r1', 'r2'],
  )
  assert.equal(repo.branches.main.headId, 'r2')
  assert.equal(repo.currentRevisionId, 'r2')
  assert.equal(unwrap(currentRevision(repo)).label, '扣合 pricing')
  assert.deepEqual(repo.revisions.r1.parentId, 'r0')
  assert.deepEqual(repo.revisions.r2.parentId, 'r1')
  assert.equal(Object.keys(repo.branches).length, 1)
  assert.equal(unwrap(validateRepository(repo)), repo)
})

test('commit is append-only: the input repository is never mutated', () => {
  const before = linear()
  const snapshot = JSON.stringify(before)
  unwrap(commit(before, { id: 'r3', directionId: 'apple', selections: { hero: 'hero-c' }, label: '替换', ts: 4000, reason: 'replace' }))

  assert.equal(JSON.stringify(before), snapshot)
})

test('commit rejects duplicate ids, unknown restore sources and malformed input', () => {
  const repo = linear()

  expectError(commit(repo, { id: 'r1', directionId: 'apple', selections: {}, label: '重复', ts: 4000 }), 'duplicate_id')
  expectError(commit(repo, { id: 'r3', directionId: 'apple', selections: {}, label: '', ts: 4000 }), 'invalid_input')
  expectError(commit(repo, { id: 'r3', directionId: 'apple', selections: {}, label: 'x', ts: Number.NaN }), 'invalid_input')
  expectError(commit(repo, { id: 'r3', directionId: 'apple', selections: null, label: 'x', ts: 4000 }), 'invalid_input')
  expectError(
    commit(repo, { id: 'r3', directionId: 'apple', selections: {}, label: 'x', ts: 4000, restoredFrom: 'ghost' }),
    'unknown_revision',
  )
  // Total on garbage: never throws, even when the repository itself is absent.
  expectError(commit(null, { id: 'r3', directionId: 'apple', selections: {}, label: 'x', ts: 1 }), 'invalid_repository')
  expectError(commit(repo, undefined), 'invalid_input')
})

test('fork creates a divergent branch that shares an ancestor', () => {
  const repo = forked()

  assert.equal(repo.branches.alt.parentBranchId, 'main')
  assert.equal(repo.branches.alt.baseRevisionId, 'r1')
  // Forking copies nothing: `alt` reaches r1 and r0 through the shared DAG.
  assert.deepEqual(
    unwrap(ancestry(repo, 'a1')).map((revision) => revision.id),
    ['r0', 'r1', 'a1'],
  )
  assert.deepEqual(
    unwrap(ancestry(repo, 'r2')).map((revision) => revision.id),
    ['r0', 'r1', 'r2'],
  )
  // The two tips are two complete, independently restorable pages.
  assert.equal(repo.branches.main.headId, 'r2')
  assert.equal(repo.branches.alt.headId, 'a1')
  assert.deepEqual(
    unwrap(childrenOf(repo, 'r1')).map((revision) => revision.id),
    ['r2', 'a1'],
  )
  assert.deepEqual(
    unwrap(listBranches(repo)).map((branch) => branch.id),
    ['main', 'alt'],
  )
  unwrap(validateRepository(repo))
})

test('fork rejects a duplicate branch id or an unknown source revision', () => {
  const repo = linear()

  expectError(fork(repo, { branchId: 'main', name: '重复', fromRevisionId: 'r1', ts: 4000 }), 'duplicate_id')
  expectError(fork(repo, { branchId: 'alt', name: '实验', fromRevisionId: 'ghost', ts: 4000 }), 'unknown_revision')
  expectError(fork(repo, { branchId: 'alt', name: '', fromRevisionId: 'r1', ts: 4000 }), 'invalid_input')
})

test('checkout returns the exact selection map and direction of any revision', () => {
  const repo = forked()

  const old = unwrap(checkout(repo, 'r1'))
  assert.deepEqual(old.selections, { hero: 'hero-a' })
  assert.equal(old.directionId, 'apple')
  assert.equal(old.repo.currentRevisionId, 'r1')
  assert.equal(old.repo.currentBranchId, 'main')
  // Reading history must not rewrite it.
  assert.equal(old.repo.branches.main.headId, 'r2')

  const tip = unwrap(checkoutBranch(repo, 'alt'))
  assert.deepEqual(tip.selections, { hero: 'hero-b', pricing: 'pricing-b' })
  assert.equal(tip.directionId, 'brutal')
  assert.equal(tip.repo.currentRevisionId, 'a1')

  expectError(checkout(repo, 'ghost'), 'unknown_revision')
  expectError(checkoutBranch(repo, 'ghost'), 'unknown_branch')
})

test('a checked-out selection map is a snapshot, not a live reference', () => {
  const repo = linear()
  const selections = { hero: 'hero-a' }
  const next = unwrap(commit(repo, { id: 'r3', directionId: 'apple', selections, label: '扣合', ts: 4000, reason: 'select' }))

  selections.hero = 'mutated-after-commit'
  assert.deepEqual(unwrap(checkout(next, 'r3')).selections, { hero: 'hero-a' })
})

test('artifact source is snapshotted per revision even when candidate ids are reused', () => {
  const oldArtifact = {
    id: 'hero-a', componentId: 'hero', variant: 'expressive', files: [{ path: 'src/Hero.tsx', content: 'old source' }],
    entryFile: 'src/Hero.tsx', previewProps: {}, notes: [], runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }
  const r1 = unwrap(commit(root(), {
    id: 'artifact-old', directionId: 'apple', selections: { hero: 'hero-a' }, artifacts: { 'hero-a': oldArtifact }, label: 'old', ts: 2,
  }))
  oldArtifact.files[0].content = 'mutated outside repository'
  const newArtifact = { ...oldArtifact, files: [{ path: 'src/Hero.tsx', content: 'new source' }] }
  const r2 = unwrap(commit(r1, {
    id: 'artifact-new', directionId: 'hacker', selections: { hero: 'hero-a' }, artifacts: { 'hero-a': newArtifact }, label: 'new', ts: 3,
  }))
  assert.equal(unwrap(checkout(r2, 'artifact-old')).artifacts['hero-a'].files[0].content, 'old source')
  assert.equal(unwrap(checkout(r2, 'artifact-new')).artifacts['hero-a'].files[0].content, 'new source')
})

test('undo and redo traverse the DAG instead of mutating a stack', () => {
  const repo = linear()

  const back = unwrap(undo(repo))
  assert.equal(back.revision.id, 'r1')
  assert.equal(back.from.id, 'r2')
  assert.deepEqual(back.selections, { hero: 'hero-a' })
  // Undo is navigation: nothing is dropped and the head does not move.
  assert.equal(back.repo.branches.main.headId, 'r2')
  assert.ok(back.repo.revisions.r2)

  const backAgain = unwrap(undo(back.repo))
  assert.equal(backAgain.revision.id, 'r0')
  assert.equal(canUndo(backAgain.repo), false)
  expectError(undo(backAgain.repo), 'no_undo_target')

  const forward = unwrap(redo(backAgain.repo))
  assert.equal(forward.revision.id, 'r1')
  const forwardAgain = unwrap(redo(forward.repo))
  assert.equal(forwardAgain.revision.id, 'r2')
  assert.equal(canRedo(forwardAgain.repo), false)
  expectError(redo(forwardAgain.repo), 'no_redo_target')
})

test('redo at a fork point returns to the child undo came from', () => {
  const repo = forked()

  // Rule 1, from the `alt` tip: undo then redo is an identity.
  const fromAlt = unwrap(undo(repo))
  assert.equal(fromAlt.revision.id, 'r1')
  assert.equal(unwrap(redo(fromAlt.repo)).revision.id, 'a1')

  // Rule 1 again, arriving at the same fork point from the other child.
  const fromMain = unwrap(undo(unwrap(checkout(repo, 'r2')).repo))
  assert.equal(fromMain.revision.id, 'r1')
  assert.equal(unwrap(redo(fromMain.repo)).revision.id, 'r2')
})

test('redo without a remembered child follows the current branch, then the newest child', () => {
  // Rule 2: no memory (a restored repository), two children on two branches —
  // follow the one that continues the branch the cursor is on.
  const forgotten = { ...unwrap(checkout(forked(), 'r1')).repo, redoChoice: {} }
  assert.equal(forgotten.currentBranchId, 'main')
  assert.equal(unwrap(redo(forgotten)).revision.id, 'r2')

  const onAlt = { ...forgotten, currentBranchId: 'alt' }
  assert.equal(unwrap(redo(onAlt)).revision.id, 'a1')

  // Rule 3: committing from behind the head puts two children of the same
  // branch under r1, so "current branch" cannot disambiguate. The newest wins,
  // deterministically, from the caller-supplied timestamps.
  const reworked = unwrap(
    commit(unwrap(checkout(linear(), 'r1')).repo, {
      id: 'r3',
      directionId: 'apple',
      selections: { hero: 'hero-a', pricing: 'pricing-z' },
      label: '换个 pricing',
      ts: 9000,
      reason: 'replace',
    }),
  )
  assert.deepEqual(
    unwrap(childrenOf(reworked, 'r1')).map((revision) => revision.id),
    ['r2', 'r3'],
  )
  const ambiguous = { ...unwrap(checkout(reworked, 'r1')).repo, redoChoice: {} }
  assert.equal(unwrap(redo(ambiguous)).revision.id, 'r3')
})

test('restore appends a new revision rather than rewinding history', () => {
  const repo = linear()
  const restored = unwrap(restore(repo, 'r1', { id: 'r3', label: '恢复到扣合 hero', ts: 6000 }))

  assert.equal(restored.revisions.r3.reason, 'restore')
  assert.equal(restored.revisions.r3.restoredFrom, 'r1')
  assert.equal(restored.revisions.r3.parentId, 'r2')
  assert.deepEqual(restored.revisions.r3.selections, { hero: 'hero-a' })
  // The revision that was restored away from is still reachable.
  assert.ok(restored.revisions.r2)
  assert.deepEqual(
    unwrap(ancestry(restored, 'r3')).map((revision) => revision.id),
    ['r0', 'r1', 'r2', 'r3'],
  )
  expectError(restore(repo, 'ghost', { id: 'r4', label: 'x', ts: 1 }), 'unknown_revision')
})

test('ancestry is ordered root to leaf', () => {
  const path = unwrap(ancestry(forked(), 'a1'))

  assert.deepEqual(
    path.map((revision) => revision.id),
    ['r0', 'r1', 'a1'],
  )
  assert.equal(path[0].parentId, null)
  assert.equal(path[0].reason, 'root')
  for (let i = 1; i < path.length; i++) {
    assert.equal(path[i].parentId, path[i - 1].id)
    assert.ok(path[i].ts >= path[i - 1].ts)
  }
  expectError(ancestry(forked(), 'ghost'), 'unknown_revision')
})

test('diff reports slot-level changes, additions, removals and direction changes', () => {
  const repo = forked()

  const added = unwrap(diff(repo, 'r1', 'r2'))
  assert.deepEqual(added.slots, [{ slotId: 'pricing', from: null, to: 'pricing-a', kind: 'added' }])
  assert.deepEqual(added.unchangedSlotIds, ['hero'])
  assert.equal(added.direction, null)
  assert.equal(added.changed, true)

  // Across branches: exactly the A/B comparison of two complete pages.
  const across = unwrap(diff(repo, 'r2', 'a1'))
  assert.deepEqual(across.slots, [
    { slotId: 'hero', from: 'hero-a', to: 'hero-b', kind: 'changed' },
    { slotId: 'pricing', from: 'pricing-a', to: 'pricing-b', kind: 'changed' },
  ])
  assert.deepEqual(across.direction, { from: 'apple', to: 'brutal' })

  const removed = unwrap(diff(repo, 'r2', 'r1'))
  assert.deepEqual(removed.slots, [{ slotId: 'pricing', from: 'pricing-a', to: null, kind: 'removed' }])

  const same = unwrap(diff(repo, 'r2', 'r2'))
  assert.deepEqual(same.slots, [])
  assert.equal(same.changed, false)

  // A direction-only change still counts as a change.
  const reskinned = unwrap(
    commit(repo, { id: 'a2', directionId: 'apple', selections: repo.revisions.a1.selections, label: '换肤', ts: 7000, reason: 'visual' }),
  )
  const visualOnly = unwrap(diff(reskinned, 'a1', 'a2'))
  assert.deepEqual(visualOnly.slots, [])
  assert.deepEqual(visualOnly.direction, { from: 'brutal', to: 'apple' })
  assert.equal(visualOnly.changed, true)

  expectError(diff(repo, 'r1', 'ghost'), 'unknown_revision')
})

test('a cycle is rejected rather than looping forever', () => {
  const branch = { id: 'main', name: '主线', headId: 'b', parentBranchId: null, baseRevisionId: null, createdAt: 1 }
  const node = (id, parentId, ts) => ({
    id,
    parentId,
    branchId: 'main',
    directionId: 'apple',
    selections: {},
    label: id,
    ts,
    reason: 'manual',
  })
  const cyclic = {
    revisions: { a: node('a', 'b', 1), b: node('b', 'a', 2) },
    branches: { main: branch },
    currentBranchId: 'main',
    currentRevisionId: 'b',
    redoChoice: {},
  }

  const error = expectError(ancestry(cyclic, 'b'), 'cycle_detected')
  assert.equal(error.revisionId, 'b')
  expectError(validateRepository(cyclic), 'cycle_detected')

  // A self-parent is the degenerate case and must not hang either.
  const selfParent = {
    ...cyclic,
    revisions: { a: node('a', 'a', 1) },
    branches: { main: { ...branch, headId: 'a' } },
    currentRevisionId: 'a',
  }
  expectError(ancestry(selfParent, 'a'), 'cycle_detected')
})

test('a dangling parent is rejected rather than silently truncating history', () => {
  const repo = linear()
  const dangling = {
    ...repo,
    revisions: { ...repo.revisions, r2: { ...repo.revisions.r2, parentId: 'ghost' } },
  }

  expectError(ancestry(dangling, 'r2'), 'dangling_parent')
  expectError(undo(dangling), 'dangling_parent')
  expectError(validateRepository(dangling), 'dangling_parent')

  // A branch head pointing at nothing is caught too.
  expectError(
    validateRepository({ ...repo, branches: { main: { ...repo.branches.main, headId: 'ghost' } } }),
    'unknown_revision',
  )
})

test('ephemeral UI state cannot be committed', () => {
  const repo = linear()
  const base = { id: 'r3', directionId: 'apple', selections: { hero: 'hero-a' }, label: '扣合', ts: 4000 }

  // Every key the architecture study bans, one at a time.
  for (const key of EPHEMERAL_KEYS) {
    const error = expectError(commit(repo, { ...base, [key]: 'x' }), 'ephemeral_field')
    assert.deepEqual(error.keys, [key])
  }

  // The specific fields §5 calls out, including via the store's own names.
  for (const key of ['activeSlotId', 'tryOnId', 'hoveredElementId', 'selectedElementId', 'progress', 'streamPreviewHtml', 'seed', 'bursts', 'starOpen', 'settingsOpen', 'muted']) {
    assert.equal(isEphemeralKey(key), true, `${key} must be ephemeral`)
  }
  assert.equal(isEphemeralKey('hero'), false)
  assert.equal(isEphemeralKey('selections'), false)

  // Nor smuggled in through the selection map, disguised as a slot.
  expectError(commit(repo, { ...base, selections: { hero: 'hero-a', tryOnId: 'hero-b' } }), 'ephemeral_field')
  // Nor at the root.
  expectError(
    createRepository({ revisionId: 'r0', branchId: 'main', branchName: '主线', directionId: 'apple', label: 'x', ts: 1, activeSlotId: 'hero' }),
    'ephemeral_field',
  )
  // Nor through fork.
  expectError(fork(repo, { branchId: 'alt', name: '实验', fromRevisionId: 'r1', ts: 1, tryOnId: 'x' }), 'ephemeral_field')

  // A committed revision holds only the restorable fields.
  assert.deepEqual(Object.keys(repo.revisions.r2).sort(), [
    'artifacts',
    'branchId',
    'directionId',
    'id',
    'label',
    'parentId',
    'reason',
    'selections',
    'ts',
  ])
})
