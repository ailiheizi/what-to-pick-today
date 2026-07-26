# What to Pick Today

一个用于并行生成、比较和挑选 UI 方案的 React + TypeScript 应用。

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

应用不要求服务端环境变量。Kimi API Key 由使用者在应用设置中填写，并保存在其浏览器中。请勿将私人 Key 提交到仓库，或以 `VITE_` 环境变量注入公开部署，因为 Vite 会把它打包进浏览器代码。

## 检查

```bash
cd app
npm run build
npm run test:harness
```
