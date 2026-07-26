# AI Generation Harness 架构

## 1. 目标

Harness 接收用户需求，调用 OpenAI 兼容 API 规划页面，创建并发组件生成任务，将生成过程转成统一事件，驱动浏览器实时草图、渐进编译和最终 React 渲染。

Harness 不负责规定最终视觉，也不依赖大型预制组件库。它负责让多个 AI 生成结果可靠地协作。

## 2. 总体结构

```text
User Prompt
    ↓
Planner
    ├── Atomic Widget Fast Path
    ├── Page Plan
    ├── Visual DNA
    ├── Component Contracts
    └── Task Graph
            ↓
Concurrent Component Builders
    ├── Sidebar Candidate A/B/C
    ├── Chat Candidate A/B/C
    ├── Composer Candidate A/B/C
    └── Header Candidate A/B/C
            ↓
Event Stream
    ├── preview.updated → 无脚本 HTML 草图
    └── source.ready → Compiler + React Sandbox
            ↓
User Selection
            ↓
Integrated Page
            ↓
Screenshot Reviewer / Fixer
```

## 3. Planner 输出

Planner 应使用 Structured Output 返回稳定数据：

```ts
type PagePlan = {
  project: {
    name: string
    description: string
  }
  visualDNA: VisualDNA
  pages: PageDefinition[]
  components: ComponentContract[]
  tasks: GenerationTask[]
}

type GenerationTask = {
  id: string
  componentId: string
  dependsOn: string[]
  candidateCount: number
  prompt: string
}
```

Planner 只规划，不直接生成整页代码。拆分的基本单位是“可独立替换的组件槽位”，而不是视觉上能够圈出的每一块区域。

### 3.1 组件关联与槽位边界

规划时先判断多个区域是否共享同一个核心交互状态：

- 计数显示与加减/重置按钮属于一个完整计数器，不能拆开。
- 计算器显示区与键盘、播放器画面与控制、表单字段与提交动作同样不能拆开。
- 如果远程 Planner 仍把这类原子组件拆成 2～3 个槽位，Harness 会合并合同中的 inputs、outputs、dependencies 和 designTokens，并把页面 slots 改回一个完整槽位。
- 计数器、计算器、计时器、播放器、开关和单表单等明确的原子需求会走本地快速规划，跳过一次远程 Planner 请求；后续草图与 React 组件仍由真实 API 生成。

复杂页面不应因此退化为单个巨型组件。导航、内容列表、筛选器、详情区等能够独立替换，并能用明确 inputs/outputs 协作的页面区块，仍按槽位拆分。Builder 必须消费合同输入、触发合同输出，不能在兄弟组件中各自复制同一份状态。

## 4. 并发策略

模型 API 每个请求只产生一个候选回复。一个组件需要三个候选时，由 Harness 发起三个请求。

```text
component: sidebar
├── request 1: conservative
├── request 2: expressive
└── request 3: experimental
```

推荐第一版：

- 页面组件：3～6 个
- 每个组件候选：2～3 个
- 同时活跃请求：3～5 个
- 失败自动重试：最多 1～2 次
- 编译修复循环：最多 2 次

任务应支持：

- 排队
- 启动
- 暂停接收
- 取消
- 重试
- 超时
- 失败降级

## 5. 统一事件协议

无论底层使用供应商 SSE、ReadableStream 还是本地事件总线，前端只消费统一事件：

```ts
type GenerationEvent =
  | { type: "plan.started" }
  | { type: "plan.completed"; plan: PagePlan }
  | { type: "component.queued"; componentId: string; candidateId: string }
  | { type: "component.started"; candidateId: string }
  | { type: "preview.updated"; componentId: string; candidateId: string; html: string; complete: boolean }
  | { type: "file.created"; candidateId: string; path: string }
  | { type: "code.delta"; candidateId: string; path: string; delta: string }
  | { type: "source.ready"; candidate: CandidateArtifact }
  | { type: "compile.started"; candidateId: string }
  | { type: "compile.succeeded"; candidateId: string }
  | { type: "compile.failed"; candidateId: string; errors: string[] }
  | { type: "render.ready"; candidateId: string }
  | { type: "review.completed"; patches: Patch[] }
  | { type: "task.failed"; taskId: string; error: string }
  | { type: "generation.completed" }
```

事件应包含顺序号，便于断线恢复和去重：

```ts
type EventEnvelope = {
  sessionId: string
  sequence: number
  timestamp: number
  event: GenerationEvent
}
```

## 6. 流式草图与渐进编译

Harness 会同时启动一个限额很小的 API Draft Renderer 和完整 Builder。Draft Renderer 只生成 `previewHtml`，使用快速模型和较小 token 上限，负责尽快给出第一帧；完整 Builder 仍把 `previewHtml` 放在第一个字段、`files` 放在后面，作为草图补充和最终 React 源码来源。两条 SSE 都通过同一个增量解码器发布 `preview.updated`，完整源码编译成功后原位替换草图。两者都是真实 API 输出，不使用本地假 UI。

