import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DASHBOARD_SLOT_PATTERNS,
  inferGeneratedLayout,
  overviewScale,
  pickDistinctSemanticSlots,
} from '../src/lib/harness/layout.ts'

const component = (id, role) => ({
  id, role, slot: id, width: 'fluid', inputs: [], outputs: [], dependencies: ['react'], designTokens: [],
})

test('semantic layout roles never assign one slot to two positions', () => {
  const slots = [
    component('revenue-trend', '收入趋势指标'),
    component('activity-chart', '实时活动图表'),
  ]
  const matches = pickDistinctSemanticSlots(slots, DASHBOARD_SLOT_PATTERNS, (item) => `${item.id} ${item.role}`)
    .filter(Boolean)
  assert.equal(new Set(matches).size, matches.length)
  assert.equal(matches.filter((item) => item.id === 'revenue-trend').length, 1)
})

test('dashboard intent wins over incidental landing vocabulary', () => {
  const plan = {
    project: { name: '运营驾驶舱', description: '查看套餐收入与功能使用情况' },
    pages: [{ id: 'home', name: '首页', route: '/', slots: ['pricing-table', 'feature-usage', 'metrics'] }],
    visualDirections: [],
    components: [
      component('pricing-table', '套餐收入表格'),
      component('feature-usage', '功能使用趋势'),
      component('metrics', '核心指标'),
    ],
  }
  assert.equal(inferGeneratedLayout(plan), 'dashboard')
})

test('component structure can infer landing and dashboard layouts', () => {
  const plan = (components) => ({
    project: { name: '新页面', description: '' },
    pages: [{ id: 'home', name: '首页', route: '/', slots: components.map(({ id }) => id) }],
    visualDirections: [], components,
  })
  assert.equal(inferGeneratedLayout(plan([
    component('hero', '产品首屏'), component('pricing', '定价方案'), component('cta', '行动召唤'),
  ])), 'landing')
  assert.equal(inferGeneratedLayout(plan([
    component('metrics', '核心指标'), component('trend', '收入趋势'), component('orders', '订单表格'),
  ])), 'dashboard')
})

test('overview scale fits long pages while keeping a usable lower bound', () => {
  assert.equal(overviewScale(720, 600), 1)
  assert.equal(overviewScale(720, 1200), 0.5)
  assert.equal(overviewScale(500, 5000), 0.18)
  assert.equal(overviewScale(Number.NaN, 1200), 1)
})
