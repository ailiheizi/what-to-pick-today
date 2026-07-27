import { CornerUpLeft, FileJson, GitBranch, Layers } from 'lucide-react'
import { useStore } from '../../lib/store'
import { DIRECTIONS } from '../../lib/dna'

const KIND_ICON: Record<string, string> = {
  plan: '◈', direction: '◆', select: '●', undo: '◌', branch: '⑂', review: '◎', done: '✦', sys: '·',
}

function time(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function LeftPanel() {
  const { scenario, directionId, switchBranch, phase, history, undo, slots } = useStore()
  const selectedCount = slots.filter((s) => s.status === 'selected').length
  const canBranch = !!directionId

  return (
    <aside className="hidden xl:flex w-56 shrink-0 m-3 mt-0 rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-lg flex-col min-h-0 overflow-hidden">
      {/* 项目 */}
      <div className="px-4 pt-4 pb-3">
        <div className="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 flex items-center gap-1.5">
          <Layers size={11} /> 项目
        </div>
        <div className="mt-1.5 text-sm font-black text-neutral-800 truncate">
          {scenario ? scenario.projectName : '未命名项目'}
        </div>
        {slots.length > 0 && (
          <div className="mt-2.5">
            <div className="flex justify-between text-[10px] text-neutral-400 mb-1">
              <span>拼合进度</span>
              <span className="font-mono">{selectedCount}/{slots.length}</span>
            </div>
            <div className="h-2 rounded-full bg-neutral-200/70 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-amber-300 transition-all duration-700 ease-out"
                style={{ width: `${(selectedCount / slots.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mx-4 h-px bg-neutral-200/70" />

      {/* 设计分支 */}
      <div className="px-4 py-3">
        <div className="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 flex items-center gap-1.5 mb-2">
          <GitBranch size={11} /> 设计分支
        </div>
        <div className="space-y-1.5">
          {DIRECTIONS.map((d, i) => {
            const active = directionId === d.id
            return (
              <button
                key={d.id}
                disabled={!canBranch || active}
                onClick={() => switchBranch(d.id)}
                style={{ animationDelay: `${i * 0.06}s` }}
                className={`hover-pop w-full flex items-center gap-2 px-3 py-2 rounded-2xl text-left text-xs transition-colors ${
                  active
                    ? 'bg-neutral-900 text-white shadow-md'
                    : canBranch
                      ? 'bg-white/70 hover:bg-white text-neutral-600 border border-neutral-200/70'
                      : 'text-neutral-300 cursor-not-allowed'
                }`}
              >
                <span className="flex -space-x-1">
                  <i className="w-3 h-3 rounded-full border border-white shadow-sm" style={{ background: d.vars['--dna-bg'] }} />
                  <i className="w-3 h-3 rounded-full border border-white shadow-sm" style={{ background: d.vars['--dna-accent'] }} />
                </span>
                <span className="flex-1 font-bold">{d.name}</span>
                {active && <span className="text-[9px] opacity-70">● 当前</span>}
              </button>
            )
          })}
        </div>
        {!canBranch && <div className="mt-2 text-[10px] text-neutral-400">挑选底板后，风格随时可切换</div>}
      </div>

      <div className="mx-4 h-px bg-neutral-200/70" />

      {/* 历史 */}
      <div className="flex-1 min-h-0 flex flex-col px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-semibold tracking-widest uppercase text-neutral-400 flex items-center gap-1.5">
            <FileJson size={11} /> 历史版本
          </div>
          <button
            onClick={undo}
            disabled={selectedCount === 0 || phase === 'reviewing' || phase === 'done'}
            className="hover-pop flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium text-neutral-500 hover:bg-white disabled:opacity-30"
          >
            <CornerUpLeft size={10} /> 撤销
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
          {history.length === 0 && <div className="text-[10px] text-neutral-400">尚无记录</div>}
          {[...history].reverse().map((h) => (
            <div key={h.id} className="anim-pop flex gap-1.5 text-[10px] leading-relaxed">
              <span className="text-neutral-400 shrink-0 w-3 text-center">{KIND_ICON[h.kind]}</span>
              <div className="min-w-0">
                <div className="text-neutral-600 truncate">{h.label}</div>
                <div className="text-neutral-300 font-mono">{time(h.ts)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
