import type { ComponentContract, PagePlan } from './types.ts'

const ATOMIC_WIDGET = /计数(?:器)?|counter|计算器|calculator|秒表|timer|倒计时|播放器|player|开关|toggle|登录(?:框|表单)?|login form|单个?表单|single form/i

function uniqueByName<T extends { name: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.name, item])).values()]
}

function atomicName(requirement: string) {
  if (/计数|counter/i.test(requirement)) return { id: 'counter', role: '完整计数器' }
  if (/计算器|calculator/i.test(requirement)) return { id: 'calculator', role: '完整计算器' }
  if (/秒表|timer|倒计时/i.test(requirement)) return { id: 'timer', role: '完整计时器' }
  if (/播放器|player/i.test(requirement)) return { id: 'player', role: '完整播放器' }
  if (/登录|login|表单|form/i.test(requirement)) return { id: 'form', role: '完整交互表单' }
  return { id: 'widget', role: '完整交互组件' }
}

export function createAtomicPlan(requirement: string): PagePlan | null {
  if (!ATOMIC_WIDGET.test(requirement)) return null
  const identity = atomicName(requirement)
  const component: ComponentContract = {
    ...identity,
    slot: 'page-main',
    width: 'fluid',
    inputs: [],
    outputs: [],
    dependencies: ['react', 'lucide-react', 'motion'],
    designTokens: ['color', 'surface', 'text', 'radius', 'spacing', 'motion'],
  }
  return {
    project: { name: identity.role, description: requirement.trim() },
    pages: [{ id: 'home', name: '主页', route: '/', slots: [component.id] }],
    visualDirections: [],
    components: [component],
  }
}

/** Last line of defence when a remote Planner splits one atomic stateful widget. */
export function normalizePlanCohesion(plan: PagePlan, requirement: string): PagePlan {
  if (!ATOMIC_WIDGET.test(requirement) || plan.components.length <= 1 || plan.components.length > 3) return plan
  const identity = atomicName(requirement)
  const mergedIds = new Set(plan.components.map((component) => component.id))
  const merged: ComponentContract = {
    ...identity,
    slot: plan.components[0]?.slot ?? 'page-main',
    width: plan.components.some((component) => component.width === 'fluid') ? 'fluid' : 'fixed',
    inputs: uniqueByName(plan.components.flatMap((component) => component.inputs)),
    outputs: uniqueByName(plan.components.flatMap((component) => component.outputs)),
    dependencies: [...new Set(plan.components.flatMap((component) => component.dependencies))],
    designTokens: [...new Set(plan.components.flatMap((component) => component.designTokens))],
  }
  return {
    ...plan,
    components: [merged],
    pages: plan.pages.map((page) => {
      const firstMergedAt = page.slots.findIndex((slot) => mergedIds.has(slot))
      if (firstMergedAt < 0) return page
      return {
        ...page,
        slots: page.slots.flatMap((slot, index) => {
          if (!mergedIds.has(slot)) return [slot]
          return index === firstMergedAt ? [merged.id] : []
        }),
      }
    }),
  }
}
