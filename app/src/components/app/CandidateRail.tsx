import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  Compass,
  Hourglass,
  Layers,
  LayoutPanelLeft,
  Loader2,
  MousePointer2,
  Sparkles,
  Plus,
  Columns3,
  X,
  Zap,
} from 'lucide-react'
import { getActiveHarness, useStore, type CandidateState, type SlotState } from '../../lib/store'
import { playClick, playTick } from '../../lib/sound'
import { PlayfulLoader } from './playful'
import GeneratedCandidatePreview from './GeneratedCandidatePreview'
import StreamingHtmlPreview from './StreamingHtmlPreview'
import { getDirection } from '../../lib/dna'

type AgentIdentity = { id: 'motion' | 'product' | 'explorer'; name: string; role: string }

const FALLBACK_AGENTS: Record<CandidateState['def']['style'], AgentIdentity> = {
  expressive: { id: 'motion', name: 'Motion Agent', role: '动效与情绪反馈' },
  conservative: { id: 'product', name: 'Product Agent', role: '产品结构与可用性' },
  experimental: { id: 'explorer', name: 'Explorer Agent', role: '探索式构图与交互' },
}

/** 每个 Agent 一个专属字形：生成中光看图标就能分辨是谁在干活。 */
const AGENT_GLYPHS = { motion: Zap, product: LayoutPanelLeft, explorer: Compass } as const

const AGENT_ROSTER: AgentIdentity[] = Object.values(FALLBACK_AGENTS)

const GENERATION_STEPS = ['排队', '草图', '写组件', '编译', '完成'] as const

type CandidateStage = 'queued' | 'drafting' | 'coding' | 'compiling' | 'repairing' | 'ready' | 'failed'

const STAGE_TEXT: Record<CandidateStage, string> = {
  queued: '排队中',
  drafting: '起草中',
  coding: '生成代码',
  compiling: '编译中',
  repairing: '修复中',
  ready: '已就绪',
  failed: '失败',
}

const STAGE_STEP: Record<CandidateStage, number> = {
  queued: 0,
  drafting: 1,
  coding: 2,
  compiling: 3,
  repairing: 3,
  ready: 4,
  failed: 3,
}

const isSettled = (cand: CandidateState) => cand.status === 'rendered' || cand.status === 'failed'
const isWorking = (cand: CandidateState) => cand.status === 'streaming' || cand.status === 'compiling'

function candidateStage(cand: CandidateState): CandidateStage {
  const hasSource = cand.code.length > 0 || Boolean(cand.artifact)
  if (cand.status === 'failed') return 'failed'
  if (cand.status === 'rendered') return 'ready'
  if (cand.status === 'compiling') return cand.error ? 'repairing' : 'compiling'
  if (cand.status === 'streaming') return hasSource ? 'coding' : 'drafting'
  return 'queued'
}

function candidateActivity(cand: CandidateState) {
  const stage = candidateStage(cand)
  const hasSource = cand.code.length > 0 || Boolean(cand.artifact)
  const step = stage === 'failed' ? (hasSource ? 3 : 1) : STAGE_STEP[stage]
  return { stage, step, label: STAGE_TEXT[stage] }
}

/** 候选身上已经带着 Agent 身份：优先用 artifact，其次从 `def.label` 前缀反查。 */
function resolveAgent(cand: CandidateState): AgentIdentity {
  if (cand.artifact?.agent) return cand.artifact.agent
  const prefix = cand.def.label.split('·')[0].trim()
  return AGENT_ROSTER.find((agent) => agent.name === prefix) ?? FALLBACK_AGENTS[cand.def.style]
}

/** 顶部状态条已经写了 Agent 名字与职责，底部就只留「这一版是什么」。 */
function withoutPrefix(text: string, prefix: string) {
  const head = `${prefix} · `
  return text.startsWith(head) ? text.slice(head.length) : text
}

