// 候选组件共享的模拟数据（演示场景：真实的 AI Harness 会把这些数据写进 Props 合同）

export const STATS = [
  { label: '月活跃用户', value: '128,430', delta: '+12.4%', up: true },
  { label: '付费转化率', value: '4.86%', delta: '+0.6%', up: true },
  { label: '客单价', value: '¥ 286', delta: '-2.1%', up: false },
  { label: '净推荐值 NPS', value: '62', delta: '+4', up: true },
]

export const TREND = [
  { m: '1月', revenue: 42, users: 30 },
  { m: '2月', revenue: 55, users: 38 },
  { m: '3月', revenue: 49, users: 45 },
  { m: '4月', revenue: 68, users: 52 },
  { m: '5月', revenue: 74, users: 60 },
  { m: '6月', revenue: 91, users: 71 },
  { m: '7月', revenue: 86, users: 78 },
  { m: '8月', revenue: 104, users: 90 },
]

export const CHANNELS = [
  { name: '自然搜索', value: 38 },
  { name: '直接访问', value: 26 },
  { name: '社交媒体', value: 21 },
  { name: '外链推荐', value: 15 },
]

export const ORDERS = [
  { id: '#WT-2041', user: '陈一鸣', product: 'Pro 年度订阅', amount: '¥1,288', status: '已完成', time: '10:24' },
  { id: '#WT-2040', user: '林小满', product: '团队席位 ×5', amount: '¥2,940', status: '进行中', time: '09:58' },
  { id: '#WT-2039', user: '赵一帆', product: 'Pro 月度订阅', amount: '¥128', status: '已完成', time: '09:31' },
  { id: '#WT-2038', user: '何静姝', product: '企业定制版', amount: '¥18,600', status: '待支付', time: '08:47' },
  { id: '#WT-2037', user: '沈从周', product: '团队席位 ×2', amount: '¥1,176', status: '已完成', time: '08:12' },
]

export const NAV_ITEMS = ['概览', '分析', '订单', '客户', '营销', '设置']

export const FEATURES = [
  { icon: 'zap', title: '秒级生成', desc: '描述需求，AI 并发产出多个组件候选，完成一个渲染一个。' },
  { icon: 'layers', title: '挑选拼合', desc: '像挑衣服一样滚动试穿候选，一键扣合进你的页面。' },
  { icon: 'git-branch', title: '设计分支', desc: '每个视觉方向都是一条分支，随时切换、随时回滚。' },
  { icon: 'shield', title: '沙箱运行', desc: '生成的代码只在隔离沙箱中运行，接口受控，审美自由。' },
  { icon: 'scan', title: '截图审查', desc: 'AI 对最终页面截图复查，只打局部补丁，不重写全页。' },
  { icon: 'download', title: '一键导出', desc: '页面计划、组件合同与选择历史，导出为 JSON 带走。' },
]
