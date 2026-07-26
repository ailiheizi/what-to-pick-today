import type { CandidateArtifact, CandidateVariant, ComponentContract, PagePlan, VisualDirection } from './types.ts'
import { builderAgentFor } from './agents.ts'

const JSON_ONLY = '只返回合法 JSON，不要 Markdown 代码围栏，不要添加 JSON 之外的解释。'
const ALLOWED_DEPENDENCIES = ['react', 'react-dom', 'lucide-react', 'motion']

export function plannerMessages(requirement: string) {
  return [
    {
      role: 'system' as const,
      content: `你是“今天选什么？”的轻量 Planner。只拆页面并定义严格组件合同，不生成代码，也不生成视觉底板。输出必须简洁，接口必须严格。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        requirement,
        rules: [
          '按复杂度拆成 1 到 4 个可以独立替换的组件槽位；简单页面不要过度拆分',
          '共享同一个核心交互状态的部分必须保持为一个槽位：计数显示+按钮、计算器显示+键盘、播放器画面+控制、表单字段+提交都禁止拆开',
          '只有能够独立替换且通过清晰 inputs/outputs 协作的页面区块才允许拆分；不得让兄弟组件各自复制同一份状态',
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
        builderAgent: agent,
        variant: input.variant,
        variantProfile,
        rules: [
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
  direction: VisualDirection
  component: ComponentContract
  variant: CandidateVariant
}) {
  const agent = builderAgentFor(input.variant)
  return [
    {
      role: 'system' as const,
      content: `你是 ${agent.name} 的快速 UI Draft Renderer，专职负责${agent.role}。草图必须体现该 Agent 的设计主张。只返回一个紧凑的无脚本 HTML 组件草图，不生成 React 源码，不解释。previewHtml 必须是 JSON 的第一个且唯一的键。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        requirement: input.requirement,
        visualDNA: input.direction.visualDNA,
        componentContract: input.component,
        builderAgent: agent,
        rules: [
          '根元素必须立刻包含关键可见内容；前 240 个字符出现标题、数字或按钮文字',
          '使用内联样式，允许末尾追加 style；绑定 --dna-* CSS 变量',
          '禁止 script、iframe、外部资源、表单提交和事件处理器',
          '控制在 900 字符以内，优先完整布局和清晰层级',
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
  plan: PagePlan
  direction: VisualDirection
  selections: Record<string, string>
  screenshot?: string
}) {
  const request = JSON.stringify({
    plan: input.plan,
    visualDNA: input.direction.visualDNA,
    selections: input.selections,
    rules: ['只允许 token、props、CSS 或指定组件重新生成补丁', '不要重写整个项目'],
    outputSchema: {
      summary: 'string',
      patches: [{ type: 'token | props | css | regenerate', target: 'string', reason: 'string', value: {} }],
    },
  })
  return [
    {
      role: 'system' as const,
      content: `你是最终页面 Reviewer。检查视觉一致性、层级、响应式、可访问性和交互反馈，只提出边界明确的局部补丁。${JSON_ONLY}`,
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
  component: ComponentContract
  direction: VisualDirection
  candidate: CandidateArtifact
}) {
  return [
    {
      role: 'system' as const,
      content: `你是局部 Revision Builder。根据用户补充要求修改一个已经选中的组件，同时保留组件合同、现有文件边界和没有被要求改变的设计。返回所有文件的完整内容。${JSON_ONLY}`,
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        instruction: input.instruction,
        componentContract: input.component,
        visualDNA: input.direction.visualDNA,
        currentCandidate: input.candidate,
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
