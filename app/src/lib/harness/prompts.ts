import type { CandidateArtifact, CandidateVariant, ComponentContract, PagePlan, VisualDirection } from './types.ts'
import { builderAgentFor } from './agents.ts'

const JSON_ONLY = '只返回合法 JSON，不要 Markdown 代码围栏，不要添加 JSON 之外的解释。'
const ALLOWED_DEPENDENCIES = ['react', 'react-dom', 'lucide-react', 'motion']

export function preferredUiLanguage(requirement: string) {
  const asksForEnglish = /\b(?:use|write|display|render)(?:\s+the)?(?:\s+ui|\s+interface|\s+copy|\s+content)?\s+(?:in\s+)?english\b/i.test(requirement)
    || /(?:用|使用|采用|改成|输出|界面|文案|内容).{0,8}(?:英文|英语)/.test(requirement)
  const rejectsEnglish = /(?:不要|禁止|避免|别用).{0,8}(?:英文|英语)/.test(requirement)
  if (asksForEnglish && !rejectsEnglish) return 'English (en-US)'
  return /[\u3400-\u9fff]/.test(requirement) ? '简体中文（zh-CN）' : 'English (en-US)'
}

function sampleSharedValue(name: string, type: string, language: string) {
  const key = name.toLowerCase()
  const normalizedType = type.toLowerCase()
  const isChinese = language.startsWith('简体中文')
  if (/city|城市|location/.test(key)) return isChinese ? '上海' : 'Shanghai'
  if (/unit|单位/.test(key)) return '°C'
  if (/locale|语言/.test(key)) return isChinese ? 'zh-CN' : 'en-US'
  if (/time.?range|date.?range|时间范围|日期范围/.test(key)) return isChinese ? '近 30 天' : 'Last 30 days'
  if (/selected.?metric|metric|指标/.test(key)) return isChinese ? '收入' : 'Revenue'
  if (/category|分类/.test(key)) return isChinese ? '全部' : 'All'
  if (/theme|主题/.test(key)) return isChinese ? '明亮' : 'Light'
  if (/currency|币种/.test(key)) return 'CNY'
  if (/query|search|keyword|搜索|关键词/.test(key)) return ''
  if (/boolean|bool/.test(normalizedType)) return false
  if (/number|int|float/.test(normalizedType)) return 0
  if (/array|\[\]/.test(normalizedType)) return []
  // Unknown prop identifiers are implementation details, not acceptable UI copy.
  // An empty value keeps the preview contract intact without leaking e.g. `accountId`.
  return ''
}

export function sharedPreviewProps(plan: PagePlan, requirement = '') {
  const language = preferredUiLanguage(requirement || `${plan.project.name} ${plan.project.description}`)
  const occurrences = new Map<string, { name: string; type: string; count: number }>()
  for (const component of plan.components) {
    for (const input of component.inputs) {
      const key = input.name.trim().toLowerCase()
      const current = occurrences.get(key)
      occurrences.set(key, current
        ? { ...current, count: current.count + 1 }
        : { name: input.name, type: input.type, count: 1 })
    }
  }
  return Object.fromEntries([...occurrences.values()]
    .filter((input) => input.count > 1)
    .map((input) => [input.name, sampleSharedValue(input.name, input.type, language)]))
}

function compositionContext(plan: PagePlan, component: ComponentContract, requirement: string) {
  return {
    currentResponsibility: { id: component.id, role: component.role, inputs: component.inputs, outputs: component.outputs },
    siblingResponsibilities: plan.components
      .filter((item) => item.id !== component.id)
      .map((item) => ({ id: item.id, role: item.role, inputs: item.inputs, outputs: item.outputs })),
    sharedPreviewProps: sharedPreviewProps(plan, requirement),
  }
}

