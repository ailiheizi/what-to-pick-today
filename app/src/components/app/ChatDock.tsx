// 聊天收纳坞：聊天气泡常驻左下角，点开才是完整对话。
// 设计决策见 docs/design-decisions.md —— 聊天只在最初描述需求时重要。
import { useEffect, useRef, useState } from 'react'
import { Bot, MessageCircle, User, X } from 'lucide-react'
import { useStore } from '../../lib/store'
import { playClick, playTick } from '../../lib/sound'

export default function ChatDock() {
  const chat = useStore((s) => s.chat)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const unread = open ? 0 : chat.length - seen

  useEffect(() => {
    if (open) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [open, chat.length])

  return (
    <div className="absolute left-4 bottom-4 z-40 flex flex-col items-start gap-2">
      {open && (
        <div className="anim-bounce-in w-72 max-h-[46vh] flex flex-col rounded-3xl border border-white/60 bg-white/90 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-100">
            <span className="text-xs font-bold text-neutral-800">💬 对话记录</span>
            <span className="text-[9px] text-neutral-400">聊完需求就靠边站</span>
            <button
              onClick={() => {
                setSeen(chat.length)
                setOpen(false)
                playClick()
              }}
              className="ml-auto w-6 h-6 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-400"
            >
              <X size={12} />
            </button>
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2">
            {chat.length === 0 && <div className="text-[10px] text-neutral-400 text-center py-6">还没有对话，去底部输入需求吧 ✨</div>}
            {chat.map((m) => (
              <div key={m.id} className={`flex gap-1.5 anim-pop ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div
                  className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${
                    m.role === 'user' ? 'bg-neutral-900' : m.role === 'sys' ? 'bg-neutral-200' : 'bg-amber-100'
                  }`}
                >
                  {m.role === 'user' ? (
                    <User size={10} className="text-white" />
                  ) : (
                    <Bot size={10} className={m.role === 'sys' ? 'text-neutral-500' : 'text-amber-600'} />
                  )}
                </div>
                <div
                  className={`max-w-[85%] px-2.5 py-1.5 rounded-2xl text-[11px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-neutral-900 text-white rounded-tr-md'
                      : m.role === 'sys'
                        ? 'bg-neutral-100 text-neutral-500'
                        : 'bg-white border border-neutral-200 text-neutral-700 rounded-tl-md'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => {
          if (!open) setSeen(chat.length)
          setOpen(!open)
          playTick(open ? 1 : 3)
        }}
        className={`hover-pop relative w-12 h-12 rounded-full shadow-xl flex items-center justify-center border transition-colors ${
          open ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white/90 backdrop-blur text-neutral-700 border-white/60'
        }`}
        title="对话记录"
      >
        <MessageCircle size={19} className={open ? '' : 'anim-float'} />
        {!open && unread > 0 && (
          <span className="anim-pop absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center shadow">
            {unread}
          </span>
        )}
      </button>
    </div>
  )
}
