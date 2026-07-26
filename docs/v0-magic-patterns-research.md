# v0 与 Magic Patterns 竞品机制研究

> 研究日期：2026-07-26
> 研究范围：结合当前仓库的产品文档与源码，分析 v0、Magic Patterns 中适合“今天选什么？”的生成、探索、Visual DNA 和设计系统机制。
> 约束：当前产品保持纯前端、静态部署、BYOK、OpenAI-compatible API，不默认引入托管后端。

## 1. 结论摘要

当前项目并非从零开始。它已经具备一套方向正确的 v0 式生成骨架：

- Planner 拆分组件合同。
- 多个 Component Agent 并发生成候选。
- Draft Renderer 提前输出真实 API 草图。
- 完整源码进入浏览器沙箱编译。
- 编译失败后进入有限次数 Fixer 循环。
- 只有成功渲染的候选才能选择和导出。
- API Key、项目快照和事件历史保存在用户浏览器中。

真正需要优先补齐的是三个闭环：

1. **生成真实性**：当前只有 `previewHtml` 是真正的网络流；`code.delta` 是完整 JSON 返回后再切片发布，并非真实文件流。
2. **结构多样性**：三个 Agent 有不同 persona，但没有预先分配互斥结构蓝图，也没有生成后的结构差异门禁。
3. **Visual DNA 输入**：当前 Visual DNA 是固定主题变量，尚未形成从截图、CSS、Tailwind、URL 或已有代码提取证据的管线。

建议分别借鉴：

- 向 v0 借鉴：**可观察、可恢复、可验证、可回退的 revision pipeline**。
- 向 Magic Patterns 借鉴：**先固定真实设计基线，再让候选只沿互斥结构方向发散**。

不建议复制 v0 的 Vercel 托管栈，也不建议复制 Magic Patterns 的云端协作和完整设计系统平台。

## 2. 当前项目现状

### 2.1 已有生成链路

当前 Harness 已经实现：

```text
用户需求
→ Planner / 原子组件快速规划
→ 选择固定 Visual DNA 方向
→ Draft Renderer 与完整 Builder 并行
→ preview.updated 显示安全 HTML 草图
→ source.ready
→ 浏览器沙箱编译与运行
→ compile.failed 时调用 Fixer
→ render.ready
→ 用户选择候选
→ Reviewer
→ 导出 Vite + React 项目映射
```

主要实现位置：

- `app/src/lib/harness/session.ts`：生成主状态机。
- `app/src/lib/harness/kimi.ts`：OpenAI-compatible Chat Completions SSE 客户端。
- `app/src/lib/harness/prompts.ts`：Planner、Builder、Draft、Fixer、Reviewer、Revision 提示词。
- `app/src/lib/harness/sandbox-runtime.ts`：浏览器内 Babel 转译和 iframe Runtime。
- `app/src/components/app/StreamingHtmlPreview.tsx`：无脚本流式草图。
- `app/src/components/app/GeneratedCandidatePreview.tsx`：完整 React 候选预览。
- `app/src/lib/harness/export.ts`：候选项目导出。

### 2.2 已有多 Agent 机制

当前候选分为：

- `conservative`：Product Agent，关注产品结构、效率和可用性。
- `expressive`：Motion Agent，关注动效、空间层次和即时反馈。
- `experimental`：Explorer Agent，关注探索式构图和交互隐喻。

代码位于：

- `app/src/lib/harness/agents.ts`
- `app/src/lib/harness/prompts.ts`
- `app/src/lib/harness/generation-graph.ts`

现有 Prompt 已明确要求候选差异来自构图、层级、控件和动效，而不是只换颜色。这是正确方向，但仍属于模型软约束。

### 2.3 已有 Visual DNA 机制

当前 `VisualDNA` 包含：

```ts
type VisualDNA = {
  concept: string
  mood: string[]
  colors: Record<string, string>
  typography: Record<string, unknown>
  geometry: {
    radius: string
    border: string
    density: string
  }
  motion: {
    personality: string
    duration: string
    easing: string
  }
  compositionRules: string[]
}
```

