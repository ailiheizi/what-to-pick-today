# 纯前端 Generation Harness

## 定位

“今天选什么？”默认是一个可静态部署的开源前端工具：不要求账号、云数据库或项目维护者提供后端。用户提供自己的 API Key，浏览器直接调用 OpenAI-compatible API。

```text
React UI
→ Browser Generation Harness
→ OpenAI-compatible API（BYOK）
→ 浏览器 Runtime 沙箱
→ IndexedDB
```

如果模型供应商没有开放浏览器 CORS，生产部署仍可把 `baseUrl` 指向自己部署的兼容代理。仓库本地开发额外提供 Vite-only `/api/model` 转发：它从根目录 `.env` 读取上游地址和临时 Key，只运行在开发服务器，不进入生产 bundle，也不改变纯前端产品架构。

```text
AI_PROXY_BASE_URL=https://provider.example/v1
AI_PROXY_API_KEY=temporary-key

应用 Base URL=/api/model
浏览器 API Key=留空
```

开发代理只接受无 Origin 的本地工具请求或与 Vite 页面同源的浏览器请求；其他网页跨站访问会返回 403，避免借 localhost 间接使用 `.env` 中的 Key。

## 已实现模块

代码位于 `app/src/lib/harness/`：

- `session.ts`：Planner → 视觉方向 → 并发候选 → 编译/Fixer → 选择 → Reviewer 的主状态机。
- `generation-graph.ts`：LangGraph `StateGraph` 的 map/reduce 扇出，把候选生成任务分派给三个 specialist 节点。
- `agents.ts`：Motion / Product / Explorer 三个 Builder Agent persona 及 `CandidateVariant → persona` 映射。
- `plan-cohesion.ts`：原子交互组件的本地快速规划（`createAtomicPlan`）与远程 Planner 过度拆分时的合并兜底（`normalizePlanCohesion`）。
- `kimi.ts`：浏览器端兼容 SSE 客户端和 JSON 聚合（保留旧文件名以避免破坏现有导入）。
- `scheduler.ts`：限制并发、取消、重试和失败降级。目前用于 `revise()` 的补充修改批次；候选生成批次已改由 LangGraph 承担。
- `events.ts`：统一事件、顺序号、重放和稳定的随机 `motionCue`。
- `schemas.ts`：Structured Output 校验、依赖白名单和文件路径安全检查。
- `sandbox-runtime.ts`：Babel standalone 转译、CSP iframe 文档生成、`SandboxRuntimeAdapter` 与 iframe 选择桥。
- `storage.ts`：IndexedDB 项目快照和事件历史。
- `settings.ts`：BYOK 设置。Key 默认只放 `sessionStorage`；用户明确选择记住时才进入 `localStorage`。
- `prompts.ts`：Planner、Draft Renderer、Builder、Fixer、Reviewer、Revision 的角色提示词。
- `export.ts`：把已选候选组装为可下载的 React 项目（`src/App.tsx` 入口 + 固定依赖版本）。
- `local-proxy.ts`：开发用 `/api/model` 代理的路径解析与同源校验纯函数，供 Vite 插件复用。

### 接线状态（重要，先看这张表再动手）

仓库里存在若干**已实现、有完整测试、但没有任何应用代码调用**的模块。它们通过 `npm run test:harness` 不代表功能在产品里可用。判定方法是 grep 除自身测试之外的导入方：

```bash
grep -rl "harness/<name>.ts" app/src | grep -v "harness/<name>.ts$"
```

| 模块 | 状态 | 证据 / 接入点 |
| --- | --- | --- |
| `session.ts` `events.ts` `schemas.ts` `storage.ts` `kimi.ts` `prompts.ts` `agents.ts` `generation-graph.ts` `plan-cohesion.ts` `sandbox-runtime.ts` `settings.ts` `export.ts` `local-proxy.ts` | 已接线 | 主链路 |
| `errors.ts` | 已接线 | `store.ts` 导入 `classifyError`，按 `surface` 分流到设置弹窗 / 聊天 / 卡片内联 |
| `diversity.ts` | 已接线 | `session.ts` 检测并发出 `candidate.duplicate`；`store.ts` 标记卡片，`CandidateRail.tsx` 展示相似度和用户确认的「换一个」入口 |
| `model-routing.ts` | **已实现，未接线** | 无导入方。接入点：`session.ts` 中六处 `model:` / `codeModel:` 传参（planner/draft/builder/fixer/reviewer/revision） |
| `revisions.ts` | **已实现，未接线** | 无导入方。接入点：`store.ts` 的 `commitCandidate`、`undo`、`switchBranch` |

