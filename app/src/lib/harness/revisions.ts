/**
 * Revision / branch DAG for design decisions.
 *
 * Today the app records what the user did as a flat `HistoryItem[]` in
 * `store.ts`: a text log with `kind/label/ts`. That log can be read but not
 * *restored* — `undo()` reverse-scans the slot array for the last selected
 * slot, and `switchBranch()` only swaps the visual direction. So there is no
 * way to return to an earlier whole-page state, fork an exploration, or hold
 * two complete pages side by side.
 *
 * This module is the missing model: an append-only DAG of `Revision` nodes
 * (see `docs/onlook-architecture-study.md` §5 and §9, and the append-only
 * version model in `docs/v0-magic-patterns-research.md` §3.4). A revision is a
 * *restorable* value — the full slot→candidate selection map plus the visual
 * direction — not a description of a mutation. Undo and redo are therefore
 * movement along the DAG, not replay of an inverse-operation stack.
 *
 * Two properties are load-bearing:
 *
 * 1. **Only committed state may enter a revision.** Ephemeral UI state
 *    (`activeSlotId`, `tryOnId`, hover/selection, generation progress,
 *    streaming preview HTML, animation seeds, bursts, modal and sound state)
 *    would make an old revision unrestorable — replaying it would resurrect a
 *    half-finished stream or a stale modal. `EPHEMERAL_KEYS` names them, the
 *    `EphemeralFree<T>` type rejects them at compile time, and `commit`
 *    rejects them again at runtime for callers that arrive through JS.
 * 2. **Total, deterministic and pure.** No `Date.now`, no `Math.random`, no
 *    DOM, no storage, no imports. Ids and timestamps come in from the caller so
 *    tests can be exact. Nothing throws: every operation returns a `Result`,
 *    and traversals are cycle-guarded so a malformed (e.g. deserialized)
 *    repository can never spin forever.
 *
 * Every operation returns a *new* repository; the input is never mutated, so a
 * caller can hold onto an old repository value for comparison or rollback.
 */

/* -------------------------------------------------------------------------- */
/* Ephemeral state                                                            */
/* -------------------------------------------------------------------------- */

/**
 * State that must never be committed, from `docs/onlook-architecture-study.md`
 * §5. These are all *view* state: they describe what the user is currently
 * looking at or what the generator is currently doing, never what the user
 * decided. Restoring them would be meaningless at best and would revive dead
 * in-flight work at worst.
 */
export const EPHEMERAL_KEYS = [
  'activeSlotId',
  'tryOnId',
  'hoveredElementId',
  'selectedElementId',
  'progress',
  'streamMs',
  'streamPreviewHtml',
  'streamPreviewComplete',
  'anim',
  'seed',
  'bursts',
  'bigConfetti',
  'starOpen',
  'settingsOpen',
  'muted',
  'tokensStreamed',
  'phase',
] as const

export type EphemeralKey = (typeof EPHEMERAL_KEYS)[number]

const EPHEMERAL_LOOKUP: Readonly<Record<string, true>> = EPHEMERAL_KEYS.reduce<Record<string, true>>(
  (acc, key) => {
    acc[key] = true
    return acc
  },
  {},
)

/** Whether `key` names ephemeral UI state that may not enter a revision. */
export function isEphemeralKey(key: string): key is EphemeralKey {
  return EPHEMERAL_LOOKUP[key] === true
}

/**
 * Compile-time half of the ephemeral ban.
 *
 * `T & { [K in EphemeralKey]?: never }` makes every ephemeral field a type
 * error even when the argument is a pre-built variable, where TypeScript's
 * excess-property check would not fire — which is the realistic wiring case
 * (`commit(repo, { ...somethingFromTheStore })`).
 */
export type EphemeralFree<T> = T & { [K in EphemeralKey]?: never }

/* -------------------------------------------------------------------------- */
/* Domain types                                                               */
/* -------------------------------------------------------------------------- */

/** slotId → candidateId. The entire restorable content of a page. */
export type SlotSelectionMap = Readonly<Record<string, string>>

