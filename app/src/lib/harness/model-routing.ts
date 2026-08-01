/**
 * Provider-neutral model routing.
 *
 * The harness runs five distinct model roles, but the settings shape only ever
 * exposed two model fields (`model`, `codeModel`), so a user cannot put a cheap
 * fast model on drafts and a strong one on builds. This module names the roles,
 * describes what the harness needs from *any* OpenAI-compatible provider, and
 * resolves the two-field settings into a complete per-role routing table.
 *
 * Today's behaviour, read out of `session.ts`, is the fallback contract:
 *
 * | role     | model field | maxTokens | session.ts                    |
 * | -------- | ----------- | --------- | ----------------------------- |
 * | planner  | `model`     | 6000      | Large plans may contain many independent slots |
 * | draft    | `model`     | 900       | L315-L316                     |
 * | builder  | `codeModel` | 6000      | L330-L331                     |
 * | fixer    | `codeModel` | 6000      | L429-L430                     |
 * | reviewer | `model`     | 2500      | L543-L548 (no `model` option) |
 *
 * `planner` and `reviewer` pass no `model` to `BrowserKimiClient.completeJson`,
 * which falls back to `settings.model` (kimi.ts L100) — that is why they route
 * to the reasoning model rather than the code model.
 *
 * Revision is deliberately *not* a sixth role. `#reviseCandidate` (session.ts
 * L505-L509) issues the exact same request shape as `#repair` (L427-L431) —
 * same `codeModel`, same 6000-token budget — and both rewrite one candidate's
 * complete file set under `#assertSameFileBoundary`. They differ in the prompt,
 * not in the model requirement. A separate budget would be a knob with no
 * distinct meaning, so `'revision'` is accepted as an alias that normalizes onto
 * `fixer` (see `normalizeModelRole`).
 *
 * The module is standalone by design: no harness imports, no DOM, no network,
 * no clock, no randomness. Every exported function is pure, total and
 * deterministic — no input, however malformed, can make one throw.
 */

export const MODEL_ROLES = ['planner', 'draft', 'builder', 'fixer', 'reviewer'] as const

export type ModelRole = (typeof MODEL_ROLES)[number]

/**
 * Role names accepted for input but folded onto a canonical role. Kept separate
 * from `ModelRole` so a routing table can never grow a budget nobody reads.
 */
export type ModelRoleAlias = 'revision'

/** Which legacy `KimiSettings` field a role falls back to. */
export type LegacyModelField = 'model' | 'codeModel'

/** A resolved role assignment: which model answers, and with what budget. */
export type ModelRoute = {
  /** Provider model id, exactly as it will be sent on the wire. */
  model: string
  /** Upper bound on generated tokens for this role. Positive integer. */
  maxTokens: number
}

/** Complete routing table. Every role is present; that is the type's job. */
export type ModelRoutingTable = Record<ModelRole, ModelRoute>

/** Per-role user override. Absent fields fall back to the legacy behaviour. */
export type ModelRouteOverride = Partial<ModelRoute>

export type ModelRoutingOverrides = Partial<Record<ModelRole, ModelRouteOverride>>

/**
 * Input shape of the resolver. `KimiSettings` is structurally assignable to it,
 * so this stays decoupled from the harness type module; `roles` is the forward
 * slot for per-role selection in settings.
 */
export type ModelRoutingSettings = {
  model?: string
  codeModel?: string
  roles?: ModelRoutingOverrides
}

/** Chinese role labels, for validation copy that is safe to render directly. */
export const ROLE_LABELS: Record<ModelRole, string> = {
  planner: '规划 Planner',
  draft: '草图 Draft',
  builder: '构建 Builder',
  fixer: '修复 Fixer（含 Revision）',
  reviewer: '评审 Reviewer',
}

/**
 * The fallback contract: role → legacy settings field + token budget, verified
 * against `session.ts` (see the table in the module doc comment).
 */
export const LEGACY_ROLE_ROUTING: Record<ModelRole, { field: LegacyModelField; maxTokens: number }> = {
  planner: { field: 'model', maxTokens: 6000 },
  draft: { field: 'model', maxTokens: 900 },
  builder: { field: 'codeModel', maxTokens: 6000 },
  fixer: { field: 'codeModel', maxTokens: 6000 },
  reviewer: { field: 'model', maxTokens: 2500 },
}

