import { useState } from 'react'
import { CircleStop, RefreshCw, SendHorizonal } from 'lucide-react'
import { getActiveHarness, useStore } from '../../lib/store'
import { playClick } from '../../lib/sound'

const PLACEHOLDER: Record<string, string> = {
  idle: '描述你想做的界面，例如「帮我做一个 SaaS 增长数据看板」…',
  planning: 'Planner 规划中，可先记下补充要求…',
  direction: '先在画布中挑选一个风格底板…',
  generating: '补充要求，例如「我喜欢黑客风」…',
  reviewing: 'Reviewer 正在检查最终组合…',
  done: '继续提修改要求，例如「圆角再大一点」「换成 MD3」…',
}

export default function Composer() {
  const { phase, submitPrompt, sendFollowUp, stopGeneration, regenerate, stopped, slots, harnessMode } = useStore()
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)

  const send = () => {
    const t = text.trim()
    if (!t) return
    playClick()
    if (phase === 'idle') submitPrompt(t)
    else sendFollowUp(t)
    setText('')
    setSent(true)
    setTimeout(() => setSent(false), 500)
  }

  const hasUnselected = slots.some((s) => s.status !== 'selected')
  const canRegenerate = hasUnselected && (
    stopped
    || (harnessMode === 'kimi' ? getActiveHarness()?.phase === 'selecting' : phase === 'generating')
  )

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-4 z-30 w-[min(620px,60%)]">
      <div
        className={`rounded-full border border-white/60 bg-white/85 backdrop-blur-xl shadow-2xl pl-5 pr-2 py-2 transition-transform duration-300 ${
          sent ? 'scale-[0.97]' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
            placeholder={PLACEHOLDER[phase]}
            className="flex-1 bg-transparent text-[13px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none"
          />
          {phase === 'generating' && !stopped && (
            <button
              onClick={stopGeneration}
              className="hover-pop flex items-center gap-1 px-3 py-2 rounded-full text-[11px] font-bold text-rose-500 hover:bg-rose-50"
              title="停止接收生成流"
            >
              <CircleStop size={13} /> 停止
            </button>
          )}
          {canRegenerate && (
            <button
              onClick={regenerate}
              className="hover-pop flex items-center gap-1 px-3 py-2 rounded-full text-[11px] font-bold text-neutral-500 hover:bg-neutral-100"
              title="重新生成未确认的槽位"
            >
              <RefreshCw size={13} /> 重新生成
            </button>
          )}
          <button
            onClick={send}
            disabled={!text.trim()}
            className="hover-pop w-9 h-9 rounded-full bg-neutral-900 text-white disabled:opacity-25 flex items-center justify-center shadow-lg"
            title="发送（Enter）"
          >
            <SendHorizonal size={15} className={text.trim() ? 'transition-transform group-hover:translate-x-0.5' : ''} />
          </button>
        </div>
      </div>
      <div className="mt-1.5 text-center text-[9px] text-neutral-500/80">
        {harnessMode === 'kimi' ? 'Browser Harness · Kimi BYOK · iframe 沙箱运行' : '未配置 Key · 当前使用本地 Mock Harness 演示'}
      </div>
    </div>
  )
}