/**
 * Why a revision exists. Mirrors the checkpoint trigger table in
 * `docs/onlook-architecture-study.md` §5.1 — try-on and "换一批" are absent on
 * purpose, because neither commits a decision.
 */
export type RevisionReason =
  | 'root'
  | 'select'
  | 'replace'
  | 'visual'
  | 'structure'
  | 'revision'
  | 'restore'
  | 'manual'

/** One restorable whole-page state. Immutable once committed. */
export interface Revision {
  readonly id: string
  /** `null` only for the root revision of the repository. */
  readonly parentId: string | null
  readonly branchId: string
  /** The visual direction id (`dna.ts`), the one non-slot part of the design. */
  readonly directionId: string
  /** The full committed selection map — never a delta. */
  readonly selections: SlotSelectionMap
  readonly label: string
  readonly ts: number
  readonly reason: RevisionReason
  /**
   * Set when this revision was produced by restoring an older one. Restoring
   * appends a new revision rather than rewinding history, so the fact that the
   * user went back stays visible (`docs/onlook-architecture-study.md` §4.3).
   */
  readonly restoredFrom?: string
}

/**
 * A named line of exploration.
 *
 * Unlike Onlook's branch schema (§4.1), `parentBranchId` and `baseRevisionId`
 * are recorded, so the fork relationship is reconstructible and a version tree
 * can actually be drawn.
 */
export interface Branch {
  readonly id: string
  readonly name: string
  /** Newest revision on this branch. Only ever advanced by `commit`. */
  readonly headId: string
  readonly parentBranchId: string | null
  /** The revision this branch was forked from; `null` for the root branch. */
  readonly baseRevisionId: string | null
  readonly createdAt: number
}

/**
 * The whole version store. A plain, serializable value — no classes, no maps,
 * so it can be persisted and rehydrated as-is later.
 */
