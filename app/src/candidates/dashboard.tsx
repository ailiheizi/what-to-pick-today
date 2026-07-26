// Dashboard 场景候选库 —— 模拟 Component Builders 的并发产出。
// 视觉全部绑定 Visual DNA token（var(--dna-*)），放开审美、管住接口。
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Bell, ChevronDown, CircleDot, Command, Gauge, LayoutGrid, Search, Settings2, Sparkles,
} from 'lucide-react'
import type { SlotDef } from './types'
import { CHANNELS, NAV_ITEMS, ORDERS, STATS, TREND } from './data'

const T = 'transition-[background-color,color,border-color,border-radius,box-shadow] duration-500 backdrop-blur-[var(--dna-blur)]'

/* ---------------- header · 页面头部 ---------------- */

function HeaderMinimal() {
  return (
    <header className={`flex items-center gap-4 px-5 py-3 dna-chrome dna-line-b ${T}`}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-[calc(var(--dna-radius)/2)] bg-[var(--dna-accent)]" />
        <span className="font-semibold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-display)' }}>Pulse 看板</span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--dna-radius)] dna-fill text-[var(--dna-muted)] text-xs w-56">
        <Search size={13} /> 搜索订单、客户…
      </div>
      <Bell size={15} className="text-[var(--dna-muted)]" />
      <div className="w-7 h-7 rounded-full bg-[var(--dna-accent2)] flex items-center justify-center text-[10px] font-bold text-[var(--dna-on-accent)]">K</div>
    </header>
  )
}

