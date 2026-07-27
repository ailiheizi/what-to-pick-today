// Mock Harness —— 前端内模拟文档中的 AI Generation Harness：
// Planner → 并发 Component Builders（每个候选一条任务）→ 统一事件 → 渐进渲染 → 用户挑选 → Reviewer 打补丁。
// 接入真实 OpenAI-compatible API 时，只需把 scheduler 的任务体替换为真实 SSE 流，状态机与 UI 保持不变。
import { create } from 'zustand'
import type { CandidateDef, Scenario, SlotDef } from '../candidates/types'
import { matchScenario } from './scenarios'
import { fakeSource } from './fakecode'
import { DIRECTIONS, getDirection } from './dna'
import * as sfx from './sound'
import { HarnessSession, SandboxRuntimeAdapter, harnessStorage, hasKimiApiKey, loadKimiSettings } from './harness/index.ts'
import { classifyError } from './harness/errors.ts'
import type { ErrorKind, ErrorSurface, ErrorVerdict } from './harness/errors.ts'
import type { CandidateArtifact, EventEnvelope, HarnessSnapshot, PagePlan, VisualDirection } from './harness/types.ts'

export type Phase = 'idle' | 'planning' | 'blueprint' | 'direction' | 'generating' | 'reviewing' | 'done'
export type CandStatus = 'queued' | 'streaming' | 'compiling' | 'rendered' | 'failed'
export type SlotStatus = 'planned' | 'generating' | 'ready' | 'selected'

/**
 * A classified failure, ready to render.
 *
 * This replaces the bare `string` that `harnessError` used to hold: every
 * failure now arrives through `classifyError`, so the UI can tell a stale API
 * key (`surface: 'settings'`) apart from a network blip (`surface: 'chat'`)
 * instead of painting both as the same red banner. `message` is the Chinese
 * copy that is safe to show; `detail` keeps the raw thrown text for debugging
 * and must never be used as the primary message.
 */
export interface HarnessError {
  kind: ErrorKind
  surface: ErrorSurface
  message: string
  detail?: string
  retryable: boolean
}

export interface CandidateState {
  def: CandidateDef
  status: CandStatus
  code: string
  progress: number
  streamMs: number
  /** 入场动效类名（随机，每个候选不同） */
  anim: string
  /** 随机种子：驱动加载器形态 / 纸屑配色 */
  seed: number
  /** API 在完整 React 源码完成前返回的无脚本流式草图。 */
  streamPreviewHtml?: string
  streamPreviewComplete?: boolean
  /** 真实 Harness 生成的源码 artifact；存在时使用 iframe 沙箱预览 */
  artifact?: CandidateArtifact
  /** Last rendered artifact retained while a runtime failure is being repaired. */
  lastGoodArtifact?: CandidateArtifact
  /**
   * User-facing failure copy for this card. Always the classified Chinese
   * message, never the raw thrown text — `CandidateRail` renders it directly.
   */
  error?: string
  /** Classified kind behind `error`, so the card can vary its affordance. */
  errorKind?: ErrorKind
  /** Raw untranslated failure text. Debugging only; never rendered alone. */
  errorDetail?: string
  /** Diversity judge warning. The candidate remains selectable until rerolled. */
  duplicate?: { score: number; reason: string }
}

/** 候选入场动效池 —— 每次生成都随机不一样 */
const ENTER_ANIMS = ['anim-pop', 'anim-jelly', 'anim-flip', 'anim-slide-l', 'anim-slide-r', 'anim-bounce-in']
const randAnim = () => ENTER_ANIMS[Math.floor(Math.random() * ENTER_ANIMS.length)]
const randSeed = () => Math.floor(Math.random() * 1e9) + 1

export interface SlotState {
  def: SlotDef
  status: SlotStatus
  candidates: CandidateState[]
  selectedId?: string
  tryOnId?: string
}

export interface ChatMsg {
  id: number
  role: 'user' | 'ai' | 'sys'
  text: string
  ts: number
}

export interface HistoryItem {
  id: number
  kind: 'plan' | 'direction' | 'select' | 'undo' | 'branch' | 'review' | 'done' | 'sys'
  label: string
  ts: number
}

export interface ReviewStep {
  text: string
  patch?: string
}

interface Tweaks {
  density: boolean
  elevation: boolean
  radiusBoost: boolean
}

let timers: ReturnType<typeof setTimeout>[] = []
let uid = 1
const now = () => Date.now()

// Bumped whenever the user picks a slot themselves, which cancels any pending
// post-confirmation auto-advance so an explicit choice always wins.
let slotFocusEpoch = 0
// How long a just-confirmed candidate stays on screen before the rail moves on.
// The rail is keyed on activeSlotId, so advancing immediately unmounted the card
// mid-animation and the user never saw their choice land.
const CONFIRM_DWELL_MS = 700

function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}
function after(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms))
}

interface Store {
  phase: Phase
  prompt: string
  scenario: Scenario | null
  directionId: string | null
  planNotes: string[]
  slots: SlotState[]
  activeSlotId: string | null
  chat: ChatMsg[]
  history: HistoryItem[]
  reviewSteps: ReviewStep[]
  reviewCursor: number
  tweaks: Tweaks
  muted: boolean
  stopped: boolean
  startedAt: number
  tokensStreamed: number
  /** 槽位扣合时的纸屑爆发（值变化触发重播） */
  bursts: Record<string, number>
  /** 页面完成时的全屏纸屑雨 */
  bigConfetti: number
  /** 完成弹窗（Star 引导 + 导出） */
  starOpen: boolean
  harnessMode: 'demo' | 'kimi'
  /**
   * The last failure worth showing globally. `null` whenever there is nothing
   * to show — in particular, a user-initiated stop leaves this `null`.
   */
  harnessError: HarnessError | null
  settingsOpen: boolean
  recentProjects: HarnessSnapshot[]
  openSettings: () => void
  closeSettings: () => void
  openStar: () => void
  closeStar: () => void
  refreshRecentProjects: () => Promise<void>
  restoreProject: (sessionId: string) => Promise<void>

