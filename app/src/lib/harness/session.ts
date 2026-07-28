import { HarnessEventStream } from './events.ts'
import { builderAgentFor } from './agents.ts'
import { compareCandidates, findRerollTargets } from './diversity.ts'
import { BrowserKimiClient, extractStreamingJsonString } from './kimi.ts'
import { createAtomicPlan, normalizePlanCohesion } from './plan-cohesion.ts'
import { builderMessages, directionLayoutGrammar, draftPreviewMessages, fixerMessages, plannerMessages, reviewerMessages, revisionMessages, sharedPreviewProps } from './prompts.ts'
import { parseCandidate, parsePlan, parseReview } from './schemas.ts'
import { TaskScheduler } from './scheduler.ts'
import { harnessStorage } from './storage.ts'
import type {
  CandidateArtifact,
  CandidateVariant,
  CompileResult,
  EventEnvelope,
  HarnessOptions,
  HarnessPhase,
  HarnessSnapshot,
  PagePlan,
  ReviewResult,
  SelectionPatch,
  VisualDirection,
} from './types.ts'

// Lead with the most immediately legible option, then fill in two deliberately
// different alternatives. `generateCandidates` runs these as progressive waves
// so an atomic, single-slot component does not spend three model requests before
// the user sees anything useful.
const VARIANTS: CandidateVariant[] = ['expressive', 'conservative', 'experimental']

// Each candidate job opens two model streams at once (the cheap draft plus the
// full builder), so this caps real request pressure at six concurrent streams —
// enough for one complete specialist team to work in parallel, which is the
// whole point of the product.
const MAX_CONCURRENT_AGENT_JOBS = 3

// A generation run and an individual candidate attempt both outlive the moment
// they stop being current: providers finish buffered responses after Stop, and
// LangGraph resolves `graph.invoke` while its agent nodes are still settling. A
// run that has been replaced must not paint, mutate or emit anything.
function supersededError() {
  return new DOMException('这批生成已被新的请求取代', 'AbortError')
}

function contractUsageErrors(candidate: CandidateArtifact, component: PagePlan['components'][number]) {
  const entry = candidate.files.find((file) => file.path === candidate.entryFile)?.content ?? ''
  const errors: string[] = []
  for (const input of component.inputs) {
    const escaped = input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`\\b${escaped}\\b`).test(entry)) {
      errors.push(`组件合同错误：必须从 props 消费 input「${input.name}」`)
    }
  }
  for (const output of component.outputs) {
    const escaped = output.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const invocation = new RegExp(`(?:\\b${escaped}|props\\s*\\.\\s*${escaped})\\s*(?:\\?\\.)?\\s*\\(`)
    if (!invocation.test(entry)) {
      errors.push(`组件合同错误：必须在真实交互中调用 output 回调「${output.name}(payload)」`)
    }
  }
  return errors
}

