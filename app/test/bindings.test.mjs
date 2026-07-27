import assert from 'node:assert/strict'
import test from 'node:test'
import { inferSemanticBindings } from '../src/lib/harness/bindings.ts'

const component = (id, inputs = [], outputs = []) => ({
  id, role: id, slot: id, width: 'fluid', dependencies: [], designTokens: [],
  inputs: inputs.map((name) => ({ name, type: 'string', required: false })),
  outputs: outputs.map((name) => ({ name, payload: 'string' })),
})

test('semantic bindings fan one output out to matching downstream inputs', () => {
  assert.deepEqual(inferSemanticBindings([
    component('metrics', [], ['metricSelected']),
    component('chart', ['selectedMetric']),
    component('orders', ['metric']),
  ]), [{
    fromComponentId: 'metrics', outputName: 'metricSelected',
    targets: [{ componentId: 'chart', inputName: 'selectedMetric' }, { componentId: 'orders', inputName: 'metric' }],
  }])
})

test('semantic bindings do not invent links for unrelated contracts', () => {
  assert.deepEqual(inferSemanticBindings([
    component('hero', [], ['ctaClicked']), component('table', ['rows']),
  ]), [])
})
