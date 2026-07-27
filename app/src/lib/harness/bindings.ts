import type { ComponentContract } from './types.ts'

const GENERIC_SIGNAL_TOKENS = new Set([
  'on', 'change', 'changed', 'select', 'selected', 'value', 'data', 'id',
  'string', 'array', 'object', 'number', 'boolean',
])

export type SemanticBinding = {
  fromComponentId: string
  outputName: string
  targets: Array<{ componentId: string; inputName: string }>
}

export function signalName(value: string) {
  return value.split(/[:(]/, 1)[0].trim()
}

export function signalTokens(value: string) {
  return signalName(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((token) => token.length > 1 && !GENERIC_SIGNAL_TOKENS.has(token))
}

/** Infer only high-confidence output → input links; one output may fan out. */
export function inferSemanticBindings(components: ComponentContract[]): SemanticBinding[] {
  const bindings: SemanticBinding[] = []
  for (const from of components) {
    for (const output of from.outputs) {
      const outputTokens = signalTokens(output.name)
      if (!outputTokens.length) continue
      const scored = components.flatMap((to) => {
        if (to.id === from.id) return []
        return to.inputs.map((input) => ({
          componentId: to.id,
          inputName: input.name,
          score: outputTokens.filter((token) => signalTokens(input.name).includes(token)).length,
        })).filter((match) => match.score > 0)
      })
      if (!scored.length) continue
      const bestPerComponent = new Map<string, (typeof scored)[number]>()
      for (const match of scored.sort((a, b) => b.score - a.score)) {
        if (!bestPerComponent.has(match.componentId)) bestPerComponent.set(match.componentId, match)
      }
      bindings.push({
        fromComponentId: from.id,
        outputName: output.name,
        targets: [...bestPerComponent.values()].map(({ componentId, inputName }) => ({ componentId, inputName })),
      })
    }
  }
  return bindings
}
