// Visual DNA —— 底板即「设计风格」：苹果风 / MD3 / 黑客风 / 复古。
// 候选组件只绑定 token，不绑定具体审美；切换底板 = 整页换肤。
// 见 docs/design-decisions.md（2026-07-26 用户反馈）。

export type Direction = {
  id: string
  name: string
  concept: string
  mood: string[]
  keywords: string[]
  motion: { personality: string; duration: string; easing: string }
  compositionRules: string[]
  vars: Record<string, string>
}

export const DIRECTIONS: Direction[] = [
  {
    id: 'apple',
    name: '苹果风',
    concept: 'Liquid Glass：半透明材质悬浮于内容之上，模糊、折射、无硬分割线',
    mood: ['通透', '玻璃', '悬浮'],
    keywords: ['苹果', 'apple', 'ios', 'mac', 'liquid', 'glass', '玻璃'],
    motion: { personality: '丝滑', duration: '350ms', easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    compositionRules: ['宽屏采用紧凑主从分栏或 inset grouped list', '控件浮于内容之上，材质模糊代替硬分割线', '蓝色只给主操作，禁止满屏药丸行'],
    vars: {
      '--dna-bg': 'rgba(245,245,247,0.72)',
      '--dna-surface': 'rgba(255,255,255,0.55)',
      '--dna-surface2': 'rgba(120,120,128,0.12)',
      '--dna-text': '#1d1d1f',
      '--dna-muted': '#86868b',
      '--dna-line': 'rgba(255,255,255,0.45)',
      '--dna-accent': '#007aff',
      '--dna-accent2': '#5e5ce6',
      '--dna-on-accent': '#ffffff',
      '--dna-radius': '22px',
      '--dna-blur': '20px',
      '--dna-font': `-apple-system, 'SF Pro Text', 'PingFang SC', sans-serif`,
      '--dna-display': `-apple-system, 'SF Pro Display', 'PingFang SC', sans-serif`,
      '--dna-tracking': '-0.02em',
      '--dna-dur': '350ms',
      '--dna-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
      '--dna-shadow': '0 8px 32px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.65)',
    },
  },
  {
    id: 'md3',
    name: 'MD3',
    concept: 'Material You：表面色调分层代替阴影，胶囊形状，filled tonal 按钮',
    mood: ['柔和', '亲切', '弹性'],
    keywords: ['md3', 'material', '安卓', '谷歌', 'material you'],
    motion: { personality: 'Q 弹', duration: '400ms', easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    compositionRules: ['宽屏采用 top app bar + 响应式 tonal card grid', '色彩即海拔（surface tones），选中态用药丸容器', '至少一个主要分组跨列或改变空间位置，禁止照搬苹果纵向列表'],
    vars: {
      '--dna-bg': '#f3edf7',
      '--dna-surface': '#fdf8ff',
      '--dna-surface2': '#ece6f0',
      '--dna-text': '#1d1b20',
      '--dna-muted': '#49454f',
      '--dna-line': '#e7e0ec',
      '--dna-accent': '#6750a4',
      '--dna-accent2': '#9a82db',
      '--dna-on-accent': '#ffffff',
      '--dna-radius': '28px',
      '--dna-blur': '0px',
      '--dna-font': `'Roboto', -apple-system, 'PingFang SC', sans-serif`,
      '--dna-display': `'Roboto', -apple-system, 'PingFang SC', sans-serif`,
      '--dna-tracking': '0em',
      '--dna-dur': '400ms',
      '--dna-ease': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      '--dna-shadow': '0 1px 2px rgba(29,27,32,0.07)',
    },
  },
  {
    id: 'hacker',
    name: '黑客风',
    concept: '真终端而非"绿色暗色主题"：磷光绿 on 近黑、扫描线耳语、密度即特性、机器不弹跳',
    mood: ['冷峻', '地下', '高能'],
    keywords: ['黑客', 'hacker', '终端', 'terminal', '矩阵', 'crt'],
    motion: { personality: '机械', duration: '120ms', easing: 'linear' },
    compositionRules: ['命令栏/状态栏 + 高密度表格或分屏面板', '等宽字体不可妥协，1px 细线分隔而非留白', '磷光 glow 只给标题与激活态'],
    vars: {
      '--dna-bg': '#0a0e0a',
      '--dna-surface': '#0d130d',
      '--dna-surface2': '#131b13',
      '--dna-text': '#b8ffb8',
      '--dna-muted': '#3f7a3f',
      '--dna-line': '#1e281e',
      '--dna-accent': '#00ff41',
      '--dna-accent2': '#ffb200',
      '--dna-on-accent': '#031303',
      '--dna-radius': '2px',
      '--dna-blur': '0px',
      '--dna-font': `'SF Mono', ui-monospace, 'JetBrains Mono', 'PingFang SC', monospace`,
      '--dna-display': `'SF Mono', ui-monospace, 'JetBrains Mono', 'PingFang SC', monospace`,
      '--dna-tracking': '0.02em',
      '--dna-dur': '120ms',
      '--dna-ease': 'linear',
      '--dna-shadow': '0 0 0 1px rgba(0,255,65,0.08)',
    },
  },
  {
    id: 'retro',
    name: '复古',
    concept: '旧印刷品：做旧纸面、颗粒噪点、衬线大字、印章红与橄榄绿',
    mood: ['怀旧', '纸感', '印刷'],
    keywords: ['复古', '古老', 'retro', '怀旧', '报纸', 'vintage', '印刷'],
    motion: { personality: '从容', duration: '450ms', easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
    compositionRules: ['报刊 masthead + 不对称双栏或跨栏标题', '衬线大标题，分隔用细双线而非色块', '红色像印章一样克制'],
    vars: {
      '--dna-bg': '#f2ead8',
      '--dna-surface': '#faf4e6',
      '--dna-surface2': '#e9dfc8',
      '--dna-text': '#3e3428',
      '--dna-muted': '#8a7b63',
      '--dna-line': '#d8cbaf',
      '--dna-accent': '#b4432f',
      '--dna-accent2': '#6b7c4a',
      '--dna-on-accent': '#faf4e6',
      '--dna-radius': '4px',
      '--dna-blur': '0px',
      '--dna-font': `Georgia, 'Songti SC', 'Noto Serif SC', serif`,
      '--dna-display': `Georgia, 'Songti SC', 'Noto Serif SC', serif`,
      '--dna-tracking': '0.01em',
      '--dna-dur': '450ms',
      '--dna-ease': 'cubic-bezier(0.25, 1, 0.5, 1)',
      '--dna-shadow': '0 1px 0 rgba(62,52,40,0.12), 0 6px 16px rgba(62,52,40,0.07)',
    },
  },
]

export function getDirection(id: string): Direction {
  return DIRECTIONS.find((d) => d.id === id) ?? DIRECTIONS[0]
}
