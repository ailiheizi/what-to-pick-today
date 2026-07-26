export type VisualDNA = {
  concept: string
  mood: string[]
  colors: Record<string, string>
  typography: Record<string, unknown>
  geometry: {
    radius: string
    border: string
    density: string
  }
  motion: {
    personality: string
    duration: string
    easing: string
  }
  compositionRules: string[]
}

export type PropDefinition = {
  name: string
  type: string
  required: boolean
  description?: string
}

export type EventDefinition = {
  name: string
  payload: string
  description?: string
}

export type ComponentContract = {
  id: string
  role: string
  slot: string
  width: 'fixed' | 'fluid'
  inputs: PropDefinition[]
  outputs: EventDefinition[]
  dependencies: string[]
  designTokens: string[]
}

export type VisualDirection = {
  id: string
  name: string
  description: string
  visualDNA: VisualDNA
}

export type PagePlan = {
  project: {
    name: string
    description: string
  }
  pages: Array<{
    id: string
    name: string
    route: string
    slots: string[]
  }>
  visualDirections: VisualDirection[]
  components: ComponentContract[]
}

export type CandidateVariant = 'conservative' | 'expressive' | 'experimental'

export type BuilderAgentPersona = {
  id: 'motion' | 'product' | 'explorer'
  name: string
  role: string
  mission: string
}

export type GeneratedFile = {
  path: string
  content: string
}

export type CandidateArtifact = {
  id: string
  componentId: string
  variant: CandidateVariant
  /**
   * Identity of the build attempt that produced this artifact. A fresh id is
   * minted every time `#candidates` is about to be replaced (build, repair,
   * revision) so async work that started against an earlier artifact can detect
   * that it has been superseded. Optional: restored v1 snapshots have none, and
   * an absent id means "attempt identity unknown", never "stale".
   */
  attemptId?: string
  /** Present on newly generated candidates; optional for restored v1 snapshots. */
  agent?: BuilderAgentPersona
  files: GeneratedFile[]
  entryFile: string
  previewProps: Record<string, unknown>
  notes: string[]
  runtimeStatus: 'source_ready' | 'compiling' | 'rendered' | 'compile_failed'
  compileErrors: string[]
  fixAttempts: number
}

export type SelectionPatch = {
  slot: string
  previousCandidateId?: string
  selectedCandidateId: string
  timestamp: number
}

export type ReviewPatch = {
  type: 'token' | 'props' | 'css' | 'regenerate'
  target: string
  reason: string
  value: unknown
}

export type ReviewResult = {
  summary: string
  patches: ReviewPatch[]
}

export type GenerationEvent =
  | { type: 'plan.started' }
  | { type: 'plan.activity'; receivedChars: number }
  | { type: 'plan.completed'; plan: PagePlan }
  | { type: 'direction.selected'; direction: VisualDirection }
  | { type: 'component.queued'; componentId: string; candidateId: string; variant: CandidateVariant; agent: BuilderAgentPersona }
  | { type: 'component.started'; componentId: string; candidateId: string }
  | { type: 'component.activity'; componentId: string; candidateId: string; receivedChars: number }
  | { type: 'preview.updated'; componentId: string; candidateId: string; html: string; complete: boolean }
  | { type: 'file.created'; candidateId: string; path: string }
  | { type: 'code.delta'; candidateId: string; path: string; delta: string }
  | { type: 'source.ready'; candidate: CandidateArtifact }
  | { type: 'compile.started'; candidateId: string }
  | { type: 'compile.succeeded'; candidateId: string }
  | { type: 'compile.failed'; candidateId: string; errors: string[] }
  | { type: 'repair.started'; candidateId: string; attempt: number }
  | { type: 'repair.completed'; candidate: CandidateArtifact }
  | { type: 'repair.exhausted'; candidateId: string; errors: string[] }
  | { type: 'render.ready'; candidateId: string }
  | { type: 'selection.committed'; patch: SelectionPatch }
  | { type: 'selection.reverted'; componentId: string; candidateId?: string }
  | { type: 'revision.started'; instruction: string; componentIds: string[] }
  | { type: 'revision.completed'; candidate: CandidateArtifact }
  | { type: 'revision.failed'; candidateId: string; error: string }
  | { type: 'review.started' }
  | { type: 'review.completed'; review: ReviewResult }
  | { type: 'task.retrying'; taskId: string; attempt: number; error: string }
  | { type: 'task.failed'; taskId: string; error: string }
  | { type: 'generation.completed'; ready: number; expected: number }
  | { type: 'generation.cancelled' }

export type MotionPhase = 'planning' | 'generating' | 'compiling' | 'ready' | 'selected' | 'reviewing'

export type EventEnvelope = {
  sessionId: string
  sequence: number
  timestamp: number
  motionCue: string
  event: GenerationEvent
}

export type HarnessPhase =
  | 'idle'
  | 'planning'
  | 'awaiting_direction'
  | 'generating'
  | 'selecting'
  | 'reviewing'
  | 'complete'
  | 'failed'
  | 'cancelled'

export type HarnessSnapshot = {
  version: 1
  sessionId: string
  requirement: string
  phase: HarnessPhase
  createdAt: number
  updatedAt: number
  plan: PagePlan | null
  direction: VisualDirection | null
  candidates: CandidateArtifact[]
  selections: Record<string, string>
  review: ReviewResult | null
  events: EventEnvelope[]
}

export type CompileResult = {
  ok: boolean
  errors?: string[]
}

export type RuntimeAdapter = {
  compile(candidate: CandidateArtifact, signal: AbortSignal): Promise<CompileResult>
}

export type KimiSettings = {
  apiKey: string
  baseUrl: string
  /** Planner 与 Reviewer 使用的结构化推理模型。 */
  model: string
  /** Builder、Fixer 与 Revision 使用的组件代码模型。 */
  codeModel: string
  temperature: number
}

export type HarnessOptions = {
  kimi: KimiSettings
  fetchImpl?: typeof fetch
  concurrency?: number
  retries?: number
  maxFixAttempts?: number
  /** 每批为每个组件生成的新增候选数；首屏推荐 1，后续按需补齐。 */
  candidateCount?: 1 | 2 | 3
  runtime?: RuntimeAdapter
  persist?: boolean
}
