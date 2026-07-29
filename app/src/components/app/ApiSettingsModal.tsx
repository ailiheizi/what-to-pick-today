import { useMemo, useState } from 'react'
import { Check, KeyRound, RefreshCw, Server, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../../lib/store'
import { clearKimiApiKey, loadKimiSettings, saveKimiSettings } from '../../lib/harness/settings.ts'
import { isLocalModelProxyBase } from '../../lib/harness/local-proxy.ts'
import { fetchModelList, PROVIDER_PRESETS, type ModelProviderId, type ProviderPreset } from '../../lib/harness/providers.ts'
import { MODEL_ROLES, ROLE_LABELS, type ModelRole, type ModelRoutingOverrides } from '../../lib/harness/model-routing.ts'
import { playClick } from '../../lib/sound'

function providerFor(baseUrl: string): ModelProviderId {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return PROVIDER_PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === normalized)?.id ?? 'custom'
}

const ROLE_HINTS: Record<ModelRole, string> = {
  planner: '页面拆分与组件合同',
  draft: '首屏快速草图',
  builder: '完整组件源码',
  fixer: '编译修复与 Revision',
  reviewer: '整页一致性评审',
}

export default function ApiSettingsModal() {
  const { settingsOpen, closeSettings } = useStore()
  const initial = loadKimiSettings()
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [model, setModel] = useState(initial.model)
  const [codeModel, setCodeModel] = useState(initial.codeModel)
  const [roleModels, setRoleModels] = useState<Record<ModelRole, string>>(() => Object.fromEntries(
    MODEL_ROLES.map((role) => [role, initial.roles?.[role]?.model ?? '']),
  ) as Record<ModelRole, string>)
  const [providerId, setProviderId] = useState<ModelProviderId>(() => providerFor(initial.baseUrl))
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [modelMessage, setModelMessage] = useState('')
  const [remember, setRemember] = useState(false)
  const [saved, setSaved] = useState(false)
  const usingLocalProxy = isLocalModelProxyBase(baseUrl)
  const visibleProviders = useMemo(
    () => PROVIDER_PRESETS.filter((preset) => !preset.developmentOnly || import.meta.env.DEV),
    [],
  )

  if (!settingsOpen) return null

  const save = () => {
    const roles = Object.fromEntries(MODEL_ROLES.flatMap((role) => {
      const roleModel = roleModels[role].trim()
      const maxTokens = initial.roles?.[role]?.maxTokens
      if (!roleModel && maxTokens === undefined) return []
      return [[role, {
        ...(roleModel ? { model: roleModel } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
      }]]
    })) as ModelRoutingOverrides
    saveKimiSettings({
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      codeModel: codeModel.trim(),
      roles,
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

  const selectProvider = (preset: ProviderPreset) => {
    setProviderId(preset.id)
    setAvailableModels([])
    setModelStatus('idle')
    setModelMessage('')
    if (preset.id === 'custom') return
    setBaseUrl(preset.baseUrl)
    setModel(preset.model)
    setCodeModel(preset.codeModel)
    // Role model ids are provider-specific. A preset switch should return all
    // roles to inheritance instead of silently sending old-provider ids to the
    // newly selected endpoint.
    setRoleModels(Object.fromEntries(MODEL_ROLES.map((role) => [role, ''])) as Record<ModelRole, string>)
    playClick()
  }

  const discoverModels = async () => {
    setModelStatus('loading')
    setModelMessage('正在向服务商读取可用模型…')
    try {
      const models = await fetchModelList({ baseUrl, apiKey })
      setAvailableModels(models)
      setModelStatus('success')
      setModelMessage(models.length > 0
        ? `已找到 ${models.length} 个模型，可搜索选择，也可以继续手填。`
        : '服务商返回了空模型列表，你仍可手动填写模型名称。')
    } catch (error) {
      setAvailableModels([])
      setModelStatus('error')
      setModelMessage(error instanceof Error ? error.message : '获取模型列表失败，你仍可手动填写。')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={closeSettings}>
      <div className="absolute inset-0 bg-neutral-900/25 backdrop-blur-sm anim-pop" />
      <div className="anim-bounce-in relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-white/60 bg-white/95 p-6 shadow-2xl backdrop-blur-xl" onClick={(event) => event.stopPropagation()}>
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

        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <label className="block text-[10px] font-bold text-neutral-500">选择服务商</label>
            <p className="mt-0.5 text-[9px] text-neutral-400">自动填写兼容地址和推荐模型，之后仍可自由修改</p>
          </div>
          <Server size={15} className="mb-1 text-neutral-300" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visibleProviders.map((preset) => {
            const selected = providerId === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectProvider(preset)}
                className={`hover-pop relative rounded-2xl border px-3 py-2.5 text-left transition ${selected ? 'border-neutral-900 bg-neutral-900 text-white shadow-lg' : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300 hover:bg-white'}`}
              >
                {selected && <Check size={11} className="absolute right-2.5 top-2.5 text-amber-300" />}
                <span className="block pr-4 text-[11px] font-black">{preset.name}</span>
                <span className={`mt-0.5 block text-[8px] leading-snug ${selected ? 'text-neutral-300' : 'text-neutral-400'}`}>{preset.description}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex items-end justify-between gap-3">
          <label className="block flex-1 text-[10px] font-bold text-neutral-500">API Key</label>
          <button
            type="button"
            onClick={() => void discoverModels()}
            disabled={modelStatus === 'loading' || !baseUrl.trim() || (!apiKey.trim() && !usingLocalProxy)}
            className="hover-pop flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[10px] font-black text-neutral-700 shadow-sm disabled:opacity-30"
          >
            <RefreshCw size={11} className={modelStatus === 'loading' ? 'animate-spin' : ''} />
            {modelStatus === 'loading' ? '正在获取' : '获取模型列表'}
          </button>
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value)
            setModelStatus('idle')
            setModelMessage('')
          }}
          placeholder="sk-…"
          className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-neutral-900/20"
        />
        <div className="mt-1.5 flex items-center justify-between gap-3 text-[9px] text-neutral-400">
          <span>{usingLocalProxy ? '本地 .env 代理将于服务端注入 Key，此处可以留空' : 'Key 仅保存在浏览器；不会进入导出项目'}</span>
          {import.meta.env.DEV && (
            <button type="button" onClick={() => selectProvider(PROVIDER_PRESETS.find((preset) => preset.id === 'local-proxy')!)} className="shrink-0 font-bold text-neutral-600 hover:text-neutral-900">使用本地代理</button>
          )}
        </div>
        {modelMessage && (
          <p className={`mt-2 rounded-xl px-3 py-2 text-[9px] leading-relaxed ${modelStatus === 'error' ? 'bg-rose-50 text-rose-600' : modelStatus === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
            {modelMessage}
          </p>
        )}
        <datalist id="available-ai-models">
          {availableModels.map((availableModel) => <option key={availableModel} value={availableModel} />)}
        </datalist>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1.35fr_1fr_1fr]">
          <div>
            <label className="block text-[10px] font-bold text-neutral-500">Base URL</label>
            <input value={baseUrl} onChange={(event) => {
              setBaseUrl(event.target.value)
              setProviderId(providerFor(event.target.value))
              setAvailableModels([])
              setModelStatus('idle')
              setModelMessage('')
            }} placeholder="https://api.example.com/v1" className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] font-mono focus:outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-neutral-500">规划模型</label>
            <input list="available-ai-models" value={model} onChange={(event) => setModel(event.target.value)} placeholder="规划 / 快速模型" className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] font-mono focus:outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-neutral-500">组件模型</label>
            <input list="available-ai-models" value={codeModel} onChange={(event) => setCodeModel(event.target.value)} placeholder="组件 / 代码模型" className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] font-mono focus:outline-none" />
          </div>
        </div>

        <details className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50/80 px-4 py-3">
          <summary className="cursor-pointer select-none text-[10px] font-black text-neutral-700">
            高级 · 按角色选择模型
            <span className="ml-2 font-normal text-neutral-400">留空即继承上方基础模型</span>
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {MODEL_ROLES.map((role) => (
              <div key={role} className={role === 'reviewer' ? 'sm:col-span-2' : ''}>
                <label className="flex items-baseline justify-between gap-2 text-[9px] font-bold text-neutral-500">
                  <span>{ROLE_LABELS[role]}</span>
                  <span className="font-normal text-neutral-400">{ROLE_HINTS[role]}</span>
                </label>
                <input
                  list="available-ai-models"
                  value={roleModels[role]}
                  onChange={(event) => setRoleModels((current) => ({ ...current, [role]: event.target.value }))}
                  placeholder={role === 'builder' || role === 'fixer' ? `继承 ${codeModel || '组件模型'}` : `继承 ${model || '规划模型'}`}
                  className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                />
              </div>
            ))}
          </div>
        </details>

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
          <button onClick={save} disabled={(!apiKey.trim() && !usingLocalProxy) || !baseUrl.trim() || !model.trim() || !codeModel.trim()} className="hover-pop flex-1 px-4 py-2.5 rounded-full bg-neutral-900 text-white text-xs font-bold shadow-lg disabled:opacity-30">
            {saved ? '✓ 已保存' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  )
}
