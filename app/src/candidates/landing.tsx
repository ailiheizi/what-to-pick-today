// Landing 场景候选库 —— 模拟 Component Builders 的并发产出。
import { ArrowRight, Download, GitBranch, Layers, MousePointer2, Scan, Shield, Sparkles, Star, Zap } from 'lucide-react'
import type { SlotDef } from './types'
import { FEATURES } from './data'

const T = 'transition-[background-color,color,border-color,border-radius,box-shadow] duration-500 backdrop-blur-[var(--dna-blur)]'
const ICONS: Record<string, typeof Zap> = { zap: Zap, layers: Layers, 'git-branch': GitBranch, shield: Shield, scan: Scan, download: Download }

/* ---------------- nav · 导航 ---------------- */

function NavClassic() {
  return (
    <nav className={`flex items-center gap-6 px-6 py-3.5 dna-chrome dna-line-b ${T}`}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-[calc(var(--dna-radius)/2)] bg-[var(--dna-accent)] flex items-center justify-center">
          <Sparkles size={13} className="text-[var(--dna-on-accent)]" />
        </div>
        <span className="font-bold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-display)' }}>Nova</span>
      </div>
      <div className="hidden sm:flex items-center gap-5 text-[13px] text-[var(--dna-muted)]">
        {['产品', '方案', '定价', '博客'].map((x) => <span key={x} className="hover:text-[var(--dna-text)]">{x}</span>)}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button className="px-3 py-1.5 text-[13px] text-[var(--dna-text)]">登录</button>
        <button className={`px-3.5 py-1.5 text-[13px] font-medium rounded-[var(--dna-radius)] bg-[var(--dna-accent)] text-[var(--dna-on-accent)] ${T}`}>免费开始</button>
      </div>
    </nav>
  )
}

function NavPill() {
  return (
    <div className="px-6 pt-4 bg-[var(--dna-bg)]">
      <nav className={`mx-auto max-w-2xl flex items-center gap-4 px-4 py-2 rounded-full bg-[var(--dna-surface)] border border-[var(--dna-line)] ${T}`} style={{ boxShadow: 'var(--dna-shadow)' }}>
        <span className="font-bold text-sm text-[var(--dna-text)] pl-1" style={{ fontFamily: 'var(--dna-display)' }}>◆ Nova</span>
        <div className="flex-1 flex justify-center gap-4 text-xs text-[var(--dna-muted)]">
          {['产品', '定价', '文档'].map((x) => <span key={x}>{x}</span>)}
        </div>
        <button className="px-3 py-1.5 text-xs font-medium rounded-full bg-[var(--dna-text)] text-[var(--dna-bg)]">开始使用</button>
      </nav>
    </div>
  )
}

function NavSplit() {
  return (
    <nav className={`relative flex items-center px-6 py-4 bg-[var(--dna-bg)] ${T}`}>
      <div className="flex gap-5 text-[13px] text-[var(--dna-muted)]">
        {['功能', '案例'].map((x) => <span key={x}>{x}</span>)}
      </div>
      <span
        className="absolute left-1/2 -translate-x-1/2 text-xl font-black uppercase text-[var(--dna-text)]"
        style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}
      >
        NOVA<span className="text-[var(--dna-accent)]">.</span>
      </span>
      <div className="ml-auto flex items-center gap-4">
        <span className="text-[13px] text-[var(--dna-muted)]">关于</span>
        <button className={`px-3.5 py-1.5 text-[13px] font-bold rounded-[var(--dna-radius)] border-2 border-[var(--dna-line)] text-[var(--dna-text)] ${T}`}>试试 →</button>
      </div>
    </nav>
  )
}

/* ---------------- hero · 主视觉 ---------------- */

