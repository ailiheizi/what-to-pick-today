import { Download, KeyRound, RotateCcw, Sparkles, Star, Volume2, VolumeX } from 'lucide-react'
import { getActiveHarness, useStore } from '../../lib/store'
import { getDirection } from '../../lib/dna'
import { buildReactSource, downloadText } from '../../lib/export-react'
import { buildHarnessExportProject, downloadHarnessExportProject } from '../../lib/harness'

const PHASE_LABEL: Record<string, string> = {
  idle: '待开始',
  planning: 'Planner 规划中',
  blueprint: '等待确认蓝图',
  direction: '等待挑选底板',
  generating: '并发生成中',
  reviewing: 'AI 审查中',
  done: '已完成 🎉',
}

export default function TopBar() {
  const { phase, muted, toggleMute, reset, scenario, directionId, slots, prompt, tokensStreamed, openStar, openSettings, harnessMode } = useStore()

  const exportReact = () => {
    if (!scenario) return
    if (harnessMode === 'kimi') {
      try {
        const session = getActiveHarness()
        if (!session) throw new Error('真实 Harness 会话不存在')
        downloadHarnessExportProject(buildHarnessExportProject(session.snapshot()))
      } catch (reason) {
        window.alert(`导出失败：${reason instanceof Error ? reason.message : String(reason)}`)
      }
      return
    }
    const dir = getDirection(directionId ?? 'apple')
    const { code } = buildReactSource({ prompt, scenario, directionId: dir.id, slots })
    downloadText('GeneratedPage.tsx', code, 'text/typescript')
  }

  const busy = phase === 'planning' || phase === 'generating' || phase === 'reviewing'
  const canReset = phase !== 'idle' || Boolean(prompt || scenario || slots.length || tokensStreamed)

  return (
    <header className="relative z-30 flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3">
      <div className="flex items-center gap-2.5 group cursor-default">
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-neutral-900 flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110">
          <Sparkles size={16} className="text-amber-300 transition-transform duration-500 group-hover:scale-125" />
        </div>
        <div>
          <div className="font-black text-[16px] tracking-tight leading-none">今天选什么？</div>
          <div className="hidden md:block text-[10px] text-neutral-500 mt-0.5">AI 负责生成，人负责挑选</div>
        </div>
      </div>

      <div className="ml-0 sm:ml-2 flex items-center gap-2 px-3 sm:px-3.5 py-1.5 rounded-full bg-white/70 backdrop-blur border border-white/60 shadow-sm">
        <span className={`w-2 h-2 rounded-full ${busy ? 'bg-emerald-500 animate-ping' : phase === 'done' ? 'bg-emerald-500' : 'bg-neutral-300'}`} />
        <span className="text-[11px] font-medium text-neutral-600">{PHASE_LABEL[phase]}</span>
        {tokensStreamed > 0 && phase !== 'idle' && (
          <span className="text-[10px] font-mono text-neutral-400">· {tokensStreamed.toLocaleString()} tok</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={openSettings}
          title="配置 AI API"
          className={`hover-pop relative w-9 h-9 rounded-full bg-white/70 backdrop-blur border border-white/60 shadow-sm flex items-center justify-center ${harnessMode === 'kimi' ? 'text-emerald-600' : 'text-neutral-500'}`}
        >
          <KeyRound size={15} />
          {harnessMode === 'kimi' && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 border border-white" />}
        </button>
        <button
          onClick={toggleMute}
          title={muted ? '取消静音' : '静音'}
          className="hover-pop w-9 h-9 rounded-full bg-white/70 backdrop-blur border border-white/60 shadow-sm flex items-center justify-center text-neutral-500"
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <button
          onClick={reset}
          disabled={!canReset}
          title={canReset ? '重新开始' : '当前没有可重置的内容'}
          className={`w-9 h-9 rounded-full bg-white/70 backdrop-blur border border-white/60 shadow-sm flex items-center justify-center transition-all duration-500 ${
            canReset
              ? 'hover-pop text-neutral-500 hover:rotate-[-120deg]'
              : 'text-neutral-300 cursor-not-allowed opacity-60'
          }`}
        >
          <RotateCcw size={15} />
        </button>
        <button
          onClick={openStar}
          title="Star 这个项目"
          className="hover-pop w-9 h-9 rounded-full bg-white/70 backdrop-blur border border-white/60 shadow-sm flex items-center justify-center text-amber-500"
        >
          <Star size={15} className={phase === 'done' ? 'fill-amber-400' : ''} />
        </button>
        <button
          onClick={exportReact}
          disabled={phase !== 'done'}
          title={harnessMode === 'kimi' ? '导出完整 Vite + React 项目包' : '导出 React 源码（单文件 .tsx）'}
          className={`group relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all ${
            phase === 'done'
              ? 'bg-neutral-900 text-white shadow-lg hover:shadow-xl hover:-rotate-1 hover:scale-105 focus:outline-none focus:anim-pulse-ring'
              : 'bg-white/50 text-neutral-300 cursor-not-allowed'
          }`}
        >
          <Download size={13} className={phase === 'done' ? 'transition-transform duration-300 group-hover:translate-y-0.5 group-hover:scale-125' : ''} />
          {harnessMode === 'kimi' ? '导出项目' : '导出 React'}
          {phase === 'done' && (
            <>
              <span className="absolute -top-1 -right-1 text-[10px] animate-[sparklePop_1.6s_ease-in-out_infinite]">✨</span>
              <span className="absolute -bottom-1 -left-1 text-[10px] animate-[sparklePop_1.6s_0.8s_ease-in-out_infinite]">✨</span>
            </>
          )}
        </button>
      </div>
    </header>
  )
}
