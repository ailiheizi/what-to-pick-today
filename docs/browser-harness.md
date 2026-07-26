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
- `kimi.ts`：浏览器端兼容 SSE 客户端和 JSON 聚合（保留旧文件名以避免破坏现有导入）。
- `scheduler.ts`：限制并发、取消、重试和失败降级。
- `events.ts`：统一事件、顺序号、重放和稳定的随机 `motionCue`。
- `schemas.ts`：Structured Output 校验、依赖白名单和文件路径安全检查。
- `storage.ts`：IndexedDB 项目快照和事件历史。
- `settings.ts`：BYOK 设置。Key 默认只放 `sessionStorage`；用户明确选择记住时才进入 `localStorage`。
- `prompts.ts`：Planner、Builder、Fixer、Reviewer 的角色提示词。

## Runtime 边界

Harness 不直接执行 AI 代码。界面层需要提供：

```ts
type RuntimeAdapter = {
  compile(candidate: CandidateArtifact, signal: AbortSignal): Promise<CompileResult>
}
```

后续可以实现 Sandpack 或严格 CSP iframe adapter，而无需改变 Planner、调度、历史和选择逻辑。未提供 adapter 时，Harness 会停在 `source.ready`，由界面编译后调用 `reportCompile`。

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
