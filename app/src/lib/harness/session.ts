import { HarnessEventStream } from './events.ts'
import { builderAgentFor } from './agents.ts'
import { BrowserKimiClient, extractStreamingJsonString } from './kimi.ts'
import { createAtomicPlan, normalizePlanCohesion } from './plan-cohesion.ts'
import { builderMessages, draftPreviewMessages, fixerMessages, plannerMessages, reviewerMessages, revisionMessages } from './prompts.ts'
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

export class HarnessSession {
  readonly sessionId: string
  readonly requirement: string
  readonly events: HarnessEventStream

  #options: Required<Pick<HarnessOptions, 'concurrency' | 'retries' | 'maxFixAttempts' | 'candidateCount' | 'persist'>> & HarnessOptions
  #client: BrowserKimiClient
  #abortController = new AbortController()
  #generationController: AbortController | null = null
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
      candidateCount: options.candidateCount ?? 3,
      persist: options.persist ?? true,
      ...options,
    }
    this.#client = new BrowserKimiClient(options.kimi, options.fetchImpl)
    this.events = new HarnessEventStream(this.sessionId, restored?.events)
    this.#createdAt = restored?.createdAt ?? Date.now()
    this.#updatedAt = restored?.updatedAt ?? this.#createdAt
    if (restored) {
      this.#phase = restored.phase
      this.#plan = restored.plan
      this.#direction = restored.direction
      this.#candidates = new Map(restored.candidates.map((candidate) => [candidate.id, candidate]))
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

  async generateCandidates(componentIds?: string[]) {
    if (!this.#plan || !this.#direction) throw new Error('页面计划和设计方向尚未就绪')
    if (this.#generationRunning) throw new Error('已有一批候选正在生成，请先停止或等待完成')
    this.#generationRunning = true
    this.#phase = 'generating'
    this.#generationController = new AbortController()
    const generationSignal = this.#generationController.signal
    const targets = componentIds?.length
      ? this.#plan.components.filter((component) => componentIds.includes(component.id))
      : this.#plan.components
    const jobs = targets.flatMap((component) => {
      const existing = new Set([...this.#candidates.values()]
        .filter((candidate) => candidate.componentId === component.id)
        .map((candidate) => candidate.variant))
      return VARIANTS.filter((variant) => !existing.has(variant))
        .slice(0, this.#options.candidateCount)
        .map((variant) => ({ component, variant }))
    })
    // Put every specialist on the rail immediately. Execution can still happen
    // in cost-aware waves, but the user should see the full design team and its
    // queued/active state from the first frame instead of discovering agents
    // only after an earlier candidate has completely finished.
    const preparedJobs = jobs.map(({ component, variant }) => {
      const candidateId = `${component.id}-${variant}-${crypto.randomUUID().slice(0, 8)}`
      const taskId = `build:${candidateId}`
      this.events.publish({
        type: 'component.queued', componentId: component.id, candidateId, variant,
        agent: builderAgentFor(variant),
      }, 'generating')
      return { component, variant, candidateId, taskId }
    })
    const invokeAgentGraph = async (graphBatch: typeof preparedJobs) => {
      // Keep LangGraph out of the initial UI bundle; load the browser runtime
      // only after the user has selected a visual direction.
      const { runComponentAgentGraph } = await import('./generation-graph.ts')
      const graphJobs = graphBatch.map(({ component, variant: jobVariant, candidateId, taskId }) => {
        return {
          id: taskId,
          variant: jobVariant,
          run: () => this.#buildCandidate(component.id, candidateId, jobVariant, generationSignal),
        }
      })
      return runComponentAgentGraph(graphJobs, {
        signal: generationSignal,
        concurrency: this.#options.concurrency,
        retries: this.#options.retries,
        onRetry: (taskId, attempt, error) => {
          this.events.publish({ type: 'task.retrying', taskId, attempt, error: error.message }, 'generating')
        },
        onFailed: (taskId, error) => {
          this.events.publish({ type: 'task.failed', taskId, error: error.message }, 'generating')
        },
      })
    }

    try {
      // A single atomic slot benefits from two immediately comparable opinions.
      // Larger pages stay at one active agent per slot to keep request pressure
      // bounded; all remaining agents are already visible as queued cards.
      const leadVariantCount = targets.length === 1 ? Math.min(2, this.#options.candidateCount) : 1
      const leadVariants = new Set(VARIANTS.slice(0, leadVariantCount))
      const firstWave = preparedJobs.filter((job) => leadVariants.has(job.variant))
      const laterWave = preparedJobs.filter((job) => !leadVariants.has(job.variant))
      const results = [
        ...(firstWave.length ? await invokeAgentGraph(firstWave) : []),
        ...(generationSignal.aborted || !laterWave.length ? [] : await invokeAgentGraph(laterWave)),
      ]
      if (generationSignal.aborted) return []
      this.#phase = 'selecting'
      const ready = results.filter((candidate) => this.#candidates.get(candidate.id)?.runtimeStatus === 'rendered').length
      this.events.publish({ type: 'generation.completed', ready, expected: preparedJobs.length }, 'ready')
      await this.#persist()
      return results
    } catch (reason) {
      // LangGraph propagates AbortError from graph.invoke even when individual
      // agent nodes correctly suppress their work. User-initiated Stop is a
      // normal terminal path, not a failed generation request.
      if (generationSignal.aborted) return []
      throw reason
    } finally {
      this.#generationRunning = false
      if (this.#generationController?.signal === generationSignal) this.#generationController = null
    }
  }

  async #buildCandidate(componentId: string, candidateId: string, variant: CandidateVariant, signal: AbortSignal) {
    if (!this.#plan || !this.#direction) throw new Error('Harness context is incomplete')
    const component = this.#plan.components.find((item) => item.id === componentId)
    if (!component) throw new Error(`不存在组件合同：${componentId}`)
    this.events.publish({ type: 'component.started', componentId, candidateId }, 'generating')
    let receivedChars = 0
    let streamedResponse = ''
    let publishedPreviewLength = 0
    let sourceReady = false
    const publishStreamingPreview = (response: string) => {
      if (sourceReady || signal.aborted) return
      const preview = extractStreamingJsonString(response, 'previewHtml')
      const visibleText = preview.value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      if (visibleText.length < 2 || preview.value.length < 48) return
      if (!preview.complete && preview.value.length - publishedPreviewLength < 96) return
      publishedPreviewLength = preview.value.length
      this.events.publish({
        type: 'preview.updated', componentId, candidateId, html: preview.value, complete: preview.complete,
      }, 'generating')
    }
    let draftResponse = ''
    void this.#client.completeJson(draftPreviewMessages({
      requirement: this.requirement,
      direction: this.#direction,
      component,
      variant,
    }), {
      signal,
      model: this.#options.kimi.model,
      maxTokens: 900,
      onDelta: (delta) => {
        draftResponse += delta
        publishStreamingPreview(draftResponse)
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
        publishStreamingPreview(streamedResponse)
        receivedChars += delta.length
        if (receivedChars < 320) return
        this.events.publish({ type: 'component.activity', componentId, candidateId, receivedChars }, 'generating')
        receivedChars = 0
      },
    })
    if (signal.aborted) throw signal.reason ?? new DOMException('生成已停止', 'AbortError')
    sourceReady = true
    const candidate = parseCandidate(raw, { id: candidateId, componentId, variant, agent: builderAgentFor(variant) })
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

  async reportCompile(candidateId: string, result: CompileResult) {
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
    candidate.runtimeStatus = 'compiling'
    this.events.publish({ type: 'compile.started', candidateId }, 'compiling')
    const result = await runtime.compile(candidate, signal)
    if (signal.aborted) return
    await this.reportCompile(candidateId, result)
  }

  async #repair(candidate: CandidateArtifact, errors: string[], signal: AbortSignal) {
    if (!this.#plan || !this.#direction) return
    if (candidate.fixAttempts >= this.#options.maxFixAttempts) {
      this.events.publish({ type: 'repair.exhausted', candidateId: candidate.id, errors }, 'compiling')
      return
    }
    candidate.fixAttempts += 1
    this.events.publish({ type: 'repair.started', candidateId: candidate.id, attempt: candidate.fixAttempts }, 'compiling')
    const component = this.#plan.components.find((item) => item.id === candidate.componentId)
    if (!component) throw new Error(`不存在组件合同：${candidate.componentId}`)
    const raw = await this.#client.completeJson(fixerMessages({ component, direction: this.#direction, candidate, errors }), {
      signal,
      model: this.#options.kimi.codeModel,
      maxTokens: 6000,
    })
    const fixed = parseCandidate(raw, {
      id: candidate.id, componentId: candidate.componentId, variant: candidate.variant,
      agent: candidate.agent ?? builderAgentFor(candidate.variant),
    })
    this.#assertSameFileBoundary(candidate, fixed)
    fixed.fixAttempts = candidate.fixAttempts
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

  async #reviseCandidate(candidateId: string, instruction: string, signal: AbortSignal) {
    if (!this.#plan || !this.#direction) throw new Error('页面上下文尚未就绪')
    const current = this.#requireCandidate(candidateId)
    const component = this.#plan.components.find((item) => item.id === current.componentId)
    if (!component) throw new Error(`不存在组件合同：${current.componentId}`)
    try {
      const raw = await this.#client.completeJson(revisionMessages({ instruction, component, direction: this.#direction, candidate: current }), {
        signal,
        model: this.#options.kimi.codeModel,
        maxTokens: 6000,
      })
      const revised = parseCandidate(raw, {
        id: current.id, componentId: current.componentId, variant: current.variant,
        agent: current.agent ?? builderAgentFor(current.variant),
      })
      this.#assertSameFileBoundary(current, revised)
      revised.fixAttempts = current.fixAttempts
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
    const raw = await this.#client.completeJson(reviewerMessages({
      plan: this.#plan,
      direction: this.#direction,
      selections: Object.fromEntries(this.#selections),
      screenshot,
    }), { signal: this.#abortController.signal, maxTokens: 2500 })
    this.#review = parseReview(raw)
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