function HeroCenter() {
  return (
    <section className={`px-6 py-14 text-center bg-[var(--dna-bg)] ${T}`}>
      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-[var(--dna-surface2)] text-[var(--dna-muted)] border border-[var(--dna-line)] ${T}`}>
        <Star size={11} className="text-[var(--dna-accent)]" /> v2.0 现已发布
      </div>
      <h1 className="mt-5 text-4xl sm:text-5xl font-black text-[var(--dna-text)] leading-tight" style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}>
        让 AI 生成可能性<br />由你来<span className="text-[var(--dna-accent)]">挑选</span>
      </h1>
      <p className="mt-4 text-sm sm:text-base text-[var(--dna-muted)] max-w-md mx-auto">
        不再从空白画布开始。描述需求，并发得到多个组件候选，像挑衣服一样拼出你的界面。
      </p>
      <div className="mt-7 flex items-center justify-center gap-3">
        <button className={`px-5 py-2.5 rounded-[var(--dna-radius)] bg-[var(--dna-accent)] text-[var(--dna-on-accent)] text-sm font-semibold flex items-center gap-1.5 ${T}`} style={{ boxShadow: 'var(--dna-shadow)' }}>
          免费开始 <ArrowRight size={14} />
        </button>
        <button className={`px-5 py-2.5 rounded-[var(--dna-radius)] border border-[var(--dna-line)] text-sm text-[var(--dna-text)] bg-[var(--dna-surface)] ${T}`}>
          观看演示
        </button>
      </div>
    </section>
  )
}

function HeroSplit() {
  return (
    <section className={`grid grid-cols-1 sm:grid-cols-2 gap-8 items-center px-8 py-12 bg-[var(--dna-bg)] ${T}`}>
      <div>
        <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--dna-accent)]" style={{ fontFamily: 'var(--dna-font)' }}>
          AI-Native UI Studio
        </div>
        <h1 className="mt-3 text-4xl font-black text-[var(--dna-text)] leading-[1.15]" style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}>
          今天<br />选什么？
        </h1>
        <p className="mt-4 text-sm text-[var(--dna-muted)] leading-relaxed">
          AI 负责创造可能性，人负责挑选。三个视觉方向、九个槽位、二十七种候选——全部并发实时渲染。
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button className={`px-5 py-2.5 rounded-[var(--dna-radius)] bg-[var(--dna-text)] text-[var(--dna-bg)] text-sm font-semibold ${T}`}>立即体验</button>
          <span className="text-xs text-[var(--dna-muted)]">无需注册 · BYOK</span>
        </div>
      </div>
      <div className={`relative dna-card p-4 ${T}`} style={{ boxShadow: 'var(--dna-shadow)' }}>
        <div className="flex gap-1.5 mb-3">
          {['bg-rose-400', 'bg-amber-400', 'bg-emerald-400'].map((c) => <i key={c} className={`w-2.5 h-2.5 rounded-full ${c}`} />)}
        </div>
        <div className="space-y-2">
          <div className="h-3 w-3/4 rounded bg-[var(--dna-surface2)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--dna-surface2)]" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-16 rounded-[calc(var(--dna-radius)/1.5)] border-2 ${i === 1 ? 'border-[var(--dna-accent)] bg-[var(--dna-accent)]/10' : 'border-[var(--dna-line)] bg-[var(--dna-surface2)]'}`} />
            ))}
          </div>
          <div className="flex items-center justify-center gap-1 pt-1 text-[10px] text-[var(--dna-accent)] font-medium">
            <MousePointer2 size={10} /> 候选 B 已选中
          </div>
        </div>
      </div>
    </section>
  )
}

function HeroBold() {
  return (
    <section className={`relative overflow-hidden px-6 py-16 bg-[var(--dna-accent)] ${T}`}>
      <div className="relative z-10 max-w-2xl">
        <h1
          className="text-5xl sm:text-6xl font-black uppercase leading-[0.95] text-[var(--dna-on-accent)]"
          style={{ fontFamily: 'var(--dna-display)', letterSpacing: '-0.04em' }}
        >
          Pick.<br />Snap.<br />Ship.
        </h1>
        <p className="mt-5 text-sm sm:text-base font-medium text-[var(--dna-on-accent)] opacity-90 max-w-sm">
          挑、扣、发。AI 生成，人类决定。这就是界面生产的新流程。
        </p>
        <button className={`mt-7 px-6 py-3 rounded-[var(--dna-radius)] bg-[var(--dna-text)] text-[var(--dna-bg)] text-sm font-black uppercase tracking-wide ${T}`}>
          开始挑选 →
        </button>
      </div>
      <div className="absolute -right-10 -bottom-16 w-64 h-64 rounded-full bg-[var(--dna-accent2)] opacity-60 blur-2xl" />
      <div className="absolute right-24 top-6 text-[var(--dna-on-accent)] opacity-40 text-7xl font-black select-none" style={{ fontFamily: 'var(--dna-display)' }}>?</div>
    </section>
  )
}

/* ---------------- features · 特性区 ---------------- */

