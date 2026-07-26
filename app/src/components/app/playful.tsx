// 俏皮动效组件库：随机加载器（每次不一样）+ 纸屑爆发 + 漂浮装饰
import { useMemo } from 'react'

const LOADER_EMOJIS = ['🛠️', '🎨', '🧱', '✨', '🪄', '📐', '🍯', '🐝', '🧩', '🎯']
const LOADER_VERBS = ['揉圆角中', '调配颜料中', '拼积木中', '打磨像素中', '注入灵魂中', '对齐网格中', '调制渐变中', '召唤组件中']
const CONFETTI_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4']

function seeded(seed: number) {
  // 简单可复现随机：同一个候选每次渲染拿到同一组随机数
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** 随机加载器：4 种形态 + 随机 emoji/动词，seed 保证同候选稳定 */
export function PlayfulLoader({ seed, label }: { seed: number; label?: string }) {
  const { kind, emoji, verb, hue } = useMemo(() => {
    const r = seeded(seed)
    return {
      kind: Math.floor(r() * 4),
      emoji: LOADER_EMOJIS[Math.floor(r() * LOADER_EMOJIS.length)],
      verb: LOADER_VERBS[Math.floor(r() * LOADER_VERBS.length)],
      hue: Math.floor(r() * 360),
    }
  }, [seed])

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-4">
      {kind === 0 && (
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: `hsl(${(hue + i * 40) % 360} 80% 60%)`,
                animation: `dotBounce 0.9s ${i * 0.14}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
      )}
      {kind === 1 && (
        <div className="relative w-9 h-9">
          <div className="absolute inset-0 rounded-full border-2 border-dashed border-neutral-300" style={{ animation: 'spinSlow 3s linear infinite' }} />
          <span
            className="absolute left-1/2 top-1/2 -ml-1.5 -mt-1.5 w-3 h-3 rounded-full"
            style={{ background: `hsl(${hue} 80% 55%)`, animation: 'orbit 1.2s linear infinite' }}
          />
        </div>
      )}
      {kind === 2 && (
        <div
          className="w-8 h-8"
          style={{ background: `linear-gradient(135deg, hsl(${hue} 80% 60%), hsl(${(hue + 60) % 360} 80% 65%))`, animation: 'morphBlob 2.4s ease-in-out infinite' }}
        />
      )}
      {kind === 3 && (
        <span className="text-2xl" style={{ animation: 'floaty 1.6s ease-in-out infinite', display: 'inline-block' }}>
          {emoji}
        </span>
      )}
      <span className="text-[10px] text-neutral-400 font-medium">
        {emoji} {label ?? verb}…
      </span>
    </div>
  )
}

/** 局部纸屑爆发（扣合组件时） */
export function ConfettiBurst({ seed }: { seed: number }) {
  const pieces = useMemo(() => {
    const r = seeded(seed)
    return Array.from({ length: 22 }, (_, i) => {
      const angle = r() * Math.PI * 2
      const dist = 50 + r() * 90
      return {
        id: i,
        cx: `${Math.cos(angle) * dist}px`,
        cy: `${Math.sin(angle) * dist - 30}px`,
        cr: `${(r() - 0.5) * 720}deg`,
        color: CONFETTI_COLORS[Math.floor(r() * CONFETTI_COLORS.length)],
        size: 4 + r() * 6,
        round: r() > 0.5,
        delay: r() * 0.1,
      }
    })
  }, [seed])

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-visible flex items-center justify-center">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute"
          style={{
            width: p.size,
            height: p.round ? p.size : p.size * 0.5,
            background: p.color,
            borderRadius: p.round ? '50%' : '1px',
            animation: `confettiPop 0.9s ${p.delay}s cubic-bezier(0.22, 1, 0.36, 1) forwards`,
            ['--cx' as string]: p.cx,
            ['--cy' as string]: p.cy,
            ['--cr' as string]: p.cr,
          }}
        />
      ))}
    </div>
  )
}

/** 全屏纸屑雨（页面完成时） */
export function ConfettiRain({ seed }: { seed: number }) {
  const pieces = useMemo(() => {
    const r = seeded(seed)
    return Array.from({ length: 90 }, (_, i) => ({
      id: i,
      left: r() * 100,
      cr: `${(r() - 0.5) * 1080}deg`,
      color: CONFETTI_COLORS[Math.floor(r() * CONFETTI_COLORS.length)],
      size: 5 + r() * 7,
      round: r() > 0.5,
      delay: r() * 1.6,
      dur: 2.4 + r() * 2,
    }))
  }, [seed])

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.55,
            background: p.color,
            borderRadius: p.round ? '50%' : '1.5px',
            animation: `confettiRain ${p.dur}s ${p.delay}s cubic-bezier(0.3, 0.6, 0.6, 1) forwards`,
            ['--cr' as string]: p.cr,
          }}
        />
      ))}
    </div>
  )
}

/** 装饰性漂浮 emoji 背景（欢迎页用） */
export function FloatingEmojis() {
  const items = useMemo(
    () => [
      { e: '🧩', l: '8%', t: '18%', d: '3.4s', s: 26 },
      { e: '🎨', l: '85%', t: '14%', d: '4.1s', s: 30 },
      { e: '✨', l: '14%', t: '72%', d: '3.8s', s: 22 },
      { e: '🧱', l: '88%', t: '68%', d: '3.1s', s: 26 },
      { e: '🪄', l: '50%', t: '8%', d: '4.6s', s: 20 },
      { e: '🐝', l: '70%', t: '85%', d: '3.6s', s: 22 },
    ],
    [],
  )
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((it, i) => (
        <span
          key={i}
          className="absolute opacity-30 select-none"
          style={{ left: it.l, top: it.t, fontSize: it.s, animation: `floaty ${it.d} ease-in-out ${i * 0.4}s infinite` }}
        >
          {it.e}
        </span>
      ))}
    </div>
  )
}
