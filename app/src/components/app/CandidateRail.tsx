import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, CircleAlert, Layers, Loader2, MousePointer2, Sparkles } from 'lucide-react'
import { useStore, type CandidateState } from '../../lib/store'
import { playClick, playTick } from '../../lib/sound'
import { PlayfulLoader } from './playful'
import GeneratedCandidatePreview from './GeneratedCandidatePreview'
import StreamingHtmlPreview from './StreamingHtmlPreview'
import { getDirection } from '../../lib/dna'

const FALLBACK_AGENTS = {
  expressive: { id: 'motion', name: 'Motion Agent', role: '动效与情绪反馈' },
  conservative: { id: 'product', name: 'Product Agent', role: '产品结构与可用性' },
  experimental: { id: 'explorer', name: 'Explorer Agent', role: '探索式构图与交互' },
} as const

const GENERATION_STEPS = ['排队', '草图', '写组件', '编译', '完成'] as const

function candidateActivity(cand: CandidateState) {
  const hasSource = cand.code.length > 0 || Boolean(cand.artifact)
  const step = cand.status === 'queued'
    ? 0
    : cand.status === 'streaming'
      ? hasSource ? 2 : 1
      : cand.status === 'compiling'
        ? 3
        : cand.status === 'rendered'
          ? 4
          : hasSource ? 3 : 1

  const label = cand.status === 'failed'
    ? '生成失败'
    : cand.status === 'streaming' && hasSource
      ? '正在写组件'
      : cand.status === 'streaming'
        ? '正在画草图'
        : cand.status === 'compiling'
          ? cand.error ? '正在自动修复' : '正在编译'
          : cand.status === 'rendered'
            ? '候选已完成'
            : '等待启动'

  return { step, label }
}

function CandidateCard({
  cand,
  previewH,
  isTryOn,
  isSelected,
  slotSelected,
  onTryOn,
  onConfirm,
  cssVariables,
}: {
  cand: CandidateState
  previewH: number
  isTryOn: boolean
  isSelected: boolean
  slotSelected: boolean
  onTryOn: () => void
  onConfirm: () => void
  cssVariables: Record<string, string>
}) {
  const ready = cand.status === 'rendered'
  const agent = cand.artifact?.agent ?? FALLBACK_AGENTS[cand.def.style]
  const activity = candidateActivity(cand)
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
      data-state={isSelected ? 'selected' : isTryOn ? 'trying' : 'idle'}
      onClick={() => ready && onTryOn()}
      className={`candidate-choice-card group relative snap-center shrink-0 rounded-2xl border bg-white overflow-hidden ${
        ready ? 'cursor-pointer' : ''
      } ${
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
      <div className="candidate-agent-panel relative z-[1] px-3 pt-2.5 pb-2" data-agent={agent.id}>
        <div className="flex items-center gap-2">
          <span className="candidate-agent-avatar flex size-7 shrink-0 items-center justify-center rounded-xl">
            <Bot size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[10px] font-extrabold text-neutral-800">{agent.name}</span>
              <span className={`candidate-agent-live-dot ${cand.status === 'rendered' || cand.status === 'failed' ? 'is-settled' : ''}`} />
            </div>
            <div className="truncate text-[8px] font-medium text-neutral-500">{agent.role}</div>
          </div>
          <div className={`candidate-agent-status flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[8px] font-bold ${cand.status === 'failed' ? 'is-failed' : ''}`}>
            {cand.status === 'failed'
              ? <CircleAlert size={9} />
              : cand.status !== 'rendered' && <Loader2 size={9} className="animate-spin" />}
            {activity.label}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1" aria-label={`生成进度：${activity.label}，第 ${activity.step + 1} 步，共 ${GENERATION_STEPS.length} 步`}>
          {GENERATION_STEPS.map((stepLabel, index) => (
            <div key={stepLabel} className="min-w-0 flex-1">
              <div
                className={`candidate-agent-step h-1 rounded-full ${
                  index < activity.step || cand.status === 'rendered'
                    ? 'is-done'
                    : index === activity.step
                      ? cand.status === 'failed' ? 'is-failed' : 'is-active'
                      : ''
                }`}
              />
              <div className={`mt-1 truncate text-center text-[6px] font-bold ${index === activity.step ? 'text-neutral-600' : 'text-neutral-300'}`}>
                {stepLabel}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* 实时预览（缩放） */}
      <div className="relative bg-neutral-50 border-b border-neutral-100 overflow-hidden" style={{ height: previewH * 0.52 }}>
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
        ) : cand.status === 'failed' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
            <span className="text-[10px] font-bold text-rose-500">生成失败</span>
            <span className="mt-1 text-[8px] text-rose-400 line-clamp-3">{cand.error ?? '请重新生成'}</span>
          </div>
        ) : cand.status === 'queued' ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-neutral-400">queued · 排队中 ⏳</span>
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
          <div className="text-[11px] font-bold text-neutral-800 truncate">{cand.def.label}</div>
          <div className="text-[9px] text-neutral-400 truncate">{cand.def.blurb}</div>
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
      {(isTryOn || isSelected) && ready && (
        <div className={`candidate-choice-statebar ${isSelected ? 'bg-emerald-400' : 'bg-neutral-900'}`} />
      )}
    </div>
  )
}

export default function CandidateRail() {
  const { slots, activeSlotId, setActiveSlot, tryOn, confirmCandidate, phase, directionId, harnessMode } = useStore()
  const cssVariables = getDirection(directionId ?? 'apple').vars
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastIdx = useRef(-1)

  const activeSlot = slots.find((s) => s.def.id === activeSlotId) ?? slots.find((s) => s.status !== 'selected') ?? null

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
          {harnessMode === 'kimi' ? '首轮每个槽位先生成 1 个候选。' : '每个槽位的 3 个候选。'}
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
              onTryOn={() => {
                tryOn(activeSlot.def.id, c.def.id)
                playClick()
              }}
              onConfirm={() => confirmCandidate(activeSlot.def.id, c.def.id)}
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