未接线模块的含义：**产品当前没有这个能力**。`revisions.ts` 有完整的分支/回溯 DAG 和 16 个测试，但用户界面上不存在版本回溯；`model-routing.ts` 能做五角色分模型路由，但设置里仍然只有两个模型字段。


## 多 Agent 候选生成（LangGraph）

### 三个 specialist persona

候选不是同一条通用 Builder prompt 的三次采样，而是三种职责边界不同的 Builder 角色，定义在 `app/src/lib/harness/agents.ts:8`：

| `CandidateVariant` | persona id | 名称 | 职责 |
|---|---|---|---|
| `expressive` | `motion` | Motion Agent | 动效与情绪反馈 |
| `conservative` | `product` | Product Agent | 产品结构与可用性 |
| `experimental` | `explorer` | Explorer Agent | 探索式构图与交互 |

`builderAgentFor(variant)` 是唯一的映射入口。persona 会进入三个地方：

- `prompts.ts:73` 的 Builder system prompt 和 `prompts.ts:126` 的 Draft Renderer system prompt（角色、mission 直接写进提示词）。
- `component.queued` 事件的 `agent` 字段（`types.ts:118`），候选卡片据此显示 Agent 身份。
- `CandidateArtifact.agent`（`types.ts:84`）。该字段是可选的，因为 v1 快照可能来自没有 persona 的旧会话。

### StateGraph 拓扑

```text
START
  └─ addConditionalEdges: state.jobs.map(job => new Send(AGENT_NODE[persona], { job }))
        ├─ motion_agent   ─┐
        ├─ product_agent  ─┼─ results reducer: (current, update) => current.concat(update)
        └─ explorer_agent ─┘
                             └─ END
```

- 状态定义在 `generation-graph.ts:19`：`jobs`（待分派任务）、`job`（单个节点收到的任务）、`results`（带 concat reducer 的扇入边界，`default: () => []`）。
- 三个节点共用同一个 `runAgentNode` 实现；差异完全来自被 `Send` 携带进来的 `job`，因此节点名称是可观测性和拓扑语义，而不是三份逻辑。
- 重试与失败降级在节点内部完成：`options.retries` 次重试后调用 `onFailed`，并返回 `{ results: [] }`，让其他 specialist 的成功结果照常扇入。
- 取消由 `graph.invoke` 的 `signal` 和节点内的 `options.signal.aborted` 双重处理。LangGraph 仍会从 `invoke` 抛出 AbortError，`session.ts` 的 `generateCandidates()` catch 分支把「用户主动 Stop」识别为正常终止路径而不是失败。
- 并发上限由 `maxConcurrency` 传给 `invoke`（`generation-graph.ts:72`）。注意它统计的是**图任务数**，不是 HTTP 请求数：每个候选任务会同时打开两条模型流（便宜的 draft + 完整的 builder）。因此 `session.ts` 用 `MAX_CONCURRENT_AGENT_JOBS = 3` 把真实并发请求压在 6 条以内，而不是直接透传 `HarnessOptions.concurrency`。

所有 specialist **同时开跑**，不再分波次。早期版本把生成划成两波（首波每槽位 1 个 variant，其余留到第二波），代价是第二波的候选卡会在界面上以 queued 状态静置整个首波时长——实测单个候选完整构建约 44 秒，三槽位页面里 slot 3 的卡要等到 88 秒后才开始动。用户看到的是一个卡住的产品，而不是一支正在工作的设计团队。所有 variant 在开跑前就已发出 `component.queued`，因此第一帧就能看到完整团队，并且它们随即真的都在跑。

对应回归测试：`test/harness.test.mjs` 的 `candidate generation exposes the full team and starts every specialist at once`，断言三个 specialist 在任何一个完成之前都已启动。

### 动态 import 与包体

LangGraph 通过 `session.ts` 中 `invokeAgentGraph` 内的 `await import('./generation-graph.ts')` 在用户选定视觉方向之后才加载，不进入首屏 bundle。本地 `vite build` 会把它拆成独立 chunk `generation-graph-*.js`，约 810 KB 原始 / 约 224 KB gzip；主 chunk 中不含 `StateGraph`。

### 持久化边界（已定案）

`HarnessSession` + IndexedDB 快照拥有全部可持久化状态；LangGraph 只负责一次性的扇出/扇入。

原因是 `ComponentAgentJob.run` 的类型就是 `() => Promise<T>`（`generation-graph.ts:8`），它是一个闭包，捕获了 `HarnessSession` 私有字段、`BrowserKimiClient` 和当前 `AbortSignal`。闭包不可序列化，因此图状态本身无法 checkpoint，也就不存在「恢复一张跑到一半的图」这种能力。

