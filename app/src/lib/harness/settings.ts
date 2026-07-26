import type { KimiSettings } from './types.ts'
import { isLocalModelProxyBase } from './local-proxy.ts'

const CONFIG_KEY = 'what-to-pick-today:kimi-config:v1'
const SESSION_KEY = 'what-to-pick-today:kimi-key:session'
const PERSISTENT_KEY = 'what-to-pick-today:kimi-key:persistent'

const DEFAULTS: Omit<KimiSettings, 'apiKey'> = {
  baseUrl: '',
  model: '',
  codeModel: '',
  temperature: 0.7,
}

export type SaveSettingsOptions = {
  rememberKey?: boolean
}

export function loadKimiSettings(): KimiSettings {
  let config: Partial<Omit<KimiSettings, 'apiKey'>> = {}
  try {
    config = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') as Partial<Omit<KimiSettings, 'apiKey'>>
  } catch {
    config = {}
  }
  const settings = {
    ...DEFAULTS,
    ...config,
    apiKey: sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(PERSISTENT_KEY) ?? '',
  }
  if (['kimi-k2.5', 'kimi-k3'].includes(settings.model)) settings.temperature = 1
  return settings
}

export function saveKimiSettings(settings: KimiSettings, options: SaveSettingsOptions = {}) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({
    baseUrl: settings.baseUrl,
    model: settings.model,
    codeModel: settings.codeModel,
    temperature: settings.temperature,
  }))
  sessionStorage.setItem(SESSION_KEY, settings.apiKey)
  if (options.rememberKey) localStorage.setItem(PERSISTENT_KEY, settings.apiKey)
  else localStorage.removeItem(PERSISTENT_KEY)
}

export function clearKimiApiKey() {
  sessionStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(PERSISTENT_KEY)
}

export function isModelApiConfigured(settings: KimiSettings) {
  const hasCredentials = Boolean(settings.apiKey.trim()) || isLocalModelProxyBase(settings.baseUrl)
  return hasCredentials
    && Boolean(settings.baseUrl.trim())
    && Boolean(settings.model.trim())
    && Boolean(settings.codeModel.trim())
}

export function hasKimiApiKey() {
  return isModelApiConfigured(loadKimiSettings())
}