export function plannerMessages(requirement: string) {
  const uiLanguage = preferredUiLanguage(requirement)
  return [
    {
      role: 'system' as const,
      content: `你是“今天选什么？”的轻量 Planner。只拆页面并定义严格组件合同，不生成代码，也不生成视觉底板。输出必须简洁，接口必须严格。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        requirement,
        uiLanguage,
        rules: [
          `project.name、project.description、pages[].name、components[].role 和所有 description 必须使用 ${uiLanguage}；不得因为字段 schema 是英文就输出英文可见文案`,
          'id、route、slot、input/output name 是代码标识符，保持简短的英文 kebab-case 或 camelCase；不要把它们当成用户可见文案',
          '按复杂度拆成 1 到 4 个可以独立替换的组件槽位；简单页面不要过度拆分',
          '共享同一个核心交互状态的部分必须保持为一个槽位：计数显示+按钮、计算器显示+键盘、播放器画面+控制、表单字段+提交都禁止拆开',
          '只有能够独立替换且通过清晰 inputs/outputs 协作的页面区块才允许拆分；不得让兄弟组件各自复制同一份状态',
          '多槽位页面必须至少定义一条可追踪的跨槽位接口：上游 output 与下游 input 使用相同的语义词根，例如 metricSelected → selectedMetric；不要让所有 outputs 都为空',
          '如果多个槽位共享筛选、城市、单位、主题或时间范围，把它们声明为同名 inputs；事件生产者再通过 outputs 明确更新动作',
          'visualDirections 固定返回空数组；视觉底板由客户端已有的苹果风、MD3、黑客风和复古风提供',
          '描述保持简洁；不要解释推理过程，不要添加示例数据之外的冗长文案',
          `依赖只能来自白名单：${ALLOWED_DEPENDENCIES.join(', ')}`,
        ],
        outputSchema: {
          project: { name: 'string', description: 'string' },
          pages: [{ id: 'string', name: 'string', route: 'string', slots: ['component-id'] }],
          visualDirections: [],
          components: [{
            id: 'string', role: 'string', slot: 'string', width: 'fixed | fluid',
            inputs: [{ name: 'string', type: 'string', required: true, description: 'string' }],
            outputs: [{ name: 'string', payload: 'string', description: 'string' }],
            dependencies: ['string'], designTokens: ['string'],
          }],
        },
      }),
    },
  ]
}

export function builderMessages(input: {
  requirement: string
  plan: PagePlan
  direction: VisualDirection
  component: ComponentContract
  variant: CandidateVariant
}) {
  const uiLanguage = preferredUiLanguage(input.requirement)
  const entryFile = `src/generated/${input.component.id}/${input.variant}.tsx`
  const agent = builderAgentFor(input.variant)
  const variantProfile = {
    conservative: {
      intent: '高完成度、低学习成本的经典方案',
      composition: '稳定对齐、清晰分区、熟悉的信息层级；避免夸张错位和装饰喧宾夺主',
      interaction: '直接反馈、轻量 hover/press/focus 动效，状态变化一眼可懂',
      signature: '精致克制、像可直接上线的成熟产品',
    },
    expressive: {
      intent: '第一眼有吸引力、活泼且仍然高效的主推方案',
      composition: '使用明确视觉焦点、层叠卡片或有节奏的非对称布局；不要退化成普通居中卡片',
      interaction: '弹性入场、选择反馈、数字或状态切换动画，并保持操作路径清楚',
      signature: '鲜明色块、空间层次和有意义的动势',
    },
    experimental: {
      intent: '与常规方案结构明显不同的探索方案',
      composition: '可采用分屏、轨道、仪表盘、舞台式构图或强排版，但不得只是换颜色',
      interaction: '尝试更大胆的空间变换、跟随反馈或分阶段状态揭示，同时保持键盘可达',
      signature: '独特结构和交互隐喻，仍需完整可用',
    },
  }[input.variant]
  return [
    {
      role: 'system' as const,
      content: `你是 ${agent.name}，专职负责${agent.role}。${agent.mission} 你不是通用 Component Builder，也不要模仿其他 Agent 的折中方案。只生成一个独立的 React + TypeScript 组件候选。严格遵守合同和依赖白名单。组件必须有真实内容、交互细节和符合 VisualDNA 的动效；禁止访问 cookie、localStorage、Node API 和未授权网络。必须处理 prefers-reduced-motion。输出对象时 previewHtml 必须是第一个键，files 必须在它之后；这让浏览器能在完整源码生成前实时显示 API 草图。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        requirement: input.requirement,
        project: input.plan.project,
        visualDNA: input.direction.visualDNA,
        componentContract: input.component,
        uiLanguage,
        compositionContext: compositionContext(input.plan, input.component, input.requirement),
        builderAgent: agent,
        variant: input.variant,
        variantProfile,
        rules: [
          `previewHtml 和 React 组件中所有用户可见的标题、按钮、表头、图例、状态、提示和空状态必须使用 ${uiLanguage}；MRR、SaaS 等通用行业缩写可保留`,
          '禁止把 timeRange、selectedMetric、accountId 等 input/prop 标识符或“示例${propName}”直接渲染给用户；必须转成自然、本地化的产品文案',
          'previewHtml 是同一组件的紧凑无脚本草图；必须以一个立刻可见的根元素（例如 div/main）开头，不要以 style 标签开头',
          'previewHtml 的前 240 个字符内必须出现用户能看见的关键内容（标题、数字、按钮文字或卡片），长 style 和装饰必须放到内容之后',
          'previewHtml 使用内联样式或末尾 style 标签，绑定 --dna-* CSS 变量；禁止 script、iframe、外部资源和事件处理器',
          'previewHtml 控制在 1200 字符以内，先表达布局、色彩、层级和关键内容，允许静态模拟交互状态',
          '默认导出一个 React 组件',
          '所有 React/TypeScript 代码必须放在 entryFile 单文件内；可以额外返回一个纯 CSS 文件，但禁止相对模块导入',
          '优先使用 CSS 变量绑定 VisualDNA，不在组件里复制项目级 token',
          '候选差异必须来自构图、信息层级、控件形态和动效语言，不能只替换颜色、阴影或圆角',
          `当前是 ${input.variant} 方案，必须贯彻其 composition、interaction 和 signature；不要折中成另外两种方案`,
          '若合同声明 inputs，必须从 props 使用这些共享输入；若声明 outputs，必须调用同名回调，不得在组件内部复制兄弟组件负责的状态',
          '当前组件只展示 currentResponsibility.role 所描述的主体内容；兄弟组件的标题、主体指标、列表或控制区禁止出现在本组件中',
          '若当前职责包含“当前/概览/摘要”，不得附带未来、历史或明细列表；若职责包含“未来/预报/历史/列表”，不得再放一张当前状态摘要卡，只能把共享字段作为小型上下文标签',
          'sharedPreviewProps 中的共享字段必须原样用于 previewHtml 和 previewProps；共享字段只可作为上下文标签，不得借此复制兄弟组件的主体内容',
          `同页兄弟组件为：${input.plan.components.filter((item) => item.id !== input.component.id).map((item) => `${item.id}:${item.role}`).join('；') || '无'}；当前组件不得重复它们的职责`,
          '不得省略代码，不得返回伪代码',
        ],
        outputSchema: {
          previewHtml: '<div style="...">可立即显示的完整紧凑草图</div>',
          files: [{ path: entryFile, content: '完整源码' }],
          entryFile,
          previewProps: {},
          notes: ['简短说明'],
        },
      }),
    },
  ]
}

