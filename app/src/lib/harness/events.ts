import type { EventEnvelope, GenerationEvent, MotionPhase } from './types.ts'

const MOTION_CUES: Record<MotionPhase, string[]> = {
  planning: ['orbit-dots', 'folding-cards', 'wand-trail', 'bouncy-blueprint'],
  generating: ['assembling-blocks', 'liquid-progress', 'pixel-garden', 'magnetic-parts', 'paper-cut-build'],
  compiling: ['breathing-rings', 'code-rain-soft', 'shape-morph'],
  ready: ['pop-confetti', 'spring-arrival', 'soft-flip', 'magnetic-snap'],
  selected: ['magnetic-snap', 'jelly-lock', 'block-click', 'ripple-confirm'],
  reviewing: ['scanner-sweep', 'magnifier-walk', 'sparkle-inspection'],
}

function hash(text: string) {
  let value = 2166136261
  for (const char of text) {
    value ^= char.charCodeAt(0)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function cueFor(sessionId: string, sequence: number, phase: MotionPhase) {
  const choices = MOTION_CUES[phase]
  return choices[hash(`${sessionId}:${sequence}:${phase}`) % choices.length] ?? choices[0]
}

// A long generation publishes one `preview.updated` per streaming delta, each
// carrying a full HTML draft, plus `code.delta` slices for every file. The whole
// event log is re-serialized into the IndexedDB snapshot on every persist, so
// retaining those verbatim grows the write payload without bound. Live
// subscribers still receive every event; only what is *kept* is compacted.
const MAX_RETAINED = 4000

function candidateOf(event: GenerationEvent): string | null {
  switch (event.type) {
    case 'preview.updated':
    case 'code.delta':
      return event.candidateId
    case 'source.ready':
      return event.candidate.id
    default:
      return null
  }
}

export class HarnessEventStream extends EventTarget {
  readonly sessionId: string
  #events: EventEnvelope[]
  #sequence: number

  constructor(sessionId: string, restored: EventEnvelope[] = []) {
    super()
    this.sessionId = sessionId
    this.#events = [...restored]
    // Derive from the highest restored sequence rather than the array length:
    // a compacted history has fewer entries than sequences issued, and using
    // the length would re-issue numbers that already exist.
    this.#sequence = restored.reduce((highest, event) => Math.max(highest, event.sequence), 0)
  }

  publish(event: GenerationEvent, phase: MotionPhase): EventEnvelope {
    const sequence = this.#sequence += 1
    const envelope: EventEnvelope = {
      sessionId: this.sessionId,
      sequence,
      timestamp: Date.now(),
      motionCue: cueFor(this.sessionId, sequence, phase),
      event,
    }
    this.#retain(envelope)
    // Always dispatch the untouched envelope — the UI animates the streaming
    // sketch from the full `preview.updated` payload.
    this.dispatchEvent(new CustomEvent<EventEnvelope>('generation', { detail: envelope }))
    return envelope
  }

  #retain(envelope: EventEnvelope) {
    const event = envelope.event
    const candidateId = candidateOf(event)

    if (event.type === 'preview.updated') {
      // Only the newest sketch per candidate is worth keeping.
      this.#drop((kept) => kept.type === 'preview.updated' && kept.candidateId === candidateId)
      this.#push(envelope)
      return
    }

    if (event.type === 'code.delta') {
      // Keep one marker per file so a failed run still shows which files were
      // being written, but drop the slice itself — `source.ready` carries the
      // full content, and the store rebuilds `code` from it on replay.
      this.#drop((kept) => kept.type === 'code.delta'
        && kept.candidateId === candidateId
        && kept.path === event.path)
      this.#push({ ...envelope, event: { ...event, delta: '' } })
      return
    }

    if (event.type === 'source.ready') {
      // The artifact now carries every file verbatim, so the streaming trace
      // for this candidate is pure overhead.
      this.#drop((kept) => (kept.type === 'preview.updated' || kept.type === 'code.delta')
        && kept.candidateId === candidateId)
    }

    this.#push(envelope)
  }

  #drop(match: (event: GenerationEvent) => boolean) {
    this.#events = this.#events.filter((envelope) => !match(envelope.event))
  }

  #push(envelope: EventEnvelope) {
    this.#events.push(envelope)
    if (this.#events.length > MAX_RETAINED) {
      this.#events = this.#events.slice(this.#events.length - MAX_RETAINED)
    }
  }

  subscribe(listener: (envelope: EventEnvelope) => void, after = 0) {
    this.after(after).forEach(listener)
    const handler = (event: Event) => listener((event as CustomEvent<EventEnvelope>).detail)
    this.addEventListener('generation', handler)
    return () => this.removeEventListener('generation', handler)
  }

  after(sequence = 0) {
    return this.#events.filter((event) => event.sequence > sequence)
  }

  all() {
    return [...this.#events]
  }
}
