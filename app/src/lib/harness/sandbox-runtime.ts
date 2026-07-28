import { inferSemanticBindings } from './bindings.ts'
import type { CandidateArtifact, CompileResult, ComponentContract, RuntimeAdapter } from './types.ts'

type BabelModule = typeof import('@babel/standalone')

const compiledCache = new Map<string, string>()
let babelPromise: Promise<BabelModule> | null = null

export type SandboxSelectionBridge = {
  slotId: string
  candidateId: string
  revisionId: string
}

export type CompositionSandboxEntry = {
  candidate: CandidateArtifact
  contract: ComponentContract
  active?: boolean
}

type SandboxSelectionMessage = SandboxSelectionBridge & {
  source: 'wtpt-sandbox'
  token: string
  type: 'selection'
}

type SandboxRuntimeMessage = {
  source: 'wtpt-sandbox'
  token: string
  revisionId: string
  type: 'ready' | 'error'
  error?: string
}

export function isSandboxSelectionMessage(
  event: Pick<MessageEvent, 'data' | 'source'>,
  sourceWindow: WindowProxy | null,
  token: string,
  revisionId: string,
): event is MessageEvent<SandboxSelectionMessage> {
  if (!sourceWindow || event.source !== sourceWindow) return false
  const data = event.data as Partial<SandboxSelectionMessage> | null
  return Boolean(
    data
    && data.source === 'wtpt-sandbox'
    && data.type === 'selection'
    && data.token === token
    && data.revisionId === revisionId
    && typeof data.slotId === 'string'
    && typeof data.candidateId === 'string',
  )
}

export function isSandboxRuntimeMessage(
  event: Pick<MessageEvent, 'data' | 'source'>,
  sourceWindow: WindowProxy | null,
  token: string,
  revisionId: string,
): event is MessageEvent<SandboxRuntimeMessage> {
  if (!sourceWindow || event.source !== sourceWindow) return false
  const data = event.data as Partial<SandboxRuntimeMessage> | null
  return Boolean(
    data
    && data.source === 'wtpt-sandbox'
    && (data.type === 'ready' || data.type === 'error')
    && data.token === token
    && data.revisionId === revisionId,
  )
}

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
  selection?: SandboxSelectionBridge,
  runtimeRevisionId = selection?.revisionId ?? candidate.attemptId ?? candidate.id,
) {
  const code = escapeScript(await transpile(candidate))
  const css = escapeScript(candidate.files.filter((file) => file.path.endsWith('.css')).map((file) => file.content).join('\n'))
  const props = escapeScript(JSON.stringify(candidate.previewProps).replace(/</g, '\\u003c'))
  const rootVars = cssVariables(vars)
  const selectionBridge = selection
    ? `<script>
    document.addEventListener('pointerdown',()=>{
      parent.postMessage({
        source:'wtpt-sandbox',
        token:${JSON.stringify(token)},
        type:'selection',
        slotId:${JSON.stringify(selection.slotId)},
        candidateId:${JSON.stringify(selection.candidateId)},
        revisionId:${JSON.stringify(selection.revisionId)}
      },'*');
    },true);
  </script>`
    : ''
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh; style-src 'unsafe-inline'; connect-src https://esm.sh https://cdn.tailwindcss.com; img-src data: blob:; font-src data:; worker-src blob:" />
  <script>
    const reportSandboxError=(error)=>parent.postMessage({source:'wtpt-sandbox',token:${JSON.stringify(token)},revisionId:${JSON.stringify(runtimeRevisionId)},type:'error',error:error instanceof Error?error.message:String(error||'Runtime error')},'*');
    window.addEventListener('error',(event)=>reportSandboxError(event.error||event.message));
    window.addEventListener('unhandledrejection',(event)=>reportSandboxError(event.reason));
  </script>
  ${selectionBridge}
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
      setTimeout(()=>parent.postMessage({source:'wtpt-sandbox',token:${JSON.stringify(token)},revisionId:${JSON.stringify(runtimeRevisionId)},type:'ready'},'*'),0);
    } catch(error) { reportSandboxError(error) }
  </script>
