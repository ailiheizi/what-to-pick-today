import { useCallback, useEffect, useRef } from 'react'
import { Check, Layers, Loader2 } from 'lucide-react'
import { useStore, type CandidateState } from '../../lib/store'
import { playClick, playTick } from '../../lib/sound'
import { PlayfulLoader } from './playful'
import GeneratedCandidatePreview from './GeneratedCandidatePreview'
import { getDirection } from '../../lib/dna'

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
  return (
    <div
      data-cand-card
      onClick={() => ready && onTryOn()}
      className={`snap-center shrink-0 rounded-2xl border bg-white overflow-hidden transition-all duration-300 ${
        ready ? 'cursor-pointer' : ''
      } ${
        isSelected
          ? 'border-emerald-400 ring-4 ring-emerald-400/25 scale-[1.01]'
          : isTryOn
            ? 'border-neutral-900 shadow-xl scale-[1.01]'
            : 'border-neutral-200/80 opacity-80 hover:opacity-100'
      }`}
    >
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
          <span className="anim-pop absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-neutral-900 text-white text-[8px] font-bold">试穿中</span>
        )}
        {isSelected && (
          <span className="anim-pop absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[8px] font-bold flex items-center gap-0.5">
            <Check size={8} /> 已拼入
          </span>
        )}
      </div>
      {/* 信息 + 操作 */}
      <div className="px-3 py-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold text-neutral-800 truncate">{cand.def.label}</div>
          <div className="text-[9px] text-neutral-400 truncate">{cand.def.blurb}</div>
        </div>
        <button
          disabled={!ready || isSelected}
          onClick={(e) => {
            e.stopPropagation()
            onConfirm()
          }}
          className={`hover-pop shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors ${
            isSelected
              ? 'bg-emerald-50 text-emerald-600'
              : ready
                ? slotSelected
                  ? 'bg-amber-400 text-amber-950 hover:bg-amber-300 shadow-md'
                  : 'bg-neutral-900 text-white hover:bg-neutral-700 shadow-md'
                : 'bg-neutral-100 text-neutral-300 cursor-not-allowed'
          }`}
        >
          {isSelected ? '✓ 当前' : slotSelected ? '替换 →' : '扣合 →'}
        </button>
      </div>
    </div>
  )
}

export default function CandidateRail() {
  const { slots, activeSlotId, setActiveSlot, tryOn, confirmCandidate, phase, directionId } = useStore()
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
          每个槽位的 3 个候选。
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
              className={`hover-pop px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                s.status === 'selected'
                  ? 'bg-emerald-100 text-emerald-700'
                  : activeSlot?.def.id === s.def.id
                    ? 'bg-neutral-900 text-white shadow'
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
        <div className="pointer-events-none absolute left-3 right-3 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1">
          <div className="h-px flex-1 bg-neutral-900/20 rounded-full" />
          <span className="text-[8px] font-bold text-neutral-400 bg-white/80 rounded-full px-1.5 py-0.5 shadow-sm">选择线</span>
          <div className="h-px flex-1 bg-neutral-900/20 rounded-full" />
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
