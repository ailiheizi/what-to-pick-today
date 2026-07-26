import assert from 'node:assert/strict'
import test from 'node:test'
import { compareCandidates, findRerollTargets } from '../src/lib/harness/diversity.ts'

function candidate(id, content, extra = []) {
  return {
    id,
    entryFile: 'src/generated/widget/main.tsx',
    files: [{ path: 'src/generated/widget/main.tsx', content }, ...extra],
  }
}

/** A stacked card counter: flex column, one heading, two buttons, framer-motion. */
const CARD_COUNTER = `
  import { useState } from 'react'
  import { motion } from 'framer-motion'

  export default function Counter() {
    const [count, setCount] = useState(0)
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-slate-50 p-6">
        <h2 className="text-lg text-slate-900">Today</h2>
        <motion.span animate={{ scale: 1 }} className="text-6xl text-indigo-500">{count}</motion.span>
        <div className="flex flex-row gap-2">
          <button className="bg-indigo-500 text-white" onClick={() => setCount(count - 1)}>Minus</button>
          <button className="bg-indigo-100 text-indigo-700" onClick={() => setCount(count + 1)}>Plus</button>
        </div>
      </div>
    )
  }
`

/** Byte-for-byte the same tree; indigo swapped for emerald, slate for zinc. */
const CARD_COUNTER_RECOLOURED = CARD_COUNTER
  .replace(/indigo/g, 'emerald')
  .replace(/slate/g, 'zinc')

/** Same tree, recoloured, and with different copy. Still not a real alternative. */
const CARD_COUNTER_RECOLOURED_RETITLED = CARD_COUNTER_RECOLOURED
  .replace('Today', 'This week')
  .replace('Minus', 'Down')
  .replace('Plus', 'Up')

/** A genuinely different design: absolute-positioned dial, no buttons, svg, sliders. */
const DIAL_COUNTER = `
  import { useReducer } from 'react'

  export default function Dial() {
    const [state, dispatch] = useReducer((value, step) => value + step, 0)
    return (
      <section className="relative h-64 w-64">
        <svg viewBox="0 0 100 100" className="absolute inset-0">
          <circle cx="50" cy="50" r="46" />
          <path d="M50 4 A46 46 0 0 1 96 50" />
        </svg>
        <input
          type="range"
          min="0"
          max="99"
          value={state}
          onChange={(event) => dispatch(Number(event.target.value) - state)}
        />
        <output className="absolute bottom-2 left-2">{state}</output>
      </section>
    )
  }
`

/** Another genuinely different design: a data table with tabs and a list. */
const TABLE_COUNTER = `
  import { useState } from 'react'
  import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

  export default function Ledger() {
    const [rows, setRows] = useState([{ id: 1, label: 'one' }])
    return (
      <main className="grid grid-cols-3 gap-6">
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="today">Today</TabsTrigger>
          </TabsList>
        </Tabs>
        <table>
          <thead><tr><th>Item</th><th>Count</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id}><td>{row.label}</td><td>{row.id}</td></tr>)}
          </tbody>
        </table>
        <ul>
          {rows.map((row) => <li key={row.id}>{row.label}</li>)}
        </ul>
        <form onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="next">Next</label>
          <input id="next" onChange={() => setRows(rows)} />
        </form>
      </main>
    )
  }
`

test('identical layout with a different accent colour is a near duplicate', () => {
  const result = compareCandidates(
    candidate('counter-a', CARD_COUNTER),
    candidate('counter-b', CARD_COUNTER_RECOLOURED),
  )

  assert.equal(result.verdict, 'near_duplicate')
  assert.ok(result.score >= 0.9, `expected a very high similarity, got ${result.score}`)
  assert.equal(result.signals.skeleton, 1)
  assert.equal(result.signals.layout, 1)
  assert.equal(result.signals.controls, 1)
  assert.equal(result.signals.depth, 1)
})