export interface Repository {
  readonly revisions: Readonly<Record<string, Revision>>
  readonly branches: Readonly<Record<string, Branch>>
  readonly currentBranchId: string
  /**
   * The cursor. Usually the current branch's head; `undo`/`checkout` move it
   * behind the head without touching the head itself (a detached-HEAD read of
   * history). The next `commit` parents onto the cursor, so committing from
   * behind deliberately creates a fork point.
   */
  readonly currentRevisionId: string
  /**
   * parentId → the child the cursor descended from, remembered by `undo` so
   * `redo` can return to exactly where it came from at a fork point.
   */
  readonly redoChoice: Readonly<Record<string, string>>
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

export type RevisionErrorCode =
  | 'invalid_repository'
  | 'invalid_input'
  | 'ephemeral_field'
  | 'duplicate_id'
  | 'unknown_revision'
  | 'unknown_branch'
  | 'dangling_parent'
  | 'cycle_detected'
  | 'no_undo_target'
  | 'no_redo_target'

/**
 * A domain failure. `message` is developer copy: this module has no UI, so the
 * presentation layer maps `code` to whatever it wants to show. `keys` and
 * `revisionId` carry the offending detail instead of being baked into a string.
 */
export interface RevisionError {
  readonly code: RevisionErrorCode
  readonly message: string
  readonly keys?: readonly string[]
  readonly revisionId?: string
  readonly branchId?: string
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RevisionError }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const err = <T>(error: RevisionError): Result<T> => ({ ok: false, error })

/* -------------------------------------------------------------------------- */
/* Input validation                                                           */
/* -------------------------------------------------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Every own key of `input` that names ephemeral UI state, sorted. */
function ephemeralKeysIn(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter(isEphemeralKey).sort()
}

/**
 * Validate and copy a selection map.
 *
 * The copy matters: the caller usually hands over a live object derived from
 * the store, and a revision that shares structure with mutable state is not a
 * snapshot. Keys are also checked against `EPHEMERAL_KEYS`, so no one can slip
 * `tryOnId` in disguised as a slot.
 */
function normalizeSelections(value: unknown): Result<SlotSelectionMap> {
  if (!isPlainObject(value)) {
    return err({ code: 'invalid_input', message: 'selections must be a plain slotId → candidateId object' })
  }
  const ephemeral = ephemeralKeysIn(value)
  if (ephemeral.length > 0) {
    return err({
      code: 'ephemeral_field',
      message: 'ephemeral UI state cannot be committed as a slot selection',
      keys: ephemeral,
    })
  }
  const out: Record<string, string> = {}
  for (const slotId of Object.keys(value).sort()) {
    const candidateId = value[slotId]
    if (!isNonEmptyString(slotId) || !isNonEmptyString(candidateId)) {
      return err({
        code: 'invalid_input',
        message: 'every selection must map a non-empty slot id to a non-empty candidate id',
        keys: [slotId],
      })
    }
    out[slotId] = candidateId
  }
  return ok(out)
}

/** Cheap structural check so every entry point is total, even on `null`. */
function readRepository(repo: unknown): Result<Repository> {
  if (!isPlainObject(repo) || !isPlainObject(repo.revisions) || !isPlainObject(repo.branches)) {
    return err({ code: 'invalid_repository', message: 'repository must hold revisions and branches objects' })
  }
  if (!isNonEmptyString(repo.currentBranchId) || !isNonEmptyString(repo.currentRevisionId)) {
    return err({ code: 'invalid_repository', message: 'repository must hold a current branch and revision id' })
  }
  return ok(repo as unknown as Repository)
}

function getRevision(repo: Repository, id: string): Result<Revision> {
  const revision = Object.prototype.hasOwnProperty.call(repo.revisions, id) ? repo.revisions[id] : undefined
  if (!revision) return err({ code: 'unknown_revision', message: `no revision ${id}`, revisionId: id })
  return ok(revision)
}

function getBranch(repo: Repository, id: string): Result<Branch> {
  const branch = Object.prototype.hasOwnProperty.call(repo.branches, id) ? repo.branches[id] : undefined
  if (!branch) return err({ code: 'unknown_branch', message: `no branch ${id}`, branchId: id })
  return ok(branch)
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export interface RootInput {
  /** Id of the root revision. Caller-supplied so tests stay exact. */
  readonly revisionId: string
  readonly branchId: string
  readonly branchName: string
  readonly directionId: string
  readonly selections?: SlotSelectionMap
  readonly label: string
  readonly ts: number
}

/**
 * Start a repository at a root revision.
 *
 * The natural root is "a visual direction was chosen, nothing is committed
 * yet", which is why `selections` defaults to empty.
 */
export function createRepository(input: EphemeralFree<RootInput>): Result<Repository> {
  if (!isPlainObject(input)) return err({ code: 'invalid_input', message: 'root input must be an object' })
  const ephemeral = ephemeralKeysIn(input)
  if (ephemeral.length > 0) {
    return err({ code: 'ephemeral_field', message: 'ephemeral UI state cannot be committed', keys: ephemeral })
  }
  if (!isNonEmptyString(input.revisionId) || !isNonEmptyString(input.branchId) || !isNonEmptyString(input.branchName)) {
    return err({ code: 'invalid_input', message: 'root revisionId, branchId and branchName are required' })
  }
  if (!isNonEmptyString(input.directionId) || !isNonEmptyString(input.label) || !isFiniteNumber(input.ts)) {
    return err({ code: 'invalid_input', message: 'root directionId, label and ts are required' })
  }
  const selections = normalizeSelections(input.selections ?? {})
  if (!selections.ok) return selections

  const revision: Revision = {
    id: input.revisionId,
    parentId: null,
    branchId: input.branchId,
    directionId: input.directionId,
    selections: selections.value,
    label: input.label,
    ts: input.ts,
    reason: 'root',
  }
  const branch: Branch = {
    id: input.branchId,
    name: input.branchName,
    headId: revision.id,
    parentBranchId: null,
    baseRevisionId: null,
    createdAt: input.ts,
  }
  return ok({
    revisions: { [revision.id]: revision },
    branches: { [branch.id]: branch },
    currentBranchId: branch.id,
    currentRevisionId: revision.id,
    redoChoice: {},
  })
}

/* -------------------------------------------------------------------------- */
/* Commit                                                                     */
/* -------------------------------------------------------------------------- */

export interface CommitInput {
  /** Id of the new revision. Caller-supplied: this module has no randomness. */
  readonly id: string
  readonly directionId: string
  readonly selections: SlotSelectionMap
  readonly label: string
  readonly ts: number
  readonly reason?: RevisionReason
  readonly restoredFrom?: string
}

/**
 * Append a revision at the cursor and advance the current branch's head.
 *
 * Committing while the cursor sits behind the head (i.e. after `undo`) is
 * legal and creates a second child — a fork point. That is the honest DAG
 * behaviour and the case `redo` is built to disambiguate; the alternative,
 * silently re-parenting onto the head, would quietly discard where the user
 * actually was.
 */
export function commit(repo: Repository, input: EphemeralFree<CommitInput>): Result<Repository> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const store = base.value
  if (!isPlainObject(input)) return err({ code: 'invalid_input', message: 'commit input must be an object' })

  const ephemeral = ephemeralKeysIn(input)
  if (ephemeral.length > 0) {
    return err({
      code: 'ephemeral_field',
      message: 'ephemeral UI state cannot be committed; only selections and the visual direction belong in a revision',
      keys: ephemeral,
    })
  }
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.directionId) || !isNonEmptyString(input.label)) {
    return err({ code: 'invalid_input', message: 'commit id, directionId and label are required' })
  }
  if (!isFiniteNumber(input.ts)) return err({ code: 'invalid_input', message: 'commit ts must be a finite number' })
  if (Object.prototype.hasOwnProperty.call(store.revisions, input.id)) {
    return err({ code: 'duplicate_id', message: `revision ${input.id} already exists`, revisionId: input.id })
  }

  const parent = getRevision(store, store.currentRevisionId)
  if (!parent.ok) return parent
  const branch = getBranch(store, store.currentBranchId)
  if (!branch.ok) return branch
  const selections = normalizeSelections(input.selections)
  if (!selections.ok) return selections
  if (input.restoredFrom !== undefined) {
    const source = getRevision(store, input.restoredFrom)
    if (!source.ok) return source
  }

  const revision: Revision = {
    id: input.id,
    parentId: parent.value.id,
    branchId: branch.value.id,
    directionId: input.directionId,
    selections: selections.value,
    label: input.label,
    ts: input.ts,
    reason: input.reason ?? 'manual',
    ...(input.restoredFrom === undefined ? {} : { restoredFrom: input.restoredFrom }),
  }
  return ok({
    ...store,
    revisions: { ...store.revisions, [revision.id]: revision },
    branches: { ...store.branches, [branch.value.id]: { ...branch.value, headId: revision.id } },
    currentRevisionId: revision.id,
    // The cursor moved forward on purpose, so any remembered redo target for
    // this parent is stale — the new child is where "forward" now leads.
    redoChoice: { ...store.redoChoice, [parent.value.id]: revision.id },
  })
}

