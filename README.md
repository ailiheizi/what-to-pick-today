# What to Pick Today

一个用于并行生成、比较和挑选 UI 方案的 React + TypeScript 应用。

在线体验：[pick.alhz.org](https://pick.alhz.org)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Failiheizi%2Fwhat-to-pick-today)

## 本地运行

```bash
cd app
npm ci
npm run dev
```

## 部署到 Vercel

仓库根目录已经包含 `vercel.json`。在 Vercel 中导入本仓库后，安装、构建和产物目录会自动配置：

- 安装：`npm ci --prefix app`
- 构建：`npm run build --prefix app`
- 输出：`app/dist`

应用不要求服务端环境变量。OpenAI-compatible API Key 由使用者在应用设置中填写，并保存在其浏览器中。请勿将私人 Key 提交到仓库，或以 `VITE_` 环境变量注入公开部署，因为 Vite 会把它打包进浏览器代码。

### 本地测试凭据

仓库根目录的 `.env` 仅供本地开发、Codex 真实 API 测试和完成报告使用，不是应用运行时依赖。可复制 [`.env.example`](./.env.example) 并填写：

- `AI_PROXY_BASE_URL`：OpenAI-compatible API 地址。
- `AI_PROXY_API_KEY`：本地端到端测试使用的临时模型 Key。
- `RESEND_API_KEY`：完成报告邮件使用的临时 Resend Token。
- `RESEND_FROM`、`RESEND_REPORT_TO`：可选的报告发件人与收件人。

`.env` 与 `.env.*` 已被 Git 忽略，只有不含真实凭据的 `.env.example` 可以提交。秘密变量禁止使用 `VITE_` 前缀，以免被 Vite 打包进公开浏览器代码。

早期说明式 `.env` 可以运行 `cd app && npm run env:migrate` 原子迁移为标准 dotenv。迁移器只有在完整识别三个必需值后才写入，文件权限设为 `0600`，不会打印值，也不会创建额外的密钥备份。

本地供应商没有浏览器 CORS 时，Vite 开发服务器会根据 `AI_PROXY_BASE_URL` 启用 `/api/model` 转发，并在服务端注入 `AI_PROXY_API_KEY`。应用设置中点击“使用本地代理”，填写规划模型和组件模型即可，浏览器 Key 可以留空。该转发只存在于 `npm run dev`，生产构建仍是纯静态单前端。

提交前运行 `cd app && npm run check:secrets`。检查只读取 Git 已跟踪文件，不读取被忽略的 `.env`，并且只报告疑似凭据所在的文件和行号，不打印凭据内容。

## 检查

```bash
cd app
npm run build
npm run test:harness
```