test('a colour-only delta cannot rescue an otherwise identical pair', () => {
  const result = compareCandidates(
    candidate('counter-a', CARD_COUNTER),
    candidate('counter-b', CARD_COUNTER_RECOLOURED),
  )

  // The palettes really are disjoint - that is exactly why the palette signal
  // must not be allowed to carry the verdict.
  assert.ok(result.signals.palette < 0.5, `expected a low palette overlap, got ${result.signals.palette}`)
  assert.equal(result.verdict, 'near_duplicate')

  // Even a hypothetically perfect palette match may not move the verdict.
  const recoloured = compareCandidates(candidate('a', CARD_COUNTER), candidate('b', CARD_COUNTER))
  assert.ok(recoloured.score - result.score <= 0.05)
})

test('recolouring plus rewording text is still a near duplicate', () => {
  const result = compareCandidates(
    candidate('counter-a', CARD_COUNTER),
    candidate('counter-c', CARD_COUNTER_RECOLOURED_RETITLED),
  )

  assert.equal(result.verdict, 'near_duplicate')
})

test('the reason names the later candidate and the traits to change', () => {
  const { reason } = compareCandidates(
    candidate('counter-a', CARD_COUNTER),
    candidate('counter-b', CARD_COUNTER_RECOLOURED),
  )

  assert.match(reason, /counter-b/)
  assert.match(reason, /counter-a/)
  assert.match(reason, /colour scheme|skeleton|layout/i)
  assert.match(reason, /Re-roll|Regenerate/i)
  assert.ok(reason.length > 80, 'reason should be specific enough to feed a re-roll prompt')
})

test('genuinely different layouts are distinct', () => {
  const dial = compareCandidates(candidate('counter-a', CARD_COUNTER), candidate('counter-d', DIAL_COUNTER))
  const table = compareCandidates(candidate('counter-a', CARD_COUNTER), candidate('counter-t', TABLE_COUNTER))
  const cross = compareCandidates(candidate('counter-d', DIAL_COUNTER), candidate('counter-t', TABLE_COUNTER))

  assert.equal(dial.verdict, 'distinct')
  assert.equal(table.verdict, 'distinct')
  assert.equal(cross.verdict, 'distinct')
  assert.ok(dial.score < 0.72, `expected a low similarity, got ${dial.score}`)
  assert.match(dial.reason, /No re-roll needed/)
})

test('a candidate is always a perfect duplicate of itself', () => {
  const result = compareCandidates(candidate('self', CARD_COUNTER), candidate('self-copy', CARD_COUNTER))

  assert.equal(result.verdict, 'near_duplicate')
  assert.equal(result.score, 1)
  for (const value of Object.values(result.signals)) assert.equal(value, 1)
})

test('score and signals are symmetric', () => {
  const forward = compareCandidates(candidate('a', CARD_COUNTER), candidate('b', TABLE_COUNTER))
  const backward = compareCandidates(candidate('b', TABLE_COUNTER), candidate('a', CARD_COUNTER))

  assert.equal(forward.score, backward.score)
  assert.equal(forward.verdict, backward.verdict)
  assert.deepEqual(forward.signals, backward.signals)
})

test('comparison is deterministic across repeated and reordered calls', () => {
  const a = candidate('a', CARD_COUNTER, [{ path: 'src/generated/widget/theme.css', content: '.a { color: #fff }' }])
  const b = candidate('b', CARD_COUNTER_RECOLOURED)

  const first = compareCandidates(a, b)
  for (let index = 0; index < 5; index += 1) {
    const repeat = compareCandidates(a, b)
    assert.deepEqual(repeat, first)
  }

  // File order inside a candidate must not change the outcome.
  const shuffled = { ...a, files: [...a.files].reverse() }
  assert.deepEqual(compareCandidates(shuffled, b), first)
})

