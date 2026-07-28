import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Clock3, Coins, Link2, MousePointerClick, PartyPopper, ScanSearch, Wand2 } from 'lucide-react'
import { useStore, type SlotState } from '../../lib/store'
import type { Scenario, SlotDef } from '../../candidates/types'
import { DIRECTIONS, getDirection } from '../../lib/dna'
import { EXAMPLE_PROMPTS } from '../../lib/scenarios'
import { inferSemanticBindings, signalName } from '../../lib/harness/bindings'
import { ConfettiBurst, ConfettiRain, FloatingEmojis } from './playful'
import GeneratedCandidatePreview from './GeneratedCandidatePreview'
import GeneratedCompositionPreview from './GeneratedCompositionPreview'
import StreamingHtmlPreview from './StreamingHtmlPreview'

/* ---------------- 空状态：产品自我介绍 ---------------- */

function Welcome({ onPick }: { onPick: (p: string) => void }) {
  const { recentProjects, refreshRecentProjects, restoreProject } = useStore()
  useEffect(() => { void refreshRecentProjects() }, [refreshRecentProjects])
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
      {recentProjects.length > 0 && (
        <div className="anim-pop mt-6 w-full max-w-2xl rounded-[24px] border border-white/70 bg-white/65 p-3 text-left shadow-lg backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-extrabold text-neutral-500"><Clock3 size={12} /> 最近项目</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recentProjects.slice(0, 4).map((project) => (
              <button key={project.sessionId} type="button" onClick={() => void restoreProject(project.sessionId)} className="hover-pop rounded-2xl border border-neutral-200/70 bg-white/80 px-3 py-2.5 text-left hover:border-violet-300 hover:shadow-md">
                <div className="truncate text-[11px] font-extrabold text-neutral-800">{project.plan?.project.name ?? project.requirement}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[8px] text-neutral-400">
                  <span>{project.plan?.components.length ?? 0} 个槽位 · {project.candidates.length} 个候选</span>
                  <span>{new Date(project.updatedAt).toLocaleDateString('zh-CN')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
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
  const { planNotes, scenario, phase, prompt, startedAt } = useStore()
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt))
  useEffect(() => {
    if (phase !== 'planning') return
    const tick = window.setInterval(() => setElapsed(Math.max(0, Date.now() - startedAt)), 250)
    return () => window.clearInterval(tick)
  }, [phase, startedAt])
  const seconds = elapsed / 1000
  const stages = [
    { label: '理解需求', detail: prompt ? `已收到 ${prompt.length} 个字符` : '读取用户目标', doneAt: 0.4 },
    { label: '拆分页面', detail: '推断可独立挑选的槽位', doneAt: 2.2 },
    { label: '定义接口', detail: '连接组件输入与输出', doneAt: 4.8 },
    { label: '生成方向', detail: '准备 Visual DNA 候选', doneAt: 7.5 },
  ]
  return (
    <div className="h-full overflow-y-auto px-6 py-8">
      <div className="anim-frame-in mx-auto grid w-full max-w-4xl gap-4 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="rounded-[28px] border border-white/60 bg-white/80 p-6 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-neutral-600">
            <span className="flex items-center gap-2"><span className="text-base anim-float inline-block">🧠</span> Planner · 正在规划</span>
            <span className="rounded-full bg-emerald-100 px-2 py-1 font-mono text-[9px] text-emerald-700">{seconds.toFixed(1)}s</span>
          </div>
          <div className="mt-5 space-y-3">
            {stages.map((stage, index) => {
              const done = seconds >= stage.doneAt
              const active = !done && (index === 0 || seconds >= stages[index - 1].doneAt)
              return (
                <div key={stage.label} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-all ${done ? 'border-emerald-100 bg-emerald-50/70' : active ? 'border-violet-200 bg-violet-50 shadow-sm' : 'border-neutral-100 bg-white/50 opacity-55'}`}>
                  <span className={`flex size-6 items-center justify-center rounded-full text-[10px] font-black ${done ? 'bg-emerald-500 text-white' : active ? 'bg-violet-600 text-white animate-pulse' : 'bg-neutral-100 text-neutral-400'}`}>{done ? '✓' : index + 1}</span>
                  <div><div className="text-[11px] font-extrabold text-neutral-700">{stage.label}</div><div className="text-[8px] text-neutral-400">{stage.detail}</div></div>
                </div>
              )
            })}
          </div>
          {seconds > 8 && <div className="mt-4 rounded-2xl bg-amber-50 px-3 py-2 text-[9px] leading-relaxed text-amber-700">模型正在校验结构化输出；页面框架已经在右侧预绘，不需要盯着空白等待。</div>}
        </div>
        <div className="relative min-h-[420px] overflow-hidden rounded-[28px] border border-white/60 bg-white/65 p-5 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between"><div><div className="text-[10px] font-black text-neutral-700">即时页面轮廓</div><div className="mt-0.5 text-[8px] text-neutral-400">本地预绘 · 不等待模型返回</div></div><span className="rounded-full bg-violet-100 px-2 py-1 text-[8px] font-bold text-violet-700">实时细化中</span></div>
          <div className="mt-4 space-y-3 rounded-3xl border border-neutral-200/70 bg-gradient-to-br from-violet-50/80 via-white to-amber-50/70 p-4">
            <div className="flex items-center gap-2 rounded-2xl border border-white bg-white/70 px-3 py-2"><i className="size-5 rounded-lg bg-neutral-800/80" /><i className="h-2 w-20 rounded-full bg-neutral-300" /><div className="ml-auto flex gap-2">{[24, 32, 22].map((width) => <i key={width} className="h-2 rounded-full bg-neutral-200" style={{ width }} />)}</div></div>
            <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((item) => <div key={item} className="h-20 rounded-2xl border border-white bg-white/70 p-3"><i className="block h-2 w-1/2 rounded-full bg-neutral-200" /><i className="mt-4 block h-5 w-3/4 rounded-lg bg-violet-200/80" /></div>)}</div>
            <div className="flex h-36 items-end gap-2 rounded-2xl border border-white bg-white/70 px-4 pb-4 pt-8">{[42, 66, 54, 82, 63, 92, 70, 80].map((height, index) => <i key={index} className="flex-1 rounded-t-lg bg-gradient-to-t from-violet-300 to-fuchsia-200" style={{ height: `${height}%`, animation: `pulse 1.5s ${index * 80}ms ease-in-out infinite alternate` }} />)}</div>
            <div className="space-y-2 rounded-2xl border border-white bg-white/70 p-3">{[0, 1, 2].map((item) => <div key={item} className="flex items-center gap-3"><i className="size-6 rounded-full bg-neutral-200" /><i className="h-2 flex-1 rounded-full bg-neutral-200" /><i className="h-2 w-16 rounded-full bg-amber-200" /></div>)}</div>
          </div>
          {planNotes.length > 0 && <div className="absolute inset-x-5 bottom-5 flex flex-wrap gap-1.5">{planNotes.slice(-3).map((note, index) => <span key={`${note}-${index}`} className="anim-pop rounded-full border border-white bg-neutral-900/80 px-2.5 py-1 text-[8px] font-bold text-white shadow backdrop-blur">✓ {note}</span>)}</div>}
          {scenario && planNotes.length >= 2 && (
            <div className="absolute inset-x-5 bottom-5 grid grid-cols-3 gap-2">
              {scenario.slots.slice(0, 3).map((slot) => <div key={slot.id} className="rounded-xl bg-neutral-900/85 px-2 py-1.5 text-[8px] font-bold text-white shadow">{slot.role}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type WireframeKind = 'nav' | 'sidebar' | 'stats' | 'chart' | 'table' | 'hero' | 'features' | 'cta' | 'atomic' | 'section'

type BlueprintBinding = {
  from: SlotDef
  to: SlotDef
  signal: string
  mode: 'signal' | 'context'
}

function contractForSlot(slot: SlotDef) {
  return {
    id: slot.id, role: slot.role, slot: slot.id, width: slot.width,
    inputs: slot.inputs.map((input) => ({ name: signalName(input), type: input.split(':').slice(1).join(':').trim() || 'unknown', required: false })),
    outputs: slot.outputs.map((output) => ({ name: signalName(output), payload: output.split(':').slice(1).join(':').trim() || 'unknown' })),
    dependencies: slot.dependencies, designTokens: [],
  }
}

function inferBlueprintBindings(slots: SlotDef[]): BlueprintBinding[] {
  const byId = new Map(slots.map((slot) => [slot.id, slot]))
  const contracts = slots.map(contractForSlot)
  const bindings = inferSemanticBindings(contracts).flatMap((binding) => binding.targets.map((target) => ({
    from: byId.get(binding.fromComponentId)!, to: byId.get(target.componentId)!,
    signal: binding.outputName, mode: 'signal' as const,
  }))).filter((binding) => binding.from && binding.to)
  if (bindings.length > 0) return bindings.slice(0, 4)

  // Some otherwise valid planners return display-only contracts. The page is
  // still one composition, so show the ordering/context relationship without
  // pretending an event binding exists. A later plan with matching I/O names
  // automatically replaces these softer links with precise signal bindings.
  return slots.slice(0, -1).map((from, index) => ({
    from,
    to: slots[index + 1],
    signal: '共享页面上下文',
    mode: 'context' as const,
  })).slice(0, 3)
}

function wireframeKind(slot: SlotDef): WireframeKind {
  const text = `${slot.id} ${slot.role}`
  if (/nav|header|导航|顶栏|头部/i.test(text)) return 'nav'
  if (/sidebar|侧栏/i.test(text)) return 'sidebar'
  if (/stats|metric|指标|数据卡/i.test(text)) return 'stats'
  if (/chart|graph|图表|趋势/i.test(text)) return 'chart'
  if (/table|list|feed|列表|表格|订单/i.test(text)) return 'table'
  if (/hero|首屏|主视觉/i.test(text)) return 'hero'
  if (/feature|特性|功能/i.test(text)) return 'features'
  if (/cta|行动|召唤|订阅/i.test(text)) return 'cta'
  if (/计数|计算器|计时|播放器|表单|counter|calculator|timer|player|form/i.test(text)) return 'atomic'
  return 'section'
}

function WireframeContent({ kind }: { kind: WireframeKind }) {
  if (kind === 'nav') {
    return (
      <div className="flex h-full items-center gap-2 px-3">
        <i className="h-3 w-12 rounded-full bg-neutral-700/70" />
        <div className="ml-auto flex gap-1.5">{[20, 28, 22].map((width, index) => <i key={index} className="h-1.5 rounded-full bg-neutral-300" style={{ width }} />)}</div>
        <i className="h-5 w-12 rounded-full bg-neutral-800/80" />
      </div>
    )
  }
  if (kind === 'sidebar') {
    return <div className="flex h-full flex-col gap-2 px-3 pt-9">{[70, 82, 58, 76, 64].map((width, index) => <i key={index} className="h-2 rounded-full bg-neutral-300" style={{ width: `${width}%` }} />)}</div>
  }
  if (kind === 'stats') {
    return <div className="grid h-full grid-cols-3 gap-2 px-3 pb-3 pt-8">{[0, 1, 2].map((item) => <div key={item} className="rounded-xl border border-neutral-200 bg-white p-2"><i className="block h-1.5 w-8 rounded-full bg-neutral-300" /><i className="mt-2 block h-4 w-12 rounded-md bg-neutral-700/70" /></div>)}</div>
  }
  if (kind === 'chart') {
    return (
      <div className="flex h-full items-end gap-2 px-4 pb-3 pt-9">
        {[34, 58, 45, 76, 64, 88, 54, 72].map((height, index) => <i key={index} className="flex-1 rounded-t-md bg-gradient-to-t from-neutral-500/55 to-neutral-300/80" style={{ height: `${height}%` }} />)}
      </div>
    )
  }
  if (kind === 'table') {
    return <div className="space-y-2 px-3 pb-3 pt-9">{[0, 1, 2, 3].map((row) => <div key={row} className="grid grid-cols-[1.2fr_0.8fr_0.6fr] gap-2"><i className="h-2 rounded-full bg-neutral-300" /><i className="h-2 rounded-full bg-neutral-200" /><i className="h-2 rounded-full bg-neutral-300" /></div>)}</div>
  }
  if (kind === 'hero') {
    return (
      <div className="grid h-full grid-cols-[1.05fr_0.95fr] gap-3 px-4 pb-4 pt-9">
        <div className="flex flex-col justify-center"><i className="h-3 w-3/4 rounded-full bg-neutral-700/75" /><i className="mt-2 h-3 w-5/6 rounded-full bg-neutral-700/55" /><i className="mt-3 h-2 w-full rounded-full bg-neutral-200" /><i className="mt-1.5 h-2 w-4/5 rounded-full bg-neutral-200" /><i className="mt-4 h-6 w-20 rounded-full bg-neutral-800/80" /></div>
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-inner"><div className="m-3 h-[calc(100%-1.5rem)] rounded-xl bg-gradient-to-br from-neutral-100 to-neutral-200" /></div>
      </div>
    )
  }
  if (kind === 'features') {
    return <div className="grid h-full grid-cols-3 gap-2 px-3 pb-3 pt-9">{[0, 1, 2].map((item) => <div key={item} className="rounded-xl border border-neutral-200 bg-white p-2"><i className="block size-5 rounded-lg bg-neutral-300" /><i className="mt-3 block h-2 w-3/4 rounded-full bg-neutral-600/60" /><i className="mt-2 block h-1.5 w-full rounded-full bg-neutral-200" /></div>)}</div>
  }
  if (kind === 'cta') {
    return <div className="flex h-full flex-col items-center justify-center px-4 pt-6"><i className="h-3 w-2/3 rounded-full bg-neutral-700/70" /><i className="mt-2 h-2 w-4/5 rounded-full bg-neutral-200" /><i className="mt-4 h-6 w-24 rounded-full bg-neutral-800/80" /></div>
  }
  if (kind === 'atomic') {
    return <div className="mx-auto flex h-full w-4/5 flex-col items-center justify-center px-4 pt-6"><i className="h-7 w-24 rounded-xl bg-neutral-700/75" /><div className="mt-4 grid w-full grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map((item) => <i key={item} className="aspect-square rounded-xl border border-neutral-200 bg-white" />)}</div></div>
  }
  return <div className="grid h-full grid-cols-2 gap-3 px-4 pb-4 pt-9"><div className="rounded-xl bg-white shadow-inner" /><div className="space-y-2 pt-2"><i className="block h-3 w-3/4 rounded-full bg-neutral-600/60" /><i className="block h-2 w-full rounded-full bg-neutral-200" /><i className="block h-2 w-4/5 rounded-full bg-neutral-200" /></div></div>
}

function WireframeSlot({ slot, index, active, incoming, outgoing, onSelect, className = '' }: { slot: SlotDef; index: number; active: boolean; incoming: boolean; outgoing: boolean; onSelect: () => void; className?: string }) {
  const kind = wireframeKind(slot)
  return (
    <button
      type="button"
      data-wireframe-slot={slot.id}
      aria-pressed={active}
      onClick={onSelect}
      className={`group relative min-h-0 overflow-hidden rounded-2xl border text-left transition-all duration-300 ${active ? 'border-indigo-500 bg-indigo-50/80 shadow-[0_0_0_3px_rgba(99,102,241,0.14)]' : 'border-neutral-200 bg-neutral-50 hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md'} ${className}`}
    >
      <span className={`absolute left-2.5 top-2 z-10 flex items-center gap-1.5 rounded-full px-2 py-1 text-[8px] font-black shadow-sm ${active ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-600'}`}>
        <b className="font-mono">{String(index + 1).padStart(2, '0')}</b>{slot.role}
      </span>
      {incoming && <span className="absolute -left-px top-1/2 z-20 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow" title="接收其他槽位的数据" />}
      {outgoing && <span className="absolute -right-px top-1/2 z-20 size-2.5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-fuchsia-500 shadow" title="向其他槽位发送事件" />}
      <WireframeContent kind={kind} />
    </button>
  )
}

function BlueprintWireframe({ scenario, activeSlotId, onSelect }: { scenario: Scenario; activeSlotId: string; onSelect: (slotId: string) => void }) {
  const indexed = new Map(scenario.slots.map((slot, index) => [slot.id, index]))
  const bindings = inferBlueprintBindings(scenario.slots)
  const roles = scenario.slots.map((slot) => `${slot.id} ${slot.role}`).join(' ')
  const inferredLayout = scenario.layout !== 'freeform'
    ? scenario.layout
    : /hero|主视觉|cta|行动召唤/i.test(roles)
      ? 'landing'
      : /sidebar|侧栏|chart|图表|table|列表|指标/i.test(roles)
        ? 'dashboard'
        : 'freeform'
  const find = (kind: WireframeKind) => scenario.slots.find((slot) => wireframeKind(slot) === kind)
  const renderSlot = (slot: SlotDef | undefined, className: string) => slot ? (
    <WireframeSlot
      key={slot.id}
      slot={slot}
      index={indexed.get(slot.id) ?? 0}
      active={activeSlotId === slot.id}
      incoming={bindings.some((binding) => binding.to.id === slot.id)}
      outgoing={bindings.some((binding) => binding.from.id === slot.id)}
      onSelect={() => onSelect(slot.id)}
      className={className}
    />
  ) : null

  let body: React.ReactNode
  if (inferredLayout === 'dashboard') {
    const header = find('nav')
    const sidebar = find('sidebar')
    const stats = find('stats')
    const chart = find('chart')
    const table = find('table')
    const used = new Set([header, sidebar, stats, chart, table].filter(Boolean).map((slot) => slot!.id))
    const remaining = scenario.slots.filter((slot) => !used.has(slot.id))
    body = (
      <div className="flex h-full flex-col gap-2">
        {renderSlot(header, 'h-[58px] shrink-0')}
        <div className="flex min-h-0 flex-1 gap-2">
          {renderSlot(sidebar, 'w-[24%] shrink-0')}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {renderSlot(stats, 'h-[82px] shrink-0')}
            {renderSlot(chart, 'min-h-[120px] flex-[1.25]')}
            {renderSlot(table, 'min-h-[88px] flex-1')}
            {remaining.map((slot) => renderSlot(slot, 'min-h-[76px] flex-1'))}
          </div>
        </div>
      </div>
    )
  } else if (inferredLayout === 'landing') {
    body = (
      <div className="flex h-full flex-col gap-2">
        {scenario.slots.map((slot) => {
          const kind = wireframeKind(slot)
          const height = kind === 'nav' ? 'h-[52px] shrink-0' : kind === 'hero' ? 'flex-[1.5] min-h-[145px]' : kind === 'features' ? 'flex-1 min-h-[112px]' : kind === 'cta' ? 'h-[88px] shrink-0' : 'min-h-[84px] flex-1'
          return renderSlot(slot, height)
        })}
      </div>
    )
  } else {
    const single = scenario.slots.length === 1
    body = (
      <div className={`grid h-full gap-2 ${single ? 'place-items-center' : 'grid-cols-12 content-start'}`}>
        {scenario.slots.map((slot) => renderSlot(slot, single ? 'h-[300px] w-full max-w-[360px]' : `${slot.width === 'fixed' ? 'col-span-4' : 'col-span-8'} min-h-[120px]`))}
      </div>
    )
  }

  return (
    <div className="rounded-[26px] border border-neutral-200 bg-neutral-100 p-2.5 shadow-inner">
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <i className="size-2 rounded-full bg-rose-300" /><i className="size-2 rounded-full bg-amber-300" /><i className="size-2 rounded-full bg-emerald-300" />
        <span className="ml-2 truncate text-[8px] font-bold uppercase tracking-[0.18em] text-neutral-400">{scenario.projectName} · local wireframe</span>
      </div>
      <div className={`overflow-hidden rounded-[20px] bg-white p-2 ${inferredLayout === 'landing' ? 'h-[460px]' : 'h-[400px]'}`}>
        {body}
      </div>
      <div className="mt-2 rounded-2xl border border-neutral-200 bg-white/80 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.16em] text-neutral-400"><Link2 size={10} /> 槽位数据流</div>
        {bindings.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {bindings.map((binding) => (
              <button
                type="button"
                key={`${binding.from.id}-${binding.to.id}`}
                onClick={() => onSelect(binding.to.id)}
                className="hover-pop flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-[8px] font-bold text-neutral-600"
              >
                <span className={`size-1.5 rounded-full ${binding.mode === 'signal' ? 'bg-fuchsia-500' : 'bg-violet-400'}`} />{binding.from.role}
                <ArrowRight size={9} className="text-neutral-400" />
                <span className="size-1.5 rounded-full bg-sky-500" />{binding.to.role}
                <span className={`${binding.mode === 'signal' ? 'font-mono' : ''} font-medium text-neutral-400`}>· {binding.signal}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-1 text-[8px] text-neutral-400">当前槽位没有可推断的数据绑定，可分别生成和挑选。</div>
        )}
      </div>
    </div>
  )
}

function BlueprintView() {
  const { scenario, confirmBlueprint, harnessMode } = useStore()
  const [activeSlotId, setActiveSlotId] = useState('')
  if (!scenario) return null
  const focusedSlotId = activeSlotId || scenario.slots[0]?.id || ''
  const candidateCount = scenario.slots.length * 3
  const streamCount = candidateCount * 2
  const firstWaveCandidates = scenario.slots.length
  const firstWaveStreams = firstWaveCandidates * 2
  return (
    <div className="h-full overflow-y-auto px-6 py-8">
      <div className="anim-pop mx-auto w-full max-w-5xl rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-neutral-400">Planner Blueprint</div>
            <h2 className="mt-2 text-2xl font-black text-neutral-900">先确认页面怎么拆</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">确认前不会启动 Builder，也不会产生候选生成费用。</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-1 text-[10px] font-bold text-amber-700"><Coins size={12} /> 首轮可见成本</div>
            <div className="mt-1 text-lg font-black text-amber-950">{firstWaveCandidates} 个主推候选</div>
            <div className="text-[9px] text-amber-700">{firstWaveStreams} 条模型流并发 · 每槽位优先出一个</div>
            <div className="mt-1 border-t border-amber-200 pt-1 text-[8px] text-amber-600">完整补齐上限：{candidateCount} 候选 · {streamCount} 条流（分批）</div>
          </div>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(320px,0.95fr)_minmax(340px,1.05fr)]">
          <section>
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <div>
                <div className="text-[10px] font-black text-neutral-800">整页低保真框架</div>
                <div className="mt-0.5 text-[8px] text-neutral-400">由 Planner 结果本地绘制 · 0 次 Builder 调用</div>
              </div>
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[8px] font-bold text-emerald-700">立即可见</span>
            </div>
            <BlueprintWireframe scenario={scenario} activeSlotId={focusedSlotId} onSelect={setActiveSlotId} />
            <div className="mt-2 text-center text-[8px] text-neutral-400">点击线框区块，查看对应组件合同</div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <div>
                <div className="text-[10px] font-black text-neutral-800">组件合同</div>
                <div className="mt-0.5 text-[8px] text-neutral-400">职责与接口将在候选之间保持一致</div>
              </div>
              <span className="font-mono text-[8px] text-neutral-400">{scenario.slots.length} slots</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {scenario.slots.map((slot, index) => {
                const active = focusedSlotId === slot.id
                return (
                  <button
                    type="button"
                    key={slot.id}
                    onClick={() => setActiveSlotId(slot.id)}
                    className={`anim-slide-l rounded-2xl border p-4 text-left transition-all duration-300 ${active ? 'border-indigo-400 bg-indigo-50/70 shadow-[0_0_0_3px_rgba(99,102,241,0.1)]' : 'border-neutral-200/80 bg-white hover:border-neutral-400 hover:shadow-md'}`}
                    style={{ animationDelay: `${index * 0.08}s` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex size-6 items-center justify-center rounded-full text-[10px] font-black ${active ? 'bg-indigo-600 text-white' : 'bg-neutral-900 text-white'}`}>{index + 1}</span>
                      <div className="text-[12px] font-extrabold text-neutral-800">{slot.role}</div>
                      <span className="ml-auto text-[8px] font-bold text-neutral-400">{slot.width === 'fixed' ? '固定区' : '自适应区'}</span>
                    </div>
                    <div className="mt-3 space-y-1 text-[9px] leading-relaxed text-neutral-500">
                      <div><span className="font-bold text-neutral-700">输入：</span>{slot.inputs.join(' · ') || '无外部输入'}</div>
                      <div><span className="font-bold text-neutral-700">输出：</span>{slot.outputs.join(' · ') || '仅展示'}</div>
                      <div><span className="font-bold text-neutral-700">依赖：</span>{slot.dependencies.join(' · ') || '独立槽位'}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
        <div className="sticky bottom-2 z-30 mt-5 flex flex-col items-center justify-between gap-3 rounded-2xl border border-white/15 bg-neutral-950/95 px-4 py-3 text-white shadow-2xl backdrop-blur-xl sm:flex-row">
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
        切换分支会保留业务合同与共享状态，并让模型重新设计布局、控件与动效，而不只是换色
      </div>
    </div>
  )
}

/* ---------------- 槽位外壳：随机加载 / 试穿 / 已确认 ---------------- */

function InstantSlotFrame({ slot, active }: { slot: SlotState; active: boolean }) {
  const role = `${slot.def.id} ${slot.def.role}`
  const isMetrics = /metric|stats|指标|数据卡/i.test(role)
  const isChart = /chart|trend|graph|趋势|图表/i.test(role)
  const isTable = /table|list|order|列表|订单|表格/i.test(role)
  const isHero = /hero|首屏|主视觉/i.test(role)
  const line = 'linear-gradient(90deg, color-mix(in srgb, var(--dna-text) 9%, transparent), color-mix(in srgb, var(--dna-accent) 18%, transparent), color-mix(in srgb, var(--dna-text) 9%, transparent))'
  return (
    <div className="relative min-h-36 overflow-hidden rounded-[inherit] p-4" style={{ background: 'var(--dna-surface)', color: 'var(--dna-text)' }}>
      <div className="absolute inset-0 opacity-50" style={{ background: 'radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--dna-accent) 18%, transparent), transparent 38%)' }} />
      <div className="absolute inset-y-0 -left-1/3 w-1/3 animate-[slide_1.8s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/55 to-transparent" />
      <div className="relative flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black opacity-70">{slot.def.role}</div>
          <div className="mt-1 text-[8px] opacity-40">页面框架已就位 · AI 正在填充细节</div>
        </div>
        <span className={`rounded-full px-2 py-1 text-[8px] font-bold ${active ? 'bg-neutral-900 text-white' : 'bg-white/70 text-neutral-500'}`}>即时框架</span>
      </div>
      <div className="relative mt-4">
        {isMetrics ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 rounded-2xl border border-white/60 bg-white/45 p-2"><div className="h-2 w-2/5 rounded-full" style={{ background: line }} /><div className="mt-3 h-4 w-3/5 rounded-full" style={{ background: line }} /></div>)}
          </div>
        ) : isChart ? (
          <div className="flex h-28 items-end gap-2 rounded-2xl border border-white/60 bg-white/40 px-3 pb-3 pt-6">
            {[42, 68, 54, 88, 64, 96, 72, 84].map((height, item) => <div key={item} className="flex-1 rounded-t-lg opacity-55 transition-all" style={{ height: `${height}%`, background: 'var(--dna-accent)', animation: `pulse 1.4s ease-in-out ${item * 70}ms infinite alternate` }} />)}
          </div>
        ) : isTable ? (
          <div className="space-y-2 rounded-2xl border border-white/60 bg-white/40 p-3">
            {[0, 1, 2, 3].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl bg-white/45 px-3 py-2"><div className="size-7 rounded-full" style={{ background: line }} /><div className="h-2 flex-1 rounded-full" style={{ background: line }} /><div className="h-2 w-14 rounded-full" style={{ background: line }} /></div>)}
          </div>
        ) : isHero ? (
          <div className="flex min-h-40 items-center justify-between gap-6 rounded-3xl border border-white/60 bg-white/35 p-5"><div className="w-3/5 space-y-3"><div className="h-5 w-4/5 rounded-full" style={{ background: line }} /><div className="h-2 w-full rounded-full" style={{ background: line }} /><div className="h-8 w-24 rounded-full" style={{ background: 'var(--dna-accent)', opacity: 0.45 }} /></div><div className="aspect-square w-24 rounded-3xl" style={{ background: line }} /></div>
        ) : (
          <div className="grid min-h-28 grid-cols-[1.3fr_0.7fr] gap-3"><div className="rounded-2xl border border-white/60 bg-white/40 p-3"><div className="h-3 w-2/3 rounded-full" style={{ background: line }} /><div className="mt-3 h-2 w-full rounded-full" style={{ background: line }} /><div className="mt-2 h-2 w-4/5 rounded-full" style={{ background: line }} /></div><div className="rounded-2xl border border-white/60 bg-white/40" /></div>
        )}
      </div>
    </div>
  )
}

function SlotShell({ slot }: { slot: SlotState }) {
  const { setActiveSlot, tryOn, reportCandidateRuntimeError, activeSlotId, bursts } = useStore()
  // 试穿优先：即使已扣合，试穿其他候选也即时预览（不替换已确认内容）
  const activeCand = slot.candidates.find((c) => c.def.id === (slot.tryOnId ?? slot.selectedId))
  const streaming = slot.candidates.find((c) => c.status === 'streaming' || c.status === 'compiling')
  const failed = slot.candidates.find((c) => c.status === 'failed')
  const renderedCount = slot.candidates.filter((c) => c.status === 'rendered').length
  const isActive = activeSlotId === slot.def.id
  const selected = slot.status === 'selected'
  const tryingOther = selected && slot.tryOnId && slot.tryOnId !== slot.selectedId
  const burst = bursts[slot.def.id]

  return (
    <div
      data-canvas-slot={slot.def.id}
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
              <div className="relative">
                <InstantSlotFrame slot={slot} active={isActive} />
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/70 bg-white/85 px-3 py-2 text-[9px] font-bold text-neutral-600 shadow-lg backdrop-blur">
                  <span className="size-2 animate-pulse rounded-full bg-fuchsia-500" />
                  {streaming.status === 'compiling' ? '正在把源码组装进框架' : 'AI 正在覆盖即时框架'}
                </div>
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
            <InstantSlotFrame slot={slot} active={isActive} />
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
          {phase === 'reviewing' ? '整页总监 · 正在统一与编译' : '审查完成 · 优化已安全应用 🎉'}
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
  const { phase, slots, activeSlotId, directionId, scenario, tweaks, submitPrompt, bigConfetti, harnessMode, setActiveSlot, tryOn } = useStore()
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

  useEffect(() => {
    if (!activeSlotId || !['generating', 'reviewing', 'done'].includes(phase)) return
    const timer = window.setTimeout(() => {
      const target = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-canvas-slot]') ?? [])]
        .find((element) => element.dataset.canvasSlot === activeSlotId)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [activeSlotId, phase])

  const slotById = (id: string) => slots.find((s) => s.def.id === id)
  const gapCls = tweaks.density ? 'gap-4' : 'gap-5'
  const candidateTotal = slots.reduce((total, slot) => total + slot.candidates.length, 0)
  const compositionEntries = useMemo(() => slots.flatMap((slot) => {
    const candidate = slot.candidates.find((item) => item.def.id === (slot.tryOnId ?? slot.selectedId))
    const artifact = candidate?.status === 'rendered' ? candidate.artifact : candidate?.lastGoodArtifact
    if (!candidate || !artifact) return []
    return [{ candidate: artifact, contract: contractForSlot(slot.def) }]
  }), [slots])
  const showIntegratedComposition = harnessMode === 'kimi' && slots.length > 1 && compositionEntries.length === slots.length

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
              className="anim-frame-in relative mx-auto max-w-4xl rounded-[28px] overflow-hidden shadow-2xl transition-colors duration-500 border border-white/50"
              style={{
                ...(vars as React.CSSProperties),
                background: 'var(--dna-bg)',
                fontFamily: 'var(--dna-font)',
                ...(glass ? { backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)' } : {}),
              }}
            >
              {/* 风格氛围层：黑客=CRT 扫描线组，复古=纸张颗粒 */}
              <StyleAtmosphere dirId={dir.id} />
              {showIntegratedComposition ? (
                <GeneratedCompositionPreview
                  entries={compositionEntries}
                  cssVariables={vars}
                  directionId={dir.id}
                  layout={scenario.layout}
                  activeSlotId={activeSlotId}
                  onSelect={({ slotId, candidateId }) => {
                    setActiveSlot(slotId)
                    tryOn(slotId, candidateId)
                  }}
                />
              ) : scenario.layout === 'dashboard' ? (
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