由此确定的规则：

- 断点续跑依赖 `HarnessSnapshot`（`types.ts:165`）与 `harnessStorage.save/load`，恢复入口是 `HarnessSession.restore(sessionId, options)`。
- **不使用 LangGraph 的 `interrupt()`**。人机确认（选择候选、确认视觉方向、补充要求）已经由 session 阶段机 + IndexedDB 表达；再引入 checkpointer 会出现两套互相冲突的持久化真相。当前 `app/src/` 中没有任何 `interrupt`、`checkpoint` 或 `MemorySaver` 引用。
- 图的输入必须是「已经准备好、可以立刻执行」的 job 列表；任何需要跨会话存活的信息都要先落到 session 状态里。

## iframe 选择桥

候选预览是 `sandbox="allow-scripts"` 的 iframe，父页面拿不到里面的点击。为了让「点一下候选就把它设为当前槽位」这件事成立，`sandbox-runtime.ts` 注入了一段极小的桥接脚本。

### 消息契约

```ts
type SandboxSelectionBridge = {
  slotId: string
  candidateId: string
  revisionId: string
}

type SandboxSelectionMessage = SandboxSelectionBridge & {
  source: 'wtpt-sandbox'
  token: string
  type: 'selection'
}
```

`createSandboxDocument(candidate, vars, token, selection)` 只有在传入第四个参数时才注入桥接脚本（`sandbox-runtime.ts:89`）。脚本本体是一个捕获阶段的 `pointerdown` 监听，向 `parent` `postMessage` 上面这个结构。

### 三重校验

`isSandboxSelectionMessage(event, sourceWindow, token, revisionId)`（`sandbox-runtime.ts:20`）在父页面侧做三件互相独立的检查，`GeneratedCandidatePreview.tsx:46` 在调用 `onSelect` 前必须先过这个函数：

1. **来源窗口**：`event.source` 必须严格等于当前 iframe 的 `contentWindow`，排除其他 iframe 和任意第三方窗口。
2. **token**：每次生成 srcDoc 都会新建一个 `crypto.randomUUID()` token，只有本次文档知道它。
3. **revisionId**：同样每次重建文档时新生成；用于丢弃「上一版文档在被替换途中发出的迟到消息」。

同时还会检查 `source === 'wtpt-sandbox'`、`type === 'selection'`，以及 `slotId` / `candidateId` 是字符串。校验通过后调用方拿到的是 `event.data` 里的 `slotId` 和 `candidateId`，`CanvasStage.tsx` 在 `<GeneratedCandidatePreview onSelect={...}>` 里用它调用 `setActiveSlot`。

### 约束：不能吃掉组件自己的交互

桥接脚本只监听、不干预：它不调用 `preventDefault`、`stopPropagation` 或 `stopImmediatePropagation`。生成组件里的按钮、输入框、拖拽必须继续正常工作，「选中这个候选」是顺带发生的副作用。`app/test/sandbox-runtime.test.mjs:59` 用一条断言把这个约束钉住。

监听器注册在捕获阶段（`addEventListener('pointerdown', ..., true)`），这样即使生成组件在自己的处理函数里停止冒泡，选择信号也不会丢。

## Runtime 边界

Harness 不直接执行 AI 代码。界面层需要提供：

```ts
type RuntimeAdapter = {
  compile(candidate: CandidateArtifact, signal: AbortSignal): Promise<CompileResult>
}
```

实际实现是 `SandboxRuntimeAdapter`（`app/src/lib/harness/sandbox-runtime.ts:161`）：用 `@babel/standalone` 在浏览器里转译 TSX，生成一份带 CSP 的 `srcdoc`，塞进离屏 `sandbox="allow-scripts"` iframe，等待 `type:'ready'` 或 `type:'error'` 的 postMessage，默认 15 秒超时。React 19、`react-dom`、`lucide-react` 和 `motion` 从 `https://esm.sh` 以 ESM 方式加载，Tailwind 从 `https://cdn.tailwindcss.com` 加载；沙箱内的 `require()` 只认这四个白名单包，其他一律抛错。当前不支持相对模块导入，转译前会显式拒绝。

Sandpack 与 WebContainers 都没有被采用，也不在 `app/package.json` 里，详见「与旧文档的差异」。未提供 adapter 时，Harness 会停在 `source.ready`，由界面编译后调用 `reportCompile`。

初次聊天结束后，补充要求可以调用 `session.revise(instruction)`；Harness 只修改已经选中的候选，并继续遵守原组件合同和文件边界。

## 基本用法