`app/src/lib/dna.ts` 内置苹果风、MD3、黑客风和复古四套方向；`app/src/index.css` 提供 `.dna-*` 语义表面类。这是导入外部视觉系统时可以继续复用的稳定输出接口。

## 3. v0 研究

### 3.1 v0 的流式 UI 本质

v0 当前的流式机制不应理解为“直接把不完整 JSX 塞进页面”。其公开 API 使用结构化 SSE Agent 消息流：

```text
opening chat/message snapshot
→ ordered message.parts.chunk patches
→ usage / agent actions / errors
→ closing canonical snapshot
```

`Message.parts` 可以表达文本、思考、读文件、写文件、搜索、Bash、工具调用和 Agent action。用户看到的实时反馈来自这些结构化动作以及独立运行的 Preview，而不是单一源码字符串。

可借鉴点：

- 开流时发布完整初始快照。
- 中间事件有严格顺序，可重放、去重。
- 流结束时返回最终 canonical snapshot。
- 临时 delta 不是最终事实源。
- 明确记录 usage、error 和 `finishReason`。

### 3.2 v0 的源码与预览分离

v0 每个 chat 运行在独立 Vercel Sandbox 中：

- Preview 是沙箱中真实 dev server 的运行结果。
- Code editor、Terminal 和 Preview 使用同一文件系统。
- 源文件可以通过 API 单独取回或下载。
- Preview readiness 与消息生成流是两条通道。

适合当前项目借鉴的不是 VM，而是状态拆分：

```ts
type CandidateRuntimeState = {
  draftPreview: DraftPreviewState
  sourceHead: SourceRevisionState
  compile: CompileState
  runtimePreview: RuntimePreviewState
}
```

候选失败时应保留 `lastKnownGoodPreview`，不应因为新 revision 编译失败而清空上一次成功画面。

### 3.3 v0 的自动修错

v0 官方说明能够在生成循环中处理：

- 缺失文件和依赖。
- 语法、格式、import/export 错误。
- Runtime error 和程序 bug。
- 部署日志中的错误或警告。

其关键不是“再生成一遍”，而是：

```text
收集诊断
→ 绑定到明确 source revision
→ 生成局部修复 revision
→ 重新编译
→ 运行验证
→ 成功后晋级为新的 head / last-good
```

v0 没有公开内部 repair prompt、错误排序和成功判定算法，因此不应推断或照抄不存在的内部细节。

### 3.4 v0 的版本机制

v0 生成消息形成版本。恢复旧版本时会把旧状态创建为新的最新版本，而不是原地修改历史。这种 append-only 模型适合当前项目：

```ts
type CandidateRevision = {
  id: string
  candidateId: string
  parentId?: string
  files: GeneratedFile[]
  createdBy: 'builder' | 'repair' | 'revision' | 'restore'
  status: 'source-ready' | 'compile-failed' | 'rendered'
  diagnostics: DiagnosticBundle[]
  createdAt: number
}
```

`CandidateArtifact` 本身只需要指向：

```ts
headRevisionId: string
lastGoodRevisionId?: string
```

### 3.5 v0 不适合作为当前底座

完整 v0 Platform API 不符合当前架构：

- 使用 `V0_API_KEY`，不是通用 OpenAI-compatible API。
- 自身 Agent 只使用 v0 专有模型配置。
- Preview token 要求服务端代理，不能把 V0 Key 暴露给浏览器。
- 依赖 Vercel Sandbox、项目、环境变量和托管基础设施。
- 官方 v0 SDK 仍标记为 Developer Preview / beta。

因此应复制其协议和 UX 思路，不直接把 v0 SDK 或 Platform API 作为产品核心依赖。

## 4. Magic Patterns 研究

### 4.1 多方案探索的关键机制

Magic Patterns 官方 Inspiration workflow 的重点是：

1. 先忠实建立 baseline。
2. 固定 focus、shared copy、颜色、字体、间距、圆角和真实资产。
3. 主 Agent 先提出多个有名字和 thesis 的方向。
4. 每个并行 Agent 只获得一个专属方向。
5. 候选必须采用不同 layout philosophy、arrangement 或 product framing。

