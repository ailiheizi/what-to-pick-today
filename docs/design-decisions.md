# 设计决策记录

## 2026-07-26 · 界面风格方向（来自用户反馈）

### 视觉底板 = 设计风格，不是抽象情绪
底板（Visual DNA 分支）应该是用户熟知的**设计风格**，例如：

- MD3（Material Design 3 / Material You）
- 苹果风（Apple HIG / Liquid Glass）
- 黑客风（终端 / CRT / Hacker）
- 古老 / 复古风（Retro / Vintage 印刷风）
- 等等，可持续扩展

### 2026-07-26 · 四种风格的研究结论（基于官方资料与设计社区）

**苹果风 = Liquid Glass（WWDC25 / iOS 26）**
- 核心是"半透明材质悬浮于内容之上"：rgba 半透明表面 + backdrop-blur，不是"浅色+蓝"
- 无硬分割线，用 separator `rgba(60,60,67,0.12)` 和 systemFill `rgba(120,120,128,0.12)`
- 阴影带顶部高光（specular），大圆角与屏幕曲率同心

**MD3 = Material You**
- "色彩即海拔"：用 surface 色调分层（surface / surfaceContainer / surfaceContainerHigh），几乎不用阴影
- 官方 baseline：primary `#6750A4`、surface `#FDF8FF`、surfaceContainerHigh `#ECE6F0`、outline `#E7E0EC`
- 胶囊形状 + 弹簧物理动效（M3 Expressive）

**黑客风 = 真终端，不是"绿色暗色主题"**
- 每个元素都要回答"真终端会这样做吗"：等宽字体不可妥协、无圆角、无渐变、无弹跳动画（机器不弹跳）
- 磷光绿 `#00FF41` on 近黑 `#0A0E0A`，琥珀 `#FFB200` 只做告警；glow 要克制（只给标题/激活态）
- 扫描线要"耳语不要喊"：repeating-linear-gradient 2px 线、低透明度
- 密度即特性：1px 细线分隔，不用留白分隔

**复古 = 旧印刷品，不是"米色"**
- 做旧纸面 +  muted earthy 色板（奶油、橄榄、芥末、印章红）
- 衬线/打字机字体、印刷版式（双线规则、杂志网格）
- 颗粒噪点纹理（film grain）是触感来源

### 工具自身 UI 原则

1. **全圆角**：面板、卡片、按钮、输入框全部大圆角（参考用户提供的圆角截图，R≈20–28px，按钮胶囊形）。
2. **生动活泼的动效**：
   - 加载不用枯燥骨架屏，用动画代替（"后端正在制作 UI 组件"的感觉），且每次动画随机不一样。
   - 选中 / 扣合组件时要有动画反馈。
   - 按钮聚焦 / 悬停（如导出按钮）也要有动画。
   - 多点随机、俏皮的动画更好。
3. **聊天弱化**：聊天只在最初描述需求时重要，之后基本用不上 → 聊天框收纳到一边（悬浮可展开），不占据主界面。

## 2026-07-26 · 运行架构（来自用户反馈）

项目默认采用**纯前端、静态可部署、BYOK** 架构。Planner、并发 Builders、事件、历史和存储都运行在浏览器中，不要求项目维护者提供服务端。

- API Key 默认只保存在当前浏览器会话中。
- 项目、候选和事件历史保存在 IndexedDB。
- 生成代码只能在隔离 Runtime 中运行。
- 自建 OpenAI-compatible Proxy 只是 CORS 不可用时的可选兼容方案，不是默认产品结构。

### 组件协议补充：`.dna-*` 共享语义层（class 白名单）

2026-07-26 起，AI 生成的组件**不允许**自行拼装 `bg/border/shadow/radius` 等表面样式，必须使用共享语义类（定义于 `src/index.css`，由 Visual DNA token 统一驱动）。这是"放开审美，管住接口"的具体化：组件内部布局自由，表面材质收口。

