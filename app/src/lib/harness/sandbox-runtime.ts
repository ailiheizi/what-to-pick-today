import type { CandidateArtifact, CompileResult, RuntimeAdapter } from './types.ts'

type BabelModule = typeof import('@babel/standalone')

const compiledCache = new Map<string, string>()
let babelPromise: Promise<BabelModule> | null = null

function loadBabel() {
  babelPromise ??= import('@babel/standalone')
  return babelPromise
}

function cacheKey(candidate: CandidateArtifact) {
  return candidate.files.map((file) => `${file.path}:${file.content}`).join('\n---\n')
}

function escapeScript(value: string) {
  return value.replace(/<\/script/gi, '<\\/script')
}

function cssVariables(vars: Record<string, string>) {
  return Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(';')
}

async function transpile(candidate: CandidateArtifact) {
  const key = cacheKey(candidate)
  const cached = compiledCache.get(key)
  if (cached) return cached
  const entry = candidate.files.find((file) => file.path === candidate.entryFile)
  if (!entry) throw new Error('找不到候选入口文件')
  const relativeImport = entry.content.match(/from\s+['"](\.{1,2}\/[^'"]+)['"]/)
  if (relativeImport) throw new Error(`当前沙箱暂不支持相对模块导入：${relativeImport[1]}`)
  const Babel = await loadBabel()
  const result = Babel.transform(entry.content, {
    filename: candidate.entryFile,
    sourceType: 'module',
    presets: [
      ['typescript', { ignoreExtensions: true }],
      ['react', { runtime: 'classic' }],
    ],
    plugins: ['transform-modules-commonjs'],
  })
  if (!result.code) throw new Error('Babel 没有生成可执行代码')
  compiledCache.set(key, result.code)
  return result.code
}

export async function createSandboxDocument(
  candidate: CandidateArtifact,
  vars: Record<string, string> = {},
  token = crypto.randomUUID(),
) {
  const code = escapeScript(await transpile(candidate))
  const css = escapeScript(candidate.files.filter((file) => file.path.endsWith('.css')).map((file) => file.content).join('\n'))
  const props = escapeScript(JSON.stringify(candidate.previewProps).replace(/</g, '\\u003c'))
  const rootVars = cssVariables(vars)
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh; style-src 'unsafe-inline'; connect-src https://esm.sh https://cdn.tailwindcss.com; img-src data: blob:; font-src data:; worker-src blob:" />
  <script>
    const reportSandboxError=(error)=>parent.postMessage({source:'wtpt-sandbox',token:${JSON.stringify(token)},type:'error',error:error instanceof Error?error.message:String(error||'Runtime error')},'*');
    window.addEventListener('error',(event)=>reportSandboxError(event.error||event.message));
    window.addEventListener('unhandledrejection',(event)=>reportSandboxError(event.reason));
  </script>
  <script async src="https://cdn.tailwindcss.com"></script>
  <style>
    html,body,#root{margin:0;min-height:100%;width:100%;overflow:auto}body{background:transparent;color:var(--dna-text,#171717);font-family:var(--dna-font,system-ui,sans-serif)}*{box-sizing:border-box}
    :root{${rootVars}}
    @media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
    ${css}
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    try {
      const [ReactNamespace,ReactDOMNamespace,ReactDOMClient,Lucide,Motion]=await Promise.all([
        import('https://esm.sh/react@19.2.0'),
        import('https://esm.sh/react-dom@19.2.0'),
        import('https://esm.sh/react-dom@19.2.0/client'),
        import('https://esm.sh/lucide-react@0.562.0?deps=react@19.2.0'),
        import('https://esm.sh/motion@12/react?deps=react@19.2.0,react-dom@19.2.0'),
      ]);
      const React=ReactNamespace.default;
      const {createRoot}=ReactDOMClient;
      const module={exports:{}};const exports=module.exports;
      const require=(name)=>{
        if(name==='react')return {...ReactNamespace,default:React};
        if(name==='react-dom')return ReactDOMNamespace;
        if(name==='react-dom/client')return ReactDOMClient;
        if(name==='lucide-react')return Lucide;
        if(name==='motion'||name==='motion/react'||name==='framer-motion')return Motion;
        throw new Error('Dependency is not allowed: '+name);
      };
      ${code}
      const Component=module.exports.default||module.exports.Component||module.exports;
      if(typeof Component!=='function'&&typeof Component!=='object')throw new Error('入口文件必须 default export 一个 React 组件');
      createRoot(document.getElementById('root')).render(React.createElement(Component,${props}));
      setTimeout(()=>parent.postMessage({source:'wtpt-sandbox',token:${JSON.stringify(token)},type:'ready'},'*'),0);
    } catch(error) { reportSandboxError(error) }
  </script>
</body>
</html>`
}

export type SandboxRuntimeOptions = {
  timeoutMs?: number
  getCssVariables?: () => Record<string, string>
}

export class SandboxRuntimeAdapter implements RuntimeAdapter {
  #timeoutMs: number
  #getCssVariables: () => Record<string, string>

  constructor(options: SandboxRuntimeOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 15_000
    this.#getCssVariables = options.getCssVariables ?? (() => ({}))
  }

  async compile(candidate: CandidateArtifact, signal: AbortSignal): Promise<CompileResult> {
    let srcDoc: string
    const token = crypto.randomUUID()
    try {
      srcDoc = await createSandboxDocument(candidate, this.#getCssVariables(), token)
    } catch (reason) {
      return { ok: false, errors: [reason instanceof Error ? reason.message : String(reason)] }
    }
    return new Promise((resolve) => {
      const iframe = document.createElement('iframe')
      iframe.sandbox.add('allow-scripts')
      iframe.style.cssText = 'position:fixed;width:800px;height:600px;left:-10000px;top:-10000px;opacity:0;pointer-events:none'
      const finish = (result: CompileResult) => {
        window.removeEventListener('message', onMessage)
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        iframe.remove()
        resolve(result)
      }
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { source?: string; token?: string; type?: string; error?: string }
        if (data.source !== 'wtpt-sandbox' || data.token !== token) return
        finish(data.type === 'ready' ? { ok: true } : { ok: false, errors: [data.error ?? 'Sandbox runtime error'] })
      }
      const onAbort = () => finish({ ok: false, errors: ['编译已取消'] })
      const timeout = window.setTimeout(() => finish({ ok: false, errors: ['沙箱编译超时，请检查网络或生成代码'] }), this.#timeoutMs)
      window.addEventListener('message', onMessage)
      signal.addEventListener('abort', onAbort, { once: true })
      iframe.srcdoc = srcDoc
      document.body.appendChild(iframe)
    })
  }
}