/**
 * Roles whose prompt can carry an image part. Only `reviewerMessages` does —
 * it appends an `image_url` content part when a screenshot is supplied
 * (prompts.ts L199-L201). Everything else sends plain text.
 */
export const IMAGE_CAPABLE_ROLES: readonly ModelRole[] = ['reviewer']

/* ------------------------------------------------------------------------ *
 * Provider adapter surface
 * ------------------------------------------------------------------------ */

export type ModelMessageRole = 'system' | 'user' | 'assistant'

/**
 * Message content. A plain string, or OpenAI-style content parts (that is how
 * the reviewer screenshot travels). Parts stay loosely typed on purpose:
 * providers disagree about part shapes and the harness only ever constructs
 * `text` and `image_url`.
 */
export type ModelMessageContent = string | ReadonlyArray<Record<string, unknown>>

export type ModelMessage = {
  role: ModelMessageRole
  content: ModelMessageContent
}

/**
 * What the harness needs to know about a model before routing work to it.
 *
 * `maxContextTokens` and `supportsStreaming` are hard requirements: the client
 * only speaks SSE, and a budget larger than the window is a guaranteed failure.
 * `acceptsImages` gates the reviewer screenshot.
 */
export type ModelCapabilities = {
  /** Total context window in tokens (prompt + completion). */
  maxContextTokens: number
  /** Per-response completion cap, when the provider publishes one separately. */
  maxOutputTokens?: number
  /** Whether the model can be called with `stream: true`. */
  supportsStreaming: boolean
  /** Whether the model accepts image content parts (reviewer screenshots). */
  acceptsImages: boolean
  /** Whether a custom `temperature` is honoured; some reasoning models pin it. */
  supportsTemperature?: boolean
  /** Whether the provider can hard-guarantee JSON output for this model. */
  supportsJsonOutput?: boolean
}

export type ModelDescriptor = {
  id: string
  label?: string
  capabilities: ModelCapabilities
}

export type ModelStreamRequest = {
  /** Concrete provider model id, already resolved from a role. */
  model: string
  messages: readonly ModelMessage[]
  signal: AbortSignal
  maxTokens?: number
  temperature?: number
  /** Invoked for every content delta, in arrival order. */
  onDelta?: (delta: string) => void
}

export type ModelStreamResult = {
  /** Full concatenated assistant text. */
  text: string
  /** Model that actually served the request; providers may alias or upgrade. */
  model: string
  finishReason?: 'stop' | 'length' | 'aborted' | 'content_filter' | 'unknown'
  usage?: { promptTokens?: number; completionTokens?: number }
}

/**
 * Everything the harness requires from a provider. Deliberately narrow: one
 * streaming chat call, one capability lookup, and an optional catalogue.
 *
 * Implementations live elsewhere — this module never talks to a network.
 */
export interface ModelProviderAdapter {
  /** Stable provider id, e.g. `openai-compatible`, `local-proxy`. */
  readonly id: string
  /** Human-facing provider name. */
  readonly label?: string
  /**
   * Capabilities of one model. `null` means "unknown to this provider" — a
   * caller must treat that as unverified, not as unsupported.
   */
  capabilitiesOf(modelId: string): ModelCapabilities | null
  /** Optional: providers without a catalogue endpoint simply omit this. */
  listModels?(options?: { signal?: AbortSignal }): Promise<readonly ModelDescriptor[]>
  /** Streaming chat completion. Rejects on abort, transport and API errors. */
  streamChat(request: ModelStreamRequest): Promise<ModelStreamResult>
}

/** Capability lookup used during validation; may be a partial catalogue. */
export type CapabilityLookup = (modelId: string) => ModelCapabilities | null | undefined

/* ------------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Property reads are guarded: callers may hand over hostile getters. */
function read(value: unknown, key: string): unknown {
  const record = asRecord(value)
  if (!record) return undefined
  try {
    return record[key]
  } catch {
    return undefined
  }
}

function asModelId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asBudget(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
    ? value
    : null
}

/**
 * Fold an alias onto a canonical role. Returns `null` for anything that is not
 * a role, so callers can reject unknown keys instead of guessing.
 */