function HeaderBreadcrumb() {
  return (
    <header className={`px-5 py-3 dna-chrome dna-line-b ${T}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-widest uppercase text-[var(--dna-muted)]" style={{ fontFamily: 'var(--dna-font)' }}>
            工作台 / 分析
          </div>
          <h1 className="text-lg font-bold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}>
            增长概览
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {['今日', '7 天', '30 天'].map((t, i) => (
            <button
              key={t}
              className={`px-3 py-1 text-xs rounded-[var(--dna-radius)] ${i === 1 ? 'bg-[var(--dna-accent)] text-[var(--dna-on-accent)]' : 'text-[var(--dna-muted)] bg-[var(--dna-surface2)]'} ${T}`}
            >
              {t}
            </button>
          ))}
          <button className={`ml-2 px-3 py-1.5 text-xs rounded-[var(--dna-radius)] border border-[var(--dna-line)] text-[var(--dna-text)] flex items-center gap-1 ${T}`}>
            <ChevronDown size={12} /> 导出
          </button>
        </div>
      </div>
    </header>
  )
}

function HeaderCommand() {
  return (
    <header className={`flex items-center gap-3 px-5 py-3 bg-[var(--dna-bg)] ${T}`}>
      <div className={`flex-1 flex items-center gap-3 px-4 py-2.5 dna-card ${T}`} style={{ boxShadow: 'var(--dna-shadow)' }}>
        <Command size={14} className="text-[var(--dna-accent)]" />
        <span className="text-sm text-[var(--dna-muted)]" style={{ fontFamily: 'var(--dna-font)' }}>输入命令或搜索…</span>
        <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[var(--dna-surface2)] text-[var(--dna-muted)]" style={{ fontFamily: 'var(--dna-font)' }}>⌘K</kbd>
      </div>
      <button className={`px-4 py-2.5 rounded-[var(--dna-radius)] bg-[var(--dna-accent)] text-[var(--dna-on-accent)] text-sm font-medium flex items-center gap-1.5 ${T}`}>
        <Sparkles size={14} /> 新建报表
      </button>
      <div className="w-8 h-8 rounded-[var(--dna-radius)] dna-fill flex items-center justify-center text-[var(--dna-muted)]">
        <Bell size={14} />
      </div>
    </header>
  )
}

/* ---------------- sidebar · 侧边导航 ---------------- */

function SidebarRail() {
  const icons = [LayoutGrid, Gauge, CircleDot, Bell, Command, Settings2]
  return (
    <aside className={`h-full w-14 shrink-0 flex flex-col items-center py-4 gap-1.5 dna-chrome dna-line-r ${T}`}>
      {icons.map((Icon, i) => (
        <div
          key={i}
          className={`w-9 h-9 rounded-[var(--dna-radius)] flex items-center justify-center ${i === 0 ? 'bg-[var(--dna-accent)] text-[var(--dna-on-accent)]' : 'text-[var(--dna-muted)] hover:bg-[var(--dna-surface2)]'} ${T}`}
        >
          <Icon size={16} />
        </div>
      ))}
      <div className="mt-auto w-8 h-8 rounded-full bg-[var(--dna-surface2)] border border-[var(--dna-line)]" />
    </aside>
  )
}

function SidebarFull() {
  return (
    <aside className={`h-full w-44 shrink-0 flex flex-col py-4 px-3 dna-chrome dna-line-r ${T}`}>
      <div className="px-2 pb-2 text-[10px] tracking-widest uppercase text-[var(--dna-muted)]">导航</div>
      {NAV_ITEMS.map((n, i) => (
        <div
          key={n}
          className={`flex items-center gap-2 px-2.5 py-2 rounded-[var(--dna-radius)] text-sm ${i === 0 ? 'bg-[var(--dna-surface2)] text-[var(--dna-text)] font-semibold' : 'text-[var(--dna-muted)]'} ${T}`}
        >
          {i === 0 && <div className="w-1 h-4 rounded-full bg-[var(--dna-accent)]" />}
          {n}
          {i === 2 && <span className="ml-auto text-[9px] px-1.5 rounded-full bg-[var(--dna-accent)] text-[var(--dna-on-accent)]">12</span>}
        </div>
      ))}
      <div className={`mt-auto mx-1 p-3 rounded-[var(--dna-radius)] dna-fill ${T}`}>
        <div className="text-xs font-semibold text-[var(--dna-text)]">用量 78%</div>
        <div className="mt-2 h-1.5 rounded-full bg-[var(--dna-line)] overflow-hidden">
          <div className="h-full w-[78%] rounded-full bg-[var(--dna-accent)]" />
        </div>
      </div>
    </aside>
  )
}

function SidebarTree() {
  const groups: [string, string[]][] = [
    ['分析', ['概览', '漏斗', '留存']],
    ['经营', ['订单', '客户']],
    ['系统', ['设置']],
  ]
  return (
    <aside className={`h-full w-44 shrink-0 py-4 px-3 bg-[var(--dna-bg)] dna-line-r overflow-hidden ${T}`}>
      {groups.map(([g, items]) => (
        <div key={g} className="mb-3">
          <div className="px-2 py-1 text-[10px] font-bold tracking-widest uppercase text-[var(--dna-muted)]" style={{ fontFamily: 'var(--dna-font)' }}>{g}</div>
          {items.map((it, j) => (
            <div
              key={it}
              className={`ml-2 px-2.5 py-1.5 text-[13px] rounded-[calc(var(--dna-radius)/1.5)] border-l-2 ${j === 0 && g === '分析' ? 'border-[var(--dna-accent)] text-[var(--dna-text)] bg-[var(--dna-surface)]' : 'border-transparent text-[var(--dna-muted)]'} ${T}`}
            >
              {it}
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}

/* ---------------- stats · 指标卡 ---------------- */

function StatsCards() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {STATS.map((s) => (
        <div key={s.label} className={`p-4 dna-card ${T}`} style={{ boxShadow: 'var(--dna-shadow)' }}>
          <div className="text-xs text-[var(--dna-muted)]">{s.label}</div>
          <div className="mt-1.5 text-xl font-bold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-display)', letterSpacing: 'var(--dna-tracking)' }}>{s.value}</div>
          <div className={`mt-1 text-[11px] font-medium ${s.up ? 'text-emerald-500' : 'text-rose-500'}`}>{s.delta} vs 上月</div>
        </div>
      ))}
    </div>
  )
}

function StatsStrip() {
  return (
    <div className={`flex divide-x divide-[var(--dna-line)] dna-card overflow-hidden ${T}`}>
      {STATS.map((s) => (
        <div key={s.label} className="flex-1 px-4 py-3.5">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-font)' }}>{s.value}</span>
            <span className={`text-[10px] ${s.up ? 'text-emerald-500' : 'text-rose-500'}`}>{s.delta}</span>
          </div>
          <div className="text-[11px] text-[var(--dna-muted)] mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

function StatsSpark() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {STATS.map((s, i) => (
        <div key={s.label} className={`relative p-4 rounded-[var(--dna-radius)] overflow-hidden ${i === 0 ? 'bg-[var(--dna-accent)]' : 'bg-[var(--dna-surface)] border border-[var(--dna-line)]'} ${T}`}>
          <div className={`text-xs ${i === 0 ? 'text-[var(--dna-on-accent)] opacity-80' : 'text-[var(--dna-muted)]'}`}>{s.label}</div>
          <div className={`mt-1 text-xl font-bold ${i === 0 ? 'text-[var(--dna-on-accent)]' : 'text-[var(--dna-text)]'}`} style={{ fontFamily: 'var(--dna-display)' }}>{s.value}</div>
          <div className="absolute bottom-0 left-0 right-0 h-8 opacity-70">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={TREND}>
                <Line type="monotone" dataKey={i % 2 ? 'users' : 'revenue'} stroke={i === 0 ? 'var(--dna-on-accent)' : 'var(--dna-accent2)'} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------------- chart · 主图表 ---------------- */

function ChartArea() {
  return (
    <div className={`p-4 dna-card ${T}`} style={{ boxShadow: 'var(--dna-shadow)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-[var(--dna-text)]">收入与用户增长</div>
        <div className="flex gap-3 text-[11px] text-[var(--dna-muted)]">
          <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-[var(--dna-accent)] inline-block" />收入</span>
          <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-[var(--dna-accent2)] inline-block" />用户</span>
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={TREND} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="var(--dna-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 10, fill: 'var(--dna-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--dna-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--dna-surface)', border: '1px solid var(--dna-line)', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="revenue" stroke="var(--dna-accent)" fill="var(--dna-accent)" fillOpacity={0.15} strokeWidth={2} />
            <Area type="monotone" dataKey="users" stroke="var(--dna-accent2)" fill="var(--dna-accent2)" fillOpacity={0.1} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartBars() {
  return (
    <div className={`p-4 dna-card ${T}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-[var(--dna-text)]">月度收入</div>
          <div className="text-[11px] text-[var(--dna-muted)]">单位：万元 · 最近 8 个月</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-[var(--dna-accent)]" style={{ fontFamily: 'var(--dna-font)' }}>+38%</div>
          <div className="text-[10px] text-[var(--dna-muted)]">同比增长</div>
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={TREND} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="var(--dna-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="m" tick={{ fontSize: 10, fill: 'var(--dna-muted)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--dna-muted)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--dna-surface)', border: '1px solid var(--dna-line)', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="revenue" fill="var(--dna-accent)" radius={[4, 4, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ChartDonut() {
  const COLORS = ['var(--dna-accent)', 'var(--dna-accent2)', 'var(--dna-muted)', 'var(--dna-line)']
  return (
    <div className={`p-4 dna-card flex items-center gap-4 ${T}`}>
      <div className="relative w-36 h-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={CHANNELS} dataKey="value" innerRadius={42} outerRadius={62} strokeWidth={0} paddingAngle={3}>
              {CHANNELS.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-font)' }}>38%</span>
          <span className="text-[9px] text-[var(--dna-muted)]">自然搜索</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        <div className="text-sm font-semibold text-[var(--dna-text)]">流量来源</div>
        {CHANNELS.map((c, i) => (
          <div key={c.name} className="flex items-center gap-2 text-[11px]">
            <i className="w-2 h-2 rounded-full inline-block" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="text-[var(--dna-muted)]">{c.name}</span>
            <span className="ml-auto font-semibold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-font)' }}>{c.value}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- table · 数据表 ---------------- */

function StatusPill({ s }: { s: string }) {
  const cls =
    s === '已完成'
      ? 'bg-emerald-500/10 text-emerald-500'
      : s === '进行中'
        ? 'bg-[var(--dna-accent)]/10 text-[var(--dna-accent)]'
        : 'bg-amber-500/10 text-amber-500'
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>{s}</span>
}

function TableDense() {
  return (
    <div className={`dna-card overflow-hidden ${T}`}>
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-[var(--dna-line)]">
        <span className="text-sm font-semibold text-[var(--dna-text)]">最近订单</span>
        <span className="text-[11px] text-[var(--dna-accent)]">查看全部 →</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--dna-muted)] border-b border-[var(--dna-line)]">
            {['单号', '客户', '商品', '金额', '状态'].map((h) => (
              <th key={h} className="px-4 py-2 font-medium" style={{ fontFamily: 'var(--dna-font)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ORDERS.map((o) => (
            <tr key={o.id} className="border-b border-[var(--dna-line)] last:border-0 hover:bg-[var(--dna-surface2)]">
              <td className="px-4 py-2 text-[var(--dna-muted)]" style={{ fontFamily: 'var(--dna-font)' }}>{o.id}</td>
              <td className="px-4 py-2 text-[var(--dna-text)]">{o.user}</td>
              <td className="px-4 py-2 text-[var(--dna-muted)]">{o.product}</td>
              <td className="px-4 py-2 font-semibold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-font)' }}>{o.amount}</td>
              <td className="px-4 py-2"><StatusPill s={o.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableCards() {
  return (
    <div className="space-y-2">
      {ORDERS.slice(0, 4).map((o) => (
        <div key={o.id} className={`flex items-center gap-3 px-4 py-3 dna-card ${T}`}>
          <div className="w-8 h-8 rounded-full bg-[var(--dna-surface2)] flex items-center justify-center text-xs font-bold text-[var(--dna-accent)]">
            {o.user[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-[var(--dna-text)] truncate">{o.user} · {o.product}</div>
            <div className="text-[10px] text-[var(--dna-muted)]" style={{ fontFamily: 'var(--dna-font)' }}>{o.id} · {o.time}</div>
          </div>
          <div className="text-sm font-bold text-[var(--dna-text)]" style={{ fontFamily: 'var(--dna-font)' }}>{o.amount}</div>
          <StatusPill s={o.status} />
        </div>
      ))}
    </div>
  )
}

function TableFeed() {
  return (
    <div className={`dna-card p-4 ${T}`}>
      <div className="text-sm font-semibold text-[var(--dna-text)] mb-3">实时动态</div>
      <div className="relative pl-5 space-y-3.5 before:absolute before:left-[5px] before:top-1 before:bottom-1 before:w-px before:bg-[var(--dna-line)]">
        {ORDERS.slice(0, 4).map((o, i) => (
          <div key={o.id} className="relative">
            <i className={`absolute -left-5 top-1 w-[11px] h-[11px] rounded-full border-2 border-[var(--dna-surface)] ${i === 0 ? 'bg-[var(--dna-accent)]' : 'bg-[var(--dna-line)]'}`} />
            <div className="text-[12px] text-[var(--dna-text)]">
              <b>{o.user}</b> 提交了 <span className="text-[var(--dna-accent)]">{o.product}</span>
            </div>
            <div className="text-[10px] text-[var(--dna-muted)]" style={{ fontFamily: 'var(--dna-font)' }}>{o.time} · {o.amount} · {o.status}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 导出槽位定义 ---------------- */

export const dashboardSlots: SlotDef[] = [
  {
    id: 'header',
    role: '页面头部',
    width: 'fluid',
    inputs: ['user: User', 'dateRange: Range'],
    outputs: ['onSearch(q)', 'onExport()'],
    dependencies: ['lucide-react'],
    previewH: 64,
    candidates: [
      { id: 'header-a', label: 'A · 极简顶栏', style: 'conservative', blurb: '克制的信息架构，搜索与账户右置', Component: HeaderMinimal },
      { id: 'header-b', label: 'B · 面包屑标题', style: 'expressive', blurb: '大标题 + 时间范围切换，强调场景感', Component: HeaderBreadcrumb },
      { id: 'header-c', label: 'C · 命令栏', style: 'experimental', blurb: '⌘K 命令面板优先的效率工具形态', Component: HeaderCommand },
    ],
  },
  {
    id: 'sidebar',
    role: '侧边导航',
    width: 'fixed',
    inputs: ['nav: NavItem[]', 'activeId: string'],
    outputs: ['onNavigate(id)'],
    dependencies: ['lucide-react'],
    previewH: 260,
    candidates: [
      { id: 'sidebar-a', label: 'A · 图标轨道', style: 'conservative', blurb: '窄轨道省空间，hover 展开标签', Component: SidebarRail },
      { id: 'sidebar-b', label: 'B · 完整导航', style: 'expressive', blurb: '带徽标与用量卡的经典 SaaS 侧栏', Component: SidebarFull },
      { id: 'sidebar-c', label: 'C · 分组树', style: 'experimental', blurb: '分组树形结构，左边线指示当前位置', Component: SidebarTree },
    ],
  },
  {
    id: 'stats',
    role: '指标卡组',
    width: 'fluid',
    inputs: ['stats: Stat[]'],
    outputs: ['onDrill(metric)'],
    dependencies: ['recharts'],
    previewH: 110,
    candidates: [
      { id: 'stats-a', label: 'A · 经典卡片', style: 'conservative', blurb: '四张卡片，数值 + 环比，信息最清晰', Component: StatsCards },
      { id: 'stats-b', label: 'B · 数据横条', style: 'expressive', blurb: '一整条分割线布局，等宽字体读数', Component: StatsStrip },
      { id: 'stats-c', label: 'C · 迷你趋势', style: 'experimental', blurb: '首卡高亮主色，底部嵌入 sparkline', Component: StatsSpark },
    ],
  },
  {
    id: 'chart',
    role: '主图表',
    width: 'fluid',
    inputs: ['series: Series[]', 'granularity: string'],
    outputs: ['onRangeSelect(r)'],
    dependencies: ['recharts'],
    previewH: 190,
    candidates: [
      { id: 'chart-a', label: 'A · 双轴面积图', style: 'conservative', blurb: '收入与用户双序列，趋势一目了然', Component: ChartArea },
      { id: 'chart-b', label: 'B · 柱状对比', style: 'expressive', blurb: '柱状节奏 + 同比读数，偏经营汇报', Component: ChartBars },
      { id: 'chart-c', label: 'C · 环形构成', style: 'experimental', blurb: '放弃时间轴，直接展示流量构成', Component: ChartDonut },
    ],
  },
  {
    id: 'table',
    role: '订单列表',
    width: 'fluid',
    inputs: ['orders: Order[]'],
    outputs: ['onRowClick(id)'],
    dependencies: [],
    previewH: 210,
    candidates: [
      { id: 'table-a', label: 'A · 密集型表格', style: 'conservative', blurb: '传统数据表，状态胶囊 + 斑马纹 hover', Component: TableDense },
      { id: 'table-b', label: 'B · 卡片流', style: 'expressive', blurb: '每行一张卡片，头像与金额右置', Component: TableCards },
      { id: 'table-c', label: 'C · 动态时间线', style: 'experimental', blurb: '把订单讲成一条实时动态流', Component: TableFeed },
    ],
  },
]