</body>
</html>`
}

/**
 * Render several generated components inside one React tree and one document.
 * This is deliberately different from stacking candidate iframes: siblings now
 * share the same Visual DNA surface and output callbacks can drive downstream
 * input props in the live canvas, matching the exported project.
 */
export async function createCompositionSandboxDocument(
  entries: CompositionSandboxEntry[],
  vars: Record<string, string> = {},
  token = crypto.randomUUID(),
  revisionId = crypto.randomUUID(),
  layout = 'custom',
  directionId = 'custom',
) {
  if (!entries.length) throw new Error('组合预览至少需要一个候选')
  const compiled = await Promise.all(entries.map(({ candidate }) => transpile(candidate)))
  const rootVars = cssVariables(vars)
  const css = escapeScript(entries.flatMap(({ candidate }) => candidate.files
    .filter((file) => file.path.endsWith('.css'))
    .map((file) => file.content)).join('\n'))
  const entryIds = new Set(entries.map(({ contract }) => contract.id))
  const bindings = inferSemanticBindings(entries.map(({ contract }) => contract))
    .filter((binding) => entryIds.has(binding.fromComponentId))
    .map((binding) => ({
      ...binding,
      targets: binding.targets.filter((target) => entryIds.has(target.componentId)),
    }))
    .filter((binding) => binding.targets.length > 0)
  const entryIndex = new Map(entries.map(({ contract }, index) => [contract.id, index]))
  const stateDefinitions = bindings.map((binding, index) => {
    const initial = binding.targets
      .map((target) => entries[entryIndex.get(target.componentId)!]?.candidate.previewProps[target.inputName])
      .find((value) => value !== undefined) ?? null
    return { binding, name: `signal_${index}`, initial }
  })
  const propOverrides = new Map<string, string[]>()
  for (const { binding, name } of stateDefinitions) {
    const source = propOverrides.get(binding.fromComponentId) ?? []
    source.push(`${JSON.stringify(binding.outputName)}:(...args)=>set_${name}(args.length<=1?args[0]:args)`)
    propOverrides.set(binding.fromComponentId, source)
    for (const target of binding.targets) {
      const targetProps = propOverrides.get(target.componentId) ?? []
      targetProps.push(`${JSON.stringify(target.inputName)}:${name}`)
      propOverrides.set(target.componentId, targetProps)
    }
  }
  const factories = compiled.map((code, index) => `
      const Component${index}=(()=>{
        const module={exports:{}};const exports=module.exports;
        ${escapeScript(code)}
        const value=module.exports.default||module.exports.Component||module.exports;
        if(typeof value!=='function'&&typeof value!=='object')throw new Error('组件 ${index + 1} 没有合法的默认导出');
        return value;
      })();`).join('\n')
  const states = stateDefinitions.map(({ name, initial }) =>
    `const [${name},set_${name}]=React.useState(${escapeScript(JSON.stringify(initial).replace(/</g, '\\u003c'))});`).join('\n')
  const sections = entries.map(({ candidate, contract, active }, index) => {
    const props = escapeScript(JSON.stringify(candidate.previewProps).replace(/</g, '\\u003c'))
    const overrides = propOverrides.get(contract.id) ?? []
    const mergedProps = overrides.length ? `{...${props},${overrides.join(',')}}` : props
    return `React.createElement('section',{
      key:${JSON.stringify(contract.id)},
      className:'composition-slot${active ? ' is-active' : ''}',
      'data-composition-slot':${JSON.stringify(contract.id)},
      'data-candidate-id':${JSON.stringify(candidate.id)},
      'data-slot-kind':${JSON.stringify(contract.slot)},
      'data-slot-label':${JSON.stringify(contract.role)}
    },React.createElement(Component${index},${mergedProps}))`
  }).join(',\n')
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh; style-src 'unsafe-inline'; connect-src https://esm.sh https://cdn.tailwindcss.com; img-src data: blob:; font-src data:; worker-src blob:" />
  <script>
    const reportSandboxError=(error)=>parent.postMessage({source:'wtpt-sandbox',token:${JSON.stringify(token)},revisionId:${JSON.stringify(revisionId)},type:'error',error:error instanceof Error?error.message:String(error||'Runtime error')},'*');
    window.addEventListener('error',(event)=>reportSandboxError(event.error||event.message));
    window.addEventListener('unhandledrejection',(event)=>reportSandboxError(event.reason));
    window.addEventListener('message',(event)=>{
      const data=event.data;
      if(event.source!==parent||!data||data.source!=='wtpt-parent'||data.token!==${JSON.stringify(token)}||data.revisionId!==${JSON.stringify(revisionId)}||data.type!=='active-slot')return;
      document.querySelectorAll('[data-composition-slot]').forEach((slot)=>slot.classList.toggle('is-active',slot.dataset.compositionSlot===data.slotId));
    });
    document.addEventListener('pointerdown',(event)=>{
      const slot=event.target instanceof Element?event.target.closest('[data-composition-slot]'):null;
      if(!slot)return;
      parent.postMessage({source:'wtpt-sandbox',token:${JSON.stringify(token)},revisionId:${JSON.stringify(revisionId)},type:'selection',slotId:slot.dataset.compositionSlot,candidateId:slot.dataset.candidateId},'*');
    },true);
  </script>
  <script async src="https://cdn.tailwindcss.com"></script>
  <style>
    html,body,#root{margin:0;min-height:100%;width:100%}body{overflow:auto;background:var(--dna-bg,#fff);color:var(--dna-text,#171717);font-family:var(--dna-font,system-ui,sans-serif)}*{box-sizing:border-box}:root{${rootVars}}
    .composition-root{min-height:100%;display:flex;flex-direction:column;background:var(--dna-bg,#fff);color:var(--dna-text,#171717)}
    .composition-slot{position:relative;min-width:0;isolation:isolate;outline:0 solid transparent;transition:outline-color .2s ease,filter .2s ease}
    .composition-slot> :first-child{min-height:0!important;height:auto!important;background-color:transparent!important}
    .composition-slot.is-active{outline:2px solid color-mix(in srgb,var(--dna-accent,#7c3aed) 65%,transparent);outline-offset:-2px}
    .composition-slot::before{content:attr(data-slot-label);position:absolute;z-index:999;top:8px;left:12px;max-width:calc(100% - 24px);padding:4px 9px;border-radius:999px;background:color-mix(in srgb,var(--dna-surface,#fff) 86%,transparent);color:var(--dna-text,#171717);box-shadow:0 4px 16px rgba(0,0,0,.12);font:700 10px/1.2 system-ui,sans-serif;opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}
    .composition-slot:hover::before,.composition-slot.is-active::before{opacity:1;transform:translateY(0)}
    .composition-root[data-layout="dashboard"]{display:grid;grid-template-columns:minmax(180px,26%) minmax(0,1fr);align-items:start}.composition-root[data-layout="dashboard"]>[data-slot-kind="header"]{grid-column:1/-1}.composition-root[data-layout="dashboard"]>[data-slot-kind="sidebar"]{grid-column:1}.composition-root[data-layout="dashboard"]>:not([data-slot-kind="header"]):not([data-slot-kind="sidebar"]){grid-column:2}
    .composition-root[data-direction="apple"]{gap:14px;padding:18px}.composition-root[data-direction="apple"]>.composition-slot{border-radius:calc(var(--dna-radius,22px) + 4px);overflow:hidden}
    .composition-root[data-direction="md3"]{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:18px;padding:20px;align-items:start}.composition-root[data-direction="md3"]>.composition-slot{min-height:100%;border-radius:var(--dna-radius,28px);background:var(--dna-surface,#fff)}
    .composition-root[data-direction="md3"]>.composition-slot:first-child:nth-last-child(3){grid-column:1/-1}
    .composition-root[data-direction="hacker"]{gap:0;padding:12px}.composition-root[data-direction="hacker"]>.composition-slot{border:1px solid var(--dna-line,#1e281e);border-bottom:0}.composition-root[data-direction="hacker"]>.composition-slot:last-child{border-bottom:1px solid var(--dna-line,#1e281e)}
    .composition-root[data-direction="retro"]{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(240px,.85fr);gap:22px;padding:24px}.composition-root[data-direction="retro"]>.composition-slot{border-top:3px double var(--dna-line,#8a7b63);padding-top:10px}
    @media(max-width:640px){.composition-root[data-layout="dashboard"],.composition-root[data-direction="md3"],.composition-root[data-direction="retro"]{display:flex}.composition-root[data-direction]{padding:12px}.composition-slot::before{opacity:1;transform:none}}
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
      const React=ReactNamespace.default;const {createRoot}=ReactDOMClient;
      const require=(name)=>{if(name==='react')return {...ReactNamespace,default:React};if(name==='react-dom')return ReactDOMNamespace;if(name==='react-dom/client')return ReactDOMClient;if(name==='lucide-react')return Lucide;if(name==='motion'||name==='motion/react'||name==='framer-motion')return Motion;throw new Error('Dependency is not allowed: '+name)};
      ${factories}
      function CompositionApp(){${states}return React.createElement('main',{className:'composition-root','data-layout':${JSON.stringify(layout)},'data-direction':${JSON.stringify(directionId)}},${sections})}
      createRoot(document.getElementById('root')).render(React.createElement(CompositionApp));
      setTimeout(()=>parent.postMessage({source:'wtpt-sandbox',token:${JSON.stringify(token)},revisionId:${JSON.stringify(revisionId)},type:'ready'},'*'),0);
    }catch(error){reportSandboxError(error)}
  </script>
</body>
</html>`
}

