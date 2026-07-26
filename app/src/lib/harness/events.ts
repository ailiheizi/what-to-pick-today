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

export class HarnessEventStream extends EventTarget {
  readonly sessionId: string
  #events: EventEnvelope[]

  constructor(sessionId: string, restored: EventEnvelope[] = []) {
    super()
    this.sessionId = sessionId
    this.#events = [...restored]
  }

  publish(event: GenerationEvent, phase: MotionPhase): EventEnvelope {
    const sequence = this.#events.length + 1
    const envelope: EventEnvelope = {
      sessionId: this.sessionId,
      sequence,
      timestamp: Date.now(),
      motionCue: cueFor(this.sessionId, sequence, phase),
      event,
    }
    this.#events.push(envelope)
    this.dispatchEvent(new CustomEvent<EventEnvelope>('generation', { detail: envelope }))
    return envelope
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
