# Onlook 架构研究与当前项目改造建议

> 研究日期：2026-07-26
> Onlook 仓库：<https://github.com/onlook-dev/onlook>
> 研究基线：[`423e2e924366419e418ee049093872d535eea41a`](https://github.com/onlook-dev/onlook/tree/423e2e924366419e418ee049093872d535eea41a)（2026-07-21）

## 1. 结论摘要

Onlook 最值得当前项目借鉴的不是 CodeSandbox、Git 或完整 AST 编辑器，而是以下设计原则：

1. 使用稳定的领域身份关联画布、状态和源码。
2. 将临时预览和正式提交严格分开。
3. 使用类型化 Action 同时驱动画布、源码和历史。
4. 连续交互使用事务压缩，结束时只生成一个历史节点。
5. Branch 隔离完整工作上下文，Checkpoint 对应可恢复的语义操作。
6. 恢复旧版本前先保存当前状态，避免破坏性回退。

当前项目应将这些思想压缩成纯前端实现：

```text
稳定身份
+ Selection Context
+ Typed Action
+ Draft Transaction
+ 轻量 Branch / Checkpoint DAG
- Sandbox / Git / 全仓 AST / 双向文件同步
```

当前 `tryOnId` 与 `selectedId` 的区分已经是正确基础：试穿是临时态，扣合和替换才是提交态。下一步的重点是补齐真正的版本模型、源码定位、局部编辑和结构/视觉正交模型。

## 2. Onlook 的画布元素如何对应源码

### 2.1 三层身份模型

Onlook 不依赖坐标、DOM 路径或 React Fiber 反查源码，而是维护三层身份：

| 身份 | 作用 | 生命周期 |
|---|---|---|
| `data-oid` | JSX 源码节点的稳定 ID | 跨写文件、HMR 和重新渲染稳定 |
| `data-oiid` / `instanceId` | 组件调用实例 ID | 区分组件定义和具体使用位置 |
| `data-odid` / `domId` | 当前运行时 DOM 节点 ID | iframe 当前渲染周期内有效 |

完整映射链路为：

```text
JSX data-oid
→ iframe 实际 DOM data-odid
→ LayerNode / DomElement
→ oid 查询 CodeFileSystem 索引
→ 文件路径、源码范围、组件名和代码片段
```

关键实现：

- [`packages/parser/src/ids.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/packages/parser/src/ids.ts#L127-L179)：为 JSX opening element 注入或修复 `data-oid`。
- [`packages/file-system/src/code-fs.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/packages/file-system/src/code-fs.ts#L46-L136)：写 JSX 文件时解析 AST、补 OID、格式化并更新源码索引。
- [`packages/models/src/element/templateNode.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/packages/models/src/element/templateNode.ts)：定义文件路径、组件、开始/结束标签位置等元数据。
- [`apps/web/client/src/components/store/editor/ast/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/ast/index.ts#L64-L187)：关联 DOM 节点、组件定义和组件调用实例。
- [`apps/web/client/src/components/store/editor/ide/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/ide/index.ts#L16-L57)：根据 OID 得到文件和源码范围并切换代码模式。

### 2.2 对当前项目的简化映射

当前项目控制自己的槽位、候选和生成 artifact，不需要修改所有 JSX。建议使用以下身份：

```ts
type SourceBinding = {
  nodeId: string
  componentId: string
  filePath: string
  exportName?: string
  startLine?: number
  endLine?: number
}

type CandidateRevision = {
  id: string
  candidateId: string
  previousRevisionId?: string
  batchId: string
  artifactRef: string
  sourceIndex: SourceBinding[]
}
```

建议语义：

- `slotId`：稳定结构身份，相当于 Onlook 的 `oid`。
- `candidateId`：候选设计身份。
- `revisionId`：候选某次不可变源码版本。
- `nodeId`：候选内部可编辑节点。
- iframe 或 DOM ref：只作为短命运行时引用，不能作为 history/branch 主键。

## 3. 点击画布后如何进入局部编辑

### 3.1 Onlook 的点击链路

Onlook 在 iframe 上方覆盖透明的 `GestureScreen`：

1. 捕获父画布鼠标事件。
2. 将画布坐标换算为 iframe 坐标。
3. 通过 Penpal RPC 调用 iframe 内的 `getElementAtLoc()`。
4. preload script 使用 `document.elementFromPoint()` 命中元素。
5. 返回 `domId`、`oid`、`instanceId`、`rect` 和 styles。
6. 单击更新 Selection 和 Overlay。
7. 样式面板根据 Selection 进入局部编辑上下文。

关键文件：

- [`canvas/frame/gesture.tsx`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/app/project/%5Bid%5D/_components/canvas/frame/gesture.tsx#L31-L87)
- [`element/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/element/index.ts#L29-L87)
- [`style/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/style/index.ts#L91-L145)

Onlook 当前双击画布元素会查看代码，而不是直接编辑文字。文本编辑由选中后按 Enter 或右键菜单触发。

### 3.2 文本编辑的事务模型

文本输入时，Onlook 不会为每个按键写一次源码：

```text
开始编辑
→ history.startTransaction()
→ iframe DOM 即时显示输入结果
→ transaction 内合并重复 edit-text action
→ 结束编辑
→ commitTransaction()
→ 一次性写回 JSX
```

关键实现：

- [`text/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/text/index.ts#L24-L71)
- [`history/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/history/index.ts#L49-L84)

这套事务语义应直接借鉴到试穿流程：

- 滚动 CandidateRail、hover 和快速试穿只更新 draft。
- 用户停止交互或点击扣合时才生成正式 Action。
- 连续输入、拖动和滑块修改应 debounce/coalesce 成一个 Checkpoint。

### 3.3 当前项目的实现建议

当前画布需要区分两个选择层级：

```ts
type EditorSelection = {
  selectedSlotId: string | null
  selectedElementId: string | null
  selectedCandidateRevisionId: string | null
  scope: 'slot' | 'element'
}
```

槽位级选择可以直接使用 React 事件。真实候选在 iframe 内运行时，应注入轻量 editor bridge，通过 `postMessage` 返回：

```ts
{
  type: 'ELEMENT_SELECTED'
  token: string
  revisionId: string
  slotId: string
  nodeId: string
  componentId: string
  rect: { x: number; y: number; width: number; height: number }
}
```

不要尝试让父页面直接读取跨 iframe DOM。消息必须校验 token、origin 和 revision，并忽略晚到的旧 revision。

## 4. Onlook 的 Checkpoint、分支和版本设计

### 4.1 实际模型

Onlook 当前不是完整的 Git 分支版本树，而是两层相对独立的机制：

```text
Branch = 一份独立 CodeSandbox 工程副本
Checkpoint = 该 Sandbox 内部 Git 仓库的一次 commit
Message Checkpoint = { branchId, commitOid }
Versions UI = 每个 Branch 的线性 commit 列表
```

Branch schema 中没有：

```text
parentBranchId
baseCheckpointId
headCheckpointId
forkedFrom
```

关键实现：

- [`packages/db/src/schema/project/branch.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/packages/db/src/schema/project/branch.ts#L10-L49)
- [`packages/models/src/chat/message/checkpoint.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/packages/models/src/chat/message/checkpoint.ts)
- [`settings-modal/versions/versions.tsx`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/ui/settings-modal/versions/versions.tsx)

因此 Onlook 产品层无法可靠重建跨分支树，只能展示“分支列表 + 每分支版本列表”。即使 fork 后的 Sandbox 保留部分共同 Git 历史，数据库也没有明确记录分叉关系。

### 4.2 从当前状态 Fork

Onlook 的调用链为：

```text
当前 Frame / Active Branch
→ BranchManager.forkBranch()
→ api.branch.fork()
→ CodeSandbox 复制整个源 Sandbox
→ 创建新的 Branch DB 记录
→ 创建指向新预览 URL 的 Frame
→ 初始化独立 Sandbox / History / CodeFileSystem
→ 切换到新 Branch
```

关键实现：

- [`branch/manager.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/branch/manager.ts#L157-L191)
- [`branch router`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/server/api/routers/project/branch.ts#L89-L230)

这里复制的是整个 Sandbox 当前文件状态，不是选中的 DOM 节点，也不是一组结构化槽位选择。

### 4.3 Checkpoint 与恢复

AI 对话结束后，Onlook 会遍历所有 Branch，为每个 Sandbox 创建 Git commit，并把 `{branchId, oid}` 挂到用户消息上。

恢复时：

1. 先为当前工作状态创建安全备份。
2. 暂停文件同步。
3. 执行 `git restore --source <oid> .`。
4. 恢复同步并刷新 commit 列表。

它恢复的是文件内容，不是移动 Git branch head。

值得借鉴的是非破坏性恢复语义：

```text
恢复旧版本
→ 先保存当前状态
→ 应用旧快照内容
→ 在当前分支创建新的 restore checkpoint
→ restoredFrom 指向旧 checkpoint
```

## 5. 当前项目的 Branch / Checkpoint 目标模型

建议建立轻量纯前端 Snapshot DAG：

```ts
type DesignDocument = {
  layoutRef: string
  visualRef: string
  contentRef?: string
  slotSelections: Record<string, string> // CandidateRevisionId
}

type DesignBranch = {
  id: string
  name: string
  parentBranchId: string | null
  baseCheckpointId: string
  headCheckpointId: string
  createdAt: number
}

type DesignCheckpoint = {
  id: string
  branchId: string
  parentCheckpointId: string | null
  documentRef: string
  reason: 'select' | 'replace' | 'visual' | 'structure' | 'revision' | 'restore' | 'manual'
  restoredFrom?: string
  createdAt: number
}
```

Candidate artifact 应作为不可变实体独立保存，Checkpoint 只存 ID 引用，避免反复复制完整源码。

以下临时状态不能进入 Checkpoint：

```text
activeSlotId
selectedElementId
tryOnId
hoveredElementId
generation progress
streamPreviewHtml
animation seed
bursts / modal / sound state
```

### 5.1 Checkpoint 触发边界

| 操作 | 是否创建 Checkpoint |
|---|---|
| 滚动/点击试穿 | 否 |
| 换一批候选 | 否 |
| 首次扣合 | 是，`select` |
| 替换已扣合候选 | 是，`replace` |
| 只改 Visual DNA | 是，`visual` |
| 只改布局结构 | 是，`structure` |
| 局部 Revision 完成 | 是，`revision` |
| Reviewer 一批补丁完成 | 是，一个聚合 Checkpoint |
| 恢复旧版本 | 是，`restore` |

## 6. 实时预览和代码更新

### 6.1 Onlook 的两条链路

Onlook 没有自研 HMR 协议：

```text
交互链路：父画布 ↔ Penpal RPC ↔ iframe DOM
源码链路：Action → AST diff → 本地文件系统 → CodeSandbox FS → Next.js Fast Refresh
```

样式修改时，同一个 typed Action 会驱动：

1. AST 变换和源码写入。
2. iframe 内的临时 CSS 更新。
3. CodeSandbox 内开发服务器 HMR。
4. MutationObserver 通知父画布重建 layer 和 overlay。

关键实现：

- [`action/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/action/index.ts#L24-L132)
- [`code/index.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/components/store/editor/code/index.ts#L21-L123)
- [`sync-engine.ts`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/services/sync-engine/sync-engine.ts#L360-L711)
- [`frame/view.tsx`](https://github.com/onlook-dev/onlook/blob/423e2e924366419e418ee049093872d535eea41a/apps/web/client/src/app/project/%5Bid%5D/_components/canvas/frame/view.tsx#L87-L168)

### 6.2 当前项目的正确边界

当前项目不应建立 DOM 和源码两个可写真值，而应保持：

```text
CandidateRail
→ dispatch preview/commit Action
→ Editor Store / DesignDocument（唯一真值）
→ CanvasStage 纯派生渲染
→ iframe 只负责隔离运行候选代码
```

如果继续使用 `srcDoc` iframe，建议最小消息协议为：

```text
PREVIEW_READY
APPLY_SCENE { revision, scene }
ELEMENT_SELECTED
MEASUREMENTS_CHANGED
PREVIEW_ERROR
```

所有异步编译、生成和 iframe 消息都应携带 `revision`，避免旧生成结果晚到后覆盖新候选。

## 7. 当前项目现状分析

### 7.1 已具备的正确基础

当前 Zustand store 中：

- `tryOnId` 是临时试穿。
- `selectedId` 是已扣合结果。
- 已扣合后试穿其他候选不会立即覆盖选择。
- `confirmCandidate()` 才产生扣合或替换。

`CanvasStage` 使用 `tryOnId ?? selectedId` 显示当前试穿结果；`CandidateRail` 的滚动中心线只触发试穿。这一交互闭环应保留。

### 7.2 主要缺口

1. 画布和源码只映射到槽位级，没有节点级 `sourceRef`。
2. `CanvasStage` 点击只切换 `activeSlotId`，没有 Element Selection 和 Inspector。
3. 真实候选运行在 iframe 内，iframe 点击不会冒泡给 `SlotShell`。
4. `history` 是文案日志，不可 checkout、redo、恢复或分叉。
5. `switchBranch()` 只是切换 `directionId`，实际是换肤而非分支。
6. `undo()` 倒序查找最后一个 selected slot，不代表撤销最近操作。
7. Harness 的 `regenerate()` 在三个 variant 已存在后可能没有新任务。
8. Revision 复用 candidate ID 并覆盖旧 artifact，旧源码不可寻址。
9. `code.delta` 最终合并到单字符串，丢失文件级查看代码能力。
10. Canvas 布局依赖 dashboard/landing 槽位 ID 的硬编码，无法支持真正的结构候选。

## 8. 六项产品能力设计

### 8.1 换一批

新增：

```ts
generateBatch({
  componentIds,
  count,
  preserveSelection: true,
  replaceRail: true,
})
```

规则：

- 每批生成新的 `batchId` 和 candidate IDs。
- 保留当前 `selectedId`。
- 仅替换 CandidateRail 中的候选集合。
- 生成本身不创建版本，用户扣合后才创建 `replace` Checkpoint。

### 8.2 保留布局只改视觉

视觉方向必须与设计分支解耦。操作只改变 `visualRef`：

```text
layoutRef 不变
slotSelections 不变
visualRef 更新
```

现有 `.dna-*` 和 CSS variables 可以作为基础，但需要增加硬编码颜色、字体、阴影和圆角检查，保证换肤覆盖完整。

### 8.3 保留视觉只改结构

新增通用 `LayoutTree`：

```ts
type LayoutNode =
  | { type: 'slot'; slotId: string }
  | {
      type: 'container'
      id: string
      layout: 'row' | 'column' | 'grid' | 'stack'
      constraints: Record<string, unknown>
      children: LayoutNode[]
    }
```

结构候选只修改：

- 槽位顺序和嵌套；
- grid/flex/container；
- 宽高和响应式约束；
- slot compatibility。

同时保持 `visualRef` 和尽可能多的已选 Candidate Revision。

### 8.4 查看对应代码

代码面板应直接读取 `CandidateArtifact.files` 和 `sourceIndex`：

```text
selectedSlotId / selectedElementId
→ CandidateRevision
→ SourceBinding
→ artifact.files[filePath]
→ 高亮对应范围
```

第一版只需要 Code Drawer、文件列表、范围高亮和复制路径，不需要完整 IDE。

### 8.5 从当前选择创建分支

默认只捕获正式的 `selectedId`，绝不能静默捕获由滚动产生的 `tryOnId`：

```text
materialize committed DesignDocument
→ 若 working state 尚未 checkpoint，先创建 checkpoint
→ 新建 Branch
   parentBranchId = 当前 Branch
   baseCheckpointId = 当前 Checkpoint
   headCheckpointId = 当前 Checkpoint
→ checkout 新 Branch
```

如果用户正在试穿，提供明确操作“扣合并创建分支”。

### 8.6 点击画布进入局部编辑

建议分两级：

1. 点击 SlotShell：进入槽位级编辑，可以换候选、换一批、创建分支。
2. 点击 iframe 内节点：进入元素级编辑，可以修改文字、token、图片或查看源码。

编辑作用域应明确显示：

- `Slot`：只修改当前槽位实例。
- `Candidate Root`：修改这个候选模板。
- `Visual`：修改全局视觉 DNA。
- `Structure`：修改布局树。

## 9. 文件级改造建议与优先级

### P0：建立正确的领域模型和版本语义

#### `app/src/lib/store.ts`

- 将 `switchBranch` 重命名为 `applyVisualDirection` 或 `switchVisualDirection`。
- 将 `history` 明确为 Activity Log，不再承担版本职责。
- 扣合、替换、视觉和结构修改统一经过 typed command。
- `undo/redo` 基于 Action 或 Checkpoint parent，不再倒序查找 selected slot。
- 将持久项目状态、生成任务状态和临时编辑状态逐步拆开。

#### 新建 `app/src/lib/project/types.ts`

- `DesignDocument`
- `LayoutNode`
- `CandidateRevision`
- `SourceBinding`

#### 新建 `app/src/lib/versioning/types.ts`

- `DesignBranch`
- `DesignCheckpoint`
- `DocumentRef`

#### 新建 `app/src/lib/versioning/repository.ts`

- `createCheckpoint()`
- `restoreCheckpoint()`
- `createBranchFromCurrent()`
- `checkoutBranch()`
- `undo()` / `redo()`

#### `app/src/lib/harness/types.ts`

- Candidate 增加 `batchId`、`revisionId`、`previousRevisionId` 和 `sourceIndex`。
- Generation Event 携带 revision，防止竞态覆盖。

#### `app/src/lib/harness/session.ts`

- 增加可重复的 `generateBatch()`。
- Revision 创建新的不可变版本，不覆盖原 candidate artifact。
- 将选择指针指向 Candidate Revision。

### P1：画布选择、代码定位和结构/视觉正交

#### `app/src/components/app/CanvasStage.tsx`

- 引入 `selectedSlotId`、`selectedElementId` 和 `editorMode`。
- 抽出通用 `LayoutRenderer`，移除 dashboard/landing 硬编码组合。
- 添加局部选择 Overlay 和槽位菜单。
- 增加“查看代码”和“从当前选择创建分支”。

#### `app/src/lib/harness/sandbox-runtime.ts`

- 注入轻量 editor bridge。
- 发送元素选择和尺寸消息。
- 校验 token、origin、candidate revision。

#### `app/src/components/app/GeneratedCandidatePreview.tsx`

- 增加 `onElementSelect`、`onReady` 和 `onError`。
- iframe reload/compile 结果绑定 revision。

#### `app/src/components/app/CandidateRail.tsx`

- 增加“换一批”。
- 增加视觉候选/结构候选模式。
- 保持试穿不提交、扣合或替换才创建 Checkpoint。

#### 新建 UI

- `app/src/components/app/InspectorPanel.tsx`
- `app/src/components/app/CodePanel.tsx`

### P2：持久化和版本树 UI

#### `app/src/lib/harness/storage.ts`

IndexedDB v2 建议拆分为：

```text
projects
documents
artifacts
checkpoints
branches
refs
```

Checkpoint 只保存引用；artifact 根据 ID 或内容 hash 复用，避免每个快照重复保存完整源码。

#### `app/src/components/app/LeftPanel.tsx`

- 将“视觉方向”和“设计分支”拆为两个区域。
- 原 history 保留为活动记录。
- 新增 Branch / Version 区域。

#### 新建 `app/src/components/app/VersionTree.tsx`

第一版使用树状缩进列表即可。数据必须来自 `parentCheckpointId`、`parentBranchId` 和 Branch head，不能依赖数组展示顺序。

## 10. 不应照搬的 Onlook 架构

当前项目是纯前端、受控模型驱动的槽位编辑器，以下架构明显过重：

- 每个 Branch 启动一个 CodeSandbox VM。
- 每个 Branch 持有独立远端文件系统和预览 URL。
- ZenFS + IndexedDB 整项目镜像。
- 双向递归 File Watcher、SHA-256 回声抑制和 pause/unpause。
- 在浏览器远端容器中运行 Git CLI。
- Git notes 作为版本显示名。
- Supabase、Drizzle、RLS、tRPC 分支 CRUD。
- 为所有 JSX 注入 `data-oid`。
- 每次写 JSX 都进行 AST parse、format 和全局索引更新。
- preload + Penpal + MutationObserver + 完整 DOM Layer Tree。
- DOM 乐观状态和源码/store 双真值。
- 多父 Merge、冲突解决和 CRDT。
- 每次聊天结束对所有 Branch 创建允许为空的 Git commit。

只有当产品目标转变为“编辑任意第三方 React/Next.js 仓库”时，才值得重新评估全仓库 AST 索引、preload 和远程开发沙箱。

## 11. 推荐实施顺序

```text
阶段 1
领域模型拆分
→ Candidate Revision 不可变
→ Checkpoint / Branch 数据模型
→ 正确的 undo / redo

阶段 2
generateBatch（换一批）
→ Visual / Structure 正交
→ 通用 LayoutRenderer

阶段 3
iframe Selection Bridge
→ Inspector
→ SourceBinding / CodePanel

阶段 4
IndexedDB v2
→ Branch / Version Tree UI
→ 恢复、比较和从当前选择分叉
```

在阶段 1 完成前，不建议继续扩展现有 `HistoryItem[]` 或将更多语义塞入 `switchBranch()`。否则视觉方向、工作分支、活动日志和可恢复版本会继续混为一体。