/**
 * Non-destructive restore (`docs/onlook-architecture-study.md` §4.3): re-commit
 * an old revision's content as a new revision instead of rewinding history, so
 * nothing that was reachable becomes unreachable.
 */
export function restore(
  repo: Repository,
  revisionId: string,
  input: EphemeralFree<{ id: string; label: string; ts: number }>,
): Result<Repository> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const source = getRevision(base.value, revisionId)
  if (!source.ok) return source
  if (!isPlainObject(input)) return err({ code: 'invalid_input', message: 'restore input must be an object' })
  return commit(base.value, {
    id: input.id,
    directionId: source.value.directionId,
    selections: source.value.selections,
    label: input.label,
    ts: input.ts,
    reason: 'restore',
    restoredFrom: source.value.id,
  })
}

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

export interface Checkout {
  readonly repo: Repository
  readonly revision: Revision
  /** Exactly what the page should show: the committed slot selections. */
  readonly selections: SlotSelectionMap
  readonly directionId: string
}

/**
 * Move the cursor to any revision in the DAG and report the state to render.
 *
 * Branch heads are untouched: checking out an old revision is a read, not a
 * rewrite. The cursor's branch follows the revision, so a later `commit` lands
 * on the branch that revision belongs to.
 */
export function checkout(repo: Repository, revisionId: string): Result<Checkout> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const revision = getRevision(base.value, revisionId)
  if (!revision.ok) return revision
  const branch = getBranch(base.value, revision.value.branchId)
  if (!branch.ok) return branch
  return ok({
    repo: { ...base.value, currentBranchId: branch.value.id, currentRevisionId: revision.value.id },
    revision: revision.value,
    selections: revision.value.selections,
    directionId: revision.value.directionId,
  })
}

