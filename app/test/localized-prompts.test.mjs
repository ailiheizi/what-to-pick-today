import assert from 'node:assert/strict'
import test from 'node:test'
import {
  builderMessages,
  draftPreviewMessages,
  plannerMessages,
  preferredUiLanguage,
  revisionMessages,
  sharedPreviewProps,
} from '../src/lib/harness/prompts.ts'

const direction = {
  id: 'md3', name: 'MD3', description: '',
  visualDNA: {
    concept: 'friendly', mood: [], colors: {}, typography: {},
    geometry: { radius: '24px', border: 'soft', density: 'normal' },
    motion: { personality: 'spring', duration: '300ms', easing: 'ease-out' },
    compositionRules: [],
  },
}

const components = ['filters', 'summary'].map((id) => ({
  id,
  role: id === 'filters' ? '时间筛选' : '收入摘要',
  slot: id,
  width: 'fluid',
  inputs: [
    { name: 'timeRange', type: 'string', required: true },
    { name: 'selectedMetric', type: 'string', required: true },
    { name: 'accountId', type: 'string', required: true },
  ],
  outputs: [], dependencies: ['react'], designTokens: [],
}))

const plan = {
  project: { name: '数据看板', description: '一个运营看板' },
  pages: [{ id: 'home', name: '首页', route: '/', slots: components.map(({ id }) => id) }],
  visualDirections: [direction], components,
}

test('UI language follows the requirement and respects explicit English requests', () => {
  assert.equal(preferredUiLanguage('做一个收入数据看板'), '简体中文（zh-CN）')
  assert.equal(preferredUiLanguage('做一个数据看板，文案用英文'), 'English (en-US)')
  assert.equal(preferredUiLanguage('做一个数据看板，不要出现英文'), '简体中文（zh-CN）')
  assert.equal(preferredUiLanguage('Build a revenue dashboard'), 'English (en-US)')
})

test('shared preview props use localized product values instead of prop identifiers', () => {
  assert.deepEqual(sharedPreviewProps(plan, '做一个收入数据看板'), {
    timeRange: '近 30 天',
    selectedMetric: '收入',
    accountId: '',
  })
  assert.deepEqual(sharedPreviewProps(plan, 'Build a revenue dashboard'), {
    timeRange: 'Last 30 days',
    selectedMetric: 'Revenue',
    accountId: '',
  })
})

test('planner and component prompts require localized visible copy but English identifiers', () => {
  const planner = JSON.parse(plannerMessages('做一个收入数据看板')[1].content)
  assert.equal(planner.uiLanguage, '简体中文（zh-CN）')
  assert.match(planner.rules.join('\n'), /project\.name.*简体中文/)
  assert.match(planner.rules.join('\n'), /input\/output name.*英文/)

  const input = {
    requirement: '做一个收入数据看板',
    plan, direction, component: components[0], variant: 'expressive',
  }
  for (const messages of [builderMessages(input), draftPreviewMessages(input)]) {
    const prompt = JSON.parse(messages[1].content)
    assert.equal(prompt.uiLanguage, '简体中文（zh-CN）')
    assert.equal(prompt.compositionContext.sharedPreviewProps.timeRange, '近 30 天')
    assert.match(prompt.rules.join('\n'), /timeRange.*selectedMetric/)
    assert.match(prompt.rules.join('\n'), /(?:用户可见|可见文案)/)
  }
})

test('revision prompt keeps generated UI in the original requirement language', () => {
  const candidate = {
    id: 'filters-candidate', componentId: 'filters', variant: 'expressive',
    files: [{ path: 'src/generated/filters/expressive.tsx', content: 'export default function C(){}' }],
    entryFile: 'src/generated/filters/expressive.tsx', previewProps: {}, notes: [],
    runtimeStatus: 'rendered', compileErrors: [], fixAttempts: 0,
  }
  const prompt = JSON.parse(revisionMessages({
    instruction: '调整卡片间距', requirement: '做一个收入数据看板',
    component: components[0], direction, candidate,
  })[1].content)
  assert.equal(prompt.uiLanguage, '简体中文（zh-CN）')
  assert.match(prompt.rules.join('\n'), /input\/prop.*代码标识符/)
})