test('malformed, empty and hostile input never throws', () => {
  const cases = [
    [null, null],
    [undefined, undefined],
    [candidate('a', ''), candidate('b', '')],
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'a', files: null, entryFile: null }, { id: 'b', files: 'nope', entryFile: 7 }],
    [{ id: 'a', files: [null, undefined, 42, { path: 1, content: 2 }] }, candidate('b', CARD_COUNTER)],
    [{ files: [{ path: 'x', content: '<div>' }] }, { files: [{ content: '</span></div><<<>' }] }],
    [candidate('a', '<div><section><p>unclosed'), candidate('b', 'const x = a < b && c > d')],
    [candidate('a', 'useState<number>(0)'), candidate('b', '<'.repeat(500))],
    [candidate('a', '{/* <div className="flex" /> */}'), candidate('b', '// <button>x</button>')],
  ]

  for (const [left, right] of cases) {
    const result = compareCandidates(left, right)
    assert.ok(Number.isFinite(result.score), 'score must be a finite number')
    assert.ok(result.score >= 0 && result.score <= 1, `score out of range: ${result.score}`)
    assert.ok(['distinct', 'weak', 'near_duplicate'].includes(result.verdict))
    assert.equal(typeof result.reason, 'string')
    assert.ok(result.reason.length > 0)
    for (const value of Object.values(result.signals)) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1)
    }
  }

  assert.doesNotThrow(() => findRerollTargets(null))
  assert.doesNotThrow(() => findRerollTargets(undefined))
  assert.doesNotThrow(() => findRerollTargets('not an array'))
  assert.doesNotThrow(() => findRerollTargets([null, undefined, {}]))
  assert.deepEqual(findRerollTargets([]), [])
})

test('two empty candidates cannot be told apart and collide', () => {
  const result = compareCandidates(candidate('a', ''), candidate('b', '   \n  '))

  assert.equal(result.verdict, 'near_duplicate')
  assert.match(result.reason, /no analysable source/i)
  assert.match(result.reason, /\bb\b/)
})

test('re-roll flags the later candidate of a colliding pair, never the first', () => {
  const targets = findRerollTargets([
    candidate('first', CARD_COUNTER),
    candidate('second', CARD_COUNTER_RECOLOURED),
    candidate('third', DIAL_COUNTER),
  ])

  assert.deepEqual(targets, ['second'])
  assert.ok(!targets.includes('first'))
})

test('the three-same-layout-different-colour batch keeps exactly one candidate', () => {
  const targets = findRerollTargets([
    candidate('conservative', CARD_COUNTER),
    candidate('expressive', CARD_COUNTER_RECOLOURED),
    candidate('experimental', CARD_COUNTER_RECOLOURED_RETITLED),
  ])

  assert.deepEqual(targets, ['expressive', 'experimental'])
})

test('a fully diverse batch needs no re-rolls', () => {
  assert.deepEqual(findRerollTargets([
    candidate('a', CARD_COUNTER),
    candidate('b', DIAL_COUNTER),
    candidate('c', TABLE_COUNTER),
  ]), [])
})

test('re-roll order follows input order and reports each id once', () => {
  const targets = findRerollTargets([
    candidate('a', CARD_COUNTER),
    candidate('b', DIAL_COUNTER),
    candidate('c', CARD_COUNTER_RECOLOURED),
    candidate('d', DIAL_COUNTER),
  ])

  assert.deepEqual(targets, ['c', 'd'])
  assert.deepEqual(new Set(targets).size, targets.length)
})

test('a later candidate colliding with any earlier one is flagged', () => {
  // 'c' matches 'a' but not 'b'; the pairwise sweep must still catch it.
  const targets = findRerollTargets([
    candidate('a', TABLE_COUNTER),
    candidate('b', DIAL_COUNTER),
    candidate('c', TABLE_COUNTER),
  ])

  assert.deepEqual(targets, ['c'])
})

test('weak collisions are opt-in', () => {
  const nudged = CARD_COUNTER.replace(
    '<div className="flex flex-row gap-2">',
    '<div className="flex flex-row gap-2"><span className="sr-only">count</span>',
  )
  const pair = [candidate('a', CARD_COUNTER), candidate('b', nudged)]
  const strict = findRerollTargets(pair)
  const lenient = findRerollTargets(pair, { minVerdict: 'weak' })

  assert.ok(lenient.length >= strict.length)
  for (const id of strict) assert.ok(lenient.includes(id))
  assert.ok(!lenient.includes('a'))
})
