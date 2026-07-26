# 今天选什么？

## 1. 产品定义

“今天选什么？”是一个选择驱动、AI 原生的 UI 生成与组合工具。

用户不需要从空白画布开始，也不需要准确描述最终视觉。AI 根据聊天需求拆分页面，生成多个可拼接的组件候选；用户像挑衣服一样选择喜欢的版本，系统像拼积木一样把它们实时组合成完整界面。

> AI 负责创造可能性，人负责挑选。

项目不提供大型预制组件库。项目提供的是 AI Harness、组件协议、并发任务调度、浏览器运行沙箱、实时渲染、分支历史和挑选体验。

## 2. 核心流程

```text
用户描述需求
→ AI 拆分页面和组件
→ AI 生成多个视觉方向
→ 用户选择底板或视觉方向
→ 多个组件任务并发生成
→ 完成一个组件就实时渲染一个
→ 每个组件提供多个候选
→ 用户逐个挑选并拼入页面
→ AI 检查最终组合并局部修复
→ 导出项目
```

用户每次看到的候选都应包含当前底板和已选择内容，而不是孤立组件。选择完成后，系统基于新的完整结果继续生成下一轮候选。

## 3. 界面结构

- 左侧：项目、聊天、页面、设计分支和历史版本
- 中间：实时运行的完整 UI 画布
- 右侧：当前步骤或当前槽位的 AI 候选
- 底部浮层：聊天输入、停止生成、重新生成和补充要求

中间画布是产品的唯一真实结果。聊天只负责表达意图和修改方向。

## 4. 渐进式生成

每个组件独立经历以下状态：

```text
planned
→ files_created
→ code_streaming
→ compiling
→ rendered
→ visually_checked
→ ready
```

后台或本地 Harness 并发运行多个 Kimi 请求，任何组件先完成，就先显示在画布和候选区中，不等待整页生成结束。

流式代码不应每收到几个字符就编译。建议在完整代码块、文件完成标记或 300～800ms 防抖后尝试编译；编译失败时保留上一次成功画面，并把错误交给修复任务。

## 5. AI 角色

第一版只保留三个核心角色：

1. Planner：理解需求，拆分页面、组件、槽位和依赖。
2. Component Builders：并发生成每个组件的多个候选。
3. Reviewer / Fixer：根据编译错误和最终截图进行局部修复。

视觉方向可以先由 Planner 一并生成。后续再独立成 Visual Director。

所有角色可以使用 Kimi，不需要为了多模型而增加复杂度。角色差异来自 System Prompt、输入上下文、输出 Schema 和可调用工具。

## 6. AI 自由发展的视觉规则

项目不强制固定设计系统。AI 根据用户需求生成项目级 `VisualDNA`：

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

Visual DNA 用于给并发生成的组件共享方向，但不限制组件内部表现。

项目可以提供少量视觉种子，它们只是 Prompt Seed，不是预制主题：

- 自由生长
- 现代 SaaS
- 温暖友好
- 深色工具
- 编辑杂志
- 大胆实验

原则是：

> 放开审美，管住接口。

## 7. 组件拼合协议

AI 可以自由生成视觉和内部代码，但组件外部合同必须严格：

```ts
type ComponentContract = {
  id: string
  role: string
  slot: string
  width: "fixed" | "fluid"
  inputs: PropDefinition[]
  outputs: EventDefinition[]
  dependencies: string[]
  designTokens: string[]
}
```

严格控制：

- 组件 ID
- Props 输入
- 事件输出
- 页面槽位
- 文件格式
- 允许依赖
- 运行权限
- 响应式边界

开放部分：

- 视觉语言
- 内部布局
- 动画表达
- 内容呈现
- 组件变体

## 8. 开源与运行模式

项目采用 BYOK，由使用者在界面中提供自己的 Kimi API Key，项目维护者不承担模型费用。

默认采用纯前端静态运行：

```text
浏览器
→ Browser Generation Harness
→ Kimi API
```

API Key 默认只保存在 `sessionStorage`，用户明确选择记住时才保存在 `localStorage`；Key 不进入项目导出。项目不要求登录、云数据库、付费系统或托管 Serverless。若供应商 CORS 不可用，用户可以自行配置兼容 Proxy URL。

项目数据、设计分支和设置优先保存在 IndexedDB，也可以导出为 JSON。

## 9. 技术方向

- React / Next.js
- TypeScript
- Tailwind CSS
- Zustand
- Motion
- IndexedDB
- SSE
- Sandpack、WebContainers 或 iframe 沙箱
- 浏览器内 TypeScript / JSX 编译
- Kimi API

AI 生成代码必须运行在隔离环境中。禁止直接在编辑器主页面执行任意生成代码。

第一版建议限制：

- React + TypeScript + Tailwind
- 固定依赖白名单
- 禁止任意 Node API
- 禁止未授权网络请求
- 禁止运行任意安装脚本

## 10. 声音和动画

- 候选越过中心选择线：轻微 `tick`
- 候选吸附：清晰 `click`
- 确认组件：积木扣合或磁吸声
- 撤销：柔和反向声音
- 页面完成：短促完成音

声音按候选索引变化触发，不按滚动像素触发，并提供静音选项。

动画用于解释变化：

- 组件完成：局部淡入
- 组件替换：形变或交叉淡入
- 插入区块：撑开空间后滑入
- 删除区块：收缩并重新排列
- 视觉 DNA 改变：颜色、圆角和间距平滑变化

## 11. MVP

第一版验证以下闭环：

```text
输入产品需求
→ Kimi 拆成 3～6 个组件
→ 生成 3 个视觉方向
→ 用户选择底板
→ 组件并发生成
→ 完成一个渲染一个
→ 用户为每个组件选择候选
→ 页面实时拼完整
→ Kimi 根据截图检查和修复
```

第一版暂不做：

- 多模型统一适配
- 多人协作
- 云端账号和同步
- 组件市场
- Figma 双向同步
- 多框架导出
- 任意第三方依赖

## 12. 命名

中文品牌：

> 今天选什么？

副标题：

> AI 负责生成，人负责挑选。

或者：

> 像挑衣服一样，拼出你的 UI。

英文口号：

> What will you pick today?

项目和仓库名：

```text
what-to-pick-today
```