这比给三个 Agent 同一句 Prompt、只改变 temperature 或“大胆程度”更可靠。

适合当前产品的探索轴：

| 探索类型 | 可分配方向 |
|---|---|
| 入口与可发现性 | sidebar、topbar、contextual entry、global launcher |
| 信息架构 | tabs、grouped sidebar、wizard、progressive disclosure |
| 构图 | split、rail、dashboard、stage、timeline、editorial |
| 交互模型 | direct、inline edit、bulk action、spatial、staged flow |

### 4.2 Brand DNA 与探索方向应拆开

当前 `VisualDNA` 同时承担：

- 品牌/设计系统事实。
- 候选结构探索方向。

建议拆为：

- `BrandDNA` / `DesignSystemSnapshot`：颜色、字体、间距、圆角、图标、组件规则；同一轮候选保持不变。
- `ExplorationDirection`：布局哲学、信息层级、入口位置、控件模式、交互隐喻；候选之间变化。

如果同一次候选对比同时改变 Apple/MD3/Hacker/Retro 主题和布局，人会首先感知颜色差异，而不是结构差异。

### 4.3 Magic Patterns 的设计系统不是颜色表

其 Design System 包含：

- Components
- Typography & Icons
- Colors
- Rules
- Skills
- Access & Settings

生成时会自动应用 Rules、颜色 token、字体、图标和组件，也可以明确引用指定组件。

当前产品无需照搬完整平台，但应引入轻量 `DesignSystemSnapshot`：

```ts
type DesignSystemSnapshot = {
  id: string
  version: number
  tokenSet: DTCGTokenGroup
  rules: {
    always: string[]
    conditional: Array<{
      description: string
      instructions: string[]
    }>
  }
  components: Array<{
    name: string
    importPath?: string
    props?: Record<string, unknown>
    variants: string[]
    whenToUse?: string
    whenNotToUse?: string
  }>
  typography: unknown
  icons: unknown
  provenance: VisualEvidence[]
}
```

只知道 props 不足以正确使用设计系统组件，还需要用途、禁用场景、变体和真实使用示例。

### 4.4 多源导入

Magic Patterns 支持或规划从 GitHub、本地代码、NPM、Figma 和网站导入。最值得借鉴的原则是：

> 视觉源和代码源配对。

例如：

- 网站或截图说明外观。
- GitHub、CSS、Tailwind 或组件代码说明真实实现。
- Storybook/文档说明组件语义和使用条件。

导入后先提出检测结果，由用户 review 后才写入 Design System，而不是静默覆盖已有 token。

### 4.5 Fork 与 Merge

Magic Patterns 的 fork 适合后续设计分支：

- 从当前设计 fork。
- 从旧版本 fork。
- Fork 后清空无关聊天上下文。
- 从一个设计引用或合并另一个设计的局部内容。

当前项目 P0 不需要完整 fork UI，但 Candidate revision 和 Visual DNA lineage 应为未来分支保留结构。

## 5. 多 Agent 如何保证真正结构不同

### 5.1 当前问题

现在三个 Agent 的差异主要来自：

- persona
- variant profile
- system prompt

但是它们：

- 不知道兄弟候选已经占用了哪些结构。
- 没有明确的布局 archetype。
- 没有主操作位置和交互模型约束。
- 生成后没有结构指纹比较。

因此容易同时产生：

```text
标题
→ 中心卡片
→ 一组按钮
→ 底部说明
```

然后只在颜色、阴影、圆角或动画上不同。

### 5.2 推荐两阶段流程

```text
Brand DNA + Component Contract
→ Blueprint Planner 一次生成 N 个互斥蓝图
→ 本地 Diversity Solver 检查蓝图
→ 每个 Component Agent 只获取自己的蓝图
→ 并行生成和编译
→ 从真实 DOM 提取 Structure Fingerprint
→ Structural Diversity Gate
→ 过近候选定向重生
```

