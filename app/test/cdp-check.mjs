const cdpPort = process.env.CDP_PORT ?? '9223'
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:7100/'
const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then((response) => response.json())
const page = pages.find((item) => item.type === 'page' && item.url.startsWith(appUrl)) ?? pages.find((item) => item.type === 'page')
if (!page) throw new Error('No Chrome page target found')

const socket = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const browserErrors = []
const networkFailures = []
const networkRequests = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text)
  if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) {
    browserErrors.push(message.params.entry.text)
  }
  if (message.method === 'Network.requestWillBeSent') {
    networkRequests.set(message.params.requestId, message.params.request.url)
  }
  if (message.method === 'Network.loadingFailed') {
    networkFailures.push({ url: networkRequests.get(message.params.requestId), error: message.params.errorText, blockedReason: message.params.blockedReason })
  }
}
await new Promise((resolve) => { socket.onopen = resolve })
const call = (method, params = {}) => new Promise((resolve) => {
  const callId = ++id
  pending.set(callId, resolve)
  socket.send(JSON.stringify({ id: callId, method, params }))
})
await call('Runtime.enable')
await call('Log.enable')
await call('Page.enable')
await call('Network.enable')
const evaluate = async (expression) => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text)
  return response.result.result.value
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await evaluate(`(() => { sessionStorage.clear(); localStorage.clear(); location.href = ${JSON.stringify(appUrl)} })()`)
await sleep(1200)

const modal = await evaluate(`(async () => {
  const button = document.querySelector('[title="配置 Kimi API Key"]')
  button?.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const text = document.body.innerText
  return {
    button: Boolean(button),
    modal: text.includes('Kimi · BYOK 设置'),
    hasApiKeyInput: Boolean(document.querySelector('input[type="password"]')),
    securityNotice: text.includes('默认只写入 sessionStorage'),
  }
})()`)

await evaluate(`(() => {
  const close = [...document.querySelectorAll('button')].find((button) => button.querySelector('svg') && button.closest('.fixed.inset-0'))
  close?.click()
})()`)
await sleep(100)

const mockInitial = await evaluate(`(() => {
  const input = [...document.querySelectorAll('input')].find((node) => node.placeholder?.includes('描述你想做的界面'))
  if (!input) return { input: false }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, '帮我做一个 SaaS 增长数据看板')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  return { input: true }
})()`)
await sleep(250)
mockInitial.planning = await evaluate(`document.body.innerText.includes('Planner 规划中')`)
mockInitial.realKimi = await evaluate(`document.body.innerText.includes('真实 Planner 正在分析')`)
await sleep(4200)
mockInitial.direction = await evaluate(`document.body.innerText.includes('等待挑选底板')`)
mockInitial.hasDirectionCards = await evaluate(`document.body.innerText.includes('苹果风') && document.body.innerText.includes('黑客风') && document.body.innerText.includes('MD3') && document.body.innerText.includes('复古')`)

const sandbox = await evaluate(`(async () => {
  const runtime = await import('/src/lib/harness/sandbox-runtime.ts')
  const candidate = {
    id: 'cdp', componentId: 'hero', variant: 'expressive', entryFile: 'src/C.tsx',
    previewProps: {}, notes: [], runtimeStatus: 'source_ready', compileErrors: [], fixAttempts: 0,
    files: [{ path: 'src/C.tsx', content: "import React from 'react'; export default function C(){return <button className='rounded-full bg-purple-500 text-white p-4'>Pick</button>}" }]
  }
  return await new runtime.SandboxRuntimeAdapter().compile(candidate, new AbortController().signal)
})()`)

const sandboxRequests = [...networkRequests.values()].filter((url) => /esm\.sh|tailwindcss/.test(url))
const result = { modal, mockInitial, sandbox, browserErrors, networkFailures, sandboxRequests }
console.log(JSON.stringify(result, null, 2))
socket.close()

const passed = modal.modal && modal.hasApiKeyInput && modal.securityNotice
  && mockInitial.input && mockInitial.planning && !mockInitial.realKimi && mockInitial.direction && mockInitial.hasDirectionCards
  && sandbox.ok
if (!passed) process.exitCode = 1