/** Checkout a branch's head. The everyday "switch to this exploration". */
export function checkoutBranch(repo: Repository, branchId: string): Result<Checkout> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const branch = getBranch(base.value, branchId)
  if (!branch.ok) return branch
  return checkout(base.value, branch.value.headId)
}

/* -------------------------------------------------------------------------- */
/* Fork                                                                       */
/* -------------------------------------------------------------------------- */

export interface ForkInput {
  readonly branchId: string
  readonly name: string
  /** Any revision in the DAG — fork from the current state or from history. */
  readonly fromRevisionId: string
  readonly ts: number
}

/**
 * Open a new branch at an existing revision and move the cursor onto it.
 *
 * No revision is copied: the new branch shares the whole ancestry up to the
 * fork point and only diverges when something is committed on it. This is how
 * the user gets to A/B two complete pages from one shared history.
 */
export function fork(repo: Repository, input: EphemeralFree<ForkInput>): Result<Repository> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const store = base.value
  if (!isPlainObject(input)) return err({ code: 'invalid_input', message: 'fork input must be an object' })
  if (!isNonEmptyString(input.branchId) || !isNonEmptyString(input.name)) {
    return err({ code: 'invalid_input', message: 'fork branchId and name are required' })
  }
  if (!isFiniteNumber(input.ts)) return err({ code: 'invalid_input', message: 'fork ts must be a finite number' })
  if (Object.prototype.hasOwnProperty.call(store.branches, input.branchId)) {
    return err({ code: 'duplicate_id', message: `branch ${input.branchId} already exists`, branchId: input.branchId })
  }
  const from = getRevision(store, input.fromRevisionId)
  if (!from.ok) return from

  const branch: Branch = {
    id: input.branchId,
    name: input.name,
    headId: from.value.id,
    parentBranchId: from.value.branchId,
    baseRevisionId: from.value.id,
    createdAt: input.ts,
  }
  return ok({
    ...store,
    branches: { ...store.branches, [branch.id]: branch },
    currentBranchId: branch.id,
    currentRevisionId: from.value.id,
  })
}

/** Branches in a stable order: oldest first, ties broken by id. */
export function listBranches(repo: Repository): Result<readonly Branch[]> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const branches = Object.keys(base.value.branches)
    .map((id) => base.value.branches[id])
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return ok(branches)
}

/* -------------------------------------------------------------------------- */
/* Traversal                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Children of a revision, in a deterministic order: oldest commit first, ties
 * broken by id so the result never depends on object key insertion order.
 */
export function childrenOf(repo: Repository, revisionId: string): Result<readonly Revision[]> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const parent = getRevision(base.value, revisionId)
  if (!parent.ok) return parent
  const children = Object.keys(base.value.revisions)
    .map((id) => base.value.revisions[id])
    .filter((revision) => revision.parentId === parent.value.id)
    .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return ok(children)
}

/**
 * The path from the root down to `revisionId`, root first.
 *
 * Cycle-guarded: a repository can arrive from storage or from a future merge
 * path, and a corrupt parent link must surface as `cycle_detected` rather than
 * hang the UI thread. A parent id that names no revision is `dangling_parent`.
 */