function migrateRestoredCandidateOutputs(candidates: CandidateArtifact[], originalPlan: PagePlan, normalizedPlan: PagePlan) {
  const normalizedById = new Map(normalizedPlan.components.map((component) => [component.id, component]))
  const renamesByComponent = new Map<string, Array<{ from: string; to: string }>>()
  for (const original of originalPlan.components) {
    const normalized = normalizedById.get(original.id)
    if (!normalized) continue
    const renames = original.outputs.flatMap((output, index) => {
      const next = normalized.outputs[index]
      return next && next.name !== output.name ? [{ from: output.name, to: next.name }] : []
    })
    if (renames.length) renamesByComponent.set(original.id, renames)
  }
  return candidates.map((candidate) => {
    const renames = renamesByComponent.get(candidate.componentId)
    if (!renames?.length) return candidate
    return {
      ...candidate,
      files: candidate.files.map((file) => ({
        ...file,
        content: renames.reduce((content, rename) => content.replace(
          new RegExp(`\\b${rename.from.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'g'),
          rename.to,
        ), file.content),
      })),
    }
  })
}

export class HarnessSession {
  readonly sessionId: string
  readonly requirement: string
  readonly events: HarnessEventStream

  #options: Required<Pick<HarnessOptions, 'concurrency' | 'retries' | 'maxFixAttempts' | 'candidateCount' | 'persist'>> & HarnessOptions
  #client: BrowserKimiClient
  #abortController = new AbortController()
  #generationController: AbortController | null = null
  // Identity of the generation run that currently owns the rail. Every run mints
  // a fresh id; work that captured an older one is superseded and must stay
  // silent. This is deliberately independent of the abort signal: a run can be
  // replaced while its fire-and-forget draft streams are still open, and those
  // streams see no abort at all.
  #runId: string | null = null
  #generationRunning = false
  #phase: HarnessPhase = 'idle'
  #plan: PagePlan | null = null
  #direction: VisualDirection | null = null
  #candidates = new Map<string, CandidateArtifact>()
  #selections = new Map<string, string>()
  #review: ReviewResult | null = null
  #createdAt: number
  #updatedAt: number

  constructor(requirement: string, options: HarnessOptions, restored?: HarnessSnapshot) {
    this.sessionId = restored?.sessionId ?? crypto.randomUUID()
    this.requirement = requirement
    this.#options = {
      concurrency: options.concurrency ?? 4,
      retries: options.retries ?? 1,
      maxFixAttempts: options.maxFixAttempts ?? 2,
      candidateCount: options.candidateCount ?? 1,
      persist: options.persist ?? true,
      ...options,
    }
    this.#client = new BrowserKimiClient(options.kimi, options.fetchImpl)
    this.events = new HarnessEventStream(this.sessionId, restored?.events)
    this.#createdAt = restored?.createdAt ?? Date.now()
    this.#updatedAt = restored?.updatedAt ?? this.#createdAt
    if (restored) {
      // Network work cannot survive a page refresh. Restore interrupted phases
      // to an honest, resumable selection state instead of showing phantom
      // spinners for requests that no longer exist.
      this.#phase = ['generating', 'reviewing'].includes(restored.phase)
        ? (restored.direction ? 'selecting' : 'awaiting_direction')
        : restored.phase === 'planning'
          ? (restored.plan ? 'awaiting_direction' : 'failed')
          : restored.phase
      // Old snapshots may use value-like output names (`selectedUser`) for an
      // event that feeds a sibling input. Upgrade those contracts on restore so
      // existing generated callbacks (`onSelectedUserChange`) become live
      // bindings instead of leaving restored projects permanently disconnected.
      this.#plan = restored.plan ? normalizePlanCohesion(restored.plan, requirement) : null
      this.#direction = restored.direction
      const restoredCandidates = restored.plan && this.#plan
        ? migrateRestoredCandidateOutputs(restored.candidates, restored.plan, this.#plan)
        : restored.candidates
      this.#candidates = new Map(restoredCandidates.map((candidate) => [candidate.id, candidate]))
      this.#selections = new Map(Object.entries(restored.selections))
      this.#review = restored.review
    }
  }

  static async restore(sessionId: string, options: HarnessOptions) {
    const snapshot = await harnessStorage.load(sessionId)
    if (!snapshot) throw new Error('找不到本地 Harness 会话')
    return new HarnessSession(snapshot.requirement, options, snapshot)
  }

  subscribe(listener: (event: EventEnvelope) => void, after = 0) {
    return this.events.subscribe(listener, after)
  }

  get phase() { return this.#phase }
  get plan() { return this.#plan }
  get direction() { return this.#direction }
  get candidates() { return [...this.#candidates.values()] }
  get selections() { return Object.fromEntries(this.#selections) }

  async start() {
    if (this.#phase !== 'idle' && this.#phase !== 'failed') throw new Error('当前会话不能重新规划')
    this.#phase = 'planning'
    this.events.publish({ type: 'plan.started' }, 'planning')
    await this.#persist()
    try {
      const atomicPlan = createAtomicPlan(this.requirement)
      if (atomicPlan) {
        this.#plan = atomicPlan
        this.#phase = 'awaiting_direction'
        this.events.publish({ type: 'plan.completed', plan: this.#plan }, 'ready')
        await this.#persist()
        return this.#plan
      }
      let receivedChars = 0
      const raw = await this.#client.completeJson(plannerMessages(this.requirement), {
        signal: this.#abortController.signal,
        maxTokens: 3000,
        onDelta: (delta) => {
          receivedChars += delta.length
          if (receivedChars < 240) return
          this.events.publish({ type: 'plan.activity', receivedChars }, 'planning')
          receivedChars = 0
        },
      })
      this.#plan = normalizePlanCohesion(parsePlan(raw), this.requirement)
      this.#phase = 'awaiting_direction'
      this.events.publish({ type: 'plan.completed', plan: this.#plan }, 'ready')
      await this.#persist()
      return this.#plan
    } catch (reason) {
      this.#fail('plan', reason)
      throw reason
    }
  }

  async chooseDirection(directionId: string) {
    if (!this.#plan) throw new Error('请先完成页面规划')
    if (!['awaiting_direction', 'selecting', 'complete'].includes(this.#phase)) throw new Error('当前阶段不能切换设计方向')
    const direction = this.#plan.visualDirections.find((item) => item.id === directionId)
    if (!direction) throw new Error(`不存在设计方向：${directionId}`)
    this.#direction = direction
    this.events.publish({ type: 'direction.selected', direction }, 'selected')
    await this.#persist()
    if (this.#phase === 'awaiting_direction') await this.generateCandidates()
  }

  async chooseVisualDirection(direction: VisualDirection) {
    if (!this.#plan) throw new Error('请先完成页面规划')
    if (!['awaiting_direction', 'selecting', 'complete'].includes(this.#phase)) throw new Error('当前阶段不能切换设计方向')
    this.#direction = direction
    this.events.publish({ type: 'direction.selected', direction }, 'selected')
    await this.#persist()
    if (this.#phase === 'awaiting_direction') await this.generateCandidates()
  }

  async generateCandidates(componentIds?: string[], requestedCount: number = this.#options.candidateCount) {
    if (!this.#plan || !this.#direction) throw new Error('页面计划和设计方向尚未就绪')
    if (this.#generationRunning) throw new Error('已有一批候选正在生成，请先停止或等待完成')
    this.#generationRunning = true
    this.#phase = 'generating'
    this.#generationController = new AbortController()
    const generationSignal = this.#generationController.signal
    const runId = this.#runId = crypto.randomUUID()
    const targets = componentIds?.length
      ? this.#plan.components.filter((component) => componentIds.includes(component.id))
      : this.#plan.components
    const variantsByComponent = new Map(targets.map((component) => {
      const existing = new Set([...this.#candidates.values()]
        .filter((candidate) => candidate.componentId === component.id)
        .map((candidate) => candidate.variant))
      return [component.id, VARIANTS.filter((variant) => !existing.has(variant))
        .slice(0, Math.max(1, Math.min(3, requestedCount)))] as const
    }))
    // Interleave by specialist round instead of exhausting one component first.
    // With a three-job concurrency cap, component-major ordering made the first
    // slot occupy the whole first wave while every other part of the page stayed
    // blank. Round-robin ordering gives each slot its lead candidate before any
    // slot consumes capacity on a second direction.
    const jobs = VARIANTS.flatMap((variant) => targets.flatMap((component) =>
      variantsByComponent.get(component.id)?.includes(variant)
        ? [{ component, variant }]
        : []))
    // Put every specialist on the rail immediately. Execution can still happen
    // in cost-aware waves, but the user should see the full design team and its
    // queued/active state from the first frame instead of discovering agents
    // only after an earlier candidate has completely finished.
    const preparedJobs = jobs.map(({ component, variant }) => {
      const candidateId = `${component.id}-${variant}-${crypto.randomUUID().slice(0, 8)}`
      const taskId = `build:${candidateId}`
      // `candidateId` names the *slot on the rail*; `attemptId` names this
      // particular build of it. A retry, repair or revision replaces the
      // artifact under the same candidateId, so only the attempt id can tell
      // an in-flight continuation that its artifact is gone.
      const attemptId = crypto.randomUUID()
      this.events.publish({
        type: 'component.queued', componentId: component.id, candidateId, variant,
        agent: builderAgentFor(variant),
      }, 'generating')
      return { component, variant, candidateId, taskId, attemptId }
    })
    const invokeAgentGraph = async (graphBatch: typeof preparedJobs) => {
      // Keep LangGraph out of the initial UI bundle; load the browser runtime
      // only after the user has selected a visual direction.
      const { runComponentAgentGraph } = await import('./generation-graph.ts')
      const graphJobs = graphBatch.map(({ component, variant: jobVariant, candidateId, taskId, attemptId }) => {
        return {
          id: taskId,
          variant: jobVariant,
          run: () => this.#buildCandidate({
            componentId: component.id, candidateId, variant: jobVariant, signal: generationSignal, runId, attemptId,
          }),
        }
      })
      return runComponentAgentGraph(graphJobs, {
        signal: generationSignal,
        // Each job opens two model streams at once (the cheap draft plus the
        // full builder), so the graph's job limit is half the real request
        // pressure. Allow one complete specialist team to run concurrently —
        // three jobs, six streams — since seeing all the agents work at once
        // is the product's whole premise. Anything beyond that queues.
        concurrency: Math.max(1, Math.min(this.#options.concurrency, MAX_CONCURRENT_AGENT_JOBS)),
        retries: this.#options.retries,
        onRetry: (taskId, attempt, error) => {
          if (this.#runId !== runId) return
          this.events.publish({ type: 'task.retrying', taskId, attempt, error: error.message }, 'generating')
        },
        onFailed: (taskId, error) => {
          if (this.#runId !== runId) return
          this.events.publish({ type: 'task.failed', taskId, error: error.message }, 'generating')
        },
      })
    }

    try {
      // Every specialist runs concurrently. Serializing them into waves meant a
      // second-wave card sat visibly "queued" for the entire duration of the
      // first build (~44s measured), which reads as a stalled product rather
      // than a design team at work. Request pressure is bounded by the graph's
      // concurrency limit, which the caller sets in terms of real HTTP streams.
      const results = await invokeAgentGraph(preparedJobs)
      if (generationSignal.aborted || this.#runId !== runId) return []
      this.#phase = 'selecting'
      const ready = results.filter((candidate) => this.#candidates.get(candidate.id)?.runtimeStatus === 'rendered').length
      this.events.publish({ type: 'generation.completed', ready, expected: preparedJobs.length }, 'ready')
      await this.#persist()
      this.#reportDuplicateCandidates(targets.map((component) => component.id))
      return results
    } catch (reason) {
      // LangGraph propagates AbortError from graph.invoke even when individual
      // agent nodes correctly suppress their work. User-initiated Stop is a
      // normal terminal path, not a failed generation request — and so is being
      // replaced by a newer run.
      if (generationSignal.aborted || this.#runId !== runId) return []
      throw reason
    } finally {
      this.#generationRunning = false
      // Only the run that still owns the session may clear its identity. A
      // newer run has already installed its own; wiping it here would let this
      // stale run's stragglers pass every `#runId` check that follows.
      if (this.#generationController?.signal === generationSignal) this.#generationController = null
      if (this.#runId === runId) this.#runId = null
    }
  }

  /**
   * Flag candidates that are only superficially different from a sibling.
   *
   * The product's premise is that each slot offers genuinely comparable
   * alternatives; three variations on one layout with a different accent colour
   * is not a choice. This reports the collision so the UI can offer a re-roll —
   * it deliberately does not regenerate automatically, because spending another
   * builder request per duplicate without asking is exactly the runaway cost the
   * blueprint gate is meant to prevent.
   */
  #reportDuplicateCandidates(componentIds: string[]) {
    for (const componentId of componentIds) {
      const rendered = [...this.#candidates.values()]
        .filter((candidate) => candidate.componentId === componentId && candidate.runtimeStatus === 'rendered')
      if (rendered.length < 2) continue
      const duplicates = findRerollTargets(rendered)
      for (const candidateId of duplicates) {
        const candidate = this.#candidates.get(candidateId)
        if (!candidate) continue
        const candidateIndex = rendered.findIndex((item) => item.id === candidateId)
        const comparison = rendered.slice(0, candidateIndex)
          .map((original) => compareCandidates(original, candidate))
          .filter((result) => result.verdict === 'near_duplicate')
          .sort((left, right) => right.score - left.score)[0] ?? null
        this.events.publish({
          type: 'candidate.duplicate',
          componentId,
          candidateId,
          score: comparison?.score ?? 1,
          reason: comparison?.reason ?? '与同槽位的其他方案高度相似',
        }, 'ready')
      }
    }
  }

  /** Replace one candidate in place after the user accepts the extra API cost. */
  async rerollCandidate(candidateId: string) {
    if (!this.#plan || !this.#direction) throw new Error('页面上下文尚未就绪')
    if (this.#generationRunning) throw new Error('仍有候选正在生成，请稍后再换')
    const previous = this.#requireCandidate(candidateId)
    const generationController = new AbortController()
    const generationSignal = generationController.signal
    const runId = crypto.randomUUID()
    const attemptId = crypto.randomUUID()
    this.#generationController = generationController
    this.#runId = runId
    this.#generationRunning = true
    this.#phase = 'generating'
    this.events.publish({
      type: 'candidate.rerolling', componentId: previous.componentId, candidateId,
    }, 'generating')

    try {
      const { runComponentAgentGraph } = await import('./generation-graph.ts')
      const results = await runComponentAgentGraph([{
        id: `reroll:${candidateId}`,
        variant: previous.variant,
        run: () => this.#buildCandidate({
          componentId: previous.componentId,
          candidateId,
          variant: previous.variant,
          signal: generationSignal,
          runId,
          attemptId,
        }),
      }], {
        signal: generationSignal,
        concurrency: 1,
        retries: this.#options.retries,
        onRetry: (taskId, attempt, error) => {
          if (this.#runId !== runId) return
          this.events.publish({ type: 'task.retrying', taskId, attempt, error: error.message }, 'generating')
        },
        onFailed: (taskId, error) => {
          if (this.#runId !== runId) return
          this.events.publish({ type: 'task.failed', taskId, error: error.message }, 'generating')
        },
      })
      if (generationSignal.aborted || this.#runId !== runId) return null
      this.#phase = 'selecting'
      await this.#persist()
      this.#reportDuplicateCandidates([previous.componentId])
      return results[0] ?? null
    } catch (reason) {
      if (!generationSignal.aborted && this.#runId === runId) this.#phase = 'selecting'
      throw reason
    } finally {
      this.#generationRunning = false
      if (this.#generationController?.signal === generationSignal) this.#generationController = null
      if (this.#runId === runId) this.#runId = null
    }
  }

  async #buildCandidate(job: {
    componentId: string
    candidateId: string
    variant: CandidateVariant
    signal: AbortSignal
    runId: string
    attemptId: string
  }) {
    const { componentId, candidateId, variant, signal, runId, attemptId } = job
    if (!this.#plan || !this.#direction) throw new Error('Harness context is incomplete')
    const component = this.#plan.components.find((item) => item.id === componentId)
    if (!component) throw new Error(`不存在组件合同：${componentId}`)
    if (this.#runId !== runId) throw supersededError()
    this.events.publish({ type: 'component.started', componentId, candidateId }, 'generating')
    let receivedChars = 0
    let streamedResponse = ''
    let sourceReady = false
    // The cheap draft and the full builder stream concurrently and both produce
    // a `previewHtml`. They used to share one published-length counter, so they
    // suppressed each other and alternately pushed two *different* documents
    // into the same preview — the sketch visibly flip-flopped between them.
    // Track them separately, and let the builder win permanently once it paints:
    // it is the document that will actually become the component.
    const publishedLength = { draft: 0, builder: 0 }
    let builderOwnsPreview = false
    const publishStreamingPreview = (response: string, source: 'draft' | 'builder') => {
      if (sourceReady || signal.aborted) return
      // Once the builder has painted, the draft must never reclaim the preview:
      // the builder's document is the one that becomes the component, and a
      // late-finishing draft is both older and shorter.
      if (source === 'draft' && builderOwnsPreview) return
      // The draft stream is fire-and-forget and never observes an abort, so a
      // run that has been replaced would otherwise keep painting sketches into
      // a rail that now belongs to a different generation.
      if (this.#runId !== runId) return
      const preview = extractStreamingJsonString(response, 'previewHtml')
      const visibleText = preview.value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      if (visibleText.length < 2 || preview.value.length < 48) return
      if (!preview.complete && preview.value.length - publishedLength[source] < 96) return
      publishedLength[source] = preview.value.length
      if (source === 'builder') builderOwnsPreview = true
      this.events.publish({
        type: 'preview.updated', componentId, candidateId, html: preview.value, complete: preview.complete,
      }, 'generating')
    }
    let draftResponse = ''
    void this.#client.completeJson(draftPreviewMessages({
      requirement: this.requirement,
      plan: this.#plan,
      direction: this.#direction,
      component,
      variant,
    }), {
      signal,
      model: this.#options.kimi.model,
      maxTokens: 900,
      onDelta: (delta) => {
        draftResponse += delta
        publishStreamingPreview(draftResponse, 'draft')
      },
    }).catch(() => null)
    const raw = await this.#client.completeJson(builderMessages({
      requirement: this.requirement,
      plan: this.#plan,
      direction: this.#direction,
      component,
      variant,
    }), {
      signal,
      model: this.#options.kimi.codeModel,
      maxTokens: 6000,
      onDelta: (delta) => {
        streamedResponse += delta
        publishStreamingPreview(streamedResponse, 'builder')
        receivedChars += delta.length
        if (receivedChars < 320) return
        if (this.#runId !== runId) return
        this.events.publish({ type: 'component.activity', componentId, candidateId, receivedChars }, 'generating')
        receivedChars = 0
      },
    })
    if (signal.aborted) throw signal.reason ?? new DOMException('生成已停止', 'AbortError')
    // A provider that ignores AbortSignal finishes its buffered response long
    // after Stop or a replacing run. Re-check before latching `sourceReady`,
    // which is itself a mutation of this closure's publishing contract.
    if (this.#runId !== runId) throw supersededError()
    sourceReady = true
    const candidate = parseCandidate(raw, {
      id: candidateId, componentId, variant, agent: builderAgentFor(variant), attemptId,
    })
    candidate.previewProps = { ...candidate.previewProps, ...sharedPreviewProps(this.#plan, this.requirement) }
    // Last checkpoint before the artifact becomes session state. Parsing is
    // synchronous, but `parseCandidate` runs after two awaited streams, so the
    // run can have been replaced between the check above and this line only via
    // a synchronous caller — checking again is free and keeps the invariant
    // local to the mutation it protects.
    if (this.#runId !== runId) throw supersededError()
    this.#candidates.set(candidateId, candidate)
    for (const file of candidate.files) {
      this.events.publish({ type: 'file.created', candidateId, path: file.path }, 'generating')
      for (let offset = 0; offset < file.content.length; offset += 1200) {
        this.events.publish({ type: 'code.delta', candidateId, path: file.path, delta: file.content.slice(offset, offset + 1200) }, 'generating')
      }
    }
    this.events.publish({ type: 'source.ready', candidate }, 'compiling')
    await this.#persist()
    if (this.#options.runtime) await this.#compile(candidateId, signal)
    return candidate
  }

  /**
   * Apply a compile verdict to a candidate.
   *
   * `expectedAttemptId` is the `attemptId` of the artifact the compile was run
   * against. Compilation is asynchronous and the artifact underneath a
   * candidate slot can be replaced while it runs (repair, revision, rebuild),
   * so a caller that holds an artifact should pass its id: a verdict about a
   * dead build must never be stamped onto the live one. Omitting it keeps the
   * unconditional legacy behaviour.
   */
  async reportCompile(candidateId: string, result: CompileResult, expectedAttemptId?: string) {
    if (expectedAttemptId !== undefined && !this.#isCurrentAttempt(candidateId, expectedAttemptId)) return
    const candidate = this.#requireCandidate(candidateId)
    if (result.ok) {
      candidate.runtimeStatus = 'rendered'
      candidate.compileErrors = []
      this.events.publish({ type: 'compile.succeeded', candidateId }, 'ready')
      this.events.publish({ type: 'render.ready', candidateId }, 'ready')
    } else {
      const errors = result.errors?.length ? result.errors : ['未知编译错误']
      candidate.runtimeStatus = 'compile_failed'
      candidate.compileErrors = errors
      this.events.publish({ type: 'compile.failed', candidateId, errors }, 'compiling')
      await this.#repair(candidate, errors, this.#generationController?.signal ?? this.#abortController.signal)
    }
    await this.#persist()
  }

  async #compile(candidateId: string, signal: AbortSignal) {
    const candidate = this.#requireCandidate(candidateId)
    const runtime = this.#options.runtime
    if (!runtime) return
    const component = this.#plan?.components.find((item) => item.id === candidate.componentId)
    const contractErrors = component ? contractUsageErrors(candidate, component) : []
    if (contractErrors.length) {
      candidate.runtimeStatus = 'compile_failed'
      candidate.compileErrors = contractErrors
      this.events.publish({ type: 'compile.failed', candidateId, errors: contractErrors }, 'compiling')
      await this.#repair(candidate, contractErrors, signal)
      return
    }
    const attemptId = candidate.attemptId
    candidate.runtimeStatus = 'compiling'
    this.events.publish({ type: 'compile.started', candidateId }, 'compiling')
    const result = await runtime.compile(candidate, signal)
    if (signal.aborted) return
    // The artifact that was handed to the runtime may have been replaced while
    // it compiled; its verdict describes source that no longer exists.
    if (!this.#isCurrentAttempt(candidateId, attemptId)) return
    await this.reportCompile(candidateId, result, attemptId)
  }

  async #repair(candidate: CandidateArtifact, errors: string[], signal: AbortSignal) {
    if (!this.#plan || !this.#direction) return
    if (candidate.fixAttempts >= this.#options.maxFixAttempts) {
      this.events.publish({ type: 'repair.exhausted', candidateId: candidate.id, errors }, 'compiling')
      return
    }
    // Identity of the artifact being repaired. The fixer request below is a
    // full model round trip, and a revision or rebuild can land in that window.
    const attemptId = candidate.attemptId
    if (!this.#isCurrentAttempt(candidate.id, attemptId)) return
    candidate.fixAttempts += 1
    this.events.publish({ type: 'repair.started', candidateId: candidate.id, attempt: candidate.fixAttempts }, 'compiling')
    const component = this.#plan.components.find((item) => item.id === candidate.componentId)
    if (!component) throw new Error(`不存在组件合同：${candidate.componentId}`)
    const raw = await this.#client.completeJson(fixerMessages({ component, direction: this.#direction, candidate, errors }), {
      signal,
      model: this.#options.kimi.codeModel,
      maxTokens: 6000,
    })
    if (signal.aborted) return
    if (!this.#isCurrentAttempt(candidate.id, attemptId)) return
    const fixed = parseCandidate(raw, {
      id: candidate.id, componentId: candidate.componentId, variant: candidate.variant,
      agent: candidate.agent ?? builderAgentFor(candidate.variant),
      // A repair produces a new artifact, so it gets a new attempt identity:
      // anything still awaiting a verdict on the broken source is now stale.
      attemptId: crypto.randomUUID(),
    })
    this.#assertSameFileBoundary(candidate, fixed)
    fixed.fixAttempts = candidate.fixAttempts
    // Re-checked immediately before the mutation itself: `parseCandidate` and
    // the boundary assertion are synchronous, but keeping the guard adjacent to
    // the write is what makes the invariant local and hard to regress.
    if (!this.#isCurrentAttempt(candidate.id, attemptId)) return
    this.#candidates.set(candidate.id, fixed)
    this.events.publish({ type: 'repair.completed', candidate: fixed }, 'ready')
    await this.#persist()
    if (this.#options.runtime) await this.#compile(candidate.id, signal)
  }

  async select(componentId: string, candidateId: string) {
    if (!this.#plan) throw new Error('页面计划尚未就绪')
    const candidate = this.#requireCandidate(candidateId)
    if (candidate.componentId !== componentId) throw new Error('候选不属于这个组件槽位')
    if (candidate.runtimeStatus !== 'rendered') throw new Error('候选必须成功编译并渲染后才能确认')
    const previousCandidateId = this.#selections.get(componentId)
    this.#selections.set(componentId, candidateId)
    const patch: SelectionPatch = { slot: componentId, previousCandidateId, selectedCandidateId: candidateId, timestamp: Date.now() }
    this.events.publish({ type: 'selection.committed', patch }, 'selected')
    await this.#persist()
    return patch
  }

  async undoSelection(componentId: string) {
    const candidateId = this.#selections.get(componentId)
    this.#selections.delete(componentId)
    this.events.publish({ type: 'selection.reverted', componentId, candidateId }, 'selected')
    await this.#persist()
  }

  async revise(instruction: string, componentIds?: string[]) {
    if (!instruction.trim()) throw new Error('修改要求不能为空')
    if (!this.#plan || !this.#direction) throw new Error('页面上下文尚未就绪')
    const targets = componentIds?.length ? componentIds : [...this.#selections.keys()]
    if (!targets.length) throw new Error('没有可修改的已选组件')
    this.events.publish({ type: 'revision.started', instruction, componentIds: targets }, 'generating')
    const scheduler = new TaskScheduler<CandidateArtifact>({
      concurrency: this.#options.concurrency,
      retries: this.#options.retries,
      signal: this.#abortController.signal,
      onRetry: (taskId, attempt, error) => this.events.publish({ type: 'task.retrying', taskId, attempt, error: error.message }, 'generating'),
      onFailed: (taskId, error) => this.events.publish({ type: 'task.failed', taskId, error: error.message }, 'generating'),
    })
    for (const componentId of targets) {
      const selectedId = this.#selections.get(componentId)
      if (!selectedId) continue
      scheduler.add({
        id: `revise:${selectedId}`,
        run: async (signal) => this.#reviseCandidate(selectedId, instruction, signal),
      })
    }
    const results = await scheduler.run()
    await this.#persist()
    return results
  }

  async restyleCandidates(direction: VisualDirection, candidateIds: string[]) {
    if (!this.#plan) throw new Error('页面上下文尚未就绪')
    if (!['selecting', 'complete'].includes(this.#phase)) throw new Error('请等待当前候选生成结束后再切换设计分支')
    const targets = [...new Set(candidateIds)].filter((candidateId) => this.#candidates.has(candidateId))
    const previousDirection = this.#direction
    const originals = new Map(targets.map((candidateId) => [candidateId, this.#requireCandidate(candidateId)]))
    this.#direction = direction
    this.#review = null
    this.events.publish({ type: 'direction.selected', direction }, 'selected')
    if (!targets.length) {
      await this.#persist()
      return []
    }
    const instruction = [
      `把当前组件完整迁移到设计分支「${direction.name}」：${direction.visualDNA.concept}。`,
      `构图规则：${direction.visualDNA.compositionRules.join('；')}。`,
      `目标分支的强制布局语法：${directionLayoutGrammar(direction.id).join('；')}。`,
      '这不是换色任务。必须明显重做根布局、信息分组、控件形态、间距密度和交互反馈，使切换前后即使截图转为灰度也能看出结构差异。',
      '至少改变一个主要分组的空间位置、宽度关系或跨列方式；不得保留原组件的根层级结构后只替换 className。',
      '移除上一设计分支特有的布局语言；保留组件合同、业务内容、input/output 名称和文件边界。',
      '组件是整页中的可嵌入槽位：禁止 min-h-screen、100vh、fixed 全屏、独立页面背景、重复导航或重复页面外壳；根节点背景保持透明，由整页 Visual DNA 底板统一提供。',
    ].join('\n')
    this.events.publish({
      type: 'revision.started',
      instruction,
      componentIds: targets.map((candidateId) => this.#requireCandidate(candidateId).componentId),
    }, 'generating')
    const scheduler = new TaskScheduler<CandidateArtifact>({
      concurrency: Math.min(this.#options.concurrency, 3),
      retries: this.#options.retries,
      signal: this.#abortController.signal,
      onRetry: (taskId, attempt, error) => this.events.publish({ type: 'task.retrying', taskId, attempt, error: error.message }, 'generating'),
      onFailed: (taskId, error) => this.events.publish({ type: 'task.failed', taskId, error: error.message }, 'generating'),
    })
    for (const candidateId of targets) {
      scheduler.add({
        id: `restyle:${candidateId}`,
        run: async (signal) => this.#reviseCandidate(candidateId, instruction, signal),
      })
    }
    const results = await scheduler.run()
    if (results.length !== targets.length) {
      this.#direction = previousDirection
      for (const [candidateId, candidate] of originals) {
        this.#candidates.set(candidateId, candidate)
        this.events.publish({ type: 'revision.completed', candidate }, 'ready')
        if (candidate.runtimeStatus === 'rendered') this.events.publish({ type: 'render.ready', candidateId }, 'ready')
      }
      if (previousDirection) this.events.publish({ type: 'direction.selected', direction: previousDirection }, 'selected')
      await this.#persist()
      throw new Error(`设计分支迁移未完整通过（${results.length}/${targets.length}），已恢复原分支和全部候选`)
    }
    await this.#persist()
    return results
  }

  async #reviseCandidate(candidateId: string, instruction: string, signal: AbortSignal) {
    if (!this.#plan || !this.#direction) throw new Error('页面上下文尚未就绪')
    const current = this.#requireCandidate(candidateId)
    const component = this.#plan.components.find((item) => item.id === current.componentId)
    if (!component) throw new Error(`不存在组件合同：${current.componentId}`)
    try {
      const raw = await this.#client.completeJson(revisionMessages({
        instruction,
        requirement: this.requirement,
        component,
        direction: this.#direction,
        candidate: current,
      }), {
        signal,
        model: this.#options.kimi.codeModel,
        maxTokens: 6000,
      })
      const revised = parseCandidate(raw, {
        id: current.id, componentId: current.componentId, variant: current.variant,
        agent: current.agent ?? builderAgentFor(current.variant),
        // A revision replaces the artifact, so it takes a new attempt identity.
        // Without one the revised candidate would carry no identity at all and
        // every later guard against it would degrade to "unknown".
        attemptId: crypto.randomUUID(),
      })
      this.#assertSameFileBoundary(current, revised)
      revised.fixAttempts = current.fixAttempts
      const usageErrors = contractUsageErrors(revised, component)
      if (usageErrors.length) throw new Error(usageErrors.join('\n'))
      if (this.#options.runtime) {
        revised.runtimeStatus = 'compiling'
        this.events.publish({ type: 'compile.started', candidateId }, 'compiling')
        const result = await this.#options.runtime.compile(revised, signal)
        if (!result.ok) throw new Error(result.errors?.join('\n') || 'Revision 编译失败')
        revised.runtimeStatus = 'rendered'
      }
      this.#candidates.set(candidateId, revised)
      this.events.publish({ type: 'revision.completed', candidate: revised }, 'ready')
      if (revised.runtimeStatus === 'rendered') this.events.publish({ type: 'render.ready', candidateId }, 'ready')
      return revised
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.events.publish({ type: 'revision.failed', candidateId, error: error.message }, 'compiling')
      throw error
    }
  }

  async review(screenshot?: string) {
    if (!this.#plan || !this.#direction) throw new Error('页面上下文尚未就绪')
    if (this.#selections.size !== this.#plan.components.length) throw new Error('请先为所有组件槽位确认候选')
    this.#phase = 'reviewing'
    this.events.publish({ type: 'review.started' }, 'reviewing')
    const selectedCandidates = this.#plan.components.flatMap((contract) => {
      const candidateId = this.#selections.get(contract.id)
      if (!candidateId) return []
      const candidate = this.#requireCandidate(candidateId)
      return [{
        componentId: contract.id,
        candidateId,
        contract,
        previewProps: candidate.previewProps,
        files: candidate.files,
      }]
    })
    const raw = await this.#client.completeJson(reviewerMessages({
      requirement: this.requirement,
      plan: this.#plan,
      direction: this.#direction,
      selections: Object.fromEntries(this.#selections),
      selectedCandidates,
      screenshot,
    }), { signal: this.#abortController.signal, maxTokens: 2500 })
    const parsedReview = parseReview(raw)
    // Model output is advisory. Enforce both the patch and component limits in
    // code so a broad `page` suggestion cannot silently fan out across a large
    // plan or turn the final pass into a costly whole-project rewrite.
    const patches = parsedReview.patches.slice(0, 3)
    const validComponentIds = new Set(this.#plan.components.map((component) => component.id))
    const patchesByComponent = new Map<string, typeof patches>()
    const addPatch = (componentId: string, patch: (typeof patches)[number]) => {
      if (!validComponentIds.has(componentId) || !this.#selections.has(componentId)) return
      const current = patchesByComponent.get(componentId)
      if (current) current.push(patch)
      else if (patchesByComponent.size < 3) patchesByComponent.set(componentId, [patch])
    }
    for (const patch of patches) {
      if (patch.target === 'page') {
        for (const component of this.#plan.components) addPatch(component.id, patch)
      } else {
        addPatch(patch.target, patch)
      }
    }

    const scheduler = new TaskScheduler<CandidateArtifact>({
      concurrency: Math.min(this.#options.concurrency, 3),
      retries: this.#options.retries,
      signal: this.#abortController.signal,
      onRetry: (taskId, attempt, error) => this.events.publish({ type: 'task.retrying', taskId, attempt, error: error.message }, 'reviewing'),
      onFailed: (taskId, error) => this.events.publish({ type: 'task.failed', taskId, error: error.message }, 'reviewing'),
    })
    for (const [componentId, componentPatches] of patchesByComponent) {
      const candidateId = this.#selections.get(componentId)
      if (!candidateId) continue
      const instruction = componentPatches.map((patch) => {
        const explicitInstruction = typeof patch.value === 'object' && patch.value !== null && 'instruction' in patch.value
          ? String((patch.value as { instruction?: unknown }).instruction ?? '')
          : ''
        return `[${patch.type}] ${explicitInstruction || patch.reason}`
      }).join('\n')
      scheduler.add({
        id: `review-revise:${candidateId}`,
        run: async (signal) => this.#reviseCandidate(candidateId, `整页审查后的槽位级优化：\n${instruction}`, signal),
      })
    }
    const revised = await scheduler.run()
    const appliedComponentIds = revised.map((candidate) => candidate.componentId)
    const failedComponentIds = [...patchesByComponent.keys()].filter((componentId) => !appliedComponentIds.includes(componentId))
    this.#review = { ...parsedReview, patches, appliedComponentIds, failedComponentIds }
    this.#phase = 'complete'
    this.events.publish({ type: 'review.completed', review: this.#review }, 'ready')
    await this.#persist()
    return this.#review
  }

  stopGeneration() {
    if (!this.#generationController) return
    this.#generationController.abort()
    this.#phase = 'selecting'
    this.events.publish({ type: 'generation.cancelled' }, 'selected')
  }

  cancel() {
    if (['complete', 'cancelled'].includes(this.#phase)) return
    this.#phase = 'cancelled'
    this.#abortController.abort()
    this.#generationController?.abort()
    this.events.publish({ type: 'generation.cancelled' }, 'selected')
    void this.#persist()
  }

  snapshot(): HarnessSnapshot {
    return {
      version: 1,
      sessionId: this.sessionId,
      requirement: this.requirement,
      phase: this.#phase,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      plan: this.#plan,
      direction: this.#direction,
      candidates: [...this.#candidates.values()],
      selections: Object.fromEntries(this.#selections),
      review: this.#review,
      events: this.events.all(),
    }
  }

  exportJson() {
    return JSON.stringify({ product: '今天选什么？', exportedAt: new Date().toISOString(), ...this.snapshot() }, null, 2)
  }

  #requireCandidate(candidateId: string) {
    const candidate = this.#candidates.get(candidateId)
    if (!candidate) throw new Error(`不存在候选：${candidateId}`)
    return candidate
  }

  /**
   * Is `attemptId` still the artifact living under `candidateId`?
   *
   * A missing candidate is never current — the slot was cleared out from under
   * the caller. A restored v1 snapshot carries no `attemptId`, so work started
   * against it compares `undefined` to `undefined` and is treated as current;
   * that is the pre-existing behaviour and the only case where identity is
   * genuinely unknown rather than stale.
   */
  #isCurrentAttempt(candidateId: string, attemptId: string | undefined) {
    const candidate = this.#candidates.get(candidateId)
    if (!candidate) return false
    return candidate.attemptId === attemptId
  }

  #assertSameFileBoundary(previous: CandidateArtifact, next: CandidateArtifact) {
    const oldPaths = new Set(previous.files.map((file) => file.path))
    const newPaths = new Set(next.files.map((file) => file.path))
    if (oldPaths.size !== newPaths.size || [...newPaths].some((path) => !oldPaths.has(path))) {
      throw new Error('模型改变了候选文件边界，已拒绝应用')
    }
  }

  #fail(taskId: string, reason: unknown) {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    if (this.#abortController.signal.aborted) return
    this.#phase = 'failed'
    this.events.publish({ type: 'task.failed', taskId, error: error.message }, 'generating')
    void this.#persist()
  }

  async #persist() {
    this.#updatedAt = Date.now()
    if (this.#options.persist) await harnessStorage.save(this.snapshot())
  }
}
