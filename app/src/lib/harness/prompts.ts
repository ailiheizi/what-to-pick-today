import type { CandidateArtifact, CandidateVariant, ComponentContract, PagePlan, VisualDirection } from './types.ts'
import { builderAgentFor } from './agents.ts'

const JSON_ONLY = '只返回合法 JSON，不要 Markdown 代码围栏，不要添加 JSON 之外的解释。'
const ALLOWED_DEPENDENCIES = ['react', 'react-dom', 'lucide-react', 'motion']

export function directionLayoutGrammar(directionId: string) {
  const grammars: Record<string, string[]> = {
    apple: [
      '采用紧凑的 macOS/iPadOS 分栏或 inset grouped list：宽屏优先主从分栏，窄屏再折叠为纵向',
      '操作区悬浮或贴近标题工具栏，内容行使用克制留白和 accessory 对齐；禁止把每一行都做成 Material 药丸',
      '玻璃材质只属于外层分组，不要给每个最小条目都套一张厚重卡片',
    ],
    md3: [
      '采用 Material 3 的 top app bar + 响应式 tonal card grid；宽屏必须出现两列或主次卡片关系，不能照搬苹果风的纵向 inset list',
      '用 filled tonal 容器、chips、分段选择或 FAB 形成明确操作层级；列表条目属于卡片内部，不要让整页只剩一串等宽白色药丸',
      '至少一个主要信息分组必须改变空间位置或跨列尺寸，使灰度截图仍能一眼看出 Material 的卡片网格结构',
    ],
    hacker: [
      '采用终端工作区：命令栏/状态栏 + 高密度表格或分屏面板，使用连续细线而非悬浮卡片间距',
      '控件方正、对齐到字符网格，主要数据按列扫描；禁止把普通圆角卡片仅改成黑绿配色',
      '信息密度明显高于其他分支，关键状态可使用前缀、编号和短标签',
    ],
    retro: [
      '采用报刊编辑布局：masthead、大号衬线标题、双线分隔和不对称双栏；避免现代 SaaS 卡片堆叠',
      '列表更像目录、票据或排版栏，操作更像印章/标签；圆角应克制',
      '至少一个内容区使用跨栏标题或左右栏关系，让结构在灰度下仍有旧印刷品特征',
    ],
  }
  return grammars[directionId] ?? [
    '根据 Visual DNA 重做信息组织、主要分组的空间关系和控件层级，不能保留上一分支骨架只换 token',
  ]
}

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
  const signalKey = (name: string) => name.trim().replace(/^on(?=[A-Z_])/, '').toLowerCase().replace(/(?:changed?|selected|updated|submitted)$/, '')
  const currentSignals = new Set([
    ...component.inputs.map((input) => signalKey(input.name)),
    ...component.outputs.map((output) => signalKey(output.name)),
  ].filter(Boolean))
  const siblings = plan.components.filter((item) => item.id !== component.id)
  const related = siblings.filter((item) => [...item.inputs, ...item.outputs]
    .some((signal) => currentSignals.has(signalKey(signal.name))))
  const contextSiblings = [...related, ...siblings.filter((item) => !related.includes(item))].slice(0, 6)
  const omittedRelatedCount = Math.max(0, related.length - contextSiblings.filter((item) => related.includes(item)).length)
  return {
    currentResponsibility: { id: component.id, role: component.role, inputs: component.inputs, outputs: component.outputs },
    siblingResponsibilities: contextSiblings
      .map((item) => ({ id: item.id, role: item.role, inputs: item.inputs, outputs: item.outputs })),
    omittedSiblingCount: Math.max(0, siblings.length - contextSiblings.length),
    omittedRelatedCount,
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
          '按复杂度拆成可以独立替换的组件槽位，不设置固定总数上限：原子工具通常保持一个状态边界；信息丰富页面应把承担不同任务的区块分别拆出，不要为了减少数量而粗暴合并成一个大组件',
          '信息丰富页面应覆盖完整页面骨架，例如 dashboard 可包含 header、sidebar、summary、chart、activity、table、insights 等；landing 可包含 nav、hero、social-proof、features、workflow、pricing、cta 等。每个槽位必须有独立职责和真实可见内容',
          '共享同一个核心交互状态的部分必须保持为一个槽位：计数显示+按钮、计算器显示+键盘、播放器画面+控制、表单字段+提交都禁止拆开',
          '只有能够独立替换且通过清晰 inputs/outputs 协作的页面区块才允许拆分；不得让兄弟组件各自复制同一份状态',
          '多槽位页面必须至少定义一条可追踪的跨槽位接口：上游 output 必须是 React 回调命名（onUserSelected、onRoleSelected、onMetricChange），下游 input 使用对应状态名（selectedUser、selectedRole、metric）；不要把 output 和 input 都命名成 selectedUser，也不要让所有 outputs 都为空',
          '每条跨槽位接口的类型必须完全一致：output.payload 必须等于下游 input.type。若 onUserSelected 传 userId，则两边都用 string；若传完整用户，则两边都用 object，禁止 string → object 这类运行时才会崩溃的合同',
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
  const context = compositionContext(input.plan, input.component, input.requirement)
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
        compositionContext: context,
        builderAgent: agent,
        variant: input.variant,
        variantProfile,
        layoutGrammar: directionLayoutGrammar(input.direction.id),
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
          '当前产物是整页中的可嵌入组件槽位，不是独立网页：根节点必须背景透明且高度由内容决定；禁止 min-h-screen、100vh、fixed 全屏、独立页面底板、重复导航和重复页面外壳',
          `构图必须直接体现当前 VisualDNA 的 compositionRules（${input.direction.visualDNA.compositionRules.join('；')}），不能做一套固定布局后只靠 CSS 变量换色；苹果风、MD3、黑客风、复古风在灰度截图下也应有明显结构差异`,
          `必须逐条落实 layoutGrammar（${directionLayoutGrammar(input.direction.id).join('；')}），这是一组结构约束，不是风格建议`,
          '候选差异必须来自构图、信息层级、控件形态和动效语言，不能只替换颜色、阴影或圆角',
          `当前是 ${input.variant} 方案，必须贯彻其 composition、interaction 和 signature；不要折中成另外两种方案`,
          '若合同声明 inputs，必须从 props 使用这些共享输入；若声明 outputs，必须在真实用户交互中调用完全同名的回调（例如点击用户时执行 onUserSelected(user)），不得只写进 Props 类型、不得另造 onSelect 名称、不得在组件内部复制兄弟组件负责的状态',
          '当前组件只展示 currentResponsibility.role 所描述的主体内容；兄弟组件的标题、主体指标、列表或控制区禁止出现在本组件中',
          '若当前职责包含“当前/概览/摘要”，不得附带未来、历史或明细列表；若职责包含“未来/预报/历史/列表”，不得再放一张当前状态摘要卡，只能把共享字段作为小型上下文标签',
          'sharedPreviewProps 中的共享字段必须原样用于 previewHtml 和 previewProps；共享字段只可作为上下文标签，不得借此复制兄弟组件的主体内容',
          `同页相关兄弟组件为：${context.siblingResponsibilities.map((item) => `${item.id}:${item.role}`).join('；') || '无'}${context.omittedSiblingCount ? `；另有 ${context.omittedSiblingCount} 个槽位未展开${context.omittedRelatedCount ? `（其中 ${context.omittedRelatedCount} 个存在直接接口）` : ''}` : ''}；当前组件不得重复它们的职责`,
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
          '这是整页中的可嵌入槽位：根节点背景透明、高度随内容；禁止 min-h-screen、100vh、fixed 全屏、独立页面底板、重复导航或页面外壳',
          `草图构图必须体现 VisualDNA compositionRules（${input.direction.visualDNA.compositionRules.join('；')}），不同设计分支不能只是换颜色`,
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
      content: `你是局部 Fixer。只修复给定候选的编译、运行或组件合同错误，保留组件合同、视觉方向和原设计意图。合同 output 必须在真实交互中调用同名回调，input 必须从 props 消费。不得创建输入候选之外的新文件。返回所有修复后文件的完整内容。${JSON_ONLY}`,
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
  const perCandidateSourceBudget = Math.max(2_000, Math.floor(72_000 / Math.max(1, input.selectedCandidates.length)))
  const selectedCandidates = input.selectedCandidates.map((candidate) => {
    let remaining = perCandidateSourceBudget
    return {
      ...candidate,
      files: candidate.files.map((file) => {
        const content = file.content.slice(0, Math.max(0, remaining))
        remaining -= content.length
        return {
          ...file,
          content: content.length < file.content.length ? `${content}\n/* Reviewer source truncated for context safety. */` : content,
        }
      }),
    }
  })
  const request = JSON.stringify({
    requirement: input.requirement,
    plan: input.plan,
    visualDNA: input.direction.visualDNA,
    selections: input.selections,
    selectedCandidates,
    rules: [
      '检查重复标题、间距节奏、视觉层级、组件内容关联、共享状态、响应式和用户可见文案的一致性',
      '检查每个槽位是否错误生成了独立页面底板、100vh/min-h-screen、重复导航或页面外壳；发现后要求改成透明、内容高度的可嵌入 section',
      '检查当前 Visual DNA 的构图规则是否真正改变信息组织与控件形态，而不是只替换颜色、圆角和字体',
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
        layoutGrammar: directionLayoutGrammar(input.direction.id),
        currentCandidate: input.candidate,
        rules: [
          `新增或修改的用户可见文案必须使用 ${uiLanguage}，并统一现有可见文案的语言`,
          '不得把 input/prop 代码标识符或“示例${propName}”渲染到界面',
          '组件必须保持为可嵌入槽位：根节点背景透明且高度随内容，禁止 min-h-screen、100vh、fixed 全屏、独立页面底板、重复导航或页面外壳',
          `修改后的构图必须体现 VisualDNA compositionRules（${input.direction.visualDNA.compositionRules.join('；')}），不能只换色`,
          `必须逐条落实 layoutGrammar（${directionLayoutGrammar(input.direction.id).join('；')}）；至少改变一个主要信息分组的空间位置、跨列关系或控件层级，禁止沿用 currentCandidate 的根布局`,
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
