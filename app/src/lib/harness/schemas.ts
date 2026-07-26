import { z } from 'zod'
import type { BuilderAgentPersona, CandidateArtifact, CandidateVariant, PagePlan, ReviewResult } from './types.ts'

const slug = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/)
const visualDNA = z.object({
  concept: z.string(),
  mood: z.array(z.string()),
  colors: z.record(z.string(), z.string()),
  typography: z.record(z.string(), z.unknown()),
  geometry: z.object({ radius: z.string(), border: z.string(), density: z.string() }),
  motion: z.object({ personality: z.string(), duration: z.string(), easing: z.string() }),
  compositionRules: z.array(z.string()),
})

const planSchema = z.object({
  project: z.object({ name: z.string().min(1), description: z.string() }),
  pages: z.array(z.object({ id: slug, name: z.string(), route: z.string(), slots: z.array(slug) })).min(1),
  visualDirections: z.array(z.object({ id: slug, name: z.string(), description: z.string(), visualDNA })).max(3).default([]),
  components: z.array(z.object({
    id: slug,
    role: z.string(),
    slot: z.string(),
    width: z.enum(['fixed', 'fluid']),
    inputs: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean(), description: z.string().optional() })),
    outputs: z.array(z.object({ name: z.string(), payload: z.string(), description: z.string().optional() })),
    dependencies: z.array(z.string()),
    designTokens: z.array(z.string()),
  })).min(1).max(4),
})

const candidateSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string().min(1) })).min(1).max(8),
  entryFile: z.string(),
  previewProps: z.record(z.string(), z.unknown()).default({}),
  notes: z.array(z.string()).default([]),
})

const reviewSchema = z.object({
  summary: z.string(),
  patches: z.array(z.object({
    type: z.enum(['token', 'props', 'css', 'regenerate']),
    target: z.string(),
    reason: z.string(),
    value: z.unknown(),
  })),
})

const ALLOWED_DEPENDENCIES = new Set(['react', 'react-dom', 'lucide-react', 'motion'])

function assertSafePath(path: string) {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new Error(`不安全的生成文件路径：${path}`)
  if (!/\.(tsx?|jsx?|css|json)$/.test(path)) throw new Error(`不支持的生成文件类型：${path}`)
}

export function parsePlan(value: unknown): PagePlan {
  const plan = planSchema.parse(value)
  for (const component of plan.components) {
    const forbidden = component.dependencies.filter((dependency) => !ALLOWED_DEPENDENCIES.has(dependency))
    if (forbidden.length) throw new Error(`组件 ${component.id} 使用了未授权依赖：${forbidden.join(', ')}`)
  }
  return plan
}

export function parseCandidate(value: unknown, input: {
  id: string
  componentId: string
  variant: CandidateVariant
  agent?: BuilderAgentPersona
  /** Staleness token minted by the session; never accepted from model output. */
  attemptId?: string
}): CandidateArtifact {
  const candidate = candidateSchema.parse(value)
  candidate.files.forEach((file) => assertSafePath(file.path))
  if (!candidate.files.some((file) => file.path === candidate.entryFile)) throw new Error('entryFile 不在生成文件列表中')
  // Only the four payload fields the schema declares are copied out, and the
  // caller-owned identity is applied *after* them. A model that echoes back
  // `id`, `componentId`, `variant`, `agent` or `attemptId` therefore cannot
  // claim another candidate's slot or forge a fresh attempt token, even if the
  // schema were ever loosened to passthrough.
  const { files, entryFile, previewProps, notes } = candidate
  return {
    files,
    entryFile,
    previewProps,
    notes,
    ...input,
    runtimeStatus: 'source_ready',
    compileErrors: [],
    fixAttempts: 0,
  }
}

export function parseReview(value: unknown): ReviewResult {
  return reviewSchema.parse(value)
}
