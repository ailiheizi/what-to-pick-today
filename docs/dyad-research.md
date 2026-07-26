# Dyad 源码研究与 Harness 改进建议

## 研究范围

本报告对照研究 [Dyad](https://github.com/dyad-sh/dyad) 与当前项目的 `settings`、local proxy、`HarnessSession`、storage、export 和 LangGraph Multi-Agent Harness 实现。

研究基线：Dyad commit [`dfc102722c8976f0368844f7dac8d04cff6d6b35`](https://github.com/dyad-sh/dyad/tree/dfc102722c8976f0368844f7dac8d04cff6d6b35)，提交时间 2026-07-25。

重点问题：

1. 本地优先和 BYOK onboarding。
2. 多模型、多供应商适配层。
3. 生成失败、编译失败和自动修复流程。
4. 文件版本、checkpoint、恢复与导出。
5. 生成任务状态、日志和用户可见反馈。
6. 如何保持纯前端开源，同时提供安全的本地开发代理。
7. 可直接用于当前 LangGraph Multi-Agent Harness 的机制。
8. 依赖 Electron、服务端或非 Apache 许可，不适合照搬的机制。

## 总体结论

当前项目的“纯前端 + BYOK + 浏览器沙箱 + IndexedDB”方向是正确的，不应为了模仿 Dyad 引入 Electron 或常驻服务端。

最值得借鉴的并不是 Dyad 的桌面基础设施，而是以下机制：

- provider、model、credential 和实际 client factory 分离；
- 显式异步状态机和稳定的 operation/invocation ID；
- 拒绝迟到事件，避免旧请求污染新任务；
- 对 transport、provider、schema、compile、runtime 错误分类处理；
- 不破坏旧历史的 checkpoint/restore 语义；
- 用户可见的任务进度、诊断、diff 和恢复入口；
- 用户先提交需求，完成 provider 配置后继续原请求。

当前项目已经具备良好基础：

- API Key 默认只保存在 `sessionStorage`，持久化需要用户主动选择：[`app/src/lib/harness/settings.ts`](../app/src/lib/harness/settings.ts)。
- Vite-only 本地代理不会进入生产 bundle：[`app/vite.config.ts`](../app/vite.config.ts)。
- `HarnessSession` 已包含 Planner、Builders、编译、Fixer、选择、Revision 和 Reviewer：[`app/src/lib/harness/session.ts`](../app/src/lib/harness/session.ts)。
- 生成事件已有顺序号和回放能力：[`app/src/lib/harness/events.ts`](../app/src/lib/harness/events.ts)。
- AI 生成代码在无同源权限的 iframe 中运行：[`app/src/lib/harness/sandbox-runtime.ts`](../app/src/lib/harness/sandbox-runtime.ts)。
- 导出前会验证选择完整性、运行状态、路径和依赖：[`app/src/lib/harness/export.ts`](../app/src/lib/harness/export.ts)。

主要缺口是：

1. `HarnessSession` 是一个可变对象，而不是可持久恢复的显式操作状态机。
2. storage 只覆盖保存最新 snapshot，不是真正的 checkpoint/version history。
3. provider 层本质上仍是单一 OpenAI Chat Completions 客户端更换 Base URL。
4. 高频流事件、业务事件和完整代码都进入 snapshot，长期运行会放大 IndexedDB 占用。

## 1. 本地优先与 BYOK onboarding

### Dyad 的机制

Dyad 允许用户先提交 prompt。如果尚未配置供应商，它会保存用户意图、打开 provider setup，并在配置成功后继续原请求，而不是要求用户重新输入。

相关实现：

- [`SetupBanner.tsx`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/components/SetupBanner.tsx)
- [`FirstPromptProvider.tsx`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/first_prompt/FirstPromptProvider.tsx)
- [`ProviderSettingsPage.tsx`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/components/settings/ProviderSettingsPage.tsx)

保存部分 provider Key 前，Dyad 会发送一个小型验证请求，并区分认证失败、限流、超时和外部错误。无法验证时，用户仍可选择保存 Key。

### 当前项目的问题

当前 `submitPrompt()` 根据 API 是否配置，隐式决定进入真实 Harness 或 demo 模式。用户本来希望真实生成时，可能在没有明确提示的情况下看到 demo 结果。

浏览器持久化 Key 也有天然限制：`localStorage` 中的 Key 不能抵御同源 XSS、恶意扩展或同一系统账户下的浏览器数据读取。

### 建议

- 明确区分“体验 Demo”和“真实生成”，不要仅依赖是否存在 Key。
- 用户请求真实生成但未配置时，将 prompt 和附件引用保存为短期 pending intent。
- provider 配置成功后自动恢复该 intent。
- 增加连接测试，并区分：
  - API Key 被拒绝；
  - CORS 或网络不可达；
  - 限流；
  - 模型不存在；
  - 超时；
  - provider 返回格式不兼容。
- 允许“无法验证但仍保存”，避免代理或供应商临时故障阻塞用户。
- 默认保持 session-only。需要长期保存时，优先推荐本地代理从 `.env` 注入 Key。
- UI 应明确说明“记住 Key”是便利选项，不等价于操作系统安全存储。

优先级：**P1**。

## 2. 多模型、多供应商适配层

### Dyad 的机制

Dyad 将以下概念分别建模：

- Provider registry；
- Model catalog；
- 用户凭据；
- 模型别名及用途；
- provider-specific client factory。

它支持 OpenAI、Anthropic、Google、Vertex、Azure、OpenRouter、Ollama、LM Studio、Bedrock 和 Custom OpenAI-compatible provider，并针对不同供应商处理协议、认证、模型参数及错误。

相关实现：

- [`language_model_helpers.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/ipc/shared/language_model_helpers.ts)
- [`get_model_client.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/ipc/utils/get_model_client.ts)
- [`remote_language_model_catalog.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/ipc/shared/remote_language_model_catalog.ts)

### 当前项目的问题

当前 `KimiSettings` 只有一套 `baseUrl + apiKey`，Planner 与 Builder 只能更换模型名。`BrowserKimiClient` 仅完整支持 OpenAI Chat Completions SSE；provider-specific 数据行会被忽略，最终可能表现为空响应或难以诊断的 JSON 错误。

### 建议的数据边界

```ts
type ModelRef = {
  providerId: string
  modelId: string
}

type HarnessModelRouting = {
  planner: ModelRef
  builder: ModelRef
  fixer: ModelRef
  reviewer: ModelRef
  draft?: ModelRef
}

interface ModelAdapter {
  streamJson(request: ModelRequest): AsyncIterable<ModelStreamEvent>
  validateConnection(model: ModelRef): Promise<ConnectionResult>
}
```

Provider profile 至少应描述：

- `protocol`：`openai-chat`、`openai-responses`、`anthropic-messages` 等；
- `baseUrl`；
- `credentialMode`：browser key、local proxy、none/local model；
- structured output、streaming、vision、temperature 等 capability；
- 默认安全 header；
- provider 错误正规化函数。

推荐实施顺序：

1. 将现有 OpenAI-compatible 客户端封装为真正的 adapter。
2. 支持多个 provider profile，以及按 Agent 角色选择模型。
3. 再添加 Anthropic/Google 原生 adapter。
4. 使用内置静态 catalog 作为可信 fallback。
5. 可选加载 schema 校验后的远程静态 catalog，但不能让它成为启动必需条件。

### 风险

- 隐式 fallback 可能重复计费。
- 不同模型对 structured output、temperature、max tokens 的要求不同。
- 跨供应商 retry 必须向用户显示实际使用的模型和失败原因。
- 远程 catalog 是供应链入口，只能描述 provider/model 元数据，不能下发脚本或任意 header。

优先级：**P0**。

## 3. 生成失败、编译失败与修复

### Dyad 的机制

Dyad 已移除全局自动修复 Problems 的旧设置。普通模式下，用户在 Problems 面板选择 TypeScript 问题后显式触发 Fix；Agent 模式则让 Agent 自己运行类型检查。

相关实现：

- [`Problems.tsx`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/components/preview_panel/Problems.tsx)
- [`problem_prompt.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/shared/problem_prompt.ts)

这比对所有失败进行无限自动修复更透明，也更容易控制费用和回归风险。

### 当前项目的问题

当前 Harness 已有最多两轮 Fixer，但 `TaskScheduler` 和 LangGraph node 会对所有异常使用同一重试策略。认证失败、schema 错误、非法文件和编译错误不应与网络 5xx 使用相同 retry。

### 建议错误分类

- `transport_failed`
- `provider_auth_failed`
- `rate_limited`
- `model_refused`
- `invalid_structured_output`
- `unsafe_artifact_rejected`
- `compile_failed`
- `runtime_failed`
- `repair_exhausted`
- `cancelled`
- `interrupted`

### 建议流程

- 只自动重试网络中断、429 和部分 5xx 等瞬时错误。
- schema、路径越界和编译错误进入专用处理流程。
- 编译失败可自动进入最多 1–2 轮 Fixer。
- Fixer 耗尽后保留完整诊断，允许用户选择问题后手动触发修复。
- 每次 Repair/Revision 前创建 checkpoint。
- 修复结果先写入临时 candidate revision；编译成功后再原子替换当前版本。
- 诊断使用结构化对象传递：文件、行列、错误码、代码片段和阶段。
- 每次调用携带稳定的 `operationId + attempt`，避免恢复或竞态导致重复生成和重复计费。

优先级：**P0**。

## 4. 文件版本、checkpoint、恢复与导出

### Dyad 的机制

Dyad 的版本系统建立在本地 Git 上：

- 成功生成关联 commit hash；
- 支持历史预览、diff、收藏和备注；
- Restore 不改写旧历史，而是在当前分支创建新的 revert commit；
- 恢复前若存在生成中断留下的 dirty tree，会先保存 checkpoint commit；
- 代码恢复与数据库恢复分别执行，并显示部分恢复警告。

相关实现：[`version_handlers.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/ipc/handlers/version_handlers.ts)。

### 当前项目的问题

当前 IndexedDB 对每个 session 只保存一条不断覆盖的 snapshot。`HarnessSession.restore()` 已存在，但界面没有历史或恢复入口，也不能真正恢复页面刷新前仍在运行的 fetch、compile 或 repair。

完整 candidate 文件与 `code.delta` 历史同时存储，存在大量内容重复。

### 建议存储结构

- `sessions`：当前 head、摘要和 schema version；
- `checkpoints`：不可变状态节点；
- `artifacts`：按内容 hash 去重的文件 blob；
- `events`：低频语义事件；
- `operations`：未完成、已完成任务和 retry 信息。

### Checkpoint 时机

- Planner 完成；
- 选择 Visual Direction；
- candidate source ready；
- candidate compile success；
- Repair/Revision 前后；
- selection commit/undo；
- review 完成；
- export 前。

### 恢复语义

- 恢复旧 checkpoint 时创建新的 head，不删除旧历史。
- 页面重载后，将 `planning/generating/compiling/repairing` 归一为 `interrupted`。
- 用户选择“继续未完成任务”或“只恢复已完成产物”。
- checkpoint 保存 `parentId`、原因、时间、模型路由、artifact hashes 和摘要。
- 不应把旧 snapshot 中的 `generating` 状态当作仍在运行。

### 导出

当前 `.wtpt.json` 适合作为无损内部项目包，但普通用户还需要可直接解压运行的 ZIP。

建议：

- 保留 JSON，用于重新导入和灾难恢复；
- 增加纯浏览器 ZIP 导出；
- manifest 记录生成器版本、checkpointId、provider/model、依赖版本和文件 hash；
- 排除 Key、完整请求日志和代理配置；
- ZIP 前执行与导出脚手架一致的静态验证；
- 不应把 iframe 中单入口 Babel 编译成功等同于多文件 Vite 工程构建成功。

优先级：最小 checkpoint 为 **P0**；历史 UI 和 ZIP 为 **P1/P2**。

## 5. 任务状态、日志和用户反馈

### Dyad 的机制

Dyad Chat Stream 使用显式状态机：

```text
idle → starting → streaming → finalizing → idle
                    ↓
                cancelling / errored
```

每次调用带 `invocationRef`。另一个 invocation 的迟到事件不会推进当前状态；并发提交进入队列而不是被丢弃。

相关实现：

- [`chat_stream/state.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/chat_stream/state.ts)
- [`chat_stream/transition.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/chat_stream/transition.ts)
- [`chat_stream/controller.ts`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/src/chat_stream/controller.ts)

Dyad 还把高频 streaming preview 放入独立 sidecar store，而不是让主状态机 snapshot 随每个 chunk 膨胀。

### 建议任务状态

```ts
type OperationStatus =
  | 'queued'
  | 'starting'
  | 'streaming'
  | 'validating'
  | 'compiling'
  | 'repairing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
```

每条 operation 建议记录：

- `operationId`、`sessionId`、`candidateId`；
- Agent、provider、model；
- 当前阶段和 attempt；
- started/updated/finished 时间；
- 用户可读摘要；
- 结构化错误；
- 可安全显示的 provider request ID 和 token usage；
- retry、cancel、fix actions。

### UI 和存储建议

- 为每个 candidate 展示独立任务状态，而不是只使用全局 `harnessError`。
- 将高频 preview/code delta 放在非持久 sidecar。
- IndexedDB 只保存 `source.ready`、`compile.failed`、`repair.completed` 等语义事件。
- 任务面板应能展开查看诊断、重试次数、实际模型和耗时。
- 日志不得包含 Authorization、API Key、完整 header 或敏感环境变量。

优先级：**P0/P1**。

## 6. 保持纯前端开源并提供安全本地代理

### 当前实现的优点

- 代理只存在于 Vite dev server；
- Key 从工作区 `.env` 读取，不进入生产 bundle；
- 浏览器只调用同源 `/api/model`；
- 跨站 Origin 会返回 403。

### 当前风险

- `Origin` 缺失时当前直接允许请求；
- 没有限制 HTTP method；
- `/api/model` 后的任意路径都可以转发；
- 没有 body 大小、并发数、速率和超时限制；
- 没有显式移除 Cookie、Forwarded、Proxy-Authorization 等 header；
- 本机其他进程仍可能调用代理消耗 `.env` Key；
- 缺少客户端断开后对上游流的中止；
- 缺少统一、脱敏的代理错误和日志格式。

### 建议代理契约

- 强制绑定 `127.0.0.1`/`::1`，禁止监听 `0.0.0.0`。
- 浏览器请求必须同源；默认拒绝无 Origin 请求，通过显式 CLI flag 才允许本地工具调用。
- 只允许 `POST /api/model/chat/completions`；需要时显式增加 `/responses` 和 `/models`。
- 限制 JSON body 大小、并发和单请求超时。
- 上游 Key 存在时，先删除客户端 Authorization，再注入上游 Key。
- 删除 Cookie、Proxy-Authorization、Forwarded 等不需要的 header。
- 客户端断开时中止上游请求。
- 日志只记录状态、耗时和随机 request ID，不记录 body 或 credential。
- dev server 启动时生成短期 nonce，代理要求页面请求携带该 header，以降低本机其他进程的随意滥用。

该代理应继续是可选开发工具，而不是生产运行依赖。静态部署仍然直接使用浏览器 BYOK 或由部署者自行提供兼容代理。

优先级：**P0**。

## 7. 可直接用于 LangGraph Multi-Agent Harness 的机制

推荐直接采用：

- `InvocationRef`/operation ID 和 stale-event guard；
- pure transition、command adapter、controller 分层；
- 显式处理所有 state × event；
- 并发请求入队而不是丢弃；
- 高频 streaming sidecar 与持久状态分离；
- provider/model 使用稳定引用；
- provider onboarding 后恢复 first prompt；
- 生成和修复前后的不可变 checkpoint；
- 根据错误分类决定 retry、fix、停止或请求用户确认；
- 用户选择诊断后启动 Fix Agent；
- 模型 catalog 使用静态 fallback 和可选远程更新。

### LangGraph 当前的恢复障碍

当前 `ComponentAgentJob` 包含不可序列化的 `run()` closure，因此不能真正通过 LangGraph checkpointer 恢复。

建议改为纯 job descriptor：

```ts
type ComponentAgentJob = {
  jobId: string
  componentId: string
  variant: CandidateVariant
  inputCheckpointId: string
  attempt: number
}
```

Graph node 再通过注入的 adapter 执行实际请求。这样才能：

- 将 graph state 保存到 IndexedDB；
- 页面刷新后识别未完成 node；
- 按 `jobId` 去重；
- 避免恢复时重复生成和重复计费；
- 对不同 Agent/provider 使用不同 retry 策略。

## 8. 不适合照搬的机制

以下能力依赖 Electron、操作系统、本地进程或服务端：

- Electron `safeStorage` 和系统 Keychain；
- Electron main/renderer IPC；
- 本地文件系统原子写入和 `.bak` 恢复；
- Native Git、checkout、commit、revert 和 dirty-tree 检查；
- SQLite/Drizzle 元数据；
- 启动 Node/Vite/npm/tsc 子进程；
- 本地 Ollama/LM Studio 发现；
- Neon 数据库分支和时间点恢复；
- Dyad Engine、配额、远程 gateway 和 Pro 服务；
- 本地 Agent 的文件、终端和测试工具。

### 许可风险

Dyad 仓库中 `src/pro` 使用 Functional Source License 1.1，而不是 Apache 2.0。Local Agent 的大量工具实现位于该目录，不能直接复制进当前开源项目。

可以借鉴其状态机、操作 ID、工具结果和用户反馈设计，但相关代码应独立实现。

许可说明：[`README.md`](https://github.com/dyad-sh/dyad/blob/dfc102722c8976f0368844f7dac8d04cff6d6b35/README.md#L31-L34)。

## 风险清单

| 风险 | 当前表现 | 缓解措施 |
|---|---|---|
| 浏览器持久 Key 泄漏 | `localStorage` 明文保存 | 默认 session-only，长期 Key 推荐本地代理 |
| provider 假兼容 | 只适配 OpenAI Chat Completions SSE | ModelAdapter + capability + 错误正规化 |
| 重试造成重复费用 | 所有异常使用相似 retry | 按错误类型重试，记录 operationId/attempt |
| 迟到事件污染新任务 | session 内缺少稳定 invocation guard | operation/invocation ID + stale-event reject |
| 刷新后状态失真 | snapshot 可能仍是 generating | 启动时归一为 interrupted |
| IndexedDB 快速膨胀 | 文件内容与 code delta 重复存储 | artifact hash 去重，高频 sidecar 不持久化 |
| Fixer 回归 | 自动替换修复结果 | 临时 revision 编译成功后原子替换 |
| 本地代理被滥用 | 无 Origin 请求被允许 | loopback、nonce、method/path/body 限制 |
| 远程 catalog 供应链 | 远程元数据改变模型路由 | 内置 fallback、schema 校验、禁止下发代码/header |
| 许可污染 | 复制 `src/pro` FSL 代码 | 只借鉴机制，独立实现 |

## 优先级建议

| 优先级 | 改进 |
|---|---|
| P0 | Provider-neutral `ModelRef + ModelAdapter` |
| P0 | 错误分类和按错误类型 retry |
| P0 | 所有 job 增加 operationId/invocationRef 和 stale-event guard |
| P0 | 最小不可变 checkpoint，刷新后将运行中任务标记为 interrupted |
| P0 | 加固 Vite 本地代理的方法、路径、Origin、header、超时和日志 |
| P1 | 保存 first prompt，完成 BYOK onboarding 后自动恢复 |
| P1 | 独立任务面板：阶段、模型、attempt、错误、Retry/Fix/Cancel |
| P1 | Repair/Revision 编译成功后原子替换 |
| P1 | storage schema migration、artifact hash 去重和容量清理 |
| P2 | 按 Planner/Builder/Fixer/Reviewer 分别选择供应商和模型 |
| P2 | ZIP 导出、manifest、hash 和重新导入 |
| P2 | checkpoint 时间线、diff、收藏和备注 |
| P2 | 可选远程模型 catalog，始终保留内置 fallback |

推荐实施顺序：

```text
Provider adapter
→ Operation state / invocation ID
→ Error taxonomy
→ Durable checkpoint
→ Onboarding 与任务 UI
→ ZIP 与版本浏览
```

该顺序能保留当前纯前端、静态可部署和 BYOK 的优势，同时将 Dyad 已验证的可靠性机制逐步移植到 LangGraph Harness，避免引入 Electron、闭源服务或不兼容许可代码。
