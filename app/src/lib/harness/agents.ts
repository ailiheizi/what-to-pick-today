import type { BuilderAgentPersona, CandidateVariant } from './types.ts'

/**
 * These are separate builder roles rather than three temperature samples from
 * one generic prompt. Each owns a different design decision boundary so their
 * outputs should remain meaningfully comparable.
 */
export const BUILDER_AGENTS: Record<CandidateVariant, BuilderAgentPersona> = {
  expressive: {
    id: 'motion',
    name: 'Motion Agent',
    role: '动效与情绪反馈',
    mission: '用有意义的空间层次、状态过渡和即时反馈做出第一眼生动、操作仍清楚的主推方案。',
  },
  conservative: {
    id: 'product',
    name: 'Product Agent',
    role: '产品结构与可用性',
    mission: '从信息架构、操作效率、可访问性和上线完成度出发，做出成熟可靠的产品方案。',
  },
  experimental: {
    id: 'explorer',
    name: 'Explorer Agent',
    role: '探索式构图与交互',
    mission: '探索明显不同的构图和交互隐喻，挑战常规卡片布局，但必须保持完整可用。',
  },
}

export function builderAgentFor(variant: CandidateVariant) {
  return BUILDER_AGENTS[variant]
}