  submitPrompt: (text: string) => void
  confirmBlueprint: () => void
  chooseDirection: (id: string) => void
  tryOn: (slotId: string, candId: string) => void
  confirmCandidate: (slotId: string, candId: string) => void
  setActiveSlot: (slotId: string) => void
  undo: () => void
  switchBranch: (id: string) => void
  stopGeneration: () => void
  regenerate: () => void
  rerollCandidate: (slotId: string, candId: string) => void
  expandCandidates: (slotId: string) => void
  reportCandidateRuntimeError: (slotId: string, candId: string, attemptId: string | undefined, error: string) => void
  sendFollowUp: (text: string) => void
  toggleMute: () => void
  reset: () => void
  /**
   * The harness → store bridge. Normally driven by `session.subscribe`; exposed
   * on the store so the failure-presentation paths can be exercised without
   * standing up a real `HarnessSession` and a live model API.
   */
  applyHarnessEvent: (envelope: EventEnvelope) => void
}

let activeHarness: HarnessSession | null = null
let unsubscribeHarness: (() => void) | null = null

function EmptyGeneratedComponent() {
  return null
}

function previewHeight(role: string) {
  if (/hero|首屏|主视觉/i.test(role)) return 320
  if (/nav|header|导航|顶栏/i.test(role)) return 88
  if (/sidebar|侧栏/i.test(role)) return 360
  if (/table|列表|表格/i.test(role)) return 260
  if (/计数|计算器|计时|播放器|表单|counter|calculator|timer|player|form/i.test(role)) return 360
  return 200
}

function scenarioFromPlan(plan: PagePlan): Scenario {
  return {
    id: `generated-${Date.now()}`,
    title: plan.project.description || plan.project.name,
    projectName: plan.project.name,
    match: /(?:)/,
    layout: 'freeform',
    plannerNotes: [],
    slots: plan.components.map((component) => ({
      id: component.id,
      role: component.role,
      width: component.width,
      inputs: component.inputs.map((input) => `${input.name}: ${input.type}`),
      outputs: component.outputs.map((output) => `${output.name}: ${output.payload}`),
      dependencies: component.dependencies,
      previewH: previewHeight(component.role),
      candidates: [],
    })),
  }
}

function harnessDirection(id: string): VisualDirection {
  const direction = getDirection(id)
  return {
    id: direction.id,
    name: direction.name,
    description: direction.concept,
    visualDNA: {
      concept: direction.concept,
      mood: direction.mood,
      colors: {
        background: direction.vars['--dna-bg'] ?? '',
        surface: direction.vars['--dna-surface'] ?? '',
        text: direction.vars['--dna-text'] ?? '',
        muted: direction.vars['--dna-muted'] ?? '',
        accent: direction.vars['--dna-accent'] ?? '',
      },
      typography: { font: direction.vars['--dna-font'], display: direction.vars['--dna-display'] },
      geometry: { radius: direction.vars['--dna-radius'] ?? '24px', border: direction.vars['--dna-line'] ?? 'none', density: 'comfortable' },
      motion: direction.motion,
      compositionRules: direction.compositionRules,
    },
  }
}

function eventAnim(cue: string) {
  if (/flip|fold/.test(cue)) return 'anim-flip'
  if (/jelly|spring|bounce|pop/.test(cue)) return 'anim-jelly'
  if (/slide|magnetic|block/.test(cue)) return 'anim-slide-r'
  return randAnim()
}

export function getActiveHarness() {
  return activeHarness
}

function buildSlots(scenario: Scenario): SlotState[] {
  return scenario.slots.map((def) => ({
    def,
    status: 'planned',
    candidates: def.candidates.map((c) => ({
      def: c,
      status: 'queued',
      code: fakeSource(def, c),
      progress: 0,
      streamMs: 1600 + Math.random() * 2600,
      anim: randAnim(),
      seed: randSeed(),
    })),
  }))
}

function buildHarnessSlots(scenario: Scenario): SlotState[] {
  return scenario.slots.map((def) => ({
    def,
    status: 'planned',
    candidates: [],
  }))
}

/** Narrow a verdict down to the fields the UI needs, dropping transport metadata. */
function toHarnessError(verdict: ErrorVerdict): HarnessError {
  return {
    kind: verdict.kind,
    surface: verdict.surface,
    message: verdict.message,
    retryable: verdict.retryable,
    ...(verdict.detail ? { detail: verdict.detail } : {}),
  }
}

/**
 * `compile.failed` / `repair.exhausted` arrive as a list of compiler messages
 * rather than a thrown value. Shaping them like a `CompileResult` lets
 * `classifyError` recognise a blocked import inside the compiler output and
 * downgrade "编译失败" to the more accurate dependency verdict.
 */
function classifyCompileErrors(errors: string[]): ErrorVerdict {
  return classifyError({ ok: false, errors, message: errors.join('\n') })
}