蓝图必须包含可验证硬约束，例如：

- 根布局必须为两栏，移动端变为 staged stack。
- 主操作必须位于左侧 rail。
- 禁止居中 hero card。
- 必须使用 progressive disclosure。
- 不得使用其他候选已经占用的 landmark order。

### 5.3 推荐数据结构

```ts
type ExplorationBrief = {
  focus: string
  sharedCopy: Record<string, string>
  brandDnaId: string
  directions: CandidateBlueprint[]
}

type CandidateBlueprint = {
  id: string
  componentId: string
  agentId: string
  name: string
  thesis: string
  archetype:
    | 'stack'
    | 'split'
    | 'rail'
    | 'dashboard'
    | 'timeline'
    | 'stage'
    | 'command-center'
    | 'editorial'
  informationHierarchy: string[]
  primaryActionPlacement: string
  controlTopology: string[]
  interactionModel:
    | 'direct'
    | 'progressive-disclosure'
    | 'inline-edit'
    | 'bulk-action'
    | 'wizard'
    | 'spatial'
  responsivePlan: Array<{
    breakpoint: string
    transformation: string
  }>
  requiredFeatures: string[]
  forbiddenFeatures: string[]
}

type StructureFingerprint = {
  rootLayout: string
  regionRoles: string[]
  regionDepths: number[]
  flowAxes: string[]
  gridColumns: number[]
  landmarkOrder: string[]
  actionPositions: string[]
  disclosureCount: number
}
```

`CandidateArtifact` 增加：

```ts
blueprintId: string
structureFingerprint: StructureFingerprint
quality: {
  contractPass: boolean
  dnaFidelity: number
  accessibility: number
  structuralDiversity: number
}
```

### 5.4 多样性门禁

不要只用 CLIP 或普通截图 embedding。换颜色也会显著改变视觉 embedding，但不代表结构不同。

建议结构距离：

```text
StructuralDistance =
  0.35 × normalized tree-edit distance
+ 0.30 × landmark/block geometry distance
+ 0.20 × interaction-topology Jaccard distance
+ 0.15 × responsive-transformation distance
```

MVP 规则：

- 任意候选对 `StructuralDistance < 0.35` 时判定重复。
- root layout、primary CTA placement、interaction model 三项至少两项不同。
- 只重生相似候选，不重跑整个槽位。
- 重生 Prompt 应携带差异失败报告，而不是笼统要求“更有创意”。
- 编译、合同、键盘可达和响应式属于硬门槛，不能用多样性分数抵消。

## 6. Visual DNA 提取

### 6.1 推荐数据分层

不要把来源置信度直接塞进 Design Token value，否则会破坏标准 token 交换格式。

```ts
type VisualSource =
  | { kind: 'screenshot'; id: string; dataUrl: string; viewport?: Viewport }
  | { kind: 'url'; id: string; url: string; mode: 'same-origin' | 'cors-fetch' | 'proxy-snapshot' }
  | { kind: 'css'; id: string; text: string }
  | { kind: 'tailwind'; id: string; text: string; version?: 3 | 4 }
  | { kind: 'code'; id: string; files: GeneratedFile[] }

type VisualEvidence = {
  sourceId: string
  extractor:
    | 'css-ast'
    | 'computed-style'
    | 'jsx-ast'
    | 'image-analysis'
    | 'vision-model'
  confidence: number
  selectorOrPath?: string
  rawValue?: unknown
}

type VisualDNAProfile = {
  schemaVersion: 2
  tokenSet: DTCGTokenGroup
  semantics: {
    colorRoles: Record<string, string>
    typeRoles: Record<string, string>
    surfaceRoles: Record<string, string>
  }
  composition: {
    preferredArchetypes: string[]
    alignment: 'strict-grid' | 'mixed' | 'freeform'
    density: 'compact' | 'comfortable' | 'spacious'
    whitespaceRatio?: number
    hierarchyRules: string[]
    responsiveRules: string[]
  }
  components: {
    controlShape: 'rect' | 'rounded' | 'pill' | 'mixed'
    navigationPatterns: string[]
    anatomyPatterns: ComponentPattern[]
    stateTreatment: Record<string, string>
  }
  imagery: {
    treatment: string[]
    iconStyle: string[]
    illustrationStyle: string[]
  }
  motion: {
    durations: Record<string, string>
    easings: Record<string, string>
    principles: string[]
  }
  constraints: {
    must: string[]
    avoid: string[]
  }
  evidenceByPath: Record<string, VisualEvidence[]>
}
```