export type SandboxRuntimeOptions = {
  timeoutMs?: number
  observationMs?: number
  getCssVariables?: () => Record<string, string>
}

export class SandboxRuntimeAdapter implements RuntimeAdapter {
  #timeoutMs: number
  #observationMs: number
  #getCssVariables: () => Record<string, string>

  constructor(options: SandboxRuntimeOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 15_000
    this.#observationMs = options.observationMs ?? 300
    this.#getCssVariables = options.getCssVariables ?? (() => ({}))
  }

  async compile(candidate: CandidateArtifact, signal: AbortSignal): Promise<CompileResult> {
    let srcDoc: string
    const token = crypto.randomUUID()
    const revisionId = candidate.attemptId ?? crypto.randomUUID()
    try {
      srcDoc = await createSandboxDocument(candidate, this.#getCssVariables(), token, undefined, revisionId)
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
        if (readyTimer !== null) clearTimeout(readyTimer)
        signal.removeEventListener('abort', onAbort)
        iframe.remove()
        resolve(result)
      }
      const onMessage = (event: MessageEvent) => {
        if (!isSandboxRuntimeMessage(event, iframe.contentWindow, token, revisionId)) return
        if (event.data.type === 'error') {
          finish({ ok: false, errors: [event.data.error ?? 'Sandbox runtime error'] })
          return
        }
        // React can report ready before effects and queued microtasks run. Keep
        // the probe alive briefly so mount-time crashes cannot be exported as a
        // successful component.
        if (readyTimer === null) readyTimer = window.setTimeout(() => finish({ ok: true }), this.#observationMs)
      }
      const onAbort = () => finish({ ok: false, errors: ['编译已取消'] })
      let readyTimer: number | null = null
      const timeout = window.setTimeout(() => finish({ ok: false, errors: ['沙箱编译超时，请检查网络或生成代码'] }), this.#timeoutMs)
      window.addEventListener('message', onMessage)
      signal.addEventListener('abort', onAbort, { once: true })
      iframe.srcdoc = srcDoc
      document.body.appendChild(iframe)
    })
  }
}