function formatElapsed(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0s'
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}分${String(Math.floor(seconds % 60)).padStart(2, '0')}秒`
}

function CandidateCard({
  cand,
  previewH,
  isTryOn,
  isSelected,
  slotSelected,
  elapsedMs,
  workingElsewhere,
  onTryOn,
  onConfirm,
  onReroll,
  cssVariables,
  comparisonMode = false,
  interactionLocked = false,
}: {
  cand: CandidateState
  previewH: number
  isTryOn: boolean
  isSelected: boolean
  slotSelected: boolean
  /** 由整条候选轨共享的一个计时器算出，卡片自己不开 interval。 */
  elapsedMs: number
  /** 此刻真正在跑的其他 Agent 数量：解释「为什么我还在排队」。 */
  workingElsewhere: number
  onTryOn: () => void
  onConfirm: () => void
  onReroll: () => void
  cssVariables: Record<string, string>
  comparisonMode?: boolean
  interactionLocked?: boolean
}) {
  const ready = cand.status === 'rendered'
  const agent = resolveAgent(cand)
  const Glyph = AGENT_GLYPHS[agent.id] ?? Bot
  const activity = candidateActivity(cand)
  const settled = isSettled(cand)
  const queued = activity.stage === 'queued'
  const failed = activity.stage === 'failed'
  const elapsed = formatElapsed(elapsedMs)
  const variantLabel = withoutPrefix(cand.def.label, agent.name)
  const variantBlurb = withoutPrefix(cand.def.blurb, agent.role)
  // 所有候选都在同一逻辑画布宽度内渲染，再按真实内容高度 contain 到预览框。
  // 这比固定 0.52 缩放更适合模型生成的未知尺寸组件，也保证并排比较口径一致。
  const previewBoxH = comparisonMode ? 300 : Math.max(130, Math.min(240, previewH * 0.78))
  // 侧栏候选使用真实的响应式组件宽度，而不是把 640px 桌面稿硬缩成缩略图。
  // 420px 足以触发模型组件的移动/平板布局，文本在窄窗口里仍然可读。
  const previewNaturalWidth = comparisonMode ? 720 : 420
  const roomyPreview = previewBoxH >= 72
  const [isLocking, setIsLocking] = useState(false)
  const [previewNaturalHeight, setPreviewNaturalHeight] = useState(Math.max(previewH, 140))
  const [previewViewportWidth, setPreviewViewportWidth] = useState(320)
  const previewViewportRef = useRef<HTMLDivElement>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const node = previewViewportRef.current
    if (!node) return
    const update = () => setPreviewViewportWidth(node.clientWidth || 320)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const handlePreviewHeight = useCallback((height: number) => {
    setPreviewNaturalHeight(Math.max(1, height))
  }, [])
  const previewScale = Math.min(
    1,
    previewViewportWidth / previewNaturalWidth,
    previewBoxH / Math.max(previewNaturalHeight, 1),
  )

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])

  const handleConfirm = () => {
    if (!ready || isSelected || isLocking) return
    setIsLocking(true)
    playClick()
    confirmTimer.current = setTimeout(() => {
      onConfirm()
      setIsLocking(false)
    }, 360)
  }

  return (
    <div
      data-cand-card
      data-agent={agent.id}
      data-stage={activity.stage}
      data-state={isSelected ? 'selected' : isTryOn ? 'trying' : 'idle'}
      onClick={() => ready && !interactionLocked && onTryOn()}
      className={`candidate-choice-card group relative ${comparisonMode ? 'h-full' : 'w-64 lg:w-auto snap-center shrink-0'} rounded-2xl border bg-white overflow-hidden ${
        ready ? 'cursor-pointer' : ''
      } ${failed ? 'candidate-choice-failed' : queued ? 'candidate-choice-queued' : ''} ${
        isLocking
          ? 'candidate-choice-locking border-emerald-400'
          : isSelected
          ? 'candidate-choice-selected border-emerald-400'
          : isTryOn
            ? 'candidate-choice-trying border-neutral-900'
            : 'candidate-choice-idle border-neutral-200/80'
      }`}
    >
      <div className="candidate-choice-glow pointer-events-none absolute inset-0 z-20 rounded-[inherit]" />
      <div className="candidate-agent-panel relative z-[1] px-3 pt-2.5 pb-2" data-agent={agent.id} data-stage={activity.stage}>
        <div className="flex items-center gap-2">
          <span className="candidate-agent-avatar flex size-7 shrink-0 items-center justify-center rounded-xl">
            <Glyph size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[10px] font-extrabold text-neutral-800">{agent.name}</span>
              <span className={`candidate-agent-live-dot ${settled ? 'is-settled' : ''} ${queued ? 'is-waiting' : ''}`} />
            </div>
            <div className="truncate text-[8px] font-medium text-neutral-500">{agent.role}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className={`candidate-agent-status flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-bold ${failed ? 'is-failed' : ''} ${queued ? 'is-queued' : ''}`}>
              {failed
                ? <CircleAlert size={9} />
                : ready
                  ? <CircleCheck size={9} />
                  : queued
                    ? <Hourglass size={9} className="candidate-agent-hourglass" />
                    : <Loader2 size={9} className="animate-spin" />}
              {activity.label}
            </div>
            <span
              className="candidate-agent-elapsed font-mono tabular-nums text-[8px] font-bold"
              title={queued ? `已排队 ${elapsed}` : settled ? `总耗时 ${elapsed}` : `已用时 ${elapsed}`}
            >
              {elapsed}
            </span>
          </div>
        </div>
        {failed ? (
          <div className="candidate-agent-error mt-2 flex items-start gap-1 rounded-lg px-2 py-1 text-[8px] font-semibold leading-relaxed" title={cand.error ?? '未知错误'}>
            <CircleAlert size={9} className="mt-px shrink-0" />
            <span className="line-clamp-2">{cand.error ?? '未知错误，请重新生成'}</span>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1" aria-label={`生成进度：${activity.label}，第 ${activity.step + 1} 步，共 ${GENERATION_STEPS.length} 步`}>
            {GENERATION_STEPS.map((stepLabel, index) => (
              <div key={stepLabel} className="min-w-0 flex-1">
                <div
                  className={`candidate-agent-step h-1 rounded-full ${
                    index < activity.step || ready
                      ? 'is-done'
                      : index === activity.step
                        ? queued ? 'is-queued' : 'is-active'
                        : ''
                  }`}
                />
                <div className={`mt-1 truncate text-center text-[6px] font-bold ${index === activity.step ? 'text-neutral-600' : 'text-neutral-300'}`}>
                  {stepLabel}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 实时预览：按组件真实高度完整装入，而不是裁掉底部。 */}
      <div ref={previewViewportRef} className="relative hidden lg:block bg-neutral-50 border-b border-neutral-100 overflow-hidden" style={{ height: previewBoxH }}>
        {ready ? (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 origin-center transition-transform duration-300"
            style={{
              width: previewNaturalWidth,
              height: previewNaturalHeight,
              transform: `translate(-50%, -50%) scale(${previewScale})`,
            }}
          >
            <div className={`h-full w-full ${cand.anim}`}>
              {cand.artifact ? (
                <GeneratedCandidatePreview candidate={cand.artifact} cssVariables={cssVariables} onHeight={handlePreviewHeight} />
              ) : (
                <cand.def.Component />
              )}
            </div>
          </div>
        ) : cand.streamPreviewHtml ? (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 origin-center"
            style={{ width: previewNaturalWidth, height: Math.max(previewH, 140), transform: `translate(-50%, -50%) scale(${Math.min(1, previewViewportWidth / previewNaturalWidth, previewBoxH / Math.max(previewH, 140))})` }}
          >
            <StreamingHtmlPreview html={cand.streamPreviewHtml} cssVariables={cssVariables} title={`${cand.def.label} · API 流式草图`} />
          </div>
        ) : failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
            {/* 报错原文已经在上方状态条里给过一次，这里只留一个耗时定格的徽标。 */}
            <span className="candidate-fail-badge inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold">
              <CircleAlert size={9} /> 生成失败 · 停在 {elapsed}
            </span>
            {roomyPreview && (
              <span className="mt-1.5 text-[8px] text-neutral-400">点「重新生成」可以再派一次这个 Agent</span>
            )}
          </div>
        ) : queued ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <span className="candidate-queue-badge inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold">
              <Hourglass size={9} className="candidate-agent-hourglass" /> 已排队 {elapsed}
            </span>
            <span className="candidate-queue-track" aria-hidden="true" />
            {roomyPreview && (
              <span className="text-[8px] leading-relaxed text-neutral-400">
                {workingElsewhere > 0
                  ? `另有 ${workingElsewhere} 个 Agent 正在执行，轮到我就开工`
                  : '调度器已排上号，马上开始'}
              </span>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <Loader2 size={14} className="animate-spin text-neutral-400" />
            <span className="text-[10px] font-mono text-neutral-400">
              {cand.status === 'compiling' ? 'compiling…' : `streaming ${Math.round((cand.progress / Math.max(1, cand.code.length)) * 100)}%`}
            </span>
          </div>
        )}
        {isTryOn && ready && !isSelected && (
          <span className="anim-pop absolute top-1.5 right-1.5 px-2 py-1 rounded-full bg-neutral-900 text-white text-[8px] font-bold shadow-lg flex items-center gap-1">
            <MousePointer2 size={8} /> 试穿中
          </span>
        )}
        {isSelected && (
          <span className="anim-pop absolute top-1.5 right-1.5 px-2 py-1 rounded-full bg-emerald-500 text-white text-[8px] font-bold shadow-lg flex items-center gap-0.5">
            <Check size={8} /> 已拼入
          </span>
        )}
        {isLocking && (
          <div className="candidate-choice-confirm-flash absolute inset-0 z-10 flex items-center justify-center bg-emerald-500/16 backdrop-blur-[1px]">
            <span className="candidate-choice-confirm-pill flex items-center gap-1.5 rounded-full bg-neutral-950 px-3 py-1.5 text-[9px] font-bold text-white shadow-xl">
              <Sparkles size={10} className="text-amber-300" /> 正在扣合
            </span>
          </div>
        )}
      </div>
      {/* 信息 + 操作 */}
      <div className="px-3 py-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className={`${comparisonMode ? '' : 'truncate'} text-[11px] font-bold text-neutral-800`}>{variantLabel}</div>
            {comparisonMode && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-extrabold ${
                cand.def.style === 'conservative'
                  ? 'bg-sky-50 text-sky-700'
                  : cand.def.style === 'expressive'
                    ? 'bg-pink-50 text-pink-700'
                    : 'bg-violet-50 text-violet-700'
              }`}>
                {cand.def.style === 'conservative' ? '稳妥' : cand.def.style === 'expressive' ? '鲜明' : '实验'}
              </span>
            )}
          </div>
          <div className={`${comparisonMode ? 'mt-1 line-clamp-3 min-h-8 leading-relaxed' : 'truncate'} text-[9px] text-neutral-400`}>{variantBlurb}</div>
        </div>
        <button
          disabled={!ready || isSelected || isLocking || interactionLocked}
          onClick={(e) => {
            e.stopPropagation()
            handleConfirm()
          }}
          className={`candidate-choice-button hover-pop shrink-0 min-w-[66px] px-3 py-1.5 rounded-full text-[10px] font-bold ${
            isLocking
              ? 'bg-emerald-500 text-white shadow-lg'
              : isSelected
              ? 'bg-emerald-50 text-emerald-600'
              : ready
                ? slotSelected
                  ? 'bg-amber-400 text-amber-950 hover:bg-amber-300 shadow-md'
                  : 'bg-neutral-900 text-white hover:bg-neutral-700 shadow-md'
                : 'bg-neutral-100 text-neutral-300 cursor-not-allowed'
          }`}
        >
          {isLocking ? '咔哒…' : isSelected ? '✓ 当前' : slotSelected ? '替换 →' : '扣合 →'}
        </button>
      </div>
      {cand.duplicate && ready && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800">
          <CircleAlert size={11} className="shrink-0" />
          <span className="min-w-0 flex-1 text-[8px] font-semibold leading-relaxed" title={cand.duplicate.reason}>
            和其他方案太像（{Math.round(cand.duplicate.score * 100)}%）
          </span>
          {!isSelected && (
            <button
              type="button"
              disabled={interactionLocked}
              onClick={(event) => {
                event.stopPropagation()
                onReroll()
              }}
              className="shrink-0 rounded-full bg-amber-400 px-2 py-1 text-[8px] font-extrabold text-amber-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              换一个
            </button>
          )}
        </div>
      )}
      {(isTryOn || isSelected) && ready && (
        <div className={`candidate-choice-statebar ${isSelected ? 'bg-emerald-400' : 'bg-neutral-900'}`} />
      )}
    </div>
  )
}