### 6.2 截图

建议使用“浏览器确定性分析 + 可选 vision 模型”的混合方式。

浏览器端先提取：

- 主色板与明暗分布。
- 边缘密度和分割线。
- 留白比例。
- 近似区域 bounding boxes。
- 可观察的圆角和阴影分布。

Vision 模型负责解释：

- 导航、主内容、CTA 等区域语义。
- 排版气质。
- 图标和图片处理方式。
- 可能的布局 archetype。

限制：

- 单张截图不能确定精确字体。
- 不能确定 hover、focus、disabled、motion。
- 不能确定完整响应式规则。
- 推断字段必须保存 confidence。
- 如果同时提供桌面与移动截图，才可以推断响应式 transformation。

支持 vision 的兼容供应商可以直接接收 Base64 data URL，无需上传到项目服务端。

### 6.3 URL

纯前端必须明确同源边界：

- 同源页面：可以读取 DOM、bounding box 和 `getComputedStyle()`。
- 跨域且服务器允许 CORS：可以获取 HTML/CSS，但不保证脚本、字体和相对资源完整。
- 普通跨域 URL：无法读取 iframe 内 DOM/CSS。

因此不能承诺“输入任意 URL 就完整提取 Visual DNA”。可选方案：

- 用户自建 capture proxy。
- 浏览器扩展或书签脚本。
- 用户上传保存后的 HTML/CSS。
- 用户粘贴 DOM/CSS snapshot。

取得的第三方 HTML 不应在编辑器主页面执行；优先静态分析，需要渲染时进入无脚本或严格隔离沙箱。

### 6.4 CSS

使用 CSS AST 提取：

- Custom properties。
- 颜色和语义选择器。
- 字体、字号和行高。
- spacing、radius、shadow scales。
- transition、duration 和 easing。

不要把整个 `getComputedStyle()` 结果交给模型。每个元素可能包含数百项属性，绝大多数是继承或默认值。应该：

1. 从 stylesheet 和 inline style 找出显式设置的属性。
2. 再用 `getComputedStyle()` 获取最终解析值。
3. 去掉继承和重复声明。
4. 聚合为语义 token 与使用频率。

### 6.5 Tailwind

- Tailwind v4：优先读取 `@theme` 与 CSS theme variables。
- Tailwind v3：静态解析 `theme`、`extend` 对象字面量和 CSS variables。
- 禁止在主页面 `require()` 或执行用户的 `tailwind.config.js`。
- 函数、插件和动态表达式应标记 unsupported，或以后放入隔离 Worker/沙箱处理。
- spacing、font size、radius 和 shadow 应保留完整 scale，不压缩成单个值。

### 6.6 已有代码

使用 JSX/TSX AST 提取：

- 组件树和 HTML/ARIA landmarks。
- Props、state 和事件。
- `className` 中的布局与 token 使用分布。
- 重复 component anatomy。
- CSS selector 到 JSX usage 的引用关系。
- 导航、卡片、按钮、输入框等真实组件模式。

不要执行导入代码。只有需要 computed style 时，才允许在和当前生成代码沙箱同等级的隔离环境中运行。

### 6.7 证据合并顺序

建议优先级：

1. 用户显式锁定值。
2. CSS/Tailwind token。
3. 同源 computed style。
4. JSX/CSS 静态推断。
5. 截图确定性分析。
6. Vision 模型语义推断。

冲突时保留多条 evidence，让用户看到“从 CSS 确定”和“从截图推测”，不要静默覆盖。

## 7. OpenAI-compatible 与 BYOK 适配

