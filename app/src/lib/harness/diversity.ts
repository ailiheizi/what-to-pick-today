/**
 * Candidate diversity heuristics.
 *
 * The product promise is "try three, pick one". That promise breaks when the
 * three candidates are the same layout with a different accent colour: there is
 * nothing to try on. This module scores how *duplicated* a pair of candidates
 * is, so a colliding candidate can be re-rolled before the user ever sees it.
 *
 * Deliberate design choice: colour carries almost no weight. A recolour must
 * never rescue an otherwise identical pair — that is the exact failure mode
 * being detected, not a cure for it.
 *
 * The scan is a tolerant regex sweep, never a real parser. It is pure, total
 * and deterministic: same input, same output, and no input can make it throw.
 */

export type DiversityFile = {
  path: string
  content: string
}

/** Structurally compatible with `CandidateArtifact`, intentionally not coupled to it. */
export type DiversityCandidate = {
  id: string
  files: DiversityFile[]
  entryFile: string
}

export type DiversitySignalName = 'skeleton' | 'layout' | 'controls' | 'motion' | 'depth' | 'palette'

/** Per-signal similarity: 0 = nothing in common, 1 = indistinguishable. */
export type DiversitySignals = Record<DiversitySignalName, number>

export type DiversityVerdict = 'distinct' | 'weak' | 'near_duplicate'

export type CandidateComparison = {
  /** Weighted *similarity*, 0..1. Higher means more duplicated, not more diverse. */
  score: number
  verdict: DiversityVerdict
  /** Specific enough to paste into a re-roll prompt. */
  reason: string
  signals: DiversitySignals
}

export type RerollOptions = {
  /** Lowest verdict that still earns a re-roll. Defaults to `near_duplicate`. */
  minVerdict?: 'weak' | 'near_duplicate'
}

/**
 * Structure dominates; colour is a rounding error by design. The five
 * structural weights sum to 0.96, so a total palette mismatch can only move the
 * score by 0.04 — far too little to drag an identical pair below the
 * `near_duplicate` threshold.
 */
export const DIVERSITY_WEIGHTS: DiversitySignals = {
  skeleton: 0.34,
  layout: 0.22,
  controls: 0.22,
  motion: 0.1,
  depth: 0.08,
  palette: 0.04,
}

export const DIVERSITY_THRESHOLDS = {
  nearDuplicate: 0.86,
  weak: 0.72,
} as const

const SIGNAL_ORDER: DiversitySignalName[] = ['skeleton', 'layout', 'controls', 'motion', 'depth', 'palette']

const SIGNAL_LABELS: Record<DiversitySignalName, string> = {
  skeleton: 'element skeleton',
  layout: 'layout primitives (flex/grid/absolute)',
  controls: 'control inventory',
  motion: 'motion language',
  depth: 'nesting depth',
  palette: 'colour palette',
}

/** A signal at or above this counts as "shared" when explaining a verdict. */
const SHARED_SIGNAL = 0.85
/** A signal at or below this counts as "genuinely different". */
const DIFFERENT_SIGNAL = 0.5

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const LAYOUT_PATTERNS: RegExp[] = [
  /\b(?:inline-)?flex\b|\bflex-(?:1|auto|initial|none|wrap|nowrap|grow|shrink)\b|display\s*:\s*(?:inline-)?flex/g,
  /\bgrid\b|\bgrid-(?:cols|rows|flow|area|areas|template)[\w-]*\b|display\s*:\s*(?:inline-)?grid/g,
  /\b(?:absolute|fixed|sticky)\b|position\s*:\s*(?:absolute|fixed|sticky)/g,
  /\bflex-col\b|flex-direction\s*:\s*column|\bgrid-flow-row\b|\bspace-y-\d/g,
  /\bflex-row\b|flex-direction\s*:\s*row|\bgrid-flow-col\b|\bspace-x-\d/g,
]

