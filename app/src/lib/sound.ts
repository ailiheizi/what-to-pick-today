// 声音引擎 —— 对应产品文档 §10：
// tick 按候选索引变调；click 用于吸附；confirm 像积木扣合；undo 柔和反向；complete 短促完成音。
// 全部用 WebAudio 合成，无音频资源文件。

let ctx: AudioContext | null = null
let muted = false

export function setMuted(m: boolean) {
  muted = m
}
export function isMuted() {
  return muted
}

function ac(): AudioContext | null {
  if (muted) return null
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.08,
  glideTo?: number,
) {
  const c = ac()
  if (!c) return
  const t0 = c.currentTime + at
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

/** 候选越过中心选择线：按索引变调的轻微 tick */
export function playTick(index: number) {
  tone(1250 + (index % 5) * 110, 0, 0.035, 'square', 0.025)
}

/** 候选吸附 / 点击卡片 */
export function playClick() {
  tone(820, 0, 0.05, 'triangle', 0.07)
  tone(1640, 0.005, 0.03, 'sine', 0.04)
}

/** 确认组件：积木扣合 / 磁吸 */
export function playConfirm() {
  tone(340, 0, 0.09, 'triangle', 0.1, 520)
  tone(1040, 0.06, 0.1, 'sine', 0.07)
  tone(1560, 0.09, 0.08, 'sine', 0.035)
}

/** 撤销：柔和反向 */
export function playUndo() {
  tone(640, 0, 0.16, 'sine', 0.06, 300)
}

/** 方向切换 */
export function playShift() {
  tone(440, 0, 0.12, 'sine', 0.05, 660)
  tone(660, 0.08, 0.1, 'sine', 0.04)
}

/** 页面完成：短促完成音 */
export function playComplete() {
  const seq = [523.25, 659.25, 783.99, 1046.5]
  seq.forEach((f, i) => tone(f, i * 0.085, 0.16, 'triangle', 0.07))
}

/** 生成启动：轻微上升脉冲 */
export function playStart() {
  tone(392, 0, 0.1, 'sine', 0.05, 523.25)
  tone(523.25, 0.09, 0.12, 'sine', 0.05, 659.25)
}