```ts
import { HarnessSession, loadKimiSettings } from '@/lib/harness'

const session = new HarnessSession('做一个活泼的 AI 工具落地页', {
  kimi: loadKimiSettings(),
  concurrency: 4,
  candidateCount: 3,
})

session.subscribe((envelope) => {
  // envelope.event 驱动业务状态
  // envelope.motionCue 驱动现有 playful 动画注册表
})

const plan = await session.start()
await session.chooseDirection(plan.visualDirections[0].id)
```

## 安全边界

- API Key 不写入项目文件，也不随导出 JSON 导出。
- AI 文件拒绝绝对路径、`..`、反斜杠和非白名单扩展名。
- 组件依赖只允许 `react`、`react-dom`、`lucide-react`、`motion`。
- AI 代码不得进入编辑器主 React 树，必须在隔离 Runtime 中运行。
- 正式选择前必须成功编译和渲染。
- Fixer 默认最多两轮，并且不能改变原候选的文件边界。

## 与旧文档的差异

以下条目是文档与已落地代码不一致的地方，记录在这里避免重复发现。状态为「已取代」的，以本节为准；状态为「已知偏差」的，规则仍然有效，是实现欠了债。

### 已取代：技术栈不是 Next.js

`product-plan.md` §9 写的是「React / Next.js」。实际是 Vite 7 + `react-router` 7（`app/package.json`：`"dev": "vite"`、`react-router ^7.6.1`，无 `next`），产物是可静态部署的 SPA，与「纯前端、静态可部署」的定位一致。

### 已取代：沙箱不是 Sandpack，也不是 WebContainers

`ai-generation-harness.md` §7 与 `product-plan.md` §9 把 Sandpack / WebContainers 列为候选沙箱方案。实际实现是手写的 CSP iframe（见上文「Runtime 边界」）：`@babel/standalone` 转译 + `esm.sh` ESM 依赖 + `cdn.tailwindcss.com`。`app/package.json` 与 `package-lock.json` 里都没有 `@codesandbox/sandpack-*` 或 `@webcontainer/api`。

这是一个取代性决策而不是待办：Sandpack / WebContainers 会引入远大于当前需求的包体和运行时假设，而候选组件的依赖面已经被白名单收窄到四个包，手写 iframe 足够，且能精确控制 CSP、超时、错误上报和选择桥。

### 已知偏差：`.dna-*` 语义类白名单尚未对生成组件生效

`design-decisions.md` 规定 AI 生成的组件必须使用 `.dna-*` 共享语义类，不得自行拼装表面样式。当前实现并不满足这条规则：

- `prompts.ts` 中的 Builder 与 Draft Renderer 提示词要求的是「使用内联样式或末尾 style 标签，绑定 `--dna-*` CSS 变量」（`prompts.ts:88`、`prompts.ts:92`、`prompts.ts:137`），完全没有提到 `.dna-card` 等语义类。
- `schemas.ts` 只校验文件路径、依赖白名单和 `entryFile` 归属，没有任何 class 合规检查。
- `.dna-*` 类只定义在 `app/src/index.css:337` 起，并且只被工具自身 UI（`CanvasStage.tsx`、`LeftPanel.tsx` 等）使用；沙箱 iframe 是独立文档，根本加载不到这些类。

规则本身没有被推翻——「放开审美，管住接口」仍然成立，只是收口层从语义类退到了 CSS 变量。

TODO：确定 `.dna-*` 语义层要不要覆盖沙箱内的生成组件。若要，需要同时改三处：把语义类注入 `createSandboxDocument` 的 `<style>`、在 Builder 提示词里改成强制使用、在 `schemas.ts` 里加校验。在此之前，`design-decisions.md` 的语义类表格只适用于工具自身 UI。

### 已定：每槽位 3 个候选，但必须先过蓝图闸门

`relume-openui-blueprint-research.md` 建议首轮每个槽位只生成 1 个候选，不自动补齐三个（该文 §3.2）。代码里两处说法也不一致：

- `types.ts:205` 的注释写「首屏推荐 1，后续按需补齐」。
- `store.ts` 实际用 `candidateCount: 3` 构造 `HarnessSession`；`session.ts` 的默认值同样是 3（`options.candidateCount ?? 3`）。

早期版本靠波次执行压首轮调用量，但后续 Agent 会静置数十秒。当前保留每槽位 3 个候选：三槽位页面 = 9 个候选 × 2 条流 = 最多 18 条模型流（受 `MAX_CONCURRENT_AGENT_JOBS` 限流，总量不变）。