function FeaturesGrid() {
  return (
    <section className={`px-6 py-12 dna-chrome border-y border-[var(--dna-line)] ${T}`}>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-black text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}>完整闭环，而非玩具</h2>
        <p className="mt-2 text-sm text-[var(--dna-muted)]">从一句需求到一张可导出的页面</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-3xl mx-auto">
        {FEATURES.map((f) => {
          const Icon = ICONS[f.icon] ?? Zap
          return (
            <div key={f.title} className={`p-4 rounded-[var(--dna-radius)] bg-[var(--dna-bg)] border border-[var(--dna-line)] ${T}`}>
              <div className="w-8 h-8 rounded-[calc(var(--dna-radius)/1.5)] bg-[var(--dna-accent)]/10 flex items-center justify-center">
                <Icon size={15} className="text-[var(--dna-accent)]" />
              </div>
              <div className="mt-3 text-sm font-bold text-[var(--dna-text)]">{f.title}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-[var(--dna-muted)]">{f.desc}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function FeaturesRows() {
  return (
    <section className={`px-8 py-10 bg-[var(--dna-bg)] ${T}`}>
      <div className="max-w-2xl mx-auto divide-y divide-[var(--dna-line)]">
        {FEATURES.slice(0, 4).map((f, i) => {
          const Icon = ICONS[f.icon] ?? Zap
          return (
            <div key={f.title} className="flex items-start gap-4 py-5">
              <span className="text-xs font-bold text-[var(--dna-muted)] pt-1" style={{ fontFamily: 'var(--dna-font)' }}>0{i + 1}</span>
              <div className="flex-1">
                <div className="text-base font-bold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-display)' }}>{f.title}</div>
                <div className="mt-1 text-xs text-[var(--dna-muted)] leading-relaxed">{f.desc}</div>
              </div>
              <Icon size={18} className="text-[var(--dna-accent)] mt-1 shrink-0" />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function FeaturesBento() {
  const cells = [
    { f: FEATURES[0], cls: 'col-span-2 row-span-2', big: true },
    { f: FEATURES[1], cls: '' },
    { f: FEATURES[2], cls: '' },
    { f: FEATURES[3], cls: '' },
    { f: FEATURES[5], cls: '' },
  ]
  return (
    <section className={`px-6 py-10 bg-[var(--dna-bg)] ${T}`}>
      <div className="grid grid-cols-3 auto-rows-[88px] gap-2.5 max-w-2xl mx-auto">
        {cells.map(({ f, cls, big }, i) => {
          const Icon = ICONS[f.icon] ?? Zap
          return (
            <div
              key={f.title}
              className={`rounded-[var(--dna-radius)] p-3.5 flex flex-col justify-end border ${cls} ${
                big ? 'bg-[var(--dna-accent)] border-transparent' : i === 3 ? 'bg-[var(--dna-text)] border-transparent' : 'bg-[var(--dna-surface)] border-[var(--dna-line)]'
              } ${T}`}
            >
              <Icon size={big ? 22 : 15} className={big || i === 3 ? 'text-[var(--dna-bg)] mb-auto' : 'text-[var(--dna-accent)] mb-auto'} />
              <div className={`text-[12px] font-bold ${big || i === 3 ? 'text-[var(--dna-bg)]' : 'text-[var(--dna-text)]'}`}>{f.title}</div>
              {big && <div className="text-[10px] mt-0.5 text-[var(--dna-on-accent)] opacity-80">{f.desc}</div>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ---------------- cta · 行动召唤 ---------------- */

function CtaSimple() {
  return (
    <section className={`px-6 py-14 text-center bg-[var(--dna-bg)] ${T}`}>
      <h2 className="text-3xl font-black text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}>
        准备好挑选了吗？
      </h2>
      <p className="mt-3 text-sm text-[var(--dna-muted)]">免费开始，前三个项目不限候选数量。</p>
      <div className="mt-6 inline-flex items-center rounded-[var(--dna-radius)] border border-[var(--dna-line)] bg-[var(--dna-surface)] p-1" style={{ boxShadow: 'var(--dna-shadow)' }}>
        <span className="px-3 text-xs text-[var(--dna-muted)]">you@company.com</span>
        <button className={`px-4 py-2 rounded-[calc(var(--dna-radius)/1.2)] bg-[var(--dna-accent)] text-[var(--dna-on-accent)] text-xs font-semibold ${T}`}>获取邀请</button>
      </div>
    </section>
  )
}

function CtaBanner() {
  return (
    <section className="px-6 py-10 bg-[var(--dna-bg)]">
      <div className={`relative overflow-hidden rounded-[var(--dna-radius)] bg-[var(--dna-text)] px-8 py-10 ${T}`} style={{ boxShadow: 'var(--dna-shadow)' }}>
        <div className="relative z-10 flex items-center justify-between gap-6 flex-wrap">
          <div>
            <h2 className="text-2xl sm:text-3xl font-black text-[var(--dna-bg)]" style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}>
              下一个界面，不用画。
            </h2>
            <p className="mt-2 text-sm text-[var(--dna-bg)] opacity-60">描述它，生成它，挑走它。</p>
          </div>
          <button className={`px-6 py-3 rounded-[var(--dna-radius)] bg-[var(--dna-accent)] text-[var(--dna-on-accent)] text-sm font-bold flex items-center gap-2 ${T}`}>
            免费创建项目 <ArrowRight size={15} />
          </button>
        </div>
        <div className="absolute -left-8 -top-12 w-40 h-40 rounded-full bg-[var(--dna-accent2)] opacity-30 blur-2xl" />
      </div>
    </section>
  )
}

function CtaManifesto() {
  return (
    <section className={`px-6 py-14 bg-[var(--dna-accent2)] ${T}`}>
      <div className="max-w-xl mx-auto text-center">
        <div className="text-[10px] font-black tracking-[0.3em] uppercase text-[var(--dna-on-accent)] opacity-70">Manifesto</div>
        <h2 className="mt-3 text-3xl sm:text-4xl font-black uppercase leading-tight text-[var(--dna-on-accent)]" style={{ fontFamily: 'var(--dna-display)', letterSpacing: '-0.02em' }}>
          AI 负责生成<br />人负责挑选
        </h2>
        <div className="mt-6 flex justify-center gap-2.5">
          <button className={`px-5 py-2.5 rounded-[var(--dna-radius)] bg-[var(--dna-text)] text-[var(--dna-bg)] text-xs font-black uppercase ${T}`}>加入等待名单</button>
          <button className="px-5 py-2.5 rounded-[var(--dna-radius)] border-2 border-[var(--dna-on-accent)] text-xs font-black uppercase text-[var(--dna-on-accent)]">阅读宣言</button>
        </div>
      </div>
    </section>
  )
}

/* ---------------- 导出槽位定义 ---------------- */

export const landingSlots: SlotDef[] = [
  {
    id: 'nav',
    role: '导航栏',
    width: 'fluid',
    inputs: ['links: Link[]', 'cta: Action'],
    outputs: ['onNavigate(href)', 'onCta()'],
    dependencies: ['lucide-react'],
    previewH: 70,
    candidates: [
      { id: 'nav-a', label: 'A · 经典顶栏', style: 'conservative', blurb: 'Logo 左、链接中、双按钮右，最稳妥', Component: NavClassic },
      { id: 'nav-b', label: 'B · 悬浮胶囊', style: 'expressive', blurb: '浮动 pill 导航，居中带投影', Component: NavPill },
      { id: 'nav-c', label: 'C · 分裂字标', style: 'experimental', blurb: '超大居中字标，链接分裂两侧', Component: NavSplit },
    ],
  },
  {
    id: 'hero',
    role: '主视觉',
    width: 'fluid',
    inputs: ['headline: string', 'sub: string', 'cta: Action'],
    outputs: ['onPrimary()', 'onSecondary()'],
    dependencies: ['lucide-react'],
    previewH: 250,
    candidates: [
      { id: 'hero-a', label: 'A · 居中大标题', style: 'conservative', blurb: '徽章 + 大标题 + 双按钮的万能结构', Component: HeroCenter },
      { id: 'hero-b', label: 'B · 左右分栏', style: 'expressive', blurb: '文案与产品截图并排，讲故事', Component: HeroSplit },
      { id: 'hero-c', label: 'C · 满屏撞色', style: 'experimental', blurb: '主色铺满，超大英文排印，态度优先', Component: HeroBold },
    ],
  },
  {
    id: 'features',
    role: '特性区',
    width: 'fluid',
    inputs: ['features: Feature[]'],
    outputs: [],
    dependencies: ['lucide-react'],
    previewH: 240,
    candidates: [
      { id: 'feat-a', label: 'A · 三列网格', style: 'conservative', blurb: '图标卡片 2×3，信息密度均衡', Component: FeaturesGrid },
      { id: 'feat-b', label: 'B · 编号列表', style: 'expressive', blurb: '01–04 编号横排，杂志目录感', Component: FeaturesRows },
      { id: 'feat-c', label: 'C · Bento 拼格', style: 'experimental', blurb: '大小错落的便当格，主色块压轴', Component: FeaturesBento },
    ],
  },
  {
    id: 'cta',
    role: '行动召唤',
    width: 'fluid',
    inputs: ['title: string', 'cta: Action'],
    outputs: ['onSubmit(email)'],
    dependencies: ['lucide-react'],
    previewH: 170,
    candidates: [
      { id: 'cta-a', label: 'A · 邮箱订阅', style: 'conservative', blurb: '标题 + 内嵌输入框，转化路径最短', Component: CtaSimple },
      { id: 'cta-b', label: 'B · 深色横幅', style: 'expressive', blurb: '反色横幅收尾，视觉重心下坠', Component: CtaBanner },
      { id: 'cta-c', label: 'C · 宣言式收尾', style: 'experimental', blurb: '把 Slogan 本身当成 CTA', Component: CtaManifesto },
    ],
  },
]
