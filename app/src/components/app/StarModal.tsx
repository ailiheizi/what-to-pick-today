// 完成弹窗：全部槽位扣合 + 审查通过后自动弹出。
// 庆祝 → 选择摘要 → Star 引导 → 导出 React 源码 / JSON。
import { Download, FileJson, Github, PartyPopper, Star, X } from 'lucide-react'
import { getActiveHarness, useStore } from '../../lib/store'
import { getDirection } from '../../lib/dna'
import { buildReactSource, downloadText } from '../../lib/export-react'
import { buildHarnessExportProject, downloadHarnessExportProject } from '../../lib/harness'
import { playClick } from '../../lib/sound'

const REPO_URL = 'https://github.com/ailiheizi/what-to-pick-today'

export default function StarModal() {
  const { starOpen, closeStar, prompt, scenario, directionId, slots, history, tokensStreamed, startedAt, harnessMode } = useStore()
  if (!starOpen) return null

  const dir = getDirection(directionId ?? 'apple')

  const exportReact = () => {
    if (!scenario) return
    if (harnessMode === 'kimi') {
      try {
        const session = getActiveHarness()
        if (!session) throw new Error('真实 Harness 会话不存在')
        downloadHarnessExportProject(buildHarnessExportProject(session.snapshot()))
        playClick()
      } catch (reason) {
        window.alert(`导出失败：${reason instanceof Error ? reason.message : String(reason)}`)
      }
      return
    }
    const { code } = buildReactSource({ prompt, scenario, directionId: dir.id, slots })
    downloadText('GeneratedPage.tsx', code, 'text/typescript')
    playClick()
  }

  const exportJSON = () => {
    if (!scenario) return
    if (harnessMode === 'kimi') {
      const session = getActiveHarness()
      if (!session) {
        window.alert('导出失败：真实 Harness 会话不存在')
        return
      }
      downloadText('what-to-pick-today.harness.json', session.exportJson(), 'application/json')
      playClick()
      return
    }
    const payload = {
      product: '今天选什么？',
      exportedAt: new Date().toISOString(),
      prompt,
      scenario: scenario.id,
      visualDNA: dir,
      selections: slots.map((s) => ({
        slot: s.def.id,
        role: s.def.role,
        contract: { inputs: s.def.inputs, outputs: s.def.outputs, width: s.def.width, dependencies: s.def.dependencies },
        selected: s.selectedId ?? null,
        candidates: s.candidates.map((c) => c.def.id),
      })),
      stats: { tokensStreamed, elapsedMs: Date.now() - startedAt },
      history,
    }
    downloadText('what-to-pick-today.page.json', JSON.stringify(payload, null, 2), 'application/json')
    playClick()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeStar}>
      <div className="absolute inset-0 bg-neutral-900/30 backdrop-blur-sm anim-pop" />
      <div
        className="anim-bounce-in relative w-full max-w-md rounded-[28px] border border-white/60 bg-white/95 backdrop-blur-xl shadow-2xl p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeStar}
          className="hover-pop absolute top-4 right-4 w-8 h-8 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-400"
        >
          <X size={15} />
        </button>

        <div className="inline-flex w-14 h-14 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 items-center justify-center shadow-lg anim-float">
          <PartyPopper size={26} className="text-white" />
        </div>
        <h2 className="mt-3 text-xl font-black text-neutral-900">
          {scenario ? '页面拼合完成！' : '喜欢「今天选什么？」吗？'}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {scenario
            ? `${scenario.projectName} · ${dir.name} · ${slots.length}/${slots.length} 槽位已扣合`
            : '这是一个开源的 AI 原生 UI 生成与挑选工具'}
        </p>

        {/* 选择摘要 */}
        {scenario && (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {slots.map((s) => {
              const cand = s.candidates.find((c) => c.def.id === s.selectedId)
              return (
                <span key={s.def.id} className="anim-pop px-2.5 py-1 rounded-full bg-neutral-100 text-[10px] font-medium text-neutral-600">
                  {s.def.role} · {cand?.def.label.split('·')[1]?.trim() ?? '—'}
                </span>
              )
            })}
          </div>
        )}

        {/* Star 引导 */}
        <div className="mt-5 rounded-2xl bg-gradient-to-br from-neutral-900 to-neutral-700 p-4 text-left">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Star size={15} className="text-amber-300 fill-amber-300" />
            喜欢这个项目的话，欢迎 Star ✨
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-300">
            今天选什么？是开源项目（BYOK，自带 Kimi API Key 即可跑）。你的 Star 是对 AI 负责生成、人负责挑选这个理念最大的鼓励。
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hover-pop mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-neutral-900 text-xs font-bold shadow"
            onClick={playClick}
          >
            <Github size={14} /> ailiheizi/what-to-pick-today
          </a>
        </div>

        {/* 导出 */}
        {scenario && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={exportReact}
                className="hover-pop flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-neutral-900 text-white text-xs font-bold shadow-lg"
              >
                <Download size={13} /> {harnessMode === 'kimi' ? '导出完整项目' : '导出 React 源码'}
              </button>
              <button
                onClick={exportJSON}
                className="hover-pop flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-white border border-neutral-200 text-xs font-bold text-neutral-600"
              >
                <FileJson size={13} /> {harnessMode === 'kimi' ? '导出 Harness JSON' : '导出 JSON'}
              </button>
            </div>
            <div className="mt-2 text-[9px] text-neutral-400">
              {harnessMode === 'kimi'
                ? '项目包包含完整 Vite + React 多文件源码、依赖配置、Visual DNA 与导出元数据'
                : 'React 源码为单文件 GeneratedPage.tsx，依赖 tailwindcss + recharts + lucide-react'}
            </div>
          </>
        )}

        <button onClick={closeStar} className="mt-3 text-[11px] font-medium text-neutral-400 hover:text-neutral-700">
          {scenario ? '继续调整页面 →' : '关闭'}
        </button>
      </div>
    </div>
  )
}
