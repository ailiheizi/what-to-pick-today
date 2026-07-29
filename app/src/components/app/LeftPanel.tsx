import { CornerUpLeft, FileJson, GitBranch, Layers, Redo2, RotateCcw } from 'lucide-react'
import { useStore } from '../../lib/store'
import { DIRECTIONS } from '../../lib/dna'
import { canRedo, canUndo } from '../../lib/harness/revisions'

const KIND_ICON: Record<string, string> = {
  plan: '◈', direction: '◆', select: '●', undo: '◌', branch: '⑂', review: '◎', done: '✦', sys: '·',
}

function time(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function LeftPanel() {
  const { scenario, directionId, switchBranch, phase, history, undo, redo, restoreRevision, revisionRepo, revisionBusy, slots } = useStore()
  const selectedCount = slots.filter((s) => s.status === 'selected').length
  const canBranch = !!directionId
  const revisions = revisionRepo
    ? Object.values(revisionRepo.revisions).sort((a, b) => b.ts - a.ts || b.id.localeCompare(a.id))
    : []

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
                disabled={!canBranch || active || revisionBusy || phase === 'reviewing'}
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
          <div className="flex items-center gap-1">
            <button
              onClick={undo}
              disabled={revisionBusy || phase === 'reviewing' || (revisionRepo ? !canUndo(revisionRepo) : selectedCount === 0)}
              title="沿版本树撤销"
              className="hover-pop flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium text-neutral-500 hover:bg-white disabled:opacity-30"
            >
              <CornerUpLeft size={10} /> 撤销
            </button>
            <button
              onClick={redo}
              disabled={revisionBusy || phase === 'reviewing' || !revisionRepo || !canRedo(revisionRepo)}
              title="沿版本树重做"
              className="hover-pop p-1.5 rounded-full text-neutral-500 hover:bg-white disabled:opacity-30"
            >
              <Redo2 size={10} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5">
          {revisionRepo && revisions.map((revision) => {
            const current = revision.id === revisionRepo.currentRevisionId
            const branch = revisionRepo.branches[revision.branchId]
            return (
              <div
                key={revision.id}
                className={`anim-pop group rounded-2xl border px-2.5 py-2 transition-colors ${
                  current ? 'border-indigo-200 bg-indigo-50/80' : 'border-neutral-200/70 bg-white/60 hover:bg-white'
                }`}
              >
                <div className="flex items-start gap-1.5">
                  <span className={`mt-0.5 shrink-0 text-[9px] ${current ? 'text-indigo-500' : 'text-neutral-300'}`}>●</span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[10px] ${current ? 'font-bold text-indigo-800' : 'text-neutral-600'}`}>
                      {revision.label}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[9px] text-neutral-400">
                      <span className="truncate">{branch?.name ?? revision.branchId}</span>
                      <span>·</span>
                      <span className="font-mono">{time(revision.ts)}</span>
                    </div>
                  </div>
                  {!current && (
                    <button
                      onClick={() => restoreRevision(revision.id)}
                      disabled={revisionBusy || phase === 'reviewing'}
                      title="恢复为新版本，不删除后续历史"
                      className="hover-pop shrink-0 rounded-full p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-indigo-50 hover:text-indigo-600 group-hover:opacity-100 focus:opacity-100"
                    >
                      <RotateCcw size={10} />
                    </button>
                  )}
                </div>
                {current && <div className="mt-1 pl-3.5 text-[9px] font-semibold text-indigo-500">当前版本</div>}
              </div>
            )
          })}
          {!revisionRepo && history.length === 0 && <div className="text-[10px] text-neutral-400">挑选底板后开始记录可恢复版本</div>}
          {!revisionRepo && [...history].reverse().map((h) => (
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