export function normalizeModelRole(role: unknown): ModelRole | null {
  if (typeof role !== 'string') return null
  const trimmed = role.trim().toLowerCase()
  if ((MODEL_ROLES as readonly string[]).includes(trimmed)) return trimmed as ModelRole
  // Revision issues the same request as the fixer; see the module doc comment.
  if (trimmed === 'revision') return 'fixer'
  return null
}

/** Is `role` a canonical role (aliases excluded)? */
export function isModelRole(role: unknown): role is ModelRole {
  return typeof role === 'string' && (MODEL_ROLES as readonly string[]).includes(role)
}

/**
 * Resolve the two-field settings shape into a complete routing table.
 *
 * Precedence, highest first: the `overrides` argument, `settings.roles`, then
 * the legacy `model` / `codeModel` fields with today's token budgets. A model
 * id is passed through verbatim (no trimming) so the resolved table is exactly
 * what `session.ts` sends today; whitespace-only ids are caught by
 * `validateModelRouting`, which is where that judgement belongs.
 *
 * Total: any input — `null`, a string, a hostile object — yields a complete
 * table. Unusable values fall back rather than propagate.
 */
export function resolveModelRouting(
  settings: ModelRoutingSettings | unknown,
  overrides?: ModelRoutingOverrides,
): ModelRoutingTable {
  const reasoningModel = asModelId(read(settings, 'model')) ?? ''
  const codeModel = asModelId(read(settings, 'codeModel')) ?? ''
  const settingsRoles = read(settings, 'roles')

  const table = {} as ModelRoutingTable
  for (const role of MODEL_ROLES) {
    const legacy = LEGACY_ROLE_ROUTING[role]
    const fallbackModel = legacy.field === 'model' ? reasoningModel : codeModel
    const fromSettings = read(settingsRoles, role)
    const fromArgument = read(overrides, role)
    table[role] = {
      model:
        asModelId(read(fromArgument, 'model'))
        ?? asModelId(read(fromSettings, 'model'))
        ?? fallbackModel,
      maxTokens:
        asBudget(read(fromArgument, 'maxTokens'))
        ?? asBudget(read(fromSettings, 'maxTokens'))
        ?? legacy.maxTokens,
    }
  }
  return table
}

/** The routing every role falls back to when only the legacy fields are set. */
export function legacyModelRouting(model: string, codeModel: string): ModelRoutingTable {
  return resolveModelRouting({ model, codeModel })
}

/**
 * Look up one role, accepting aliases. Returns `null` for an unknown role or a
 * malformed table rather than throwing.
 */
export function routeForRole(table: unknown, role: ModelRole | ModelRoleAlias | string): ModelRoute | null {
  const canonical = normalizeModelRole(role)
  if (!canonical) return null
  const entry = read(table, canonical)
  const model = asModelId(read(entry, 'model'))
  const maxTokens = asBudget(read(entry, 'maxTokens'))
  if (model === null || maxTokens === null) return null
  return { model, maxTokens }
}

/** Distinct model ids in the table, in role order, deduplicated. */
export function modelsInRouting(table: unknown): string[] {
  const seen: string[] = []
  for (const role of MODEL_ROLES) {
    const model = asModelId(read(read(table, role), 'model'))
    if (model !== null && !seen.includes(model)) seen.push(model)
  }
  return seen
}

/* ------------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------------ */

export type ModelRoutingIssueCode =
  | 'not_an_object'
  | 'missing_role'
  | 'invalid_route'
  | 'empty_model'
  | 'invalid_max_tokens'
  | 'unknown_role'
  | 'streaming_unsupported'
  | 'exceeds_context'
  | 'images_unsupported'

export type ModelRoutingIssue = {
  code: ModelRoutingIssueCode
  /** `error` blocks the run; `warning` is worth showing but not fatal. */
  severity: 'error' | 'warning'
  /** Absent when the issue is about the table as a whole. */
  role?: ModelRole
  /** 中文用户可读文案，可直接渲染。 */
  message: string
}

export type ModelRoutingValidation = {
  valid: boolean
  issues: ModelRoutingIssue[]
}

export type ValidateModelRoutingOptions = {
  /**
   * Optional capability probe. A model the provider does not recognise
   * (`null` / `undefined`) is left unverified rather than rejected.
   */
  capabilities?: CapabilityLookup
}