流式草图的生命周期是：

```text
快速 API Draft + Builder previewHtml 增量
→ preview.updated
→ CSP iframe 中显示无脚本草图
→ 完整 files 到达并编译
→ render.ready
→ 在原位置替换为可交互 React 候选
```

草图只用于尽早反馈，不能选择或导出；只有编译成功的 React 候选才可以扣合进正式页面。草图 iframe 使用空 sandbox，并通过 CSP、标签清理禁止脚本、表单、外部资源及嵌套 iframe。

直接对每个 Token 编译会产生大量语法错误和性能消耗。完整源码阶段采用：

1. 持续接收代码并显示生成状态。
2. 遇到文件完成标记时立即编译。
3. 没有标记时使用 300～800ms 防抖。
4. 编译成功后更新候选预览。
5. 编译失败时保留草图或上一次成功画面，不显示空白区域。
6. 生成结束仍失败时，把错误和当前文件交给 Fixer。

## 7. 运行沙箱

生成代码不能进入编辑器主 React 树直接执行。

候选运行环境需要：

- iframe 隔离
- CSP
- 依赖白名单
- 网络请求限制
- 错误边界
- 运行超时
- 控制台错误捕获
- 截图能力

第一版可以优先评估 Sandpack。需要完整 npm 和开发服务器能力时，再考虑 WebContainers。

## 8. 组件拼合与关联

每个组件由以下部分组成：

```text
Component Contract
+ Generated Files
+ Visual DNA Bindings
+ Runtime Metadata
+ Preview State
```

组件候选被选中后，Harness 创建一个组合 Patch：

```ts
type SelectionPatch = {
  slot: string
  previousCandidateId?: string
  selectedCandidateId: string
  timestamp: number
}
```

正式页面只引用已确认候选。正在滚动或悬停的候选属于临时试穿状态，不写入正式历史。

“有关联”首先由 Planner 的槽位边界和组件合同保证：强共享状态的交互必须生成在同一个原子组件内；可独立替换的复杂页面区块则通过 inputs/outputs 描述数据和事件关系。当前 MVP 不让多个独立 iframe 各自持有同一核心状态，也不依赖隐式的跨 iframe 状态同步。

## 9. 视觉反馈循环

页面组合完成后：

```text
Render Page
→ Capture Screenshot
→ Send Screenshot + PagePlan + VisualDNA to Reviewer Model
→ Receive Structured Review
→ Convert Review to Local Patches
→ Preview Patches
→ Apply or Reject
```

Reviewer 只允许返回限定修改：

- Token Patch
- Props Patch
- CSS Patch
- 指定组件重新生成请求

避免 Reviewer 无理由重写整个项目。

## 10. 纯前端与 BYOK

用户在工具设置中配置：

```text
API Key / OpenAI-compatible Base URL / Model
```

浏览器 Harness 直接调用兼容 API、聚合流式响应并调度并发任务。Key 默认只在当前浏览器会话中保存，不进入源码、项目文件或导出 JSON。供应商不支持 CORS 时，Base URL 可以指向用户自己的兼容 Proxy。

项目状态保存在 IndexedDB：

- 用户需求
- PagePlan
- Visual DNA
- 组件合同
- 候选文件
- 选择历史
- 页面分支
- 模型使用统计

提供 JSON 导入和导出，方便分享、复现和提交 Issue。

## 11. 推荐目录

```text
what-to-pick-today/
├── app/
│   ├── src/
│   │   ├── components/
│   │   └── lib/
│   │       ├── harness/
│   │       │   ├── session.ts
│   │       │   ├── scheduler.ts
│   │       │   ├── events.ts
│   │       │   ├── kimi.ts
│   │       │   ├── prompts.ts
│   │       │   ├── schemas.ts
│   │       │   └── storage.ts
│   │       ├── sandbox/
│   │       └── sound/
├── docs/
└── examples/
```

## 12. 第一阶段完成标准

- 用户可以输入一个简单产品需求。
- 原子交互需求会得到一个完整组件合同，不会把显示和控制拆成彼此独立的状态孤岛。
- 复杂页面能稳定输出 1～4 个有清晰边界及 inputs/outputs 的组件合同。
- Harness 能并发运行至少 3 个组件任务。
- Builder 返回完整源码前，能够先显示并行快速 API 请求产生的安全 `previewHtml` 草图，并在完整 React 编译后无跳页替换。
- 任一组件完成编译后能够在原位置替换为可交互 React，不等待全部任务。
- 每个组件至少有 2 个可选择候选。
- 选择后可以实时拼入完整页面。
- 编译错误能够反馈给 Fixer 并至少自动修复一次。
- 页面可以保存、恢复和导出。