/**
 * A deliberately small, independent API request used as the first visual frame.
 * The full Builder runs at the same time and later replaces this draft with the
 * compiled React artifact.
 */
export function draftPreviewMessages(input: {
  requirement: string
  plan: PagePlan
  direction: VisualDirection
  component: ComponentContract
  variant: CandidateVariant
}) {
  const agent = builderAgentFor(input.variant)
  const uiLanguage = preferredUiLanguage(input.requirement)
  return [
    {
      role: 'system' as const,
      content: `你是 ${agent.name} 的快速 UI Draft Renderer，专职负责${agent.role}。草图必须体现该 Agent 的设计主张。只返回一个紧凑的无脚本 HTML 组件草图，不生成 React 源码，不解释。previewHtml 必须是 JSON 的第一个且唯一的键。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        requirement: input.requirement,
        uiLanguage,
        visualDNA: input.direction.visualDNA,
        componentContract: input.component,
        compositionContext: compositionContext(input.plan, input.component, input.requirement),
        builderAgent: agent,
        rules: [
          `所有用户可见文案必须使用 ${uiLanguage}；通用行业缩写可保留`,
          '不得把 timeRange、selectedMetric 等 prop 标识符或“示例${propName}”作为可见文案',
          '根元素必须立刻包含关键可见内容；前 240 个字符出现标题、数字或按钮文字',
          '使用内联样式，允许末尾追加 style；绑定 --dna-* CSS 变量',
          '禁止 script、iframe、外部资源、表单提交和事件处理器',
          '控制在 900 字符以内，优先完整布局和清晰层级',
          '只画 currentResponsibility.role 的主体内容，禁止出现 siblingResponsibilities 的标题、主体指标、列表或操作区',
          '若当前职责包含“当前/概览/摘要”，不得画未来、历史或明细列表；若职责包含“未来/预报/历史/列表”，不得画当前状态摘要，只保留共享上下文标签',
          '所有共享上下文字段使用 sharedPreviewProps 的固定值；不得自行更换城市、单位或其他共享语义',
        ],
        outputSchema: { previewHtml: '<main style="...">可立即显示的完整组件草图</main>' },
      }),
    },
  ]
}

export function fixerMessages(input: {
  component: ComponentContract
  direction: VisualDirection
  candidate: CandidateArtifact
  errors: string[]
}) {
  return [
    {
      role: 'system' as const,
      content: `你是局部 Fixer。只修复给定候选的编译或运行错误，保留组件合同、视觉方向和原设计意图。不得创建输入候选之外的新文件。返回所有修复后文件的完整内容。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        componentContract: input.component,
        visualDNA: input.direction.visualDNA,
        candidate: input.candidate,
        errors: input.errors,
        outputSchema: {
          files: input.candidate.files.map((file) => ({ path: file.path, content: '完整修复后源码' })),
          entryFile: input.candidate.entryFile,
          previewProps: input.candidate.previewProps,
          notes: ['修复摘要'],
        },
      }),
    },
  ]
}