function probe(lookup: CapabilityLookup | undefined, modelId: string): ModelCapabilities | null {
  if (typeof lookup !== 'function') return null
  try {
    const found = lookup(modelId)
    return asRecord(found) ? (found as ModelCapabilities) : null
  } catch {
    // A caller-supplied probe must not be able to break totality.
    return null
  }
}

/**
 * Validate a routing table. Never throws; issues come back in a stable order
 * (role order first, then unknown keys sorted) so the result is comparable
 * across runs.
 */
export function validateModelRouting(
  table: unknown,
  options: ValidateModelRoutingOptions = {},
): ModelRoutingValidation {
  const issues: ModelRoutingIssue[] = []
  const record = asRecord(table)
  if (!record) {
    return {
      valid: false,
      issues: [{ code: 'not_an_object', severity: 'error', message: '模型路由表必须是一个对象。' }],
    }
  }

  for (const role of MODEL_ROLES) {
    const label = ROLE_LABELS[role]
    const raw = read(record, role)
    if (raw === undefined || raw === null) {
      issues.push({
        code: 'missing_role',
        severity: 'error',
        role,
        message: `模型路由表缺少角色「${label}」，无法确定该阶段使用哪个模型。`,
      })
      continue
    }
    if (!asRecord(raw)) {
      issues.push({
        code: 'invalid_route',
        severity: 'error',
        role,
        message: `角色「${label}」的路由配置必须是包含 model 与 maxTokens 的对象。`,
      })
      continue
    }
    const model = asModelId(read(raw, 'model'))
    if (model === null) {
      issues.push({
        code: 'empty_model',
        severity: 'error',
        role,
        message: `角色「${label}」的模型 ID 为空，请先在设置中为该角色选择模型。`,
      })
    }
    const maxTokens = asBudget(read(raw, 'maxTokens'))
    if (maxTokens === null) {
      issues.push({
        code: 'invalid_max_tokens',
        severity: 'error',
        role,
        message: `角色「${label}」的 maxTokens 必须是大于 0 的整数。`,
      })
    }

    if (model === null) continue
    const capabilities = probe(options.capabilities, model)
    if (!capabilities) continue
    if (capabilities.supportsStreaming === false) {
      issues.push({
        code: 'streaming_unsupported',
        severity: 'error',
        role,
        message: `角色「${label}」使用的模型「${model}」不支持流式输出，而生成过程依赖流式增量渲染。`,
      })
    }
    const window = asBudget(capabilities.maxOutputTokens) ?? asBudget(capabilities.maxContextTokens)
    if (maxTokens !== null && window !== null && maxTokens > window) {
      issues.push({
        code: 'exceeds_context',
        severity: 'error',
        role,
        message: `角色「${label}」的 maxTokens（${maxTokens}）超出模型「${model}」的上限（${window}）。`,
      })
    }
    if (IMAGE_CAPABLE_ROLES.includes(role) && capabilities.acceptsImages === false) {
      issues.push({
        code: 'images_unsupported',
        severity: 'warning',
        role,
        message: `角色「${label}」使用的模型「${model}」不支持图片输入，带截图的评审请求会失败。`,
      })
    }
  }

  const unknownKeys = Object.keys(record)
    .filter((key) => !isModelRole(key))
    .sort()
  for (const key of unknownKeys) {
    const alias = normalizeModelRole(key)
    issues.push({
      code: 'unknown_role',
      severity: 'warning',
      message: alias
        ? `模型路由表包含别名角色「${key}」，它等同于「${ROLE_LABELS[alias]}」，该条目不会单独生效。`
        : `模型路由表包含未知角色「${key}」，该条目不会生效。`,
    })
  }

  return { valid: !issues.some((issue) => issue.severity === 'error'), issues }
}

/**
 * Resolve and validate in one step. The table is always returned, even when
 * invalid, so a caller can show exactly what was resolved alongside the reasons.
 */
export function resolveAndValidateModelRouting(
  settings: ModelRoutingSettings | unknown,
  options: ValidateModelRoutingOptions & { overrides?: ModelRoutingOverrides } = {},
): ModelRoutingValidation & { routing: ModelRoutingTable } {
  const routing = resolveModelRouting(settings, options.overrides)
  return { routing, ...validateModelRouting(routing, options) }
}
