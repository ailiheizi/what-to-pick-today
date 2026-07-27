import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Coins, MousePointerClick, PartyPopper, ScanSearch, Wand2 } from 'lucide-react'
import { useStore, type SlotState } from '../../lib/store'
import { DIRECTIONS, getDirection } from '../../lib/dna'
import { EXAMPLE_PROMPTS } from '../../lib/scenarios'
import { ConfettiBurst, ConfettiRain, FloatingEmojis, PlayfulLoader } from './playful'
import GeneratedCandidatePreview from './GeneratedCandidatePreview'
import StreamingHtmlPreview from './StreamingHtmlPreview'

/* ---------------- 空状态：产品自我介绍 ---------------- */

function Welcome({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="relative h-full flex flex-col items-center justify-center px-5 md:px-8 text-center overflow-hidden">
      <FloatingEmojis />
      <div className="anim-pop text-[11px] font-bold tracking-[0.35em] uppercase text-neutral-500">
        What will you pick today?
      </div>
      <h1
        className="anim-bounce-in mt-4 text-5xl md:text-6xl font-black tracking-tight text-neutral-900"
        style={{ animationDelay: '0.1s' }}
      >
        今天
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-orange-400 inline-block hover:anim-wiggle cursor-default">
          选
        </span>
        什么？
      </h1>
      <p className="anim-pop mt-4 max-w-md text-sm leading-relaxed text-neutral-500" style={{ animationDelay: '0.2s' }}>
        一个选择驱动的 AI 原生 UI 生成工具。AI 并发创造可能性，你像挑衣服一样挑选候选，系统像拼积木一样实时拼合页面。
      </p>
      <div className="mt-8 flex w-full max-w-lg flex-col lg:max-w-none lg:flex-row lg:justify-center gap-3">
        {EXAMPLE_PROMPTS.map((p, i) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="hover-pop anim-slide-l w-full lg:w-auto px-5 py-3 rounded-full border border-white/60 bg-white/80 backdrop-blur text-xs font-medium text-neutral-600 hover:text-neutral-900 shadow-md"
            style={{ animationDelay: `${0.3 + i * 0.12}s` }}
          >
            ✨ {p}
          </button>
        ))}
      </div>
      <div className="mt-10 md:mt-12 grid grid-cols-3 gap-4 md:gap-8 text-[10px] text-neutral-500">
        {[
          ['3–6', '并发组件任务', 'anim-float'],
          ['×3', '每槽位候选', 'anim-float'],
          ['1 键', '挑选扣合', 'anim-float'],
        ].map(([n, l, a], i) => (
          <div key={l} className={a} style={{ animationDelay: `${i * 0.5}s` }}>
            <div className="text-2xl font-black text-neutral-800">{n}</div>
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- Planner 规划视图 ---------------- */

function PlanView() {
  const { planNotes, scenario, phase } = useStore()
  return (
    <div className="h-full flex items-center justify-center px-8">
      <div className="w-full max-w-lg rounded-3xl border border-white/60 bg-white/75 backdrop-blur-xl shadow-xl p-6 anim-pop">
        <div className="flex items-center gap-2 text-xs font-bold text-neutral-600">
          <span className="text-base anim-float inline-block">🧠</span> Planner · 正在规划页面结构
        </div>
        <div className="mt-4 space-y-2.5">
          {planNotes.map((n, i) => (
            <div key={i} className="anim-slide-l flex items-start gap-2 text-[13px] text-neutral-700">
              <span className="shrink-0 w-[18px] h-[18px] rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] mt-0.5">
                ✓
              </span>
              {n}
            </div>
          ))}
          {phase === 'planning' && planNotes.length < (scenario?.plannerNotes.length ?? 0) && (
            <PlayfulLoader seed={planNotes.length * 7919 + 13} />
          )}
        </div>
        {scenario && planNotes.length >= 2 && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {scenario.slots.map((s, i) => (
              <div
                key={s.id}
                className="anim-bounce-in rounded-2xl border border-neutral-200/70 bg-white p-2.5"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <div className="text-[11px] font-bold text-neutral-800">{s.role}</div>
                <div className="mt-1 text-[9px] font-mono text-neutral-400 truncate">in: {s.inputs.join(' · ')}</div>
                <div className="text-[9px] font-mono text-neutral-400 truncate">out: {s.outputs.join(' · ') || '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BlueprintView() {
  const { scenario, confirmBlueprint, harnessMode } = useStore()
  if (!scenario) return null
  const candidateCount = scenario.slots.length * 3
  const streamCount = candidateCount * 2
  return (
    <div className="h-full overflow-y-auto px-6 py-8">
      <div className="anim-pop mx-auto w-full max-w-3xl rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-neutral-400">Planner Blueprint</div>
            <h2 className="mt-2 text-2xl font-black text-neutral-900">先确认页面怎么拆</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">确认前不会启动 Builder，也不会产生候选生成费用。</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-1 text-[10px] font-bold text-amber-700"><Coins size={12} /> 预计调用量</div>
            <div className="mt-1 text-lg font-black text-amber-950">{candidateCount} 个候选</div>
            <div className="text-[9px] text-amber-700">最多 {streamCount} 条模型流 · 并发受限</div>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {scenario.slots.map((slot, index) => (
            <div key={slot.id} className="anim-slide-l rounded-2xl border border-neutral-200/80 bg-white p-4" style={{ animationDelay: `${index * 0.08}s` }}>
              <div className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-black text-white">{index + 1}</span>
                <div className="text-[12px] font-extrabold text-neutral-800">{slot.role}</div>
              </div>
              <div className="mt-3 space-y-1 text-[9px] leading-relaxed text-neutral-500">
                <div><span className="font-bold text-neutral-700">输入：</span>{slot.inputs.join(' · ') || '无外部输入'}</div>
                <div><span className="font-bold text-neutral-700">输出：</span>{slot.outputs.join(' · ') || '仅展示'}</div>
                <div><span className="font-bold text-neutral-700">依赖：</span>{slot.dependencies.join(' · ') || '独立槽位'}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col items-center justify-between gap-3 rounded-2xl bg-neutral-950 px-4 py-3 text-white sm:flex-row">
          <div className="text-[10px] leading-relaxed text-neutral-300">
            {harnessMode === 'kimi' ? '确认后先选择 Visual DNA，再由 Motion / Product / Explorer 生成候选。' : '演示模式也遵循相同确认流程。'}
          </div>
          <button onClick={confirmBlueprint} className="hover-pop shrink-0 rounded-full bg-white px-5 py-2.5 text-[11px] font-black text-neutral-950 shadow-lg">
            确认蓝图，选择风格 →
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- 风格底板挑选 ---------------- */

function DirectionPicker() {
  const { chooseDirection } = useStore()
  const tilts = ['-1.5deg', '1deg', '-0.8deg', '1.6deg']
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
      <div className="anim-pop flex items-center gap-2 text-xs font-bold text-neutral-600">
        <MousePointerClick size={13} /> 第一步 · 挑选风格底板（生成一条设计分支）
      </div>
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-4xl">
        {DIRECTIONS.map((d, i) => (
          <button
            key={d.id}
            onClick={() => chooseDirection(d.id)}
            className="hover-pop anim-bounce-in group text-left rounded-3xl border border-white/60 bg-white/80 backdrop-blur p-3 shadow-md hover:shadow-xl"
            style={{ animationDelay: `${i * 0.1}s`, transform: `rotate(${tilts[i % tilts.length]})` }}
          >
            <div
              className="rounded-2xl overflow-hidden h-32 p-3 flex flex-col transition-transform duration-300 group-hover:scale-[1.02]"
              style={{ background: d.vars['--dna-bg'], fontFamily: d.vars['--dna-font'], borderRadius: `calc(${d.vars['--dna-radius']} * 0.8)` }}
            >
              <div className="flex items-center gap-1.5">
                <i className="w-3.5 h-3.5 shrink-0" style={{ background: d.vars['--dna-accent'], borderRadius: `calc(${d.vars['--dna-radius']} / 2)` }} />
                <div className="h-1.5 w-10 rounded-full" style={{ background: d.vars['--dna-text'], opacity: 0.85 }} />
                <div className="ml-auto h-3 w-8" style={{ background: d.vars['--dna-accent'], borderRadius: d.vars['--dna-radius'] }} />
              </div>
              <div className="mt-2.5 flex gap-1.5 flex-1">
                <div
                  className="w-8"
                  style={{ background: d.vars['--dna-surface'], border: `1px solid ${d.vars['--dna-line']}`, borderRadius: `calc(${d.vars['--dna-radius']} / 1.5)` }}
                />
                <div className="flex-1 grid grid-rows-3 gap-1.5">
                  {[0.95, 0.65, 0.8].map((o, j) => (
                    <div
                      key={j}
                      style={{ background: d.vars['--dna-surface'], border: `1px solid ${d.vars['--dna-line']}`, opacity: o, borderRadius: `calc(${d.vars['--dna-radius']} / 1.5)` }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between px-1">
              <div className="text-sm font-black text-neutral-900">{d.name}</div>
              <div className="text-[10px] font-bold text-neutral-300 group-hover:text-neutral-900 transition-colors">选它 →</div>
            </div>
            <div className="mt-1 px-1 text-[10px] leading-relaxed text-neutral-500 line-clamp-2">{d.concept}</div>
          </button>
        ))}
      </div>
      <div className="anim-pop mt-5 text-[10px] text-neutral-500" style={{ animationDelay: '0.45s' }}>
        底板只锁定 Visual DNA（色彩 / 字体 / 圆角 / 动效），之后随时一键换肤
      </div>
    </div>
  )
}

/* ---------------- 槽位外壳：随机加载 / 试穿 / 已确认 ---------------- */

function SlotShell({ slot }: { slot: SlotState }) {
  const { setActiveSlot, tryOn, reportCandidateRuntimeError, activeSlotId, bursts } = useStore()
  // 试穿优先：即使已扣合，试穿其他候选也即时预览（不替换已确认内容）
  const activeCand = slot.candidates.find((c) => c.def.id === (slot.tryOnId ?? slot.selectedId))
  const streaming = slot.candidates.find((c) => c.status === 'streaming' || c.status === 'compiling')
  const failed = slot.candidates.find((c) => c.status === 'failed')
  const queuedSeed = slot.candidates[0]?.seed ?? 1
  const renderedCount = slot.candidates.filter((c) => c.status === 'rendered').length
  const isActive = activeSlotId === slot.def.id
  const selected = slot.status === 'selected'
  const tryingOther = selected && slot.tryOnId && slot.tryOnId !== slot.selectedId
  const burst = bursts[slot.def.id]

  return (
    <div
      onClick={() => setActiveSlot(slot.def.id)}
      className={`relative h-full flex flex-col ${selected && !tryingOther ? '' : isActive ? 'rounded-2xl ring-2 ring-neutral-900/60 ring-offset-2 ring-offset-[var(--dna-bg)]' : ''}`}
    >
      {/* 槽位标签：清楚表达当前状态 */}
      <div className="absolute -top-2.5 left-3 z-10">
        <span
          className={`px-2.5 py-1 rounded-full text-[9px] font-bold tracking-wide shadow-sm transition-colors ${
            tryingOther
              ? 'bg-amber-400 text-amber-950'
              : selected
                ? 'bg-emerald-500 text-white'
                : isActive
                  ? 'bg-neutral-900 text-white'
                  : 'bg-white/90 border border-neutral-200 text-neutral-500'
          }`}
        >
          {tryingOther ? (
            `◐ ${slot.def.role} · 试穿 ${activeCand?.def.label ?? ''}（未替换）`
          ) : selected ? (
            <span className="flex items-center gap-0.5">
              <Check size={9} /> {slot.def.role} · {activeCand?.def.label ?? '已扣合'}
            </span>
          ) : activeCand ? (
            `${slot.def.role} · 试穿 ${activeCand.def.label}`
          ) : failed ? (
            `${slot.def.role} · 生成失败`
          ) : (
            `${slot.def.role} · ${renderedCount}/${Math.max(slot.candidates.length, 1)} 候选`
          )}
        </span>
      </div>

      {activeCand && (activeCand.status === 'rendered' || activeCand.lastGoodArtifact) ? (
        <div key={activeCand.def.id + String(selected && !tryingOther)} className={`relative h-full flex-1 ${selected && !tryingOther ? 'anim-snap' : activeCand.anim}`}>
          {activeCand.artifact || activeCand.lastGoodArtifact ? (
            <GeneratedCandidatePreview
              candidate={activeCand.status === 'rendered' ? activeCand.artifact! : activeCand.lastGoodArtifact!}
              cssVariables={getDirection(useStore.getState().directionId ?? 'apple').vars}
              selection={{ slotId: slot.def.id, candidateId: activeCand.def.id }}
              onSelect={({ slotId, candidateId }) => {
                setActiveSlot(slotId)
                tryOn(slotId, candidateId)
              }}
              onRuntimeError={(error) => reportCandidateRuntimeError(
                slot.def.id,
                activeCand.def.id,
                activeCand.artifact?.attemptId,
                error,
              )}
            />
          ) : (
            <activeCand.def.Component />
          )}
          {activeCand.status !== 'rendered' && activeCand.lastGoodArtifact && (
            <div className="absolute inset-x-3 bottom-3 rounded-2xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-center text-[9px] font-bold text-amber-800 shadow-lg backdrop-blur">
              {activeCand.status === 'failed' ? '运行时修复失败 · 已保留上一帧，不能导出' : '运行时错误正在修复 · 已保留上一帧'}
            </div>
          )}
          {tryingOther ? (
            <div className="anim-pop absolute top-2 right-2 px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[9px] font-bold backdrop-blur">
              试穿中 · 点「替换」生效
            </div>
          ) : (
            !selected && (
              <div className="anim-pop absolute top-2 right-2 px-2 py-0.5 rounded-full bg-neutral-900/85 text-white text-[9px] font-medium backdrop-blur">
                试穿中 · {activeCand.def.label}
              </div>
            )
          )}
          {selected && !tryingOther && burst && <ConfettiBurst key={burst} seed={burst} />}
        </div>
      ) : (
        /* 模型先流式返回无脚本 HTML 草图，完整 React 编译后原位替换。 */
        <div className="rounded-2xl border border-neutral-300/70 bg-white/60 backdrop-blur overflow-hidden" style={{ minHeight: Math.min(Math.max(slot.def.previewH, 200), 360) }}>
          {streaming ? (
            streaming.streamPreviewHtml ? (
              <StreamingHtmlPreview
                html={streaming.streamPreviewHtml}
                cssVariables={getDirection(useStore.getState().directionId ?? 'apple').vars}
                title={`${slot.def.role} · API 流式草图`}
              />
            ) : (
              <div className="px-3 pt-3">
                <PlayfulLoader seed={streaming.seed} label={streaming.status === 'compiling' ? '编译组装中' : '等待 API 第一帧'} />
                <pre className="px-2 pb-2 text-[9px] leading-relaxed font-mono text-neutral-400 whitespace-pre-wrap break-all max-h-16 overflow-hidden opacity-70">
                  {streaming.code.slice(0, streaming.progress).split('\n').slice(-4).join('\n')}
                  <span className="inline-block w-1.5 h-3 bg-neutral-400 align-middle animate-pulse" />
                </pre>
              </div>
            )
          ) : failed ? (
            <div className="px-4 py-5 text-center">
              <div className="text-[11px] font-bold text-rose-500">这个候选没有组装成功</div>
              <div className="mt-1 text-[9px] text-rose-400 line-clamp-2">{failed.error ?? '可以点击重新生成继续'}</div>
            </div>
          ) : (
            <PlayfulLoader seed={queuedSeed + 31} label="排队等待灵感" />
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------- 风格氛围层：CRT 扫描线 / 纸张颗粒 ---------------- */

const GRAIN_URI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`

function StyleAtmosphere({ dirId }: { dirId: string }) {
  if (dirId === 'hacker') {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {/* 静态扫描线：repeating 2px 细线，低透明度"耳语" */}
        <div
          className="absolute inset-0 opacity-40"
          style={{ background: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,0.22) 3px, transparent 4px)' }}
        />
        {/* 边缘暗角，模拟 CRT 曲面玻璃 */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)' }} />
        {/* 缓慢下扫的磷光带 */}
        <div
          className="absolute left-0 right-0 h-16"
          style={{ background: 'linear-gradient(to bottom, transparent, rgba(0,255,65,0.05), transparent)', animation: 'scanline 4s linear infinite' }}
        />
      </div>
    )
  }
  if (dirId === 'retro') {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {/* 纸张颗粒噪点 */}
        <div className="absolute inset-0 opacity-30 mix-blend-multiply" style={{ backgroundImage: GRAIN_URI }} />
        {/* 轻微泛黄的旧纸边缘 */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(120,95,50,0.12) 100%)' }} />
      </div>
    )
  }
  return null
}

function ReviewOverlay() {
  const { reviewSteps, phase } = useStore()
  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center pb-20 bg-gradient-to-t from-white/90 via-white/30 to-transparent pointer-events-none">
      <div className="anim-bounce-in w-full max-w-md mx-4 rounded-3xl border border-white/60 bg-white/90 backdrop-blur-xl shadow-2xl p-5 pointer-events-auto">
        <div className="flex items-center gap-2 text-xs font-black text-neutral-800">
          {phase === 'reviewing' ? (
            <ScanSearch size={15} className="text-indigo-500 animate-pulse" />
          ) : (
            <PartyPopper size={15} className="text-amber-500 anim-wiggle" />
          )}
          {phase === 'reviewing' ? 'Reviewer · 视觉反馈循环' : '审查完成 · 补丁已应用 🎉'}
        </div>
        <div className="mt-3 space-y-2.5 max-h-44 overflow-y-auto">
          {reviewSteps.map((s, i) => (
            <div key={i} className="anim-slide-l">
              <div className="text-[11px] text-neutral-600">{s.text}</div>
              {s.patch && (
                <div className="anim-pop mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[10px] font-mono text-indigo-600">
                  <Wand2 size={9} /> {s.patch}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** reviewing 期间常显；done 后展示 6 秒审查报告再自动收起 */
function ReviewOverlayGate() {
  const phase = useStore((s) => s.phase)
  const [show, setShow] = useState(true)
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setShow(false), 6000)
    return () => clearTimeout(t)
  }, [phase])
  if (!show) return null
  return (
    <div onClick={() => phase === 'done' && setShow(false)}>
      <ReviewOverlay />
    </div>
  )
}

/* ---------------- 画布主体 ---------------- */

export default function CanvasStage() {
  const { phase, slots, directionId, scenario, tweaks, submitPrompt, bigConfetti, harnessMode } = useStore()
  const dir = getDirection(directionId ?? 'apple')
  const scrollRef = useRef<HTMLDivElement>(null)

  const vars = useMemo(() => {
    const v = { ...dir.vars } as Record<string, string>
    if (tweaks.radiusBoost) v['--dna-radius'] = `calc(${dir.vars['--dna-radius']} * 1.6)`
    if (tweaks.elevation) v['--dna-shadow'] = '0 2px 4px rgba(0,0,0,0.10), 0 12px 32px rgba(0,0,0,0.14)'
    return v
  }, [dir, tweaks])

  const glass = dir.vars['--dna-blur'] && dir.vars['--dna-blur'] !== '0px'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [phase])

  const slotById = (id: string) => slots.find((s) => s.def.id === id)
  const gapCls = tweaks.density ? 'gap-4' : 'gap-5'
  const candidateTotal = slots.reduce((total, slot) => total + slot.candidates.length, 0)

  return (
    <main className="flex-1 min-w-0 relative">
      <div ref={scrollRef} className="absolute inset-0 overflow-y-auto rounded-3xl">
        {phase === 'idle' && <Welcome onPick={submitPrompt} />}
        {(phase === 'planning' || (phase === 'direction' && !scenario)) && <PlanView />}
        {phase === 'blueprint' && scenario && <BlueprintView />}
        {phase === 'direction' && scenario && <DirectionPicker />}

        {(phase === 'generating' || phase === 'reviewing' || phase === 'done') && scenario && (
          <div className="min-h-full px-5 pt-4 pb-32">
            <div
              className="anim-pop relative mx-auto max-w-4xl rounded-[28px] overflow-hidden shadow-2xl transition-colors duration-500 border border-white/50"
              style={{
                ...(vars as React.CSSProperties),
                background: 'var(--dna-bg)',
                fontFamily: 'var(--dna-font)',
                ...(glass ? { backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)' } : {}),
              }}
            >
              {/* 风格氛围层：黑客=CRT 扫描线组，复古=纸张颗粒 */}
              <StyleAtmosphere dirId={dir.id} />
              {scenario.layout === 'dashboard' ? (
                <div className="flex flex-col">
                  {slotById('header') && <SlotShell slot={slotById('header')!} />}
                  <div className="flex">
                    {slotById('sidebar') && <SlotShell slot={slotById('sidebar')!} />}
                    <div className={`flex-1 min-w-0 p-4 flex flex-col ${gapCls}`} style={{ transition: 'gap 0.5s' }}>
                      {slotById('stats') && <SlotShell slot={slotById('stats')!} />}
                      {slotById('chart') && <SlotShell slot={slotById('chart')!} />}
                      {slotById('table') && <SlotShell slot={slotById('table')!} />}
                    </div>
                  </div>
                </div>
              ) : scenario.layout === 'landing' ? (
                <div className={`flex flex-col ${gapCls}`}>
                  {['nav', 'hero', 'features', 'cta'].map((id) => {
                    const sl = slotById(id)
                    return sl ? <SlotShell key={id} slot={sl} /> : null
                  })}
                </div>
              ) : (
                <div className={`flex flex-col p-4 ${gapCls}`}>
                  {slots.map((slot) => (
                    <div key={slot.def.id} style={{ minHeight: Math.min(Math.max(slot.def.previewH, 120), 420) }}>
                      <SlotShell slot={slot} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mx-auto max-w-4xl mt-3 flex items-center justify-between text-[10px] text-neutral-500">
              <span>沙箱预览 · iframe 隔离 + CSP + 依赖白名单（{harnessMode === 'kimi' ? '真实生成' : '演示模式'}）</span>
              <span className="font-mono">
                {scenario.slots.length} slots · {Math.max(candidateTotal, scenario.slots.length)} candidates
              </span>
            </div>
          </div>
        )}
      </div>

      {(phase === 'reviewing' || phase === 'done') && <ReviewOverlayGate key={phase} />}
      {bigConfetti > 0 && <ConfettiRain key={bigConfetti} seed={bigConfetti} />}
    </main>
  )
}
