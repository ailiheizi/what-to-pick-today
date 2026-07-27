import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IMAGE_CAPABLE_ROLES,
  LEGACY_ROLE_ROUTING,
  MODEL_ROLES,
  ROLE_LABELS,
  isModelRole,
  legacyModelRouting,
  modelsInRouting,
  normalizeModelRole,
  resolveAndValidateModelRouting,
  resolveModelRouting,
  routeForRole,
  validateModelRouting,
} from '../src/lib/harness/model-routing.ts'

// The two-field settings shape the harness ships today.
const legacySettings = { model: 'reasoning-model', codeModel: 'code-model', temperature: 0.7 }

/**
 * Today's behaviour, read directly out of `src/lib/harness/session.ts`.
 * `planner` and `reviewer` pass no `model` option, so `BrowserKimiClient`
 * falls back to `settings.model` (kimi.ts L100).
 */
const TODAY = {
  planner: { field: 'model', maxTokens: 3000 }, // session.ts L124-L126
  draft: { field: 'model', maxTokens: 900 }, // session.ts L315-L316
  builder: { field: 'codeModel', maxTokens: 6000 }, // session.ts L330-L331
  fixer: { field: 'codeModel', maxTokens: 6000 }, // session.ts L429-L430
  reviewer: { field: 'model', maxTokens: 2500 }, // session.ts L543-L548
}

const issueCodes = (result) => result.issues.map((issue) => issue.code)

const shape = (result) => {
  assert.equal(typeof result.valid, 'boolean')
  assert.ok(Array.isArray(result.issues))
  for (const issue of result.issues) {
    assert.equal(typeof issue.code, 'string')
    assert.ok(['error', 'warning'].includes(issue.severity))
    assert.equal(typeof issue.message, 'string')
    assert.ok(issue.message.length > 0)
    // Validation copy is user-facing Chinese in this codebase.
    assert.match(issue.message, /[一-龥]/)
    if (issue.role !== undefined) assert.ok(MODEL_ROLES.includes(issue.role))
  }
  return result
}

test('the five roles are exactly the roles session.ts drives', () => {
  assert.deepEqual([...MODEL_ROLES], ['planner', 'draft', 'builder', 'fixer', 'reviewer'])
  for (const role of MODEL_ROLES) {
    assert.equal(typeof ROLE_LABELS[role], 'string')
    assert.ok(isModelRole(role))
  }
  assert.deepEqual(LEGACY_ROLE_ROUTING, TODAY)
})

test('backward compatible: two legacy fields reproduce today per-role model and budget', () => {
  const routing = resolveModelRouting(legacySettings)

  // Asserted per role against what session.ts actually sends today.
  assert.deepEqual(routing.planner, { model: 'reasoning-model', maxTokens: 3000 })
  assert.deepEqual(routing.draft, { model: 'reasoning-model', maxTokens: 900 })
  assert.deepEqual(routing.builder, { model: 'code-model', maxTokens: 6000 })
  assert.deepEqual(routing.fixer, { model: 'code-model', maxTokens: 6000 })
  assert.deepEqual(routing.reviewer, { model: 'reasoning-model', maxTokens: 2500 })

  // Same claim, expressed as the field mapping rather than literals.
  for (const role of MODEL_ROLES) {
    assert.equal(routing[role].model, legacySettings[TODAY[role].field], `role ${role} model`)
    assert.equal(routing[role].maxTokens, TODAY[role].maxTokens, `role ${role} maxTokens`)
  }
  assert.deepEqual(routing, legacyModelRouting('reasoning-model', 'code-model'))
  assert.deepEqual(modelsInRouting(routing), ['reasoning-model', 'code-model'])
})

test('backward compatible: today three roles share the reasoning model and two share the code model', () => {
  const routing = resolveModelRouting(legacySettings)
  const byModel = {}
  for (const role of MODEL_ROLES) (byModel[routing[role].model] ??= []).push(role)

  assert.deepEqual(byModel['reasoning-model'], ['planner', 'draft', 'reviewer'])
  assert.deepEqual(byModel['code-model'], ['builder', 'fixer'])
})

test('revision is an alias of fixer, not a sixth role', () => {
  assert.equal(normalizeModelRole('revision'), 'fixer')
  assert.equal(isModelRole('revision'), false)
  assert.ok(!MODEL_ROLES.includes('revision'))

  const routing = resolveModelRouting(legacySettings)
  // session.ts L505-L509 (revision) issues the same request as L429-L430 (fixer).
  assert.deepEqual(routeForRole(routing, 'revision'), routing.fixer)
  assert.deepEqual(routeForRole(routing, 'revision'), { model: 'code-model', maxTokens: 6000 })
})

