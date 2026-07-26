import { useState } from 'react'
import { KeyRound, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../../lib/store'
import { clearKimiApiKey, loadKimiSettings, saveKimiSettings } from '../../lib/harness/settings.ts'
import { playClick } from '../../lib/sound'

export default function ApiSettingsModal() {
  const { settingsOpen, closeSettings } = useStore()
  const initial = loadKimiSettings()
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [model, setModel] = useState(initial.model)
  const [codeModel, setCodeModel] = useState(initial.codeModel)
  const [remember, setRemember] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!settingsOpen) return null

  const save = () => {
    saveKimiSettings({
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      codeModel: codeModel.trim(),
      temperature: initial.temperature,
    }, { rememberKey: remember })
    setSaved(true)
    playClick()
    window.setTimeout(() => closeSettings(), 500)
  }

  const clear = () => {
    clearKimiApiKey()
    setApiKey('')
    setRemember(false)
    setSaved(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={closeSettings}>
      <div className="absolute inset-0 bg-neutral-900/25 backdrop-blur-sm anim-pop" />
      <div className="anim-bounce-in relative w-full max-w-md rounded-[28px] border border-white/60 bg-white/95 backdrop-blur-xl shadow-2xl p-6" onClick={(event) => event.stopPropagation()}>
        <button onClick={closeSettings} className="hover-pop absolute top-4 right-4 w-8 h-8 rounded-full hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
          <X size={15} />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-neutral-900 text-amber-300 flex items-center justify-center shadow-lg"><KeyRound size={17} /></div>
          <div>
            <h2 className="text-base font-black text-neutral-900">AI API · BYOK 设置</h2>
            <p className="text-[10px] text-neutral-400">支持 OpenAI-compatible API；保存后下一次生成切换到真实 Harness</p>
          </div>
        </div>

        <label className="block mt-5 text-[10px] font-bold text-neutral-500">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk-…"
          className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        />
        <div className="mt-3 grid grid-cols-[1fr_120px_120px] gap-2">
          <div>
            <label className="block text-[10px] font-bold text-neutral-500">Base URL</label>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] font-mono focus:outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-neutral-500">规划模型</label>
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="规划 / 快速模型" className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] font-mono focus:outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-neutral-500">组件模型</label>
            <input value={codeModel} onChange={(event) => setCodeModel(event.target.value)} placeholder="组件 / 代码模型" className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] font-mono focus:outline-none" />
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-[11px] text-neutral-600 cursor-pointer">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="rounded" />
          在这台设备上记住 Key
        </label>
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-[10px] leading-relaxed text-emerald-700">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          默认只写入 sessionStorage；生成代码运行在无同源权限的 CSP iframe 中，无法读取主应用存储。
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={clear} className="hover-pop px-4 py-2.5 rounded-full border border-neutral-200 text-xs font-bold text-neutral-500">清除 Key</button>
          <button onClick={save} disabled={!apiKey.trim() || !baseUrl.trim() || !model.trim() || !codeModel.trim()} className="hover-pop flex-1 px-4 py-2.5 rounded-full bg-neutral-900 text-white text-xs font-bold shadow-lg disabled:opacity-30">
            {saved ? '✓ 已保存' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}