function CandidateCompareModal({
  slot,
  cssVariables,
  elapsedFor,
  workingCount,
  onClose,
  onTryOn,
  onConfirm,
  onReroll,
  interactionLocked,
}: {
  slot: SlotState
  cssVariables: Record<string, string>
  elapsedFor: (candidateId: string) => number
  workingCount: number
  onClose: () => void
  onTryOn: (candidateId: string) => void
  onConfirm: (candidateId: string) => void
  onReroll: (candidateId: string) => void
  interactionLocked: boolean
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="candidate-compare-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/45 p-3 backdrop-blur-md md:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="anim-pop flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[32px] border border-white/70 bg-neutral-50/95 shadow-2xl ring-1 ring-neutral-950/10">
        <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200/70 bg-white/80 px-4 py-3 backdrop-blur-xl md:px-6 md:py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 shadow-sm">
            <Columns3 size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="candidate-compare-title" className="truncate text-sm font-extrabold text-neutral-900 md:text-base">
              并排比较 · {slot.def.role}
            </h2>
            <p className="mt-0.5 text-[10px] text-neutral-500 md:text-xs">同尺寸看结构与细节，先试穿整页效果，再把喜欢的方案扣合进去。</p>
          </div>
          <span className="hidden rounded-full bg-neutral-100 px-3 py-1.5 text-[10px] font-bold text-neutral-500 sm:block">
            {slot.candidates.length} 个方案
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭候选比较"
            className="hover-pop flex size-10 shrink-0 items-center justify-center rounded-2xl bg-neutral-900 text-white shadow-lg transition hover:bg-neutral-700"
          >
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-4 py-5 md:px-6 md:py-6">
          <div className="mx-auto flex w-max min-w-full items-stretch justify-start gap-4 md:justify-center md:gap-5">
            {slot.candidates.slice(0, 3).map((candidate, index) => (
              <div
                key={candidate.def.id}
                className="relative w-[min(82vw,350px)] shrink-0 animate-in fade-in slide-in-from-bottom-3"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <CandidateCard
                  cand={candidate}
                  previewH={slot.def.previewH}
                  isTryOn={slot.tryOnId === candidate.def.id}
                  isSelected={slot.selectedId === candidate.def.id}
                  slotSelected={slot.status === 'selected'}
                  elapsedMs={elapsedFor(candidate.def.id)}
                  workingElsewhere={workingCount}
                  onTryOn={() => onTryOn(candidate.def.id)}
                  onConfirm={() => onConfirm(candidate.def.id)}
                  onReroll={() => onReroll(candidate.def.id)}
                  cssVariables={cssVariables}
                  comparisonMode
                  interactionLocked={interactionLocked}
                />
              </div>
            ))}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-neutral-200/70 bg-white/75 px-4 py-3 text-center text-[10px] font-semibold text-neutral-500 backdrop-blur-xl">
          <MousePointer2 size={12} /> 点击卡片即可在中间画布试穿 · 左右滑动查看更多
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** 整条候选轨共用一个计时器：now 每 500ms 前进一次，每张卡记一次开工/收工时刻。 */
type RailClock = { now: number; startedAt: Record<string, number>; settledAt: Record<string, number> }
const EMPTY_CLOCK: RailClock = { now: 0, startedAt: {}, settledAt: {} }

export default function CandidateRail() {
  const { slots, activeSlotId, setActiveSlot, tryOn, confirmCandidate, rerollCandidate, expandCandidates, phase, directionId, harnessMode } = useStore()
  const cssVariables = getDirection(directionId ?? 'apple').vars
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastIdx = useRef(-1)
  const [compareSlotId, setCompareSlotId] = useState<string | null>(null)
  const closeCompare = useCallback(() => setCompareSlotId(null), [])
  const interactionLocked = phase === 'reviewing'

  const activeSlot = slots.find((s) => s.def.id === activeSlotId) ?? slots.find((s) => s.status !== 'selected') ?? null
  const compareSlot = slots.find((slot) => slot.def.id === compareSlotId) ?? null
  const canExpandActive = harnessMode === 'kimi'
    && getActiveHarness()?.phase === 'selecting'
    && Boolean(activeSlot)
    && activeSlot!.status !== 'selected'
    && activeSlot!.candidates.length > 0
    && activeSlot!.candidates.length < 3

  // 计时口径覆盖所有槽位：切换槽位时后台候选的耗时不会被清零重来。
  const allCandidates = slots.flatMap((s) => s.candidates)
  const rosterKey = allCandidates.map((c) => c.def.id).join('|')
  const settledKey = allCandidates.filter(isSettled).map((c) => c.def.id).join('|')
  const workingCount = allCandidates.filter(isWorking).length
  const [clock, setClock] = useState<RailClock>(EMPTY_CLOCK)

  useEffect(() => {
    const roster = rosterKey ? rosterKey.split('|') : []
    if (roster.length === 0) return
    const settled = new Set(settledKey ? settledKey.split('|') : [])
    const tick = () => setClock((prev) => {
      const now = Date.now()
      const startedAt: Record<string, number> = {}
      const settledAt: Record<string, number> = {}
      for (const id of roster) {
        // 重新生成会把已完成的候选打回 queued：此时重新计时，而不是接着旧的读数走。
        const restarted = !settled.has(id) && prev.settledAt[id] !== undefined
        startedAt[id] = restarted ? now : prev.startedAt[id] ?? now
        if (settled.has(id)) settledAt[id] = prev.settledAt[id] ?? now
      }
      return { now, startedAt, settledAt }
    })
    // 先立刻对一次表（补齐新卡片的起点、封存刚结束卡片的终点），
    // 只有还存在未结束的候选时才继续每 500ms 走针。
    const seed = setTimeout(tick, 0)
    const timer = settled.size < roster.length ? setInterval(tick, 500) : null
    return () => {
      clearTimeout(seed)
      if (timer) clearInterval(timer)
    }
  }, [rosterKey, settledKey])

  const elapsedFor = (candidateId: string) => {
    const startedAt = clock.startedAt[candidateId]
    if (!startedAt) return 0
    return Math.max(0, (clock.settledAt[candidateId] ?? clock.now) - startedAt)
  }

  /** 滚动 → 找距中心线最近的候选 → 试穿 + 按索引变调 tick */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !activeSlot) return
    const horizontal = window.matchMedia('(max-width: 1023px)').matches
    const bounds = el.getBoundingClientRect()
    const center = horizontal ? bounds.left + el.clientWidth / 2 : bounds.top + el.clientHeight / 2
    const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-cand-card]'))
    let best = -1
    let bestDist = Infinity
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect()
      const d = horizontal
        ? Math.abs(r.left + r.width / 2 - center)
        : Math.abs(r.top + r.height / 2 - center)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    if (best >= 0 && best !== lastIdx.current) {
      lastIdx.current = best
      const cand = activeSlot.candidates[best]
      if (!interactionLocked && cand && cand.status === 'rendered') {
        tryOn(activeSlot.def.id, cand.def.id)
        playTick(best)
      }
    }
  }, [activeSlot, interactionLocked, tryOn])

  useEffect(() => {
    lastIdx.current = -1
    scrollRef.current?.scrollTo({ top: 0, left: 0 })
  }, [activeSlot?.def.id])

  if (phase !== 'generating' && phase !== 'reviewing' && phase !== 'done') {
    return (
      <aside className={`${phase === 'blueprint' || phase === 'direction' ? 'hidden' : 'flex'} h-28 w-full lg:h-auto lg:w-64 xl:w-72 shrink-0 mt-3 lg:m-3 lg:mt-0 rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-lg flex-col items-center justify-center px-5 xl:px-6 text-center`}>
        <div className="anim-float">
          <Layers size={22} className="text-neutral-300" />
        </div>
        <div className="mt-3 text-xs font-bold text-neutral-500">AI 候选区</div>
        <div className="mt-1.5 hidden lg:block text-[10px] leading-relaxed text-neutral-400">
          生成开始后，这里会实时出现
          <br />
          {harnessMode === 'kimi' ? '每个槽位先出 1 个主推，需要时再补两个。' : '每个槽位的 3 个候选。'}
          <br />
          滚动试穿，点击扣合 🧩
        </div>
      </aside>
    )
  }

  return (
    <>
    <aside className="h-[230px] min-h-[210px] w-full lg:h-auto lg:min-h-0 lg:w-64 xl:w-72 shrink-0 mt-3 lg:m-3 lg:mt-0 rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-lg flex flex-col overflow-hidden">
      {/* 槽位切换 */}
      <div className="px-3 pt-3 pb-2">
        <div className="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 mb-2">槽位 · 逐个挑选</div>
        <div className="flex flex-nowrap lg:flex-wrap gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
          {slots.map((s) => (
            <button
              key={s.def.id}
              onClick={() => {
                setCompareSlotId(null)
                setActiveSlot(s.def.id)
                playClick()
              }}
              className={`candidate-slot-chip hover-pop relative px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                s.status === 'selected'
                  ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300/70'
                  : activeSlot?.def.id === s.def.id
                    ? 'bg-neutral-900 text-white shadow-md ring-2 ring-neutral-900/15'
                    : 'bg-white/80 border border-neutral-200/70 text-neutral-500 hover:border-neutral-400'
              }`}
            >
              {s.status === 'selected' ? '✓ ' : ''}
              {s.def.role}
            </button>
          ))}
        </div>
      </div>

      {/* 候选滚动区 + 中心选择线 */}
      <div className="relative flex-1 min-h-0">
        <div className="candidate-selection-guide pointer-events-none absolute left-1/2 top-2 bottom-2 -translate-x-1/2 z-10 hidden lg:flex lg:left-2 lg:right-2 lg:top-1/2 lg:bottom-auto lg:translate-x-0 lg:-translate-y-1/2 items-center gap-1 rounded-2xl px-1 py-2.5">
          <div className="h-px flex-1 bg-neutral-900/30 rounded-full" />
          <span className="text-[8px] font-bold text-neutral-600 bg-white rounded-full px-2 py-1 shadow-md ring-1 ring-neutral-900/10">试穿位置</span>
          <div className="h-px flex-1 bg-neutral-900/30 rounded-full" />
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className="flex h-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory gap-3 px-[28%] py-3 lg:block lg:overflow-x-hidden lg:overflow-y-auto lg:snap-x-none lg:snap-y lg:px-3 lg:py-[38%] lg:space-y-3">
          {activeSlot?.candidates.map((c) => (
            <CandidateCard
              key={c.def.id}
              cand={c}
              previewH={activeSlot.def.previewH}
              isTryOn={activeSlot.tryOnId === c.def.id}
              isSelected={activeSlot.selectedId === c.def.id}
              slotSelected={activeSlot.status === 'selected'}
              elapsedMs={elapsedFor(c.def.id)}
              workingElsewhere={workingCount}
              onTryOn={() => {
                tryOn(activeSlot.def.id, c.def.id)
                playClick()
              }}
              onConfirm={() => confirmCandidate(activeSlot.def.id, c.def.id)}
              onReroll={() => rerollCandidate(activeSlot.def.id, c.def.id)}
              cssVariables={cssVariables}
              interactionLocked={interactionLocked}
            />
          ))}
          {!activeSlot && (
            <div className="pt-6">
              <PlayfulLoader seed={777} label="全部槽位已确认 🎉" />
            </div>
          )}
        </div>
      </div>

      <div className="hidden lg:block px-4 py-2.5 text-[9px] text-neutral-400 leading-relaxed">
        {activeSlot && activeSlot.candidates.length >= 2 && (
          <button
            type="button"
            onClick={() => {
              setCompareSlotId(activeSlot.def.id)
              playClick()
            }}
            className="group mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-3 py-2.5 text-[10px] font-extrabold text-white shadow-lg transition duration-300 hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-violet-300/40 active:scale-[0.98]"
          >
            <Columns3 size={13} className="transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110" />
            展开比较 {activeSlot.candidates.length} 个方案
            <Sparkles size={11} className="text-amber-300 transition-transform duration-300 group-hover:rotate-12" />
          </button>
        )}
        {canExpandActive && activeSlot && !interactionLocked && (
          <button
            type="button"
            onClick={() => expandCandidates(activeSlot.def.id)}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-full bg-violet-100 px-3 py-2 text-[10px] font-extrabold text-violet-700 transition hover:bg-violet-200 hover:scale-[1.02]"
          >
            <Plus size={11} /> 再来两个方案
          </button>
        )}
        滚动或点击卡片即「试穿」；扣合后仍可随时试穿其他候选并「替换」✨
      </div>
    </aside>
    {compareSlot && compareSlot.candidates.length >= 2 && (
      <CandidateCompareModal
        slot={compareSlot}
        cssVariables={cssVariables}
        elapsedFor={elapsedFor}
        workingCount={workingCount}
        onClose={closeCompare}
        onTryOn={(candidateId) => {
          setActiveSlot(compareSlot.def.id)
          tryOn(compareSlot.def.id, candidateId)
          playClick()
        }}
        onConfirm={(candidateId) => confirmCandidate(compareSlot.def.id, candidateId)}
        onReroll={(candidateId) => rerollCandidate(compareSlot.def.id, candidateId)}
        interactionLocked={interactionLocked}
      />
    )}
    </>
  )
}