const CONTROL_PATTERNS: RegExp[] = [
  /<button\b|role\s*=\s*["']button["']/gi,
  /<input\b|<textarea\b|<select\b/gi,
  /<tabs?\b|tabstrigger|tabslist|role\s*=\s*["']tab["']|\bsegmented\b/gi,
  /<[uo]l\b|<li\b|\.map\(|role\s*=\s*["']list["']/gi,
  /<nav\b|<a[\s>]|<link\b|role\s*=\s*["']navigation["']/gi,
  /<img\b|<svg\b|<video\b|<canvas\b|<picture\b/gi,
  /<switch\b|<slider\b|<checkbox\b|type\s*=\s*["'](?:checkbox|radio|range)["']/gi,
  /<dialog\b|<modal\b|<sheet\b|<drawer\b|<popover\b|<tooltip\b|role\s*=\s*["']dialog["']/gi,
  /<table\b|<thead\b|<tbody\b|<tr\b/gi,
  /<form\b|<label\b|<fieldset\b/gi,
]

const MOTION_PATTERNS: RegExp[] = [
  /\bframer-motion\b|\bAnimatePresence\b|\bmotion\.[a-z]|\buse(?:Animate|Spring|MotionValue|Scroll|Transform)\b/g,
  /\bwhile(?:Hover|Tap|Focus|InView|Drag)\b|\bdragConstraints\b/g,
  /\b(?:initial|animate|exit|variants|transition)\s*=\s*[{"']/g,
  /@keyframes\b|\banimation\s*:|\btransition\s*:|\banimate-[a-z]/g,
  /\btransition(?:-[a-z]+)?\b|\bduration-\d+\b|\bease-[a-z-]+\b|\bdelay-\d+\b/g,
  /prefers-reduced-motion|useReducedMotion/g,
]

const PALETTE_PATTERNS: RegExp[] = [
  /#[0-9a-f]{3,8}\b/gi,
  /\b(?:rgba?|hsla?|oklch|oklab)\([^)]{0,120}\)/gi,
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|outline|decoration|accent|caret|divide|placeholder)-[a-z]+-\d{2,3}\b/gi,
  /\b(?:bg|text|border|fill|stroke)-(?:white|black|transparent|current|inherit)\b/gi,
]

type Counter = Map<string, number>

type Fingerprint = {
  tags: Counter
  shingles: Counter
  layout: number[]
  controls: number[]
  motion: number[]
  maxDepth: number
  avgDepth: number
  palette: Set<string>
  blank: boolean
}

type LooseFile = { path?: unknown, content?: unknown }
type LooseCandidate = { id?: unknown, files?: unknown, entryFile?: unknown }

function bump(counter: Counter, key: string) {
  counter.set(key, (counter.get(key) ?? 0) + 1)
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function round(value: number) {
  return Math.round(clamp01(value) * 10000) / 10000
}

function percent(value: number) {
  return `${Math.round(clamp01(value) * 100)}%`
}

/** Symmetric, count-aware Jaccard. Two empty bags are considered identical. */
function multisetJaccard(a: Counter, b: Counter) {
  let intersection = 0
  let union = 0
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const key of keys) {
    const left = a.get(key) ?? 0
    const right = b.get(key) ?? 0
    intersection += Math.min(left, right)
    union += Math.max(left, right)
  }
  return union === 0 ? 1 : intersection / union
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const key of a) if (b.has(key)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}

/**
 * Cosine on the shape of the vector, damped by how far apart the magnitudes
 * are. Cosine alone would call "3 buttons" and "30 buttons" the same thing.
 */
function vectorSimilarity(a: number[], b: number[]) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  let leftSum = 0
  let rightSum = 0
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    dot += left * right
    leftNorm += left * left
    rightNorm += right * right
    leftSum += left
    rightSum += right
  }
  if (leftSum === 0 && rightSum === 0) return 1
  if (leftSum === 0 || rightSum === 0) return 0
  const cosine = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
  const magnitude = Math.min(leftSum, rightSum) / Math.max(leftSum, rightSum)
  return clamp01(cosine * (0.7 + 0.3 * magnitude))
}

function candidateId(candidate: LooseCandidate | null | undefined, fallback: string) {
  const id = candidate?.id
  return typeof id === 'string' && id.length > 0 ? id : fallback
}

/**
 * Deterministic source view of a candidate: entry file first, then every other
 * file by path. Anything that is not a `{ path, content }` string pair is
 * dropped rather than trusted.
 */
function sourceOf(candidate: LooseCandidate | null | undefined) {
  if (!candidate || typeof candidate !== 'object') return ''
  const raw = candidate.files
  if (!Array.isArray(raw)) return ''
  const entry = typeof candidate.entryFile === 'string' ? candidate.entryFile : ''
  const files = (raw as LooseFile[])
    .filter((file): file is LooseFile => Boolean(file) && typeof file === 'object' && typeof file.content === 'string')
    .map((file) => ({
      path: typeof file.path === 'string' ? file.path : '',
      content: file.content as string,
    }))
  files.sort((left, right) => {
    const leftEntry = entry !== '' && left.path === entry
    const rightEntry = entry !== '' && right.path === entry
    if (leftEntry !== rightEntry) return leftEntry ? -1 : 1
    if (left.path === right.path) return 0
    return left.path < right.path ? -1 : 1
  })
  return files.map((file) => file.content).join('\n')
}

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

function countMatches(source: string, patterns: RegExp[]) {
  return patterns.map((pattern) => {
    const scoped = new RegExp(pattern.source, pattern.flags)
    let count = 0
    while (scoped.exec(source) !== null) {
      count += 1
      if (scoped.lastIndex === 0) break
    }
    return count
  })
}

function collectMatches(source: string, patterns: RegExp[]) {
  const found = new Set<string>()
  for (const pattern of patterns) {
    const scoped = new RegExp(pattern.source, pattern.flags)
    let match = scoped.exec(source)
    while (match !== null) {
      found.add(match[0].toLowerCase().replace(/\s+/g, ''))
      if (scoped.lastIndex === match.index) scoped.lastIndex += 1
      match = scoped.exec(source)
    }
  }
  return found
}

/**
 * Element-tree skeleton. Only tag names and nesting survive — attribute values
 * and text are discarded, which is what makes a recolour invisible here.
 *
 * Two tolerances matter: `<` immediately preceded by an identifier character is
 * a generic (`useState<number>`), not an element; and an unmatched close tag
 * rewinds to its own opener, which self-heals tags truncated by a `=>` inside
 * an attribute expression.
 */
function extractTree(source: string) {
  const tags: Counter = new Map()
  const shingles: Counter = new Map()
  const tokens: string[] = []
  const stack: string[] = []
  let maxDepth = 0
  let depthSum = 0
  let count = 0

  const pattern = /<(\/?)([A-Za-z][A-Za-z0-9._:-]*)([^>]*)>/g
  let match = pattern.exec(source)
  while (match !== null) {
    const closing = match[1] === '/'
    const name = (match[2].split('.').pop() ?? match[2]).toLowerCase()
    const attrs = match[3] ?? ''
    const previous = match.index > 0 ? source[match.index - 1] : ''
    if (closing) {
      const at = stack.lastIndexOf(name)
      if (at >= 0) stack.length = at
    } else if (!/[A-Za-z0-9_$]/.test(previous)) {
      const depth = Math.min(stack.length, 12)
      bump(tags, name)
      tokens.push(`${name}@${depth}`)
      depthSum += depth
      count += 1
      if (depth > maxDepth) maxDepth = depth
      const selfClosing = attrs.trimEnd().endsWith('/') || VOID_TAGS.has(name)
      if (!selfClosing) stack.push(name)
    }
    if (pattern.lastIndex === match.index) pattern.lastIndex += 1
    match = pattern.exec(source)
  }

  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      bump(shingles, `${size}|${tokens.slice(index, index + size).join('>')}`)
    }
  }

  return {
    tags,
    shingles,
    maxDepth,
    avgDepth: count === 0 ? 0 : depthSum / count,
    blank: count === 0,
  }
}

function fingerprint(candidate: LooseCandidate | null | undefined): Fingerprint {
  const source = stripComments(sourceOf(candidate))
  const tree = extractTree(source)
  return {
    tags: tree.tags,
    shingles: tree.shingles,
    layout: countMatches(source, LAYOUT_PATTERNS),
    controls: countMatches(source, CONTROL_PATTERNS),
    motion: countMatches(source, MOTION_PATTERNS),
    maxDepth: tree.maxDepth,
    avgDepth: tree.avgDepth,
    palette: collectMatches(source, PALETTE_PATTERNS),
    blank: tree.blank && source.trim().length === 0,
  }
}

function signalsFor(a: Fingerprint, b: Fingerprint): DiversitySignals {
  const skeleton = 0.5 * multisetJaccard(a.tags, b.tags) + 0.5 * multisetJaccard(a.shingles, b.shingles)
  const depthDelta = Math.abs(a.maxDepth - b.maxDepth) + Math.abs(a.avgDepth - b.avgDepth)
  return {
    skeleton: round(skeleton),
    layout: round(vectorSimilarity(a.layout, b.layout)),
    controls: round(vectorSimilarity(a.controls, b.controls)),
    motion: round(vectorSimilarity(a.motion, b.motion)),
    depth: round(1 - depthDelta / 8),
    palette: round(jaccard(a.palette, b.palette)),
  }
}

function weightedScore(signals: DiversitySignals) {
  let total = 0
  for (const name of SIGNAL_ORDER) total += signals[name] * DIVERSITY_WEIGHTS[name]
  return round(total)
}

function verdictFor(score: number): DiversityVerdict {
  if (score >= DIVERSITY_THRESHOLDS.nearDuplicate) return 'near_duplicate'
  if (score >= DIVERSITY_THRESHOLDS.weak) return 'weak'
  return 'distinct'
}

function join(parts: string[]) {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function formatList(names: DiversitySignalName[], signals: DiversitySignals) {
  return join(names.map((name) => `${SIGNAL_LABELS[name]} ${percent(signals[name])}`))
}

function formatTraits(names: DiversitySignalName[]) {
  return join(names.map((name) => SIGNAL_LABELS[name]))
}

function rank(names: DiversitySignalName[], signals: DiversitySignals, descending: boolean) {
  return [...names].sort((left, right) => {
    const delta = descending ? signals[right] - signals[left] : signals[left] - signals[right]
    if (delta !== 0) return delta
    return SIGNAL_ORDER.indexOf(left) - SIGNAL_ORDER.indexOf(right)
  })
}

function buildReason(
  firstId: string,
  laterId: string,
  verdict: DiversityVerdict,
  score: number,
  signals: DiversitySignals,
  bothBlank: boolean,
) {
  if (bothBlank) {
    return `${laterId} and ${firstId} carry no analysable source, so they cannot be told apart. `
      + `Regenerate ${laterId} from scratch with a concrete layout, controls and motion.`
  }

  const structural = SIGNAL_ORDER.filter((name) => name !== 'palette')
  const shared = rank(structural.filter((name) => signals[name] >= SHARED_SIGNAL), signals, true)
  const different = rank(SIGNAL_ORDER.filter((name) => signals[name] <= DIFFERENT_SIGNAL), signals, false)
  const colourOnly = signals.palette < 0.7 && structural.every((name) => signals[name] >= SHARED_SIGNAL)

  if (verdict === 'near_duplicate') {
    if (colourOnly) {
      return `${laterId} is the same design as ${firstId} in a different colour scheme `
        + `(similarity ${percent(score)}; ${formatList(shared, signals)}). `
        + `Palette overlap is only ${percent(signals.palette)}, and a recolour is not a design difference. `
        + `Re-roll ${laterId} with a different element skeleton, a different layout primitive `
        + `(swap flex for grid, or introduce absolute/overlapping composition), a different control inventory `
        + `and a different motion language. Do not change colours only.`
    }
    const focus = shared.length > 0 ? shared : rank(structural, signals, true).slice(0, 2)
    return `${laterId} is a near-duplicate of ${firstId} (similarity ${percent(score)}): `
      + `it repeats ${formatList(focus, signals)}. `
      + `Re-roll ${laterId} and change ${formatTraits(focus)} first; `
      + `a new palette will not make it a real alternative.`
  }

  if (verdict === 'weak') {
    const focus = shared.length > 0 ? shared : rank(structural, signals, true).slice(0, 2)
    const differs = different.length > 0 ? ` It already differs in ${formatList(different, signals)}.` : ''
    return `${laterId} is only weakly different from ${firstId} (similarity ${percent(score)}): `
      + `it still shares ${formatList(focus, signals)}.${differs} `
      + `Push ${laterId} further on ${formatTraits(focus)}.`
  }

  const differs = different.length > 0
    ? `differs in ${formatList(different, signals)}`
    : `no structural trait is shared strongly enough to collide`
  return `${laterId} is distinct from ${firstId} (similarity ${percent(score)}): ${differs}. No re-roll needed.`
}

/**
 * Compare two candidates. Symmetric in `score` and `signals`; `reason` is
 * written from the point of view of `b`, which is the one a re-roll would
 * replace. Never throws — malformed or missing input degrades to an empty
 * fingerprint.
 */
export function compareCandidates(
  a: DiversityCandidate | null | undefined,
  b: DiversityCandidate | null | undefined,
): CandidateComparison {
  const left = a as LooseCandidate | null | undefined
  const right = b as LooseCandidate | null | undefined
  const firstId = candidateId(left, 'candidate-a')
  const laterId = candidateId(right, 'candidate-b')
  const leftPrint = fingerprint(left)
  const rightPrint = fingerprint(right)
  const bothBlank = leftPrint.blank && rightPrint.blank
  const signals = signalsFor(leftPrint, rightPrint)
  const score = bothBlank ? 1 : weightedScore(signals)
  const verdict = verdictFor(score)
  return {
    score,
    verdict,
    reason: buildReason(firstId, laterId, verdict, score, signals, bothBlank),
    signals,
  }
}

/**
 * Ids that should be regenerated. Every candidate is compared against all
 * candidates before it, so the *earlier* member of a colliding pair is always
 * kept and the later one is flagged — a stable rule that keeps the first
 * rendered candidate on screen while its clones are replaced.
 */
export function findRerollTargets(
  candidates: ReadonlyArray<DiversityCandidate | null | undefined> | null | undefined,
  options: RerollOptions = {},
): string[] {
  if (!Array.isArray(candidates)) return []
  const includeWeak = options.minVerdict === 'weak'
  const flagged: string[] = []
  const seen = new Set<string>()
  for (let later = 1; later < candidates.length; later += 1) {
    const laterId = candidateId(candidates[later] as LooseCandidate | null | undefined, '')
    if (laterId === '' || seen.has(laterId)) continue
    for (let first = 0; first < later; first += 1) {
      const { verdict } = compareCandidates(candidates[first], candidates[later])
      if (verdict === 'near_duplicate' || (includeWeak && verdict === 'weak')) {
        flagged.push(laterId)
        seen.add(laterId)
        break
      }
    }
  }
  return flagged
}