test('role names are normalized case- and whitespace-insensitively; unknown names are rejected', () => {
  assert.equal(normalizeModelRole(' Builder '), 'builder')
  assert.equal(normalizeModelRole('REVISION'), 'fixer')
  assert.equal(normalizeModelRole('summarizer'), null)
  assert.equal(normalizeModelRole(42), null)
  assert.equal(normalizeModelRole(null), null)
  assert.equal(routeForRole(resolveModelRouting(legacySettings), 'summarizer'), null)
})

test('explicit per-role overrides win over the legacy fields', () => {
  const routing = resolveModelRouting({
    ...legacySettings,
    roles: {
      draft: { model: 'cheap-fast', maxTokens: 400 },
      builder: { model: 'strong-coder' },
      reviewer: { maxTokens: 4000 },
    },
  })

  assert.deepEqual(routing.draft, { model: 'cheap-fast', maxTokens: 400 })
  // A model-only override keeps today's budget.
  assert.deepEqual(routing.builder, { model: 'strong-coder', maxTokens: 6000 })
  // A budget-only override keeps today's model.
  assert.deepEqual(routing.reviewer, { model: 'reasoning-model', maxTokens: 4000 })
  // Untouched roles are unchanged.
  assert.deepEqual(routing.planner, { model: 'reasoning-model', maxTokens: 3000 })
  assert.deepEqual(routing.fixer, { model: 'code-model', maxTokens: 6000 })
})

test('the overrides argument beats settings.roles, which beats the legacy fields', () => {
  const routing = resolveModelRouting(
    { ...legacySettings, roles: { builder: { model: 'from-settings', maxTokens: 5000 } } },
    { builder: { model: 'from-argument' } },
  )

  assert.equal(routing.builder.model, 'from-argument')
  assert.equal(routing.builder.maxTokens, 5000)
})

test('unusable override values fall back instead of corrupting the table', () => {
  const routing = resolveModelRouting({
    ...legacySettings,
    roles: {
      draft: { model: '', maxTokens: 0 },
      builder: { model: 42, maxTokens: -100 },
      fixer: { model: null, maxTokens: 1.5 },
      reviewer: { maxTokens: Number.NaN },
      planner: 'not-an-object',
    },
  })

  assert.deepEqual(routing, resolveModelRouting(legacySettings))
})

test('a resolved legacy table validates clean', () => {
  const result = shape(validateModelRouting(resolveModelRouting(legacySettings)))

  assert.equal(result.valid, true)
  assert.deepEqual(result.issues, [])
})

test('validation catches an empty model id per role', () => {
  const routing = resolveModelRouting({ model: 'reasoning-model', codeModel: '' })
  const result = shape(validateModelRouting(routing))

  assert.equal(result.valid, false)
  const empty = result.issues.filter((issue) => issue.code === 'empty_model')
  assert.deepEqual(empty.map((issue) => issue.role), ['builder', 'fixer'])
  for (const issue of empty) assert.equal(issue.severity, 'error')

  // Whitespace-only is empty too.
  assert.equal(validateModelRouting(resolveModelRouting({ model: '   ', codeModel: 'code' })).valid, false)
})

test('validation catches a missing role', () => {
  const routing = resolveModelRouting(legacySettings)
  delete routing.reviewer
  const result = shape(validateModelRouting(routing))

  assert.equal(result.valid, false)
  const missing = result.issues.filter((issue) => issue.code === 'missing_role')
  assert.equal(missing.length, 1)
  assert.equal(missing[0].role, 'reviewer')
  assert.ok(missing[0].message.includes(ROLE_LABELS.reviewer))
})

test('validation reports every broken role, not just the first', () => {
  const result = shape(validateModelRouting({
    planner: { model: '', maxTokens: 3000 },
    draft: { model: 'draft-model', maxTokens: 0 },
    // A null route is an absent role, not a malformed one.
    builder: null,
    fixer: 'code-model',
    // reviewer missing entirely
  }))

  assert.equal(result.valid, false)
  assert.deepEqual(result.issues.map((issue) => [issue.role, issue.code]), [
    ['planner', 'empty_model'],
    ['draft', 'invalid_max_tokens'],
    ['builder', 'missing_role'],
    ['fixer', 'invalid_route'],
    ['reviewer', 'missing_role'],
  ])
})

test('an unknown or alias key is a warning, not a failure', () => {
  const routing = { ...resolveModelRouting(legacySettings), revision: { model: 'x', maxTokens: 10 }, zzz: {} }
  const result = shape(validateModelRouting(routing))

  assert.equal(result.valid, true)
  assert.deepEqual(issueCodes(result), ['unknown_role', 'unknown_role'])
  assert.ok(result.issues[0].message.includes('revision'))
  assert.ok(result.issues[0].message.includes(ROLE_LABELS.fixer))
  assert.ok(result.issues[1].message.includes('zzz'))
})

