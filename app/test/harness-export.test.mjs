import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHarnessExportProject, serializeHarnessExportProject } from '../src/lib/harness/export.ts'

function snapshot(overrides = {}) {
  const dna = {
    concept: 'MD3', mood: ['playful'], colors: { primary: '#6750a4', background: '#fff' },
    typography: { fontFamily: 'system-ui' },
    geometry: { radius: '28px', border: 'tonal', density: 'normal' },
    motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' }, compositionRules: ['rounded'],
  }
  const components = ['hero', 'features'].map((id) => ({
    id, role: id, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react', 'lucide-react'], designTokens: [],
  }))
  const candidates = components.map((component, index) => ({
    id: `${component.id}-picked`, componentId: component.id, variant: 'expressive',
    files: [
      { path: `src/generated/${component.id}/expressive.tsx`, content: `export default function View(){ return <div>${component.id}</div> }` },
      ...(component.id === 'hero' ? [{ path: 'src/generated/hero/styles.css', content: '.hero { border-radius: 28px; }' }] : []),
    ],
    entryFile: `src/generated/${component.id}/expressive.tsx`, previewProps: { index }, notes: [],
    runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }))
  return {
    version: 1, sessionId: 'session-export', requirement: '做一个生动页面', phase: 'complete', createdAt: 1, updatedAt: 2,
    plan: { project: { name: 'My Playful UI', description: 'demo' }, pages: [{ id: 'home', name: 'Home', route: '/', slots: ['hero', 'features'] }], visualDirections: [{ id: 'md3', name: 'MD3', description: '', visualDNA: dna }], components },
    direction: { id: 'md3', name: 'MD3', description: '', visualDNA: dna }, candidates,
    selections: { hero: 'hero-picked', features: 'features-picked' }, review: { summary: 'ok', patches: [] }, events: [],
    ...overrides,
  }
}

test('export builds a runnable multi-file project from selected Harness artifacts', () => {
  const project = buildHarnessExportProject(snapshot(), { generatedAt: '2026-07-26T00:00:00.000Z' })
  assert.equal(project.name, 'my-playful-ui')
  assert.deepEqual(project.selectedCandidates.map((item) => item.componentId), ['hero', 'features'])
  assert.match(project.files['src/App.tsx'], /import Selected1 from '.\/generated\/hero\/expressive'/)
  assert.match(project.files['src/App.tsx'], /import '.\/generated\/hero\/styles.css'/)
  assert.match(project.files['src/App.tsx'], /<Component2 \{\.\.\.props2\} \/>/)
  assert.match(project.files['src/index.css'], /--dna-primary: #6750a4/)
  assert.equal(JSON.parse(project.files['package.json']).dependencies['lucide-react'], '^0.562.0')
  assert.equal(JSON.parse(serializeHarnessExportProject(project)).files['src/generated/hero/expressive.tsx'], project.files['src/generated/hero/expressive.tsx'])
})

test('export rejects incomplete, unrendered, missing and colliding selections', () => {
  assert.throws(() => buildHarnessExportProject(snapshot({ selections: { hero: 'hero-picked' } })), /features 尚未选择/)
  const unrendered = snapshot()
  unrendered.candidates[0].runtimeStatus = 'compile_failed'
  assert.throws(() => buildHarnessExportProject(unrendered), /尚未成功编译并渲染/)
  assert.throws(() => buildHarnessExportProject(snapshot({ selections: { hero: 'missing', features: 'features-picked' } })), /已选候选不存在/)
  const collision = snapshot()
  collision.candidates[1].files[0].path = collision.candidates[0].files[0].path
  collision.candidates[1].entryFile = collision.candidates[0].entryFile
  assert.throws(() => buildHarnessExportProject(collision), /重复文件路径/)
})

test('export can intentionally build a partial draft', () => {
  const project = buildHarnessExportProject(snapshot({ selections: { hero: 'hero-picked' } }), {
    requireCompleteSelection: false,
    generatedAt: '2026-07-26T00:00:00.000Z',
  })
  assert.deepEqual(project.selectedCandidates.map((item) => item.componentId), ['hero'])
  assert.doesNotMatch(project.files['src/App.tsx'], /Selected2/)
})
