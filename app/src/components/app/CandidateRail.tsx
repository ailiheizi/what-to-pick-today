import { useCallback, useEffect, useRef, useState } from 'react'
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
  Zap,
} from 'lucide-react'
import { useStore, type CandidateState } from '../../lib/store'
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
  // 顶栏这类槽位的预览框只有 ~46px 高，多行说明会被裁掉。
  // 窄框只留徽标（失败原因在上方状态条里已经完整给过一次）。
  const previewBoxH = previewH * 0.52
  const roomyPreview = previewBoxH >= 72
  const [isLocking, setIsLocking] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      onClick={() => ready && onTryOn()}
      className={`candidate-choice-card group relative snap-center shrink-0 rounded-2xl border bg-white overflow-hidden ${
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
      {/* 实时预览（缩放） */}
      <div className="relative bg-neutral-50 border-b border-neutral-100 overflow-hidden" style={{ height: previewBoxH }}>
        {ready ? (
          <div className={`pointer-events-none origin-top-left ${cand.anim}`} style={{ width: '192%', transform: 'scale(0.52)' }}>
            {cand.artifact ? (
              <GeneratedCandidatePreview candidate={cand.artifact} cssVariables={cssVariables} />
            ) : (
              <cand.def.Component />
            )}
          </div>
        ) : cand.streamPreviewHtml ? (
          <div className="pointer-events-none origin-top-left" style={{ width: '192%', height: previewH, transform: 'scale(0.52)' }}>
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
          <div className="text-[11px] font-bold text-neutral-800 truncate">{variantLabel}</div>
          <div className="text-[9px] text-neutral-400 truncate">{variantBlurb}</div>
        </div>
        <button
          disabled={!ready || isSelected || isLocking}
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
              onClick={(event) => {
                event.stopPropagation()
                onReroll()
              }}
              className="shrink-0 rounded-full bg-amber-400 px-2 py-1 text-[8px] font-extrabold text-amber-950 hover:bg-amber-300"
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

/** 整条候选轨共用一个计时器：now 每 500ms 前进一次，每张卡记一次开工/收工时刻。 */
type RailClock = { now: number; startedAt: Record<string, number>; settledAt: Record<string, number> }
const EMPTY_CLOCK: RailClock = { now: 0, startedAt: {}, settledAt: {} }

export default function CandidateRail() {
  const { slots, activeSlotId, setActiveSlot, tryOn, confirmCandidate, rerollCandidate, phase, directionId, harnessMode } = useStore()
  const cssVariables = getDirection(directionId ?? 'apple').vars
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastIdx = useRef(-1)

  const activeSlot = slots.find((s) => s.def.id === activeSlotId) ?? slots.find((s) => s.status !== 'selected') ?? null

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
    const center = el.getBoundingClientRect().top + el.clientHeight / 2
    const cards = Array.from(el.querySelectorAll<HTMLElement>('[data-cand-card]'))
    let best = -1
    let bestDist = Infinity
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect()
      const d = Math.abs(r.top + r.height / 2 - center)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    if (best >= 0 && best !== lastIdx.current) {
      lastIdx.current = best
      const cand = activeSlot.candidates[best]
      if (cand && cand.status === 'rendered') {
        tryOn(activeSlot.def.id, cand.def.id)
        playTick(best)
      }
    }
  }, [activeSlot, tryOn])

  useEffect(() => {
    lastIdx.current = -1
    scrollRef.current?.scrollTo({ top: 0 })
  }, [activeSlot?.def.id])

  if (phase !== 'generating' && phase !== 'reviewing' && phase !== 'done') {
    return (
      <aside className="w-72 shrink-0 m-3 mt-0 rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-lg flex flex-col items-center justify-center px-6 text-center">
        <div className="anim-float">
          <Layers size={22} className="text-neutral-300" />
        </div>
        <div className="mt-3 text-xs font-bold text-neutral-500">AI 候选区</div>
        <div className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
          生成开始后，这里会实时出现
          <br />
          {harnessMode === 'kimi' ? '确认蓝图后，每个槽位生成 3 个候选。' : '每个槽位的 3 个候选。'}
          <br />
          滚动试穿，点击扣合 🧩
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-72 shrink-0 m-3 mt-0 rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-lg flex flex-col min-h-0 overflow-hidden">
      {/* 槽位切换 */}
      <div className="px-3 pt-3 pb-2">
        <div className="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 mb-2">槽位 · 逐个挑选</div>
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <button
              key={s.def.id}
              onClick={() => {
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
        <div className="candidate-selection-guide pointer-events-none absolute left-2 right-2 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 rounded-2xl px-1 py-2.5">
          <div className="h-px flex-1 bg-neutral-900/30 rounded-full" />
          <span className="text-[8px] font-bold text-neutral-600 bg-white rounded-full px-2 py-1 shadow-md ring-1 ring-neutral-900/10">试穿位置</span>
          <div className="h-px flex-1 bg-neutral-900/30 rounded-full" />
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto snap-y snap-mandatory px-3 py-[38%] space-y-3">
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
            />
          ))}
          {!activeSlot && (
            <div className="pt-6">
              <PlayfulLoader seed={777} label="全部槽位已确认 🎉" />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-2.5 text-[9px] text-neutral-400 leading-relaxed">
        滚动或点击卡片即「试穿」；扣合后仍可随时试穿其他候选并「替换」✨
      </div>
    </aside>
  )
}