成本控制由页面蓝图确认负责：Planner 完成后先展示槽位、输入、输出、依赖、候选数与预计模型流，用户确认后才进入 Visual DNA 选择。调度顺序按 specialist round 交错，确保每个槽位先获得 Motion 候选，再补 Product、Explorer，避免第一个槽位独占并发。


## 已补齐的高风险缺口

以下均已对照代码核实，写明核实方式，避免下一个人误判。

### 1. 运行时错误拦截

`sandbox-runtime.ts` 现在对 `ready/error` 使用来源窗口、token、revisionId 三重校验；编译探针在 `ready` 后继续观察挂载期错误。`GeneratedCandidatePreview.tsx` 会把实际使用期间的 runtime error 回传 Store，触发 Fixer。修复期间 Canvas 保留最后成功 artifact；修复失败时继续显示上一帧并明确标记不可导出。

### 2. 页面蓝图确认闸门

Store 增加 `blueprint` 产品阶段。`plan.completed` 只创建空槽位并展示确认页，不调用 Builder；用户点击 `confirmBlueprint()` 后才进入底板选择。页面展示槽位职责、输入、输出、依赖、候选数和最多模型流数。

蓝图页现在还会根据 Planner 结果在本地立即绘制整页低保真 wireframe，不增加模型调用：

- Dashboard 自动组合顶栏、侧栏、指标、图表、列表等空间关系。
- Landing Page 自动组合导航、Hero、特性区和 CTA。
- 远程 Planner 产生的 freeform 页面会根据槽位职责推断 Dashboard / Landing；无法归类时按 fixed / fluid 宽度绘制自由布局。
- 原子组件会绘制为一个完整交互区域，不再只显示合同文字。
- 点击 wireframe 区块会同步聚焦对应组件合同，方便在确认前检查职责、输入和输出。
- 蓝图页会从 outputs/inputs 名称中推断高置信度数据流，用洋红输出端口、蓝色输入端口和关联胶囊表达组件关系；旧计划没有接口时退化为紫色“共享页面上下文”关系，不伪造具体事件名。
- Planner 提示词要求多槽位页面至少提供一条语义词根一致的 output → input 链，并把城市、单位、主题、筛选或时间范围声明为同名共享 inputs。
- 成本卡区分“首轮每槽位一个主推候选”和“完整补齐上限”，避免把分批总量误读为首屏并发量。
- 蓝图阶段收起底部 Composer，并把确认条固定在可见区域；对话历史仍由 ChatDock 保留。

这层 wireframe 完全由 `Scenario / SlotDef` 绘制，不执行生成代码，也不进入 iframe。真实浏览器验证中，多槽位 SaaS 看板在 Planner 完成后立即显示“指标卡 → 趋势图 → 订单列表”整页框架；确认前 Builder 调用数仍为 0。

### 3. 重复候选由用户决定是否重做

`#reportDuplicateCandidates()` 检测到近似重复后，候选卡展示相似度与「换一个」。只有用户点击后才调用 `rerollCandidate()`；候选保持原 id 和 rail 位置，只替换 attempt/artifact，不自动产生额外费用。

## 本轮已生效的行为变更

均已在代码中核实，附核实位置。

- **specialist 公平交错并发**：按 Motion round → Product round → Explorer round 排队，同一 round 跨槽位交错；`MAX_CONCURRENT_AGENT_JOBS = 3` 对应最多 6 条模型流。
- **draft / builder 预览不再互相覆盖**：两条流曾共用一个 `publishedPreviewLength` 计数器，导致两份不同文档交替写进同一个预览，画面在两套布局间跳。现在分源计数，且 builder 一旦出图就永久接管（`session.ts` 的 `builderOwnsPreview`）。回归测试：`a slow draft cannot overwrite the builder preview it lost the race to`。
- **`runId` / `attemptId` 陈旧防护**：被取代的生成批次和被替换的候选尝试不得再发事件或改状态。
- **事件历史压缩**：`HarnessEventStream` 只保留每个候选最新一条 `preview.updated`，`source.ready` 后丢弃；`code.delta` 载荷清空（完整内容已随 artifact 保存）。实测 490 条发布 → 10 条保留。**注意**：顺序号改为基于「已恢复的最大 sequence」而非数组长度——压缩后条目数少于已发号数，用长度会重复发号。
- **IndexedDB 写合并**：`harnessStorage.save` 对同一 session 的密集写入做防抖合并，最后一次快照获胜，且每个 `save()` 的 promise 都会兑现。
- **`harnessError` 结构化**：由 `string` 改为 `{kind, surface, message, detail?, retryable}`。渲染时用 `.message`，`detail` 仅供调试，不要直接展示给用户。
