# AI Generation Harness 架构

## 1. 目标

Harness 接收用户需求，调用 Kimi 规划页面，创建并发组件生成任务，将生成过程转成统一事件，驱动浏览器渐进编译和实时渲染。

Harness 不负责规定最终视觉，也不依赖大型预制组件库。它负责让多个 AI 生成结果可靠地协作。

## 2. 总体结构

```text
User Prompt
    ↓
Planner
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
            ↓
Compiler + Sandbox Renderer
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

Planner 只规划，不直接生成整页代码。

## 4. 并发策略

Kimi 当前每个请求只产生一个回复。一个组件需要三个候选时，由 Harness 发起三个请求。

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

无论底层使用 Kimi SSE、ReadableStream 还是本地事件总线，前端只消费统一事件：

```ts
type GenerationEvent =
  | { type: "plan.started" }
  | { type: "plan.completed"; plan: PagePlan }
  | { type: "component.queued"; componentId: string; candidateId: string }
  | { type: "component.started"; candidateId: string }
  | { type: "file.created"; candidateId: string; path: string }
  | { type: "code.delta"; candidateId: string; path: string; delta: string }
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

## 6. 渐进编译

直接对每个 Token 编译会产生大量语法错误和性能消耗。推荐：

1. 持续接收代码并显示生成状态。
2. 遇到文件完成标记时立即编译。
3. 没有标记时使用 300～800ms 防抖。
4. 编译成功后更新候选预览。
5. 编译失败时继续接收，不清空上一次成功画面。
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

## 8. 组件拼合

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

## 9. 视觉反馈循环

页面组合完成后：

```text
Render Page
→ Capture Screenshot
→ Send Screenshot + PagePlan + VisualDNA to Kimi
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
Kimi API Key / Base URL / Model
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
- Planner 能稳定输出页面计划和 3～6 个组件合同。
- Harness 能并发运行至少 3 个组件任务。
- 任一组件完成后能够立即渲染，不等待全部任务。
- 每个组件至少有 2 个可选择候选。
- 选择后可以实时拼入完整页面。
- 编译错误能够反馈给 Fixer 并至少自动修复一次。
- 页面可以保存、恢复和导出。