“OpenAI-compatible”供应商实际兼容程度不同，不能假定都支持：

- Vision。
- Base64 data URL。
- Structured Outputs。
- Tool calls。
- Responses API typed events。
- 完全一致的 SSE chunk 格式。

建议将当前 `KimiSettings` 演进为 provider-neutral 设置：

```ts
type ProviderCapabilities = {
  streaming: boolean
  vision: boolean
  dataUrlImages: boolean
  jsonSchema: boolean
  toolCalls: boolean
  responsesApi: boolean
  maxInputImages?: number
}

type ProviderSettings = {
  apiKey: string
  baseUrl: string
  plannerModel: string
  draftModel: string
  codeModel: string
  reviewerModel: string
  capabilities: ProviderCapabilities
}
```

降级策略：

- 无 vision：仍可导入 CSS、Tailwind 和已有代码；截图只做浏览器端基础分析。
- 无 JSON Schema：继续使用 JSON prompt + Zod 校验 + 有限重试。
- 无 Responses API：继续使用 Chat Completions SSE，并在 provider adapter 中归一化事件。
- 无 tool calls：使用显式阶段请求，不影响核心 Component Agent 流程。

## 8. 当前产品差距清单

### 8.1 流与版本

- 没有生成 opening/closing canonical snapshot。
- 没有 `finishReason`、usage 和 typed provider error。
- 没有真正的 file start/delta/end 流协议。
- 没有 immutable source revision。
- 没有 last-good source/preview。
- 没有断流 checkpoint 和重放语义。

### 8.2 修复与验证

- Fixer 主要处理 compile errors。
- 没有统一 runtime、dependency、timeout 诊断。
- 没有最小交互 smoke test。
- 没有多 viewport 验证。
- Reviewer 没有真实截图闭环。
- Reviewer patch 没有预览、接受和执行状态。

### 8.3 多方案

- 只有 persona，没有 blueprint。
- Agent 不知道兄弟候选的结构占用。
- 没有结构指纹。
- 没有差异评分和重生门禁。
- Candidate Rail 没有展示 thesis、archetype 和差异解释。

### 8.4 Visual DNA

- 只有固定 preset。
- 没有截图/CSS/Tailwind/代码导入。
- 没有来源和 confidence。
- 没有 spacing/type/radius/shadow scale。
- 没有组件 anatomy、states 和 when-to-use。
- `.dna-*` 语义层覆盖面不足。
- 沙箱、运行时和导出 token 命名存在漂移。

### 8.5 拼合与导出

- 导出页面只是顺序 `<section>`。
- Component Contract 的 inputs/outputs 没有变成 binding graph。
- 没有完整组合项目的集成 build/smoke。
- 当前下载是 `.wtpt.json` 文件映射，不是真正 ZIP 项目。

## 9. 优先级

### 9.1 P0：真实性、可修复性与结构差异

#### P0-1：候选结构蓝图

新增：

- `ExplorationBrief`
- `CandidateBlueprint`
- `StructureFingerprint`
- `CandidateArtifact.quality`

涉及：

- `app/src/lib/harness/types.ts`
- `app/src/lib/harness/schemas.ts`
- `app/src/lib/harness/prompts.ts`
- `app/src/lib/harness/agents.ts`
- `app/src/lib/harness/session.ts`
- `app/src/lib/harness/generation-graph.ts`

建议新增：

- `app/src/lib/harness/candidate-diversity.ts`
- `app/src/lib/harness/structure-fingerprint.ts`

#### P0-2：不可变 revision 与诊断闭环

新增：

```ts
type DiagnosticBundle = {
  phase: 'parse' | 'schema' | 'compile' | 'runtime' | 'dependency' | 'timeout'
  sourceRevisionId: string
  sourceHash: string
  attempt: number
  lastGoodRevisionId?: string
  errors: Diagnostic[]
}
```

涉及：

- `app/src/lib/harness/types.ts`
- `app/src/lib/harness/events.ts`
- `app/src/lib/harness/session.ts`
- `app/src/lib/harness/sandbox-runtime.ts`
- `app/src/lib/harness/storage.ts`
- `app/src/lib/harness/export.ts`