export function reviewerMessages(input: {
  requirement: string
  plan: PagePlan
  direction: VisualDirection
  selections: Record<string, string>
  selectedCandidates: Array<{
    componentId: string
    candidateId: string
    contract: ComponentContract
    previewProps: Record<string, unknown>
    files: CandidateArtifact['files']
  }>
  screenshot?: string
}) {
  const request = JSON.stringify({
    requirement: input.requirement,
    plan: input.plan,
    visualDNA: input.direction.visualDNA,
    selections: input.selections,
    selectedCandidates: input.selectedCandidates,
    rules: [
      '检查重复标题、间距节奏、视觉层级、组件内容关联、共享状态、响应式和用户可见文案的一致性',
      '如果需求主要使用中文，所有用户可见文案必须统一为中文，但代码标识符保持英文',
      '最多返回 3 个补丁；target 必须是实际 componentId，或用 page 表示需要分发的整页一致性调整',
      '每个补丁只允许 token、props、CSS 或指定组件重新生成；不得改变组件合同、增加依赖或重写整个项目',
      'value.instruction 必须给局部 Revision Builder 一条可直接执行的具体修改指令',
      '页面已经可运行；没有明确收益时返回空 patches，不要为了修改而修改',
    ],
    outputSchema: {
      summary: 'string',
      patches: [{ type: 'token | props | css | regenerate', target: '实际 componentId | page', reason: 'string', value: { instruction: '具体修改要求' } }],
    },
  })
  return [
    {
      role: 'system' as const,
      content: `你是最终页面 Reviewer 和整页设计总监。你会读取所有已选组件的完整源码，检查视觉一致性、层级、响应式、可访问性、内容关联和交互反馈，只提出可以在槽位边界内安全执行的局部补丁。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: input.screenshot
        ? [{ type: 'text', text: request }, { type: 'image_url', image_url: { url: input.screenshot } }]
        : request,
    },
  ]
}

export function revisionMessages(input: {
  instruction: string
  requirement?: string
  component: ComponentContract
  direction: VisualDirection
  candidate: CandidateArtifact
}) {
  const uiLanguage = preferredUiLanguage(input.requirement || input.instruction)
  return [
    {
      role: 'system' as const,
      content: `你是局部 Revision Builder。根据用户补充要求修改一个已经选中的组件，同时保留组件合同、现有文件边界和没有被要求改变的设计。返回所有文件的完整内容。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        instruction: input.instruction,
        uiLanguage,
        componentContract: input.component,
        visualDNA: input.direction.visualDNA,
        currentCandidate: input.candidate,
        rules: [
          `新增或修改的用户可见文案必须使用 ${uiLanguage}，并统一现有可见文案的语言`,
          '不得把 input/prop 代码标识符或“示例${propName}”渲染到界面',
        ],
        outputSchema: {
          files: input.candidate.files.map((file) => ({ path: file.path, content: '修改后的完整源码' })),
          entryFile: input.candidate.entryFile,
          previewProps: input.candidate.previewProps,
          notes: ['修改摘要'],
        },
      }),
    },
  ]
}
