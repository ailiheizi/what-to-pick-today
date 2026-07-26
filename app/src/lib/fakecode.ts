// 为"代码流式生成"演出构造的伪源码 —— 真实 Harness 中这里会是模型 API 的真实 token 流。
import type { CandidateDef, SlotDef } from '../candidates/types'

export function fakeSource(slot: SlotDef, cand: CandidateDef): string {
  const comp = cand.label.split('·')[1]?.trim() ?? cand.id
  const name = comp.replace(/[^a-zA-Z一-龥]/g, '') || 'Component'
  const props = slot.inputs.map((i) => i.split(':')[0].trim()).join(', ')
  const deps = slot.dependencies.length ? slot.dependencies.join("', '") : ''
  const lines = [
    `// file: candidates/${slot.id}/${cand.id}.tsx`,
    `// contract: ${slot.role} · ${cand.style} · width=${slot.width}`,
    deps ? `import { ${slot.dependencies.map((d) => d.replace('-react', '')).join(', ')} } from '${deps}'` : `import type { FC } from 'react'`,
    ``,
    `type Props = {`,
    ...slot.inputs.map((i) => `  ${i.replace(':', '?:')}`),
    `}`,
    ``,
    `/** Visual DNA bindings: ${['--dna-surface', '--dna-accent', '--dna-radius'].join(' ')} */`,
    `export const ${name}${cand.style === 'experimental' ? 'X' : ''}: FC<Props> = ({ ${props} }) => {`,
    `  return (`,
    `    <section className="slot-${slot.id} dna-surface dna-radius">`,
    `      {/* ${cand.blurb} */}`,
    `      <div className="dna-text">…</div>`,
    `    </section>`,
    `  )`,
    `}`,
    ``,
    ...slot.outputs.map((o) => `// emits: ${o}`),
    `// ✓ contract check passed · sandbox ready`,
  ]
  return lines.join('\n')
}