export function ancestry(repo: Repository, revisionId: string): Result<readonly Revision[]> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const start = getRevision(base.value, revisionId)
  if (!start.ok) return start

  const path: Revision[] = []
  const seen = new Set<string>()
  let cursor: Revision | null = start.value
  while (cursor) {
    if (seen.has(cursor.id)) {
      return err({ code: 'cycle_detected', message: `revision ${cursor.id} is its own ancestor`, revisionId: cursor.id })
    }
    seen.add(cursor.id)
    path.push(cursor)
    if (cursor.parentId === null) break
    const parent = getRevision(base.value, cursor.parentId)
    if (!parent.ok) {
      return err({
        code: 'dangling_parent',
        message: `revision ${cursor.id} points at missing parent ${cursor.parentId}`,
        revisionId: cursor.parentId,
      })
    }
    cursor = parent.value
  }
  return ok(path.reverse())
}

/**
 * Whole-repository integrity check, for rehydrated or hand-built values.
 * Reports the first problem it finds rather than throwing.
 */
export function validateRepository(repo: Repository): Result<Repository> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const store = base.value
  for (const id of Object.keys(store.revisions).sort()) {
    const walked = ancestry(store, id)
    if (!walked.ok) return walked
    const revision = store.revisions[id]
    const branch = getBranch(store, revision.branchId)
    if (!branch.ok) return branch
  }
  for (const id of Object.keys(store.branches).sort()) {
    const head = getRevision(store, store.branches[id].headId)
    if (!head.ok) return head
  }
  const current = getRevision(store, store.currentRevisionId)
  if (!current.ok) return current
  const branch = getBranch(store, store.currentBranchId)
  if (!branch.ok) return branch
  return ok(store)
}

/* -------------------------------------------------------------------------- */
/* Undo / redo as DAG movement                                                */
/* -------------------------------------------------------------------------- */

/** Where the cursor landed, plus the state to render there. */
export interface Move extends Checkout {
  readonly from: Revision
}

/**
 * Walk one step towards the root.
 *
 * Nothing is deleted and no branch head moves: undo is navigation, so the
 * revision left behind stays reachable and `redo` is always possible. The
 * child we descended from is remembered in `redoChoice`.
 */
export function undo(repo: Repository): Result<Move> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const store = base.value
  const current = getRevision(store, store.currentRevisionId)
  if (!current.ok) return current
  if (current.value.parentId === null) {
    return err({ code: 'no_undo_target', message: 'already at the root revision', revisionId: current.value.id })
  }
  const parent = getRevision(store, current.value.parentId)
  if (!parent.ok) {
    return err({
      code: 'dangling_parent',
      message: `revision ${current.value.id} points at missing parent ${current.value.parentId}`,
      revisionId: current.value.parentId,
    })
  }
  const moved = checkout(
    { ...store, redoChoice: { ...store.redoChoice, [parent.value.id]: current.value.id } },
    parent.value.id,
  )
  if (!moved.ok) return moved
  return ok({ ...moved.value, from: current.value })
}

/**
 * Walk one step away from the root.
 *
 * At a fork point the target is decided by three deterministic rules, in order:
 *
 * 1. **The child you came from.** If `undo` moved the cursor here, `redoChoice`
 *    holds the exact child it descended from and redo returns to it. Undo then
 *    redo is an identity — the property a user actually relies on.
 * 2. **The child on the current branch**, when the memory is absent (a fresh
 *    session, a restored repository, or an arbitrary `checkout`) and exactly
 *    one child continues the branch the cursor is on. Staying on your own
 *    branch is the least surprising reading of "forward".
 * 3. **The newest child**, by `ts` and then by id ascending. A total order over
 *    caller-supplied values, so the result never depends on insertion order.
 *
 * Rule 3 is a guess by construction, which is why rules 1 and 2 exist to make
 * it almost never reachable; `Move.from` lets a caller show which way it went.
 */
