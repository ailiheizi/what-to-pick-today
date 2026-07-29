import type { ComponentContract, PagePlan } from './types.ts'
import { areSignalTypesCompatible, inferSemanticBindings } from './bindings.ts'

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

function callbackName(name: string) {
  const normalized = name.replace(/[^a-zA-Z0-9]+(.)/g, (_match, char: string) => char.toUpperCase())
  const pascal = normalized.charAt(0).toUpperCase() + normalized.slice(1)
  return `on${pascal}Change`
}

/** Values crossing into another slot must be emitted through an unambiguous callback prop. */
export function normalizePlanEventOutputs(plan: PagePlan): PagePlan {
  const inputOwners = new Map<string, Set<string>>()
  for (const component of plan.components) {
    for (const input of component.inputs) {
      const owners = inputOwners.get(input.name) ?? new Set<string>()
      owners.add(component.id)
      inputOwners.set(input.name, owners)
    }
  }
  let changed = false
  const components = plan.components.map((component) => {
    const outputs = component.outputs.map((output) => {
        const feedsSibling = [...(inputOwners.get(output.name) ?? [])].some((owner) => owner !== component.id)
        if (!feedsSibling || /^on[A-Z]/.test(output.name)) return output
        changed = true
        return { ...output, name: callbackName(output.name) }
      })
    return outputs.some((output, index) => output !== component.outputs[index]) ? { ...component, outputs } : component
  })
  return changed ? { ...plan, components } : plan
}

/**
 * The producer owns the payload shape. If a Planner describes a callback as
 * `string` but its semantic consumer as `object`, generated siblings can each
 * compile and still crash the first time the user interacts. Repair that
 * contract before Draft/Builder prompts are created.
 */
export function normalizePlanSignalTypes(plan: PagePlan): PagePlan {
  const bindings = inferSemanticBindings(plan.components, { requireCompatibleTypes: false })
  if (!bindings.length) return plan
  const outputTypes = new Map<string, string>()
  for (const component of plan.components) {
    for (const output of component.outputs) outputTypes.set(`${component.id}:${output.name}`, output.payload)
  }
  const targetTypes = new Map<string, string>()
  for (const binding of bindings) {
    const payload = outputTypes.get(`${binding.fromComponentId}:${binding.outputName}`)
    if (!payload) continue
    for (const target of binding.targets) targetTypes.set(`${target.componentId}:${target.inputName}`, payload)
  }
  let changed = false
  const components = plan.components.map((component) => {
    const inputs = component.inputs.map((input) => {
      const payload = targetTypes.get(`${component.id}:${input.name}`)
      if (!payload || areSignalTypesCompatible(payload, input.type)) return input
      changed = true
      return { ...input, type: payload }
    })
    return inputs.some((input, index) => input !== component.inputs[index]) ? { ...component, inputs } : component
  })
  return changed ? { ...plan, components } : plan
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
  const normalizedPlan = normalizePlanSignalTypes(normalizePlanEventOutputs(plan))
  if (!ATOMIC_WIDGET.test(requirement) || normalizedPlan.components.length <= 1 || normalizedPlan.components.length > 3) return normalizedPlan
  const identity = atomicName(requirement)
  const mergedIds = new Set(normalizedPlan.components.map((component) => component.id))
  const merged: ComponentContract = {
    ...identity,
    slot: normalizedPlan.components[0]?.slot ?? 'page-main',
    width: normalizedPlan.components.some((component) => component.width === 'fluid') ? 'fluid' : 'fixed',
    inputs: uniqueByName(normalizedPlan.components.flatMap((component) => component.inputs)),
    outputs: uniqueByName(normalizedPlan.components.flatMap((component) => component.outputs)),
    dependencies: [...new Set(normalizedPlan.components.flatMap((component) => component.dependencies))],
    designTokens: [...new Set(normalizedPlan.components.flatMap((component) => component.designTokens))],
  }
  return {
    ...normalizedPlan,
    components: [merged],
    pages: normalizedPlan.pages.map((page) => {
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