export const useStore = create<Store>((set, get) => {
  const pushChat = (role: ChatMsg['role'], text: string) =>
    set((s) => ({ chat: [...s.chat, { id: uid++, role, text, ts: now() }] }))

  const pushHistory = (kind: HistoryItem['kind'], label: string) =>
    set((s) => {
      // 去重：相同事件 1.5 秒内只记一次（防止连点/抖动刷历史）
      const last = s.history[s.history.length - 1]
      if (last && last.kind === kind && last.label === label && now() - last.ts < 1500) return s
      return { history: [...s.history, { id: uid++, kind, label, ts: now() }] }
    })

  const patchSlot = (slotId: string, fn: (slot: SlotState) => Partial<SlotState>) =>
    set((s) => ({ slots: s.slots.map((sl) => (sl.def.id === slotId ? { ...sl, ...fn(sl) } : sl)) }))

  const patchCand = (slotId: string, candId: string, fn: (c: CandidateState) => Partial<CandidateState>) =>
    patchSlot(slotId, (sl) => ({
      candidates: sl.candidates.map((c) => (c.def.id === candId ? { ...c, ...fn(c) } : c)),
    }))

  const findCandidateSlot = (candidateId: string) => get().slots.find((slot) => slot.candidates.some((candidate) => candidate.def.id === candidateId))

  /**
   * Attach a classified verdict to one candidate card.
   *
   * The card gets the Chinese `message`; the raw thrown text goes to
   * `errorDetail` so it stays greppable in devtools without ever being the
   * primary thing the user reads.
   */
  const markCandidate = (candidateId: string, verdict: ErrorVerdict, status: CandStatus = 'failed') => {
    const slot = findCandidateSlot(candidateId)
    if (!slot) return false
    patchCand(slot.def.id, candidateId, () => ({
      status,
      error: verdict.message,
      errorKind: verdict.kind,
      errorDetail: verdict.detail,
    }))
    return true
  }

  /**
   * The single presentation path for every harness failure.
   *
   * `verdict.surface` is the only thing that decides where a failure lands:
   * - `none`     user-initiated stop. Nothing is set, nothing is said. In
   *              particular `harnessError` stays `null` so a Stop can never
   *              render as a crash.
   * - `settings` the user must fix credentials before anything can work, so the
   *              API settings modal is opened for them.
   * - `inline`   one bad candidate out of several. When the card already carries
   *              the message (`inlineHandled`), the global banner stays clean.
   * - `chat`     a page-level or transient condition, announced in the system
   *              transcript.
   *
   * Deliberately does not retry: `backoffMs` belongs to the session layer, and
   * the store's only job here is presentation.
   */
  const surfaceVerdict = (
    verdict: ErrorVerdict,
    options: { label: string; note?: string; inlineHandled?: boolean } = { label: '生成失败' },
  ) => {
    if (verdict.surface === 'none') return verdict
    if (verdict.surface === 'inline' && options.inlineHandled) return verdict
    set({ harnessError: toHarnessError(verdict) })
    // Always the classifier's Chinese copy — never `verdict.detail`, which is
    // the raw thrown text and is kept for debugging only.
    pushChat('sys', `${options.label}：${verdict.message}${options.note ?? ''}`)
    if (verdict.surface === 'settings') get().openSettings()
    return verdict
  }

  /** Classify a rejected harness promise and present it. */
  const reportFailure = (reason: unknown, label: string, note?: string) =>
    surfaceVerdict(classifyError(reason), { label, note })

  const handleHarnessEvent = (envelope: EventEnvelope) => {
    const event = envelope.event
    if (event.type === 'plan.activity') {
      set((state) => ({ tokensStreamed: state.tokensStreamed + event.receivedChars }))
      if (get().planNotes.length < 3) set((state) => ({ planNotes: [...state.planNotes, 'Planner 正在分析页面结构、槽位依赖与设计方向…'] }))
      return
    }
    if (event.type === 'plan.completed') {
      const scenario = scenarioFromPlan(event.plan)
      const slots = buildHarnessSlots(scenario)
      set({ scenario, slots, activeSlotId: slots[0]?.def.id ?? null, phase: 'blueprint', planNotes: [
        `理解需求：${event.plan.project.description || event.plan.project.name}`,
        `拆分页面：识别出 ${event.plan.components.length} 个独立组件槽位`,
        '组件合同与依赖白名单检查通过',
        '规划完成：请先确认页面蓝图和预计调用量',
      ] })
      pushChat('ai', `页面计划完成：${scenario.slots.map((slot) => slot.role).join(' / ')}。请先确认蓝图，确认后才会生成候选。`)
      pushHistory('plan', `拆分完成 · ${scenario.slots.length} 个槽位 · 等待蓝图确认`)
      return
    }
    if (event.type === 'component.queued') {
      const labels = { conservative: '稳妥版', expressive: '活泼版', experimental: '实验版' }
      patchSlot(event.componentId, (slot) => ({
        status: slot.status === 'selected' ? 'selected' : 'generating',
        candidates: [...slot.candidates, {
          def: {
            id: event.candidateId,
            label: `${event.agent.name} · ${labels[event.variant]}`,
            style: event.variant,
            blurb: `${event.agent.role} · ${event.variant === 'conservative' ? '清晰稳妥' : event.variant === 'expressive' ? '更鲜明、更有动感' : '大胆实验构图'}`,
            Component: EmptyGeneratedComponent,
          },
          status: 'queued',
          code: '',
          progress: 0,
          streamMs: 0,
          anim: eventAnim(envelope.motionCue),
          seed: randSeed(),
        }],
      }))
      return
    }
    if (event.type === 'component.started') {
      patchCand(event.componentId, event.candidateId, () => ({ status: 'streaming' }))
      return
    }
    if (event.type === 'component.activity') {
      patchCand(event.componentId, event.candidateId, (candidate) => ({ progress: candidate.progress + event.receivedChars }))
      set((state) => ({ tokensStreamed: state.tokensStreamed + event.receivedChars }))
      return
    }
    if (event.type === 'preview.updated') {
      patchCand(event.componentId, event.candidateId, () => ({
        streamPreviewHtml: event.html,
        streamPreviewComplete: event.complete,
      }))
      return
    }
    if (event.type === 'code.delta') {
      const slot = findCandidateSlot(event.candidateId)
      if (slot) patchCand(slot.def.id, event.candidateId, (candidate) => ({ code: candidate.code + event.delta, progress: candidate.code.length + event.delta.length }))
      return
    }
    if (event.type === 'source.ready' || event.type === 'repair.completed' || event.type === 'revision.completed') {
      const artifact = event.candidate
      const slot = findCandidateSlot(artifact.id)
      if (slot) patchCand(slot.def.id, artifact.id, (candidate) => ({
        artifact,
        lastGoodArtifact: candidate.status === 'rendered' ? candidate.artifact : candidate.lastGoodArtifact,
        code: artifact.files.map((file) => file.content).join('\n'),
        progress: artifact.files.reduce((total, file) => total + file.content.length, 0),
        status: 'compiling',
        error: undefined,
        errorKind: undefined,
        errorDetail: undefined,
      }))
      return
    }
    if (event.type === 'compile.started' || event.type === 'repair.started') {
      const slot = findCandidateSlot(event.candidateId)
      if (slot) patchCand(slot.def.id, event.candidateId, () => ({ status: 'compiling' }))
      return
    }
    if (event.type === 'compile.failed' || event.type === 'repair.exhausted') {
      // Compiler output is inline by nature: it belongs to one card, and the
      // other candidates in the slot are still perfectly usable. Classifying it
      // also promotes a blocked import out of the generic "编译失败" bucket.
      const verdict = classifyCompileErrors(event.errors)
      // `compile.failed` still has repair attempts left, so the card stays in
      // `compiling` and reads as "正在自动修复" rather than dead.
      markCandidate(event.candidateId, verdict, event.type === 'repair.exhausted' ? 'failed' : 'compiling')
      return
    }
    if (event.type === 'render.ready') {
      const slot = findCandidateSlot(event.candidateId)
      if (!slot) return
      patchCand(slot.def.id, event.candidateId, () => ({
        status: 'rendered', anim: eventAnim(envelope.motionCue),
        error: undefined, errorKind: undefined, errorDetail: undefined,
        duplicate: undefined,
        lastGoodArtifact: undefined,
        streamPreviewHtml: undefined, streamPreviewComplete: undefined,
      }))
      const current = get().slots.find((item) => item.def.id === slot.def.id)
      if (current && !current.tryOnId && !current.selectedId) {
        patchSlot(slot.def.id, () => ({ tryOnId: event.candidateId }))
        if (!get().activeSlotId) set({ activeSlotId: slot.def.id })
      }
      return
    }
    if (event.type === 'candidate.rerolling') {
      patchCand(event.componentId, event.candidateId, () => ({
        status: 'streaming',
        progress: 0,
        code: '',
        artifact: undefined,
        lastGoodArtifact: undefined,
        error: undefined,
        errorKind: undefined,
        errorDetail: undefined,
        duplicate: undefined,
        streamPreviewHtml: undefined,
        streamPreviewComplete: undefined,
        anim: randAnim(),
        seed: randSeed(),
      }))
      return
    }
    if (event.type === 'candidate.duplicate') {
      patchCand(event.componentId, event.candidateId, () => ({
        duplicate: { score: event.score, reason: event.reason },
      }))
      return
    }
    if (event.type === 'generation.completed') {
      set((state) => ({
        slots: state.slots.map((slot) => slot.status === 'selected' ? slot : { ...slot, status: slot.candidates.some((candidate) => candidate.status === 'rendered') ? 'ready' : slot.status }),
      }))
      return
    }
    if (event.type === 'review.started') {
      set({ phase: 'reviewing', reviewCursor: 0, reviewSteps: [{ text: '已选组件、PagePlan 与 Visual DNA 已发送给 Reviewer，正在检查一致性与响应式…' }] })
      return
    }
    if (event.type === 'review.completed') {
      const steps: ReviewStep[] = [
        { text: `✓ ${event.review.summary}` },
        ...event.review.patches.map((patch) => ({ text: patch.reason, patch: `Reviewer 建议 · ${patch.type.toUpperCase()} · ${patch.target}` })),
      ]
      set({ phase: 'done', reviewSteps: steps, reviewCursor: steps.length, bigConfetti: Date.now() })
      pushHistory('done', `页面完成 · Reviewer 返回 ${event.review.patches.length} 条优化建议`)
      pushChat('ai', `页面审查完成：${event.review.summary} Reviewer 建议已记录，尚未自动改写已选组件。你可以继续提修改要求，或导出项目。`)
      sfx.playComplete()
      after(1500, () => set({ starOpen: true }))
      return
    }
    if (event.type === 'task.retrying') {
      pushHistory('sys', `${event.taskId} 重试第 ${event.attempt} 次`)
      return
    }
    if (event.type === 'task.failed' || event.type === 'revision.failed') {
      const verdict = classifyError(event.error)
      // A user-initiated stop reaches this path too (LangGraph re-throws the
      // AbortError as a task failure). Presenting it made "停止" read as a
      // crash, so let the classifier decide and bail out on `surface: 'none'`.
      if (verdict.surface === 'none') return
      // Pin the failure to the card that produced it when we can identify one.
      // `task.failed` uses a `build:<candidateId>` task id; `revision.failed`
      // carries the candidate directly.
      const candidateId = event.type === 'revision.failed'
        ? event.candidateId
        : event.taskId.startsWith('build:') ? event.taskId.slice('build:'.length) : null
      const inlineHandled = candidateId ? markCandidate(candidateId, verdict) : false
      surfaceVerdict(verdict, {
        label: event.type === 'revision.failed' ? 'Revision 失败' : '生成任务失败',
        inlineHandled,
      })
      return
    }
    if (event.type === 'generation.cancelled') {
      // Cancellation is a normal terminal path. In-flight cards are parked as
      // failed so they stop spinning, but with the classifier's "生成已停止"
      // copy and an `aborted` kind, so the UI can style them as stopped rather
      // than broken — and no global error is raised.
      const verdict = classifyError(new Error('生成已停止'))
      set((state) => ({
        slots: state.slots.map((slot) => ({
          ...slot,
          candidates: slot.candidates.map((candidate) => ['streaming', 'compiling'].includes(candidate.status)
            ? { ...candidate, status: 'failed' as const, error: verdict.message, errorKind: verdict.kind, errorDetail: undefined }
            : candidate),
        })),
      }))
    }
  }

  /** 并发调度：最多 4 个活跃生成任务，交错启动，完成一个渲染一个 */
  const runScheduler = () => {
    type Task = { slotId: string; candId: string }
    const s0 = get()
    const queue: Task[] = []
    // 交错入队：先给每个槽位发第一个候选，保证每个槽位尽早有东西可看
    for (let i = 0; i < 3; i++) {
      for (const sl of s0.slots) {
        if (sl.status === 'selected') continue
        const c = sl.candidates[i]
        if (c && c.status === 'queued') queue.push({ slotId: sl.def.id, candId: c.def.id })
      }
    }
    let active = 0
    const MAX_ACTIVE = 4

    const startTask = (t: Task) => {
      active++
      const st = get()
      const slot = st.slots.find((x) => x.def.id === t.slotId)
      const cand = slot?.candidates.find((x) => x.def.id === t.candId)
      if (!slot || !cand || get().stopped) {
        active--
        return
      }
      if (slot.status === 'planned') patchSlot(t.slotId, () => ({ status: 'generating' }))
      patchCand(t.slotId, t.candId, () => ({ status: 'streaming' }))

      const total = cand.code.length
      const tick = 55
      const charsPerTick = Math.max(3, Math.ceil(total / (cand.streamMs / tick)))
      const iv = setInterval(() => {
        if (get().stopped) {
          clearInterval(iv)
          return
        }
        const cur = get()
        const c = cur.slots.find((x) => x.def.id === t.slotId)?.candidates.find((x) => x.def.id === t.candId)
        if (!c) {
          clearInterval(iv)
          return
        }
        const next = Math.min(total, c.progress + charsPerTick)
        patchCand(t.slotId, t.candId, () => ({ progress: next }))
        set((s) => ({ tokensStreamed: s.tokensStreamed + charsPerTick }))
        if (next >= total) {
          clearInterval(iv)
          patchCand(t.slotId, t.candId, () => ({ status: 'compiling' }))
          after(350 + Math.random() * 600, () => {
            patchCand(t.slotId, t.candId, () => ({ status: 'rendered' }))
            // 槽位内第一个渲染完成的候选自动进入"试穿"
            const s2 = get()
            const sl = s2.slots.find((x) => x.def.id === t.slotId)
            if (sl && !sl.tryOnId && !sl.selectedId) {
              patchSlot(t.slotId, () => ({ tryOnId: t.candId }))
              if (!s2.activeSlotId) set({ activeSlotId: t.slotId })
            }
            const sl2 = get().slots.find((x) => x.def.id === t.slotId)
            if (sl2 && sl2.candidates.every((c2) => c2.status === 'rendered') && sl2.status !== 'selected') {
              patchSlot(t.slotId, () => ({ status: 'ready' }))
            }
            active--
            pump()
          })
        }
      }, tick)
      timers.push(iv)
    }

    const pump = () => {
      while (active < MAX_ACTIVE && queue.length > 0 && !get().stopped) {
        startTask(queue.shift()!)
      }
    }
    pump()
  }

  const maybeStartReview = () => {
    const s = get()
    if (s.slots.length > 0 && s.slots.every((sl) => sl.status === 'selected')) {
      if (s.harnessMode === 'kimi' && activeHarness) {
        const session = activeHarness
        void session.review().catch((reason: unknown) => {
          if (activeHarness !== session) return
          reportFailure(reason, 'Reviewer 失败', '。已保留当前拼合结果。')
          // Every slot is already committed, so the page itself is finished
          // whether the Reviewer succeeded, failed, or was stopped. Land on
          // `done` either way — just without an error banner on a stop.
          set({ phase: 'done' })
        })
      } else {
        startReview()
      }
    }
  }

  const startReview = () => {
    const dir = getDirection(get().directionId ?? 'apple')
    set({ phase: 'reviewing', reviewCursor: 0, reviewSteps: [] })
    pushHistory('review', '页面拼合完成，进入 AI 截图审查')
    const steps: ReviewStep[] = [
      { text: '📸 已截取完整页面截图，连同 PagePlan 与 Visual DNA 发送给 Reviewer…' },
      { text: `🔍 正在对照「${dir.name}」的 compositionRules 检查版面…` },
      { text: '发现：指标卡组与主图表间距节奏不一致', patch: 'Token Patch · gap 统一为设计密度' },
      { text: '发现：主操作按钮在浅色面上对比度不足', patch: 'CSS Patch · 提升投影与字重' },
      { text: '✓ 结构、可访问性与响应式边界检查通过，无需重写组件' },
    ]
    steps.forEach((st, i) => {
      after(900 + i * 850, () => {
        set((s) => ({ reviewSteps: [...s.reviewSteps, st], reviewCursor: i + 1 }))
        if (i === 2) set((s) => ({ tweaks: { ...s.tweaks, density: true } }))
        if (i === 3) set((s) => ({ tweaks: { ...s.tweaks, elevation: true } }))
        if (i === steps.length - 1) {
          after(700, () => {
            set({ phase: 'done', bigConfetti: Date.now() })
            pushHistory('done', '页面完成 · Reviewer 补丁已应用')
            pushChat('ai', '页面已通过审查并应用 2 个局部补丁 ✨ 你可以继续提修改要求，或从右上角导出 React 源码。')
            sfx.playComplete()
            after(1500, () => set({ starOpen: true }))
          })
        }
      })
    })
  }

  const commitCandidate = (slotId: string, candId: string) => {
    const index = get().slots.findIndex((item) => item.def.id === slotId)
    const slot = index < 0 ? undefined : get().slots[index]
    const candidate = slot?.candidates.find((item) => item.def.id === candId)
    if (!slot || !candidate || candidate.status !== 'rendered') return
    const replacing = slot.status === 'selected'
    if (replacing && slot.selectedId === candId) return
    patchSlot(slotId, () => ({ status: 'selected', selectedId: candId, tryOnId: candId }))
    set((state) => ({ bursts: { ...state.bursts, [slotId]: Date.now() } }))
    pushHistory('select', `${replacing ? '更换' : '扣合'} ${slot.def.role} ← ${candidate.def.label}`)
    sfx.playConfirm()
    if (!replacing) {
      // Advance to the next unselected slot *after* this one so the user keeps
      // moving down the page. Searching from the top instead would bounce them
      // back to an earlier skipped slot after every confirmation.
      const after_ = get().slots.slice(index + 1).find((item) => item.status !== 'selected')
      const before = after_ ? undefined : get().slots.slice(0, index).find((item) => item.status !== 'selected')
      const next = after_ ?? before
      // Hold the committed card on screen first, then move on. Advancing in the
      // same tick unmounted it before the confirmation animation could play.
      if (next) {
        set({ activeSlotId: slotId })
        const epoch = slotFocusEpoch
        after(CONFIRM_DWELL_MS, () => {
          if (epoch !== slotFocusEpoch) return
          if (get().activeSlotId !== slotId) return
          set({ activeSlotId: next.def.id })
        })
      } else {
        // Keep the final committed card visible. Clearing the active slot made a
        // successful choice disappear at the exact moment the user needed
        // confirmation that it had been added to the page.
        set({ activeSlotId: slotId })
      }
    }
    if (get().phase === 'generating') maybeStartReview()
  }

  const commitUndo = (slotId: string) => {
    const slot = get().slots.find((item) => item.def.id === slotId)
    if (!slot) return
    patchSlot(slotId, () => ({ status: 'ready', selectedId: undefined }))
    pushHistory('undo', `撤销 ${slot.def.role} 的选择`)
    set({ activeSlotId: slotId })
    sfx.playUndo()
  }

  return {
    phase: 'idle',
    prompt: '',
    scenario: null,
    directionId: null,
    planNotes: [],
    slots: [],
    activeSlotId: null,
    chat: [],
    history: [],
    reviewSteps: [],
    reviewCursor: 0,
    tweaks: { density: false, elevation: false, radiusBoost: false },
    muted: false,
    stopped: false,
    startedAt: 0,
    tokensStreamed: 0,
    bursts: {},
    bigConfetti: 0,
    starOpen: false,
    harnessMode: 'demo',
    harnessError: null,
    settingsOpen: false,
    recentProjects: [],
    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
    openStar: () => set({ starOpen: true }),
    closeStar: () => set({ starOpen: false }),
    refreshRecentProjects: async () => {
      try {
        set({ recentProjects: (await harnessStorage.list()).slice(0, 5) })
      } catch {
        set({ recentProjects: [] })
      }
    },
    restoreProject: async (sessionId) => {
      clearTimers()
      activeHarness?.cancel()
      unsubscribeHarness?.()
      const runtime = new SandboxRuntimeAdapter({ getCssVariables: () => getDirection(get().directionId ?? 'apple').vars })
      const session = await HarnessSession.restore(sessionId, { kimi: loadKimiSettings(), concurrency: 4, candidateCount: 1, runtime })
      const snapshot = await harnessStorage.load(sessionId)
      if (!snapshot?.plan) throw new Error('这个项目还没有可恢复的页面蓝图')
      const scenario = scenarioFromPlan(snapshot.plan)
      const byComponent = new Map<string, CandidateArtifact[]>()
      for (const artifact of snapshot.candidates) {
        const list = byComponent.get(artifact.componentId) ?? []
        list.push(artifact)
        byComponent.set(artifact.componentId, list)
      }
      const slots: SlotState[] = scenario.slots.map((def) => {
        const selectedId = snapshot.selections[def.id]
        const candidates = (byComponent.get(def.id) ?? []).map((artifact) => ({
          def: {
            id: artifact.id,
            label: `${artifact.agent?.name ?? 'AI Agent'} · ${artifact.variant}`,
            style: artifact.variant,
            blurb: artifact.notes[0] ?? '已从本地项目恢复',
            Component: EmptyGeneratedComponent,
          },
          status: artifact.runtimeStatus === 'rendered' ? 'rendered' as const : artifact.runtimeStatus === 'compile_failed' ? 'failed' as const : 'compiling' as const,
          code: artifact.files.map((file) => file.content).join('\n'), progress: artifact.files.reduce((sum, file) => sum + file.content.length, 0),
          streamMs: 0, anim: randAnim(), seed: randSeed(), artifact,
          error: artifact.compileErrors[0],
        }))
        return {
          def, candidates, selectedId, tryOnId: selectedId ?? candidates.find((candidate) => candidate.status === 'rendered')?.def.id,
          status: selectedId ? 'selected' as const : candidates.some((candidate) => candidate.status === 'rendered') ? 'ready' as const : 'planned' as const,
        }
      })
      activeHarness = session
      const lastSequence = snapshot.events.at(-1)?.sequence ?? 0
      unsubscribeHarness = session.subscribe((event) => {
        if (activeHarness === session) handleHarnessEvent(event)
      }, lastSequence)
      const interrupted = ['planning', 'generating', 'reviewing'].includes(snapshot.phase)
      set({
        prompt: snapshot.requirement, scenario, slots, directionId: snapshot.direction?.id ?? null,
        activeSlotId: slots.find((slot) => slot.status !== 'selected')?.def.id ?? slots[0]?.def.id ?? null,
        phase: snapshot.direction ? (snapshot.phase === 'complete' ? 'done' : 'generating') : 'blueprint',
        harnessMode: 'kimi', harnessError: null, stopped: interrupted,
        chat: [{ id: uid++, role: 'sys', text: interrupted ? '已恢复本地项目。上次网络生成已中断，可继续补齐候选。' : '已恢复本地项目。', ts: now() }],
        history: [{ id: uid++, kind: 'sys', label: '恢复本地项目', ts: now() }],
        reviewSteps: snapshot.review ? [{ text: `✓ ${snapshot.review.summary}` }] : [],
      })
    },

    submitPrompt: (text) => {
      if (hasKimiApiKey()) {
        clearTimers()
        activeHarness?.cancel()
        unsubscribeHarness?.()
        set({
          phase: 'planning', prompt: text, scenario: null, planNotes: [], slots: [], directionId: null,
          activeSlotId: null, stopped: false, reviewSteps: [], reviewCursor: 0,
          tweaks: { density: false, elevation: false, radiusBoost: false }, startedAt: now(), tokensStreamed: 0,
          bursts: {}, bigConfetti: 0, starOpen: false, harnessMode: 'kimi', harnessError: null,
        })
        pushChat('user', text)
        pushChat('ai', '收到。真实 Planner 正在分析需求、拆分组件合同和页面槽位…')
        pushHistory('plan', 'AI Planner 收到需求')
        const runtime = new SandboxRuntimeAdapter({ getCssVariables: () => getDirection(get().directionId ?? 'apple').vars })
        const session = new HarnessSession(text, { kimi: loadKimiSettings(), concurrency: 4, candidateCount: 1, runtime })
        activeHarness = session
        unsubscribeHarness = session.subscribe((event) => {
          if (activeHarness === session) handleHarnessEvent(event)
        })
        void session.start().catch((reason: unknown) => {
          if (activeHarness !== session) return
          const verdict = reportFailure(reason, 'AI Planner 失败')
          // Only drop back to the empty prompt screen when the run really died.
          // A user-initiated stop keeps whatever the planner already produced.
          if (verdict.surface !== 'none') set({ phase: 'idle' })
        })
        return
      }
      const scenario = matchScenario(text)
      clearTimers()
      set({
        phase: 'planning',
        prompt: text,
        scenario,
        planNotes: [],
        slots: [],
        directionId: null,
        activeSlotId: null,
        stopped: false,
        reviewSteps: [],
        reviewCursor: 0,
        tweaks: { density: false, elevation: false, radiusBoost: false },
        startedAt: now(),
        tokensStreamed: 0,
        bursts: {},
        bigConfetti: 0,
        starOpen: false,
        harnessMode: 'demo',
        harnessError: null,
        settingsOpen: false,
      })
      pushChat('user', text)
      pushChat('ai', `收到。Planner 正在把需求拆成页面计划（命中场景：${scenario.title}）…`)
      pushHistory('plan', `Planner 收到需求 · 命中「${scenario.title}」`)
      scenario.plannerNotes.forEach((n, i) => {
        after(500 + i * 750, () => {
          set((s) => ({ planNotes: [...s.planNotes, n] }))
          if (i === scenario.plannerNotes.length - 1) {
            after(600, () => {
              set({ phase: 'blueprint', slots: buildHarnessSlots(scenario), activeSlotId: scenario.slots[0]?.id ?? null })
              pushChat('ai', '页面计划完成：' + scenario.slots.map((s) => s.role).join(' / ') + '。请先确认蓝图，确认后才会开始生成。')
              pushHistory('plan', `拆分完成 · ${scenario.slots.length} 个槽位 · 等待蓝图确认`)
            })
          }
        })
      })
    },

    confirmBlueprint: () => {
      const state = get()
      if (state.phase !== 'blueprint' || !state.scenario) return
      const candidateCount = state.scenario.slots.length
      const streamCount = candidateCount * 2
      set({ phase: 'direction' })
      pushHistory('plan', `确认页面蓝图 · ${state.scenario.slots.length} 个槽位 · 最多 ${streamCount} 条模型流`)
      pushChat('ai', `蓝图已确认。下一步选择视觉底板；首轮每个槽位先生成 1 个主推，共 ${candidateCount} 个候选、最多 ${streamCount} 条模型流。需要比较时再按槽位补齐。`)
      sfx.playConfirm()
    },

    chooseDirection: (id) => {
      const s = get()
      if (!s.scenario || s.directionId) return
      const dir = getDirection(id)
      if (s.harnessMode === 'kimi' && activeHarness) {
        const session = activeHarness
        set({ directionId: id, phase: 'generating', stopped: false })
        pushHistory('direction', `选定视觉底板 · 分支「${dir.name}」`)
        pushChat('ai', `底板「${dir.name}」已锁定。Motion Agent 先为每个槽位生成一个主推；可以立刻选择，也可以按槽位再叫 Product 与 Explorer 补两个方案。`)
        sfx.playStart()
        void session.chooseVisualDirection(harnessDirection(id)).catch((reason: unknown) => {
          if (activeHarness !== session) return
          reportFailure(reason, '候选生成失败')
        })
        return
      }
      set({ directionId: id, phase: 'generating', slots: buildSlots(s.scenario), stopped: false })
      pushHistory('direction', `选定视觉底板 · 分支「${dir.name}」`)
      pushChat('ai', `底板「${dir.name}」已锁定。Component Builders 正在并发生成 ${s.scenario.slots.length} 个槽位 × 3 个候选，完成一个渲染一个。`)
      sfx.playStart()
      after(300, runScheduler)
    },

    tryOn: (slotId, candId) => {
      const s = get()
      const slot = s.slots.find((x) => x.def.id === slotId)
      if (!slot) return
      const cand = slot.candidates.find((c) => c.def.id === candId)
      // 任意时刻都可以自由试穿：不影响已扣合的选择，只是画布临时预览
      if (!cand || cand.status !== 'rendered') return
      if (slot.tryOnId !== candId) patchSlot(slotId, () => ({ tryOnId: candId }))
    },

    confirmCandidate: (slotId, candId) => {
      const s = get()
      const slot = s.slots.find((x) => x.def.id === slotId)
      if (!slot) return
      const cand = slot.candidates.find((c) => c.def.id === candId)
      if (!cand || cand.status !== 'rendered') return
      if (s.harnessMode === 'kimi' && activeHarness) {
        const session = activeHarness
        void session.select(slotId, candId).then(() => {
          if (activeHarness === session) commitCandidate(slotId, candId)
        }).catch((reason: unknown) => {
          if (activeHarness !== session) return
          reportFailure(reason, '候选确认失败')
        })
        return
      }
      commitCandidate(slotId, candId)
    },

    setActiveSlot: (slotId) => {
      // An explicit pick cancels any pending post-confirmation auto-advance.
      slotFocusEpoch += 1
      set({ activeSlotId: slotId })
    },

    undo: () => {
      const s = get()
      const lastSelected = [...s.slots].reverse().find((sl) => sl.status === 'selected')
      if (!lastSelected) return
      if (s.harnessMode === 'kimi' && activeHarness) {
        const session = activeHarness
        void session.undoSelection(lastSelected.def.id).then(() => {
          if (activeHarness === session) commitUndo(lastSelected.def.id)
        }).catch((reason: unknown) => {
          if (activeHarness !== session) return
          reportFailure(reason, '撤销失败')
        })
        return
      }
      commitUndo(lastSelected.def.id)
    },

    switchBranch: (id) => {
      const s = get()
      if (!s.directionId || s.directionId === id) return
      const dir = getDirection(id)
      if (s.harnessMode === 'kimi' && activeHarness && ['selecting', 'complete'].includes(activeHarness.phase)) {
        const session = activeHarness
        void session.chooseVisualDirection(harnessDirection(id)).then(() => {
          if (activeHarness !== session) return
          set({ directionId: id, harnessError: null })
          pushHistory('branch', `切换设计分支 →「${dir.name}」`)
          pushChat('ai', `已切换到分支「${dir.name}」：${dir.concept}。组件合同不变，仅 Visual DNA 换肤。`)
          sfx.playShift()
        }).catch((reason: unknown) => {
          if (activeHarness !== session) return
          reportFailure(reason, '设计分支切换失败')
        })
        return
      }
      set({ directionId: id })
      pushHistory('branch', `切换设计分支 →「${dir.name}」`)
      pushChat('ai', `已切换到分支「${dir.name}」：${dir.concept}。组件合同不变，仅 Visual DNA 换肤。`)
      sfx.playShift()
    },

    stopGeneration: () => {
      // Stopping is a normal terminal path. Clear any leftover banner so the
      // stop screen never reads as a crash, and let the classifier own the copy.
      set({ stopped: true, harnessError: null })
      if (get().harnessMode === 'kimi') activeHarness?.stopGeneration()
      clearTimers()
      pushHistory('sys', '已停止接收生成流')
      pushChat('sys', '生成已停止。已完成的候选保留，可点击"重新生成"继续。')
    },

    regenerate: () => {
      const s = get()
      if (!s.scenario) return
      if (s.harnessMode === 'kimi' && activeHarness) {
        const session = activeHarness
        const componentIds = s.slots.filter((slot) => slot.status !== 'selected').map((slot) => slot.def.id)
        if (!componentIds.length || (!s.stopped && session.phase !== 'selecting')) return
        set({ stopped: false, phase: 'generating', harnessError: null })
        void session.generateCandidates(componentIds).catch((reason: unknown) => {
          if (activeHarness !== session) return
          reportFailure(reason, '重新生成失败')
        })
        return
      }
      set({
        stopped: false,
        slots: s.slots.map((sl) =>
          sl.status === 'selected'
            ? sl
            : {
                ...sl,
                status: 'planned',
                tryOnId: undefined,
                candidates: sl.candidates.map((c) => ({ ...c, status: 'queued', progress: 0, streamMs: 1400 + Math.random() * 2400, anim: randAnim(), seed: randSeed() })),
              },
        ),
      })
      pushHistory('sys', '重新生成未确认的槽位')
      after(200, runScheduler)
    },

    rerollCandidate: (slotId, candId) => {
      const state = get()
      const slot = state.slots.find((item) => item.def.id === slotId)
      const candidate = slot?.candidates.find((item) => item.def.id === candId)
      if (!candidate || slot?.selectedId === candId || candidate.status !== 'rendered' || state.harnessMode !== 'kimi' || !activeHarness) return
      const session = activeHarness
      set({ phase: 'generating', harnessError: null, stopped: false })
      pushHistory('sys', `重新生成相似候选 · ${candidate.def.label}`)
      void session.rerollCandidate(candId).catch((reason: unknown) => {
        if (activeHarness !== session) return
        reportFailure(reason, '候选重新生成失败')
        set({ phase: 'generating' })
      })
    },

    expandCandidates: (slotId) => {
      const state = get()
      const slot = state.slots.find((item) => item.def.id === slotId)
      if (!slot || slot.status === 'selected' || slot.candidates.length >= 3 || state.harnessMode !== 'kimi' || !activeHarness) return
      const session = activeHarness
      const missing = Math.min(2, 3 - slot.candidates.length)
      set({ phase: 'generating', stopped: false, harnessError: null })
      pushHistory('sys', `补齐候选 · ${slot.def.role} · +${missing}`)
      pushChat('ai', `${slot.def.role} 的主推已保留，Product 与 Explorer 正在补充更稳妥和更实验的比较方案。`)
      void session.generateCandidates([slotId], missing).catch((reason: unknown) => {
        if (activeHarness !== session) return
        reportFailure(reason, '补齐候选失败')
      })
    },

    reportCandidateRuntimeError: (slotId, candId, attemptId, error) => {
      const state = get()
      const slot = state.slots.find((item) => item.def.id === slotId)
      const candidate = slot?.candidates.find((item) => item.def.id === candId)
      if (!candidate?.artifact || candidate.status !== 'rendered' || state.harnessMode !== 'kimi' || !activeHarness) return
      if (attemptId !== undefined && candidate.artifact.attemptId !== attemptId) return
      patchCand(slotId, candId, () => ({
        status: 'compiling',
        lastGoodArtifact: candidate.artifact,
        error: '组件运行时出错，Fixer 正在修复；已保留上一帧。',
        errorKind: 'compile',
        errorDetail: error,
      }))
      void activeHarness.reportCompile(candId, { ok: false, errors: [`RuntimeError: ${error}`] }, attemptId)
        .catch((reason: unknown) => reportFailure(reason, '运行时修复失败'))
    },

    sendFollowUp: (text) => {
      pushChat('user', text)
      const lower = text.toLowerCase()
      const dirByKeyword = DIRECTIONS.find((d) => d.keywords.some((k) => lower.includes(k)) || text.includes(d.name))
      if (dirByKeyword) {
        get().switchBranch(dirByKeyword.id)
        return
      }
      if (/圆角|radius/i.test(text)) {
        set((s) => ({ tweaks: { ...s.tweaks, radiusBoost: !s.tweaks.radiusBoost } }))
        pushChat('ai', `已${get().tweaks.radiusBoost ? '应用' : '撤消'} Token Patch：圆角增强（--dna-radius × 1.6）。`)
        pushHistory('review', '补充要求 · 圆角 Token Patch')
        sfx.playClick()
        return
      }
      if (get().harnessMode === 'kimi' && activeHarness) {
        const session = activeHarness
        pushChat('ai', '已创建真实 Revision 任务，正在局部修改已选组件…')
        pushHistory('sys', `Revision：「${text.slice(0, 24)}${text.length > 24 ? '…' : ''}」`)
        void session.revise(text).then(() => {
          if (activeHarness !== session) return
          pushChat('ai', '局部修改完成，候选已重新编译。')
        }).catch((reason: unknown) => {
          if (activeHarness !== session) return
          reportFailure(reason, 'Revision 失败')
        })
        return
      }
      pushChat('ai', '已记录为 Fixer 任务。本地演示模式下我会尽量用补丁响应；接入兼容 API 后，这句话会变成真实的修复请求。')
      pushHistory('sys', `补充要求：「${text.slice(0, 24)}${text.length > 24 ? '…' : ''}」`)
    },

    toggleMute: () => {
      const m = !get().muted
      sfx.setMuted(m)
      set({ muted: m })
    },

    applyHarnessEvent: handleHarnessEvent,

    reset: () => {
      clearTimers()
      activeHarness?.cancel()
      unsubscribeHarness?.()
      activeHarness = null
      unsubscribeHarness = null
      set({
        phase: 'idle',
        prompt: '',
        scenario: null,
        directionId: null,
        planNotes: [],
        slots: [],
        activeSlotId: null,
        chat: [],
        history: [],
        reviewSteps: [],
        reviewCursor: 0,
        tweaks: { density: false, elevation: false, radiusBoost: false },
        stopped: false,
        tokensStreamed: 0,
        bursts: {},
        bigConfetti: 0,
        starOpen: false,
        harnessMode: 'demo',
        harnessError: null,
        settingsOpen: false,
      })
    },
  }
})
