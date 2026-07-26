import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { isAllowedLocalProxyOrigin, LOCAL_MODEL_PROXY_PATH, rewriteModelProxyPath, splitModelApiBase } from './src/lib/harness/local-proxy'

function localModelProxyGuard(enabled: boolean): Plugin {
  return {
    name: 'local-model-proxy-origin-guard',
    configureServer(server) {
      if (!enabled) return
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(LOCAL_MODEL_PROXY_PATH)) return next()
        if (isAllowedLocalProxyOrigin(request.headers.origin, request.headers.host)) return next()
        response.statusCode = 403
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'Local model proxy only accepts same-origin browser requests.' }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const workspaceRoot = path.resolve(__dirname, '..')
  const localEnv = loadEnv(mode, workspaceRoot, '')
  const upstreamBase = (process.env.AI_PROXY_BASE_URL ?? localEnv.AI_PROXY_BASE_URL)?.trim()
  const upstreamKey = (process.env.AI_PROXY_API_KEY ?? localEnv.AI_PROXY_API_KEY)?.trim()
  let modelProxy: Record<string, string | ProxyOptions> | undefined

  if (upstreamBase) {
    const { target, prefix } = splitModelApiBase(upstreamBase)
    modelProxy = {
      [LOCAL_MODEL_PROXY_PATH]: {
        target,
        changeOrigin: true,
        secure: true,
        rewrite: (requestPath) => rewriteModelProxyPath(requestPath, prefix),
        configure(proxy) {
          if (!upstreamKey) return
          proxy.on('proxyReq', (proxyRequest) => {
            proxyRequest.setHeader('authorization', `Bearer ${upstreamKey}`)
          })
        },
      },
    }
  }

  return {
    base: './',
    plugins: [localModelProxyGuard(Boolean(upstreamBase)), inspectAttr(), react()],
    server: {
      port: 3000,
      proxy: modelProxy,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }
})