export function redo(repo: Repository): Result<Move> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const store = base.value
  const current = getRevision(store, store.currentRevisionId)
  if (!current.ok) return current
  const children = childrenOf(store, current.value.id)
  if (!children.ok) return children
  if (children.value.length === 0) {
    return err({ code: 'no_redo_target', message: 'no revision after the current one', revisionId: current.value.id })
  }

  const remembered = store.redoChoice?.[current.value.id]
  const target =
    children.value.find((child) => child.id === remembered) ??
    onlyOne(children.value.filter((child) => child.branchId === store.currentBranchId)) ??
    newest(children.value)

  const moved = checkout(store, target.id)
  if (!moved.ok) return moved
  return ok({ ...moved.value, from: current.value })
}

function onlyOne(revisions: readonly Revision[]): Revision | undefined {
  return revisions.length === 1 ? revisions[0] : undefined
}

function newest(revisions: readonly Revision[]): Revision {
  return revisions.reduce((best, candidate) =>
    candidate.ts > best.ts || (candidate.ts === best.ts && candidate.id < best.id) ? candidate : best,
  )
}

/** Whether `undo` / `redo` would succeed, for enabling toolbar buttons. */
export function canUndo(repo: Repository): boolean {
  return undo(repo).ok
}

export function canRedo(repo: Repository): boolean {
  return redo(repo).ok
}

/** The revision the cursor is on. */
export function currentRevision(repo: Repository): Result<Revision> {
  const base = readRepository(repo)
  if (!base.ok) return base
  return getRevision(base.value, base.value.currentRevisionId)
}

/* -------------------------------------------------------------------------- */
/* Diff                                                                       */
/* -------------------------------------------------------------------------- */

export type SlotChangeKind = 'added' | 'removed' | 'changed'

export interface SlotChange {
  readonly slotId: string
  /** The candidate before, or `null` when the slot had no committed choice. */
  readonly from: string | null
  readonly to: string | null
  readonly kind: SlotChangeKind
}

export interface RevisionDiff {
  readonly fromId: string
  readonly toId: string
  /** Slot-level changes, ordered by slot id so rendering is stable. */
  readonly slots: readonly SlotChange[]
  readonly unchangedSlotIds: readonly string[]
  /** Present only when the visual direction itself changed. */
  readonly direction: { readonly from: string; readonly to: string } | null
  readonly changed: boolean
}

/**
 * What differs between two revisions, at slot granularity.
 *
 * Works across branches — comparing two fork tips is the whole point of being
 * able to A/B two pages. Purely a function of the two revisions; it does not
 * consult the path between them.
 */
export function diff(repo: Repository, fromId: string, toId: string): Result<RevisionDiff> {
  const base = readRepository(repo)
  if (!base.ok) return base
  const from = getRevision(base.value, fromId)
  if (!from.ok) return from
  const to = getRevision(base.value, toId)
  if (!to.ok) return to
  return ok(diffRevisions(from.value, to.value))
}

/** `diff` on two revision values, for callers that already hold them. */
export function diffRevisions(from: Revision, to: Revision): RevisionDiff {
  const slotIds = Array.from(new Set([...Object.keys(from.selections), ...Object.keys(to.selections)])).sort()
  const slots: SlotChange[] = []
  const unchangedSlotIds: string[] = []

  for (const slotId of slotIds) {
    const before = Object.prototype.hasOwnProperty.call(from.selections, slotId) ? from.selections[slotId] : null
    const after = Object.prototype.hasOwnProperty.call(to.selections, slotId) ? to.selections[slotId] : null
    if (before === after) {
      unchangedSlotIds.push(slotId)
      continue
    }
    const kind: SlotChangeKind = before === null ? 'added' : after === null ? 'removed' : 'changed'
    slots.push({ slotId, from: before, to: after, kind })
  }

  const direction = from.directionId === to.directionId ? null : { from: from.directionId, to: to.directionId }
  return {
    fromId: from.id,
    toId: to.id,
    slots,
    unchangedSlotIds,
    direction,
    changed: slots.length > 0 || direction !== null,
  }
}
