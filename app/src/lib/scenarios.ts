import type { Scenario } from '../candidates/types'
import { dashboardSlots } from '../candidates/dashboard'
import { landingSlots } from '../candidates/landing'

export const SCENARIOS: Scenario[] = [
  {
    id: 'pulse-dashboard',
    title: 'SaaS 数据看板',
    projectName: 'Pulse · 增长分析台',
    match: /看板|dashboard|数据|分析|后台|管理|报表|监控|bi/i,
    layout: 'dashboard',
    plannerNotes: [
      '理解需求：B 端增长分析看板，首屏信息密度优先',
      '拆分页面：识别出 5 个独立槽位（header / sidebar / stats / chart / table）',
      '生成组件合同：为每个槽位锁定 Props 输入、事件输出与依赖白名单',
      '规划视觉方向：生成 3 条设计分支，等待用户挑选底板',
    ],
    slots: dashboardSlots,
  },
  {
    id: 'nova-landing',
    title: '产品落地页',
    projectName: 'Nova · 产品官网',
    match: /落地页|landing|官网|主页|首页|宣传|营销|网站/i,
    layout: 'landing',
    plannerNotes: [
      '理解需求：产品官网首页，需要在 5 秒内讲清价值主张',
      '拆分页面：识别出 4 个独立槽位（nav / hero / features / cta）',
      '生成组件合同：为每个槽位锁定 Props 输入、事件输出与依赖白名单',
      '规划视觉方向：生成 3 条设计分支，等待用户挑选底板',
    ],
    slots: landingSlots,
  },
]

export function matchScenario(prompt: string): Scenario {
  return SCENARIOS.find((s) => s.match.test(prompt)) ?? SCENARIOS[0]
}

export const EXAMPLE_PROMPTS = [
  '帮我做一个 SaaS 增长数据看板，要有指标卡、趋势图和订单列表',
  '给 AI 效率工具做一个有未来感的产品落地页',
]
