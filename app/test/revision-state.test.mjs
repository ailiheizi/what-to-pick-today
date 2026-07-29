import assert from 'node:assert/strict'
import test from 'node:test'
import { createRepository } from '../src/lib/harness/revisions.ts'
import { HarnessSession } from '../src/lib/harness/session.ts'

const direction = (id) => ({ id, name: id, description: '', visualDNA: {
  concept: id, mood: [], colors: {}, typography: {}, geometry: { radius: '', border: '', density: '' },
  motion: { personality: '', duration: '', easing: '' }, compositionRules: [],
} })
const artifact = (source) => ({
  id: 'hero-a', componentId: 'hero', variant: 'expressive', files: [{ path: 'src/Hero.tsx', content: source }],
  entryFile: 'src/Hero.tsx', previewProps: {}, notes: [], runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
})

test('HarnessSession atomically restores exact source for a reused candidate id', async () => {
  const apple = direction('apple')
  const hacker = direction('hacker')
  const initial = artifact('hacker source')
  const repoResult = createRepository({ revisionId: 'r0', branchId: 'main', branchName: '主线', directionId: 'apple',
    selections: { hero: 'hero-a' }, artifacts: { 'hero-a': artifact('apple source') }, label: 'apple', ts: 1 })
  assert.equal(repoResult.ok, true)
  const session = new HarnessSession('Hero', {
    kimi: { apiKey: 'x', baseUrl: 'https://example.test/v1', model: 'x', codeModel: 'x', temperature: 0 }, persist: false,
  }, {
    version: 1, sessionId: 'revision-atomic', requirement: 'Hero', phase: 'selecting', createdAt: 1, updatedAt: 1,
    plan: { project: { name: 'Hero', description: '' }, pages: [], visualDirections: [apple, hacker], components: [
      { id: 'hero', role: 'Hero', slot: 'hero', width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [] },
    ] }, direction: hacker, candidates: [initial], selections: { hero: 'hero-a' }, review: null, events: [],
  })
  await session.restoreDesignState({ direction: apple, candidates: [artifact('apple source')], selections: { hero: 'hero-a' }, revisionRepo: repoResult.value })
  assert.equal(session.direction.id, 'apple')
  assert.equal(session.phase, 'complete')
  assert.equal(session.candidates[0].files[0].content, 'apple source')
  assert.equal(session.snapshot().revisionRepo.currentRevisionId, 'r0')
})
