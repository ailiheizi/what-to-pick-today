export const LOCAL_MODEL_PROXY_PATH = '/api/model'

export function isLocalModelProxyBase(baseUrl: string) {
  const value = baseUrl.trim().replace(/\/$/, '')
  if (value === LOCAL_MODEL_PROXY_PATH) return true
  try {
    const url = new URL(value)
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.pathname.replace(/\/$/, '') === LOCAL_MODEL_PROXY_PATH
  } catch {
    return false
  }
}

export function splitModelApiBase(baseUrl: string) {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('AI_PROXY_BASE_URL 必须使用 http 或 https')
  const prefix = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return { target: url.origin, prefix }
}

export function rewriteModelProxyPath(pathname: string, prefix: string) {
  const downstream = pathname.replace(/^\/api\/model(?=\/|\?|$)/, '') || '/'
  return `${prefix}${downstream.startsWith('/') ? downstream : `/${downstream}`}`
}

export function isAllowedLocalProxyOrigin(origin: string | undefined, requestHost: string | undefined) {
  if (!origin) return true
  if (!requestHost) return false
  try {
    return new URL(origin).host === requestHost
  } catch {
    return false
  }
}
