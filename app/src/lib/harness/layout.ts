import type { Scenario } from '../../candidates/types'
import type { PagePlan } from './types'

export const DASHBOARD_SLOT_PATTERNS = [
  /header|top-nav|navbar|顶部导航|顶栏/i,
  /sidebar|side-nav|侧边|侧栏/i,
  /stats|metrics|summary|指标|数据卡|摘要/i,
  /chart|trend|收入趋势|图表|趋势/i,
  /table|orders|订单|表格/i,
]

export const LANDING_SLOT_PATTERNS = [
  /^nav\b|navbar|顶部导航|导航栏/i,
  /hero|首屏|主视觉/i,
  /features|功能|特性/i,
  /cta|行动召唤|立即开始|订阅/i,
]

export function pickDistinctSemanticSlots<T>(
  items: T[],
  patterns: RegExp[],
  semantic: (item: T) => string,
) {
  const used = new Set<T>()
  return patterns.map((pattern) => {
    const match = items.find((item) => !used.has(item) && pattern.test(semantic(item)))
    if (match) used.add(match)
    return match
  })
}

export function inferGeneratedLayout(plan: PagePlan): Scenario['layout'] {
  const projectIntent = `${plan.project.name} ${plan.project.description}`
  const componentIntent = plan.components.map((component) => `${component.id} ${component.slot} ${component.role}`).join(' ')
  if (/dashboard|驾驶舱|看板|后台|管理台|控制台/i.test(projectIntent)) return 'dashboard'
  if (/landing|落地页|产品页|官网|营销页/i.test(projectIntent)) return 'landing'

  const dashboardSignals = [
    /sidebar|side-nav|侧边栏|侧栏/i,
    /chart|trend|图表|趋势/i,
    /table|orders|表格|订单/i,
    /metrics|stats|指标|数据卡/i,
  ].filter((pattern) => pattern.test(componentIntent)).length
  const landingSignals = [
    /hero|首屏|主视觉/i,
    /features|功能特性/i,
    /pricing|价格|定价/i,
    /cta|行动召唤/i,
  ].filter((pattern) => pattern.test(componentIntent)).length

  if (dashboardSignals >= 2 && dashboardSignals >= landingSignals) return 'dashboard'
  if (landingSignals >= 2 && landingSignals > dashboardSignals) return 'landing'
  return 'freeform'
}

export function overviewContainScale(
  viewportWidth: number,
  viewportHeight: number,
  logicalWidth: number,
  contentHeight: number,
  reservedHeight = 120,
) {
  if (![viewportWidth, viewportHeight, logicalWidth, contentHeight].every(Number.isFinite) || logicalWidth <= 0 || contentHeight <= 0) return 1
  const availableWidth = Math.max(160, viewportWidth - 16)
  const availableHeight = Math.max(120, viewportHeight - reservedHeight)
  // Render at a desktop-like logical width first, then contain that canvas by
  // both dimensions. This avoids turning a narrow responsive page into a long,
  // unreadable strip before scaling it down.
  return Math.max(0.02, Math.min(1, availableWidth / logicalWidth, availableHeight / contentHeight) * 0.97)
}