#### P0-3：Provider capability negotiation

- 将供应商设置改为 provider-neutral。
- 显式区分 streaming、vision、data URL、JSON Schema、tool calls、Responses API。
- 保留 Chat Completions 最低公共兼容层。

涉及：

- `app/src/lib/harness/types.ts`
- `app/src/lib/harness/kimi.ts`，后续可重命名为 `provider.ts`。
- `app/src/lib/harness/settings.ts`
- `app/src/components/app/ApiSettingsModal.tsx`

#### P0-4：真实 Reviewer 闭环

- 捕获完整组合页面截图。
- 调用 `session.review(screenshot)`。
- Patch 增加 `proposed/previewed/accepted/rejected/applied`。
- Token/CSS/props patch 支持预览和确认。
- 删除或隔离会误导用户的演示式“已截图、已应用”文案。

涉及：

- `app/src/lib/store.ts`
- `app/src/lib/harness/session.ts`
- `app/src/lib/harness/prompts.ts`
- `app/src/components/app/CanvasStage.tsx`

#### P0-5：轻量 Visual DNA 导入

首批只支持：

- Screenshot。
- 粘贴 CSS/Tailwind token。
- 上传代码文件或压缩包。

确定性解析优先，模型仅负责语义归类与冲突解释。

建议新增：

```text
app/src/lib/visual-import/
├── types.ts
├── css.ts
├── tailwind.ts
├── code.ts
├── image.ts
├── evidence.ts
└── normalize.ts
```

#### P0-6：统一 Visual Token Map

- `dna.ts`、Harness VisualDNA、沙箱和导出共用一个 token map。
- 把 `.dna-*` 语义类注入候选沙箱和导出项目。
- 增加生成结果 lint，限制组件硬编码项目级 surface/radius/shadow。

### 9.2 P1：导入、集成和质量门禁

- CSS/JSX/Tailwind AST 分析放入 Web Worker。
- 支持同源或允许 CORS 的 URL 导入。
- 增加 DNA 冲突 review 和用户 token lock。
- 增加真实 DOM/bounding-box 多样性门禁。
- 增加多 viewport、console、runtime、a11y 检查。
- `PagePlan` 增加 composition tree 和 binding graph。
- 导出前对完整组合工程进行 build/smoke。
- Candidate Rail 展示方案 thesis、archetype、结构差异说明。

建议数据结构：

```ts
type PageNode =
  | { type: 'slot'; componentId: string }
  | { type: 'stack' | 'grid'; children: PageNode[]; responsive: unknown }

type Binding = {
  from: { componentId?: string; event?: string; store?: string }
  to: { componentId?: string; prop?: string; action?: string }
}
```

### 9.3 P2：可选扩展

- 浏览器扩展或用户自建 snapshot proxy。
- Figma `.fig`、Figma MCP。
- GitHub OAuth 与只读 repo importer。
- NPM/Storybook component metadata importer。
- Fork、merge、revision diff 和分支图。
- OCR、局部区域标注、多截图响应式推断。
- CLIP/LPIPS 或更完整 Block-Match 评估。
- 从用户连续选择中学习本地偏好。

## 10. 不适合当前产品的功能

以下能力不应因为 v0 或 Magic Patterns 提供就直接照搬：

### 10.1 不适合 P0

- 每个项目一台云端 VM。
- 完整 Node/npm/terminal/在线 IDE。
- Vercel 一键部署和环境变量管理。
- 多人实时协作、权限和云端发布。
- Figma 双向同步。
- GitHub 双向同步。
- 组件市场。
- 多框架、任意依赖和任意安装脚本。
- 私有 NPM、企业 Storybook 和完整设计系统发布。

### 10.2 与纯前端架构冲突

- 任意 URL 一键读取 DOM/CSS。
- 在编辑器主页面执行用户 Tailwind config。
- 执行第三方网页脚本或导入项目代码。
- 依赖某一家供应商专有 Responses event 或 tool call。
- 要求产品维护者托管用户 Key 或模型费用。