| 语义类 | 用途 | 绑定的 token |
|---|---|---|
| `.dna-card` | 卡片/容器表面 | `--dna-surface` + `--dna-line` + `--dna-radius` + `--dna-shadow` |
| `.dna-chrome` | 顶栏 / 侧栏 / 导航等 chrome 表面 | `--dna-surface` |
| `.dna-fill` | 次级填充（输入框、芯片、进度轨） | `--dna-surface2` |
| `.dna-line-b/r/t` | 分隔线 | `--dna-line` |
| `.dna-text` / `.dna-muted` | 文字层级 | `--dna-text` / `--dna-muted` |
| `.dna-accent-text` / `.dna-accent-bg` | 品牌强调 | `--dna-accent` |

规则：

1. 材质效果（如苹果风的 backdrop-blur、过渡动画）挂在共享过渡常量 `T` 上，组件统一引用。
2. 新增风格 = 新增一组 token，无需改动任何组件代码；组件表现自动一致。
3. Reviewer / Fixer 的表面类补丁只允许改 token，不允许给单个组件写一次性样式。
4. 布局类（flex/grid/spacing）不受限制，属于组件的“内部表现自由”。

#### 已知偏差（2026-07-26 记录）

上面这张表目前**只对工具自身 UI 生效**，尚未对沙箱里的 AI 生成组件生效：

- `app/src/lib/harness/prompts.ts:88`、`:92`、`:137` 要求 Builder 和 Draft Renderer「使用内联样式或末尾 style 标签，绑定 `--dna-*` CSS 变量」，没有提到 `.dna-card` 等语义类。
- `app/src/lib/harness/schemas.ts` 只校验文件路径、依赖白名单和 `entryFile` 归属，没有任何 class 合规检查。
- `.dna-*` 类只定义在 `app/src/index.css:337` 起，使用者是 `CanvasStage.tsx`、`LeftPanel.tsx` 等工具 UI。候选预览是独立的 `srcdoc` iframe 文档，加载不到这些类。

规则本身不撤销：「放开审美，管住接口」仍然成立，只是当前的收口层从语义类退到了 CSS 变量。

TODO：确定 `.dna-*` 语义层是否要覆盖沙箱内的生成组件。若要，需要同时改三处——把语义类注入 `createSandboxDocument` 的 `<style>`、在 Builder 提示词中改为强制使用、在 `schemas.ts` 中补上校验。在此之前，本节表格的适用范围以这条偏差记录为准。

## 2026-07-26 · 取代性技术决策

以下两条取代早期文档中的描述。`product-plan.md` §9 和 `ai-generation-harness.md` §7 尚未同步，阅读时以本节为准。

### 应用框架 = Vite + react-router，不是 Next.js

`product-plan.md` §9 写的是「React / Next.js」。实际技术栈是 Vite 7 + `react-router` 7（`app/package.json`：`"dev": "vite"`、`react-router ^7.6.1`，无 `next` 依赖）。产物是可静态部署的 SPA。

理由：产品定位就是「不要求账号、云数据库或维护者后端」的纯前端工具。Next.js 的服务端能力在这个架构里没有使用场景，反而会引入部署假设。

### 运行沙箱 = 手写 CSP iframe，不是 Sandpack / WebContainers

`ai-generation-harness.md` §7 与 `product-plan.md` §9 把 Sandpack、WebContainers 列为候选沙箱方案。二者都没有被采用，也都不在 `app/package.json` / `package-lock.json` 中。

实际实现是 `app/src/lib/harness/sandbox-runtime.ts`：

- `@babel/standalone` 在浏览器内转译 TSX（TypeScript + React classic runtime + commonjs）。
- 生成带 CSP `<meta>` 的 `srcdoc`，注入 `sandbox="allow-scripts"` iframe。
- React 19、`react-dom`、`lucide-react`、`motion` 以 ESM 从 `https://esm.sh` 加载，Tailwind 从 `https://cdn.tailwindcss.com` 加载。
- 沙箱内的 `require()` 只认这四个白名单包，其余抛错；不支持相对模块导入。

理由：候选组件的依赖面已经被白名单收窄到四个包，不需要完整 npm 或开发服务器。手写 iframe 的包体和启动成本远低于 Sandpack / WebContainers，并且能精确控制 CSP、编译超时、错误上报和选择桥这几件本产品特有的事。
