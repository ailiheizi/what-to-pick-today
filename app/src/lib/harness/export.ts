import type { CandidateArtifact, HarnessSnapshot, VisualDNA } from './types.ts'
import { eventCallbackAliases, inferSemanticBindings } from './bindings.ts'

export type HarnessExportOptions = {
  /** 默认要求每个规划组件都已经选择。 */
  requireCompleteSelection?: boolean
  /** 默认只允许导出成功编译、渲染的候选。 */
  requireRendered?: boolean
  /** 固定该值可得到完全可复现的测试或构建产物。 */
  generatedAt?: string
}

export type HarnessExportProject = {
  name: string
  entryFile: 'src/App.tsx'
  files: Record<string, string>
  selectedCandidates: Array<{
    componentId: string
    candidateId: string
    entryFile: string
  }>
}

const DEPENDENCY_VERSIONS: Record<string, string> = {
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  'lucide-react': '^0.562.0',
  motion: '^12.23.24',
}

function safeSlug(value: string) {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'generated-project'
}

function assertSafePath(path: string) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error(`无法导出不安全的文件路径：${path}`)
  }
}

function importPath(from: string, target: string) {
  const fromParts = from.split('/').slice(0, -1)
  const targetParts = target.split('/')
  while (fromParts.length && targetParts.length && fromParts[0] === targetParts[0]) {
    fromParts.shift()
    targetParts.shift()
  }
  const prefix = '../'.repeat(fromParts.length) || './'
  const joined = `${prefix}${targetParts.join('/')}`
  return joined.replace(/\.(tsx?|jsx?)$/, '')
}