test('capabilities gate streaming, context budget and reviewer images', () => {
  const capabilities = (modelId) => {
    if (modelId === 'reasoning-model') {
      return { maxContextTokens: 2000, supportsStreaming: true, acceptsImages: false }
    }
    if (modelId === 'code-model') {
      return { maxContextTokens: 128000, supportsStreaming: false, acceptsImages: false }
    }
    return null
  }
  const result = shape(validateModelRouting(resolveModelRouting(legacySettings), { capabilities }))

  assert.equal(result.valid, false)
  // planner (3000) and reviewer (2500) exceed the 2000-token window; draft (900) does not.
  const overflow = result.issues.filter((issue) => issue.code === 'exceeds_context')
  assert.deepEqual(overflow.map((issue) => issue.role), ['planner', 'reviewer'])
  const noStream = result.issues.filter((issue) => issue.code === 'streaming_unsupported')
  assert.deepEqual(noStream.map((issue) => issue.role), ['builder', 'fixer'])
  // Only the reviewer prompt attaches an image part (prompts.ts L199-L201).
  const noImages = result.issues.filter((issue) => issue.code === 'images_unsupported')
  assert.deepEqual(noImages.map((issue) => issue.role), [...IMAGE_CAPABLE_ROLES])
  assert.equal(noImages[0].severity, 'warning')
})

test('an unknown or throwing capability probe leaves the table unverified', () => {
  const routing = resolveModelRouting(legacySettings)

  assert.equal(validateModelRouting(routing, { capabilities: () => null }).valid, true)
  assert.equal(validateModelRouting(routing, { capabilities: () => undefined }).valid, true)
  assert.equal(validateModelRouting(routing, { capabilities: () => 'nonsense' }).valid, true)
  assert.equal(validateModelRouting(routing, { capabilities: () => { throw new Error('boom') } }).valid, true)
  assert.equal(validateModelRouting(routing, { capabilities: 'not-a-function' }).valid, true)
})

test('malformed input never throws and always yields a complete table', () => {
  const inputs = [
    undefined, null, '', 'kimi-k2', 0, Number.NaN, true, [], [1, 2, 3], () => {},
    {}, { model: null, codeModel: [] }, { roles: 'nope' }, { roles: [] },
    new Proxy({}, { get() { throw new Error('hostile getter') } }),
    Object.create(null),
  ]

  for (const [index, input] of inputs.entries()) {
    const routing = resolveModelRouting(input)
    assert.deepEqual(Object.keys(routing).sort(), [...MODEL_ROLES].sort(), `keys for input #${index}`)
    for (const role of MODEL_ROLES) {
      assert.equal(typeof routing[role].model, 'string')
      assert.equal(routing[role].maxTokens, TODAY[role].maxTokens)
    }
    // No credentials configured yet is the normal first-run state: invalid, not a crash.
    shape(validateModelRouting(routing))
    assert.equal(routeForRole(input, 'builder'), null)
    assert.deepEqual(modelsInRouting(input), [])
  }
})

test('malformed input never throws in validation either', () => {
  for (const input of [undefined, null, '', 42, [], () => {}, new Proxy({}, { get() { throw new Error('x') } })]) {
    const result = shape(validateModelRouting(input))
    assert.equal(result.valid, false)
  }
  assert.deepEqual(issueCodes(validateModelRouting(null)), ['not_an_object'])
})

test('resolveAndValidateModelRouting returns the table alongside the reasons', () => {
  const ok = shape(resolveAndValidateModelRouting(legacySettings))
  assert.equal(ok.valid, true)
  assert.deepEqual(ok.routing, resolveModelRouting(legacySettings))

  const broken = shape(resolveAndValidateModelRouting({ model: 'reasoning', codeModel: '' }))
  assert.equal(broken.valid, false)
  // The table is still returned so the UI can show what was resolved.
  assert.equal(broken.routing.planner.model, 'reasoning')
  assert.equal(broken.routing.builder.model, '')

  const overridden = shape(resolveAndValidateModelRouting(legacySettings, {
    overrides: { draft: { model: 'cheap-fast' } },
  }))
  assert.equal(overridden.routing.draft.model, 'cheap-fast')
})

test('resolution is deterministic and does not mutate its inputs', () => {
  const settings = { model: 'a', codeModel: 'b', roles: { draft: { model: 'c' } } }
  const snapshot = JSON.stringify(settings)
  const first = resolveModelRouting(settings)
  const second = resolveModelRouting(settings)

  assert.deepEqual(first, second)
  assert.notEqual(first, second)
  assert.equal(JSON.stringify(settings), snapshot)
})