### 10.3 产品方法上不应采用

- 用一个大模型从截图端到端生成最终项目。
- 用纯 CLIP 分数判断结构多样性。
- 将截图推断出的字体、hover、motion、响应式当成事实。
- 把生成 prototype 原样当成 production code。
- 用无限自动重试替代有限、可解释的修复流程。
- 为追求差异而破坏组件合同、键盘可达或响应式。

## 11. 可靠来源

### 11.1 v0 官方资料

- [What is v0](https://v0.app/docs)
- [Agentic features](https://v0.app/docs/agentic-features)
- [Sandbox](https://v0.app/docs/sandbox)
- [Design Systems 2.0](https://v0.app/docs/design-systems-2)
- [Screenshots and Files](https://v0.app/docs/screenshots)
- [Streaming chat API](https://v0.app/docs/api/v2/reference/chats/create-chat-streaming)
- [Streaming message API](https://v0.app/docs/api/v2/reference/messages/send-message-streaming)
- [Accessing previews](https://v0.app/docs/api/v2/guides/accessing-previews)
- [Get preview URL](https://v0.app/docs/api/v2/reference/chats/get-preview-url)
- [Get chat files](https://v0.app/docs/api/v2/reference/chats/get-chat-files)
- [Download chat files](https://v0.app/docs/api/v2/reference/chats/download-chat-files)
- [Code editing](https://v0.app/docs/code-editing)
- [Versions](https://v0.app/docs/versions)
- [v0 SDK](https://github.com/vercel/v0-sdk)

### 11.2 Magic Patterns 官方资料

- [Introduction](https://www.magicpatterns.com/docs/documentation/get-started/introduction)
- [Features](https://www.magicpatterns.com/docs/documentation/features/overview)
- [Plan Mode](https://www.magicpatterns.com/docs/documentation/editor/plan-mode)
- [Forking](https://www.magicpatterns.com/docs/documentation/editor/forking)
- [Merging Designs](https://www.magicpatterns.com/docs/documentation/editor/merging-designs)
- [Design Systems](https://www.magicpatterns.com/docs/documentation/design-systems/overview)
- [Importing a Design System](https://www.magicpatterns.com/docs/documentation/design-systems/importing/overview)
- [MCP tools and workflows](https://www.magicpatterns.com/docs/documentation/features/mcp-server/available_tools)
- [Official Inspiration skill](https://github.com/magicpatterns/agent-plugins/blob/main/codex/skills/inspiration/SKILL.md)
- [Official recreate-as-raw-html skill](https://github.com/magicpatterns/agent-plugins/blob/main/codex/skills/recreate-as-raw-html/SKILL.md)
- [Website-to-React extraction lessons](https://www.magicpatterns.com/blog/any-website-to-react-component)
- [Integration skill](https://www.magicpatterns.com/docs/documentation/exporting/integration-skill)

### 11.3 API、设计系统与浏览器基础资料

- [OpenAI Streaming API Responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [OpenAI Images and Vision](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Design Tokens Format Module](https://www.designtokens.org/tr/drafts/format/)
- [Tailwind CSS Theme Variables](https://tailwindcss.com/docs/theme)
- [MDN getComputedStyle](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle)
- [MDN Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)
- [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [WCAG 2.2 Contrast Minimum](https://www.w3.org/TR/WCAG22/#contrast-minimum)

### 11.4 视觉还原与评估研究

- [Design2Code paper](https://arxiv.org/abs/2403.03163)
- [Design2Code repository](https://github.com/NoviScl/Design2Code)
- [CLIP paper](https://arxiv.org/abs/2103.00020)
- [LPIPS paper](https://arxiv.org/abs/1801.03924)

## 12. 最终产品原则

后续实现应持续遵守：

> 固定品牌事实，发散结构方向；开放组件内部表现，严格控制合同、运行时和证据来源。

以及：

> 草图负责尽快出现，revision 负责成为事实，编译和运行验证负责决定它能否被选择与导出。