function jsonLiteral(value: unknown) {
  const json = JSON.stringify(value ?? {}, null, 2)
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function cssName(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
}

function visualDnaCss(dna: VisualDNA) {
  const colors = Object.entries(dna.colors).map(([key, value]) => `  --dna-${cssName(key)}: ${value};`)
  const typography = Object.entries(dna.typography)
    .filter((entry): entry is [string, string | number] => ['string', 'number'].includes(typeof entry[1]))
    .map(([key, value]) => `  --dna-${cssName(key)}: ${String(value)};`)
  return `:root {
${[
    ...colors,
    ...typography,
    `  --dna-radius: ${dna.geometry.radius};`,
    `  --dna-border: ${dna.geometry.border};`,
    `  --dna-density: ${dna.geometry.density};`,
    `  --dna-motion-duration: ${dna.motion.duration};`,
    `  --dna-motion-easing: ${dna.motion.easing};`,
  ].join('\n')}
}

html, body, #root { min-height: 100%; margin: 0; }
* { box-sizing: border-box; }
body { background: var(--dna-background, var(--dna-bg, #f7f7f8)); color: var(--dna-text, #171717); font-family: var(--dna-font-family, system-ui, sans-serif); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
`
}

function selectedArtifacts(snapshot: HarnessSnapshot, options: Required<Pick<HarnessExportOptions, 'requireCompleteSelection' | 'requireRendered'>>) {
  if (!snapshot.plan) throw new Error('页面计划尚未完成，无法导出')
  if (!snapshot.direction) throw new Error('尚未选择设计方向，无法导出')

  const byId = new Map(snapshot.candidates.map((candidate) => [candidate.id, candidate]))
  const selected: CandidateArtifact[] = []
  for (const component of snapshot.plan.components) {
    const candidateId = snapshot.selections[component.id]
    if (!candidateId) {
      if (options.requireCompleteSelection) throw new Error(`组件 ${component.id} 尚未选择候选`)
      continue
    }
    const candidate = byId.get(candidateId)
    if (!candidate) throw new Error(`组件 ${component.id} 的已选候选不存在：${candidateId}`)
    if (candidate.componentId !== component.id) throw new Error(`候选 ${candidateId} 不属于组件 ${component.id}`)
    if (options.requireRendered && candidate.runtimeStatus !== 'rendered') {
      throw new Error(`候选 ${candidateId} 尚未成功编译并渲染`)
    }
    selected.push(candidate)
  }
  if (!selected.length) throw new Error('没有可导出的已选候选')
  return selected
}

function safeIdentifier(value: string, fallback: string) {
  const identifier = value.replace(/[^a-zA-Z0-9_$]/g, '_')
  return /^[a-zA-Z_$]/.test(identifier) ? identifier : `${fallback}_${identifier}`
}

function appSource(snapshot: HarnessSnapshot, selected: CandidateArtifact[]) {
  const plan = snapshot.plan!
  const selectedByComponent = new Map(selected.map((candidate) => [candidate.componentId, candidate]))
  const pageSlots = plan.pages.flatMap((page) => page.slots)
  const ordered = [
    ...pageSlots.map((slot) => selectedByComponent.get(slot)).filter((candidate): candidate is CandidateArtifact => Boolean(candidate)),
    ...selected.filter((candidate) => !pageSlots.includes(candidate.componentId)),
  ]
  const bindings = inferSemanticBindings(plan.components)
    .filter((binding) => selectedByComponent.has(binding.fromComponentId))
    .map((binding) => ({ ...binding, targets: binding.targets.filter((target) => selectedByComponent.has(target.componentId)) }))
    .filter((binding) => binding.targets.length)
  const imports = selected.map((candidate, index) =>
    `import Selected${index + 1} from '${importPath('src/App.tsx', candidate.entryFile)}'`,
  )
  const cssImports = selected.flatMap((candidate) => candidate.files
    .filter((file) => file.path.endsWith('.css'))
    .map((file) => `import '${importPath('src/App.tsx', file.path)}'`))
  const props = selected.map((candidate, index) =>
    `const props${index + 1} = ${jsonLiteral(candidate.previewProps)} as Record<string, unknown>`,
  )
  const components = selected.map((_candidate, index) =>
    `const Component${index + 1} = Selected${index + 1} as unknown as ComponentType<Record<string, unknown>>`,
  )
  const selectedIndex = new Map(selected.map((candidate, index) => [candidate.componentId, index + 1]))
  const stateNames = bindings.map((binding, index) => ({
    binding,
    name: safeIdentifier(`${binding.fromComponentId}_${binding.outputName}_${index}`, 'signal'),
  }))
  const states = stateNames.map(({ binding, name }) => {
    const initial = binding.targets
      .map((target) => selectedByComponent.get(target.componentId)?.previewProps[target.inputName])
      .find((value) => value !== undefined)
    return `  const [${name}, set_${name}] = useState<unknown>(${jsonLiteral(initial ?? null)})`
  })
  const overrides = new Map<string, string[]>()
  for (const { binding, name } of stateNames) {
    const source = overrides.get(binding.fromComponentId) ?? []
    for (const alias of eventCallbackAliases(binding.outputName)) {
      source.push(`${JSON.stringify(alias)}: (...args: unknown[]) => set_${name}(args.length <= 1 ? args[0] : args)`)
    }
    overrides.set(binding.fromComponentId, source)
    for (const target of binding.targets) {
      const targetProps = overrides.get(target.componentId) ?? []
      targetProps.push(`${JSON.stringify(target.inputName)}: ${name}`)
      overrides.set(target.componentId, targetProps)
    }
  }
  const sections = ordered.map((candidate) => {
    const index = selectedIndex.get(candidate.componentId)!
    const linkedProps = overrides.get(candidate.componentId) ?? []
    const propsExpression = linkedProps.length ? `{...props${index}, ${linkedProps.join(', ')}}` : `props${index}`
    return `      <section data-component-id=${JSON.stringify(candidate.componentId)}>
        <Component${index} {...${propsExpression}} />
      </section>`
  })
  return `import { useState, type ComponentType } from 'react'
${imports.join('\n')}
${cssImports.join('\n')}
import './index.css'

${props.join('\n')}
${components.join('\n')}

export default function App() {
${states.join('\n')}
  return (
    <main data-generated-by="what-to-pick-today">
${sections.join('\n')}
    </main>
  )
}
`
}

/**
 * 将 Harness 快照中已经确认的候选组装为一个可运行的 Vite + React 多文件项目。
 * 此函数不访问 DOM，既可在浏览器使用，也可用于测试和其他导出适配器（例如 ZIP）。
 */
export function buildHarnessExportProject(
  snapshot: HarnessSnapshot,
  options: HarnessExportOptions = {},
): HarnessExportProject {
  const resolved = {
    requireCompleteSelection: options.requireCompleteSelection ?? true,
    requireRendered: options.requireRendered ?? true,
  }
  const selected = selectedArtifacts(snapshot, resolved)
  const plan = snapshot.plan!
  const direction = snapshot.direction!
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const files: Record<string, string> = {}

  for (const candidate of selected) {
    assertSafePath(candidate.entryFile)
    if (!candidate.files.some((file) => file.path === candidate.entryFile)) {
      throw new Error(`候选 ${candidate.id} 的入口文件不存在：${candidate.entryFile}`)
    }
    for (const file of candidate.files) {
      assertSafePath(file.path)
      if (Object.hasOwn(files, file.path)) throw new Error(`已选候选包含重复文件路径：${file.path}`)
      files[file.path] = file.content
    }
  }

  const dependencies = new Set(['react', 'react-dom'])
  for (const candidate of selected) {
    const contract = plan.components.find((item) => item.id === candidate.componentId)
    contract?.dependencies.forEach((dependency) => dependencies.add(dependency))
  }
  const packageDependencies = Object.fromEntries([...dependencies].sort().map((name) => {
    const version = DEPENDENCY_VERSIONS[name]
    if (!version) throw new Error(`无法导出未支持的依赖：${name}`)
    return [name, version]
  }))
  const scaffold: Record<string, string> = {
    'src/App.tsx': appSource(snapshot, selected),
    'src/main.tsx': "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)\n",
    'src/index.css': `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n${visualDnaCss(direction.visualDNA)}`,
    'index.html': '<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Generated project</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    'package.json': `${JSON.stringify({
      name: safeSlug(plan.project.name), private: true, version: '0.0.0', type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
      dependencies: packageDependencies,
      devDependencies: { '@vitejs/plugin-react': '^5.1.1', autoprefixer: '^10.4.23', postcss: '^8.5.6', tailwindcss: '^3.4.19', typescript: '~5.9.3', vite: '^7.2.4' },
    }, null, 2)}\n`,
    'vite.config.ts': "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()] })\n",
    'postcss.config.js': "export default { plugins: { tailwindcss: {}, autoprefixer: {} } }\n",
    'tailwind.config.js': "export default { content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'], theme: { extend: {} }, plugins: [] }\n",
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], allowJs: false, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, strict: true, forceConsistentCasingInFileNames: true, module: 'ESNext', moduleResolution: 'Bundler', resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx' }, include: ['src'] }, null, 2)}\n`,
    'README.md': `# ${plan.project.name}\n\n${plan.project.description}\n\n由「今天选什么？」浏览器 Harness 导出。\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
    'what-to-pick-today.json': `${JSON.stringify({ version: 1, generatedAt, sessionId: snapshot.sessionId, requirement: snapshot.requirement, direction, selections: snapshot.selections, review: snapshot.review }, null, 2)}\n`,
  }
  for (const [path, content] of Object.entries(scaffold)) {
    if (Object.hasOwn(files, path)) throw new Error(`生成文件与项目脚手架冲突：${path}`)
    files[path] = content
  }

  return {
    name: safeSlug(plan.project.name),
    entryFile: 'src/App.tsx',
    files,
    selectedCandidates: selected.map(({ componentId, id, entryFile }) => ({ componentId, candidateId: id, entryFile })),
  }
}

/** 将项目封装为无损 JSON 文件；ZIP 适配器可直接消费其中的 files 映射。 */
export function serializeHarnessExportProject(project: HarnessExportProject) {
  return `${JSON.stringify(project, null, 2)}\n`
}

/** 浏览器下载入口。当前下载无损 .wtpt.json，避免为 ZIP 引入额外运行时依赖。 */
export function downloadHarnessExportProject(project: HarnessExportProject, filename = `${project.name}.wtpt.json`) {
  if (typeof document === 'undefined') throw new Error('下载功能只能在浏览器环境中使用')
  const url = URL.createObjectURL(new Blob([serializeHarnessExportProject(project)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
