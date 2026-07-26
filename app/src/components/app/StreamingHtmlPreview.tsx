import { useMemo } from 'react'

function sanitizeDraft(html: string) {
  return html
    .replace(/<(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|meta|base)\b[^>]*\/?\s*>/gi, '')
}

function cssVariables(vars: Record<string, string>) {
  return Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(';')
}

export default function StreamingHtmlPreview({
  html,
  cssVariables: variables,
  title = 'API 流式 UI 草图',
  badge = true,
}: {
  html: string
  cssVariables: Record<string, string>
  title?: string
  badge?: boolean
}) {
  const srcDoc = useMemo(() => `<!doctype html>
<html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'" />
<style>:root{${cssVariables(variables)}}html,body{margin:0;min-height:100%;width:100%;overflow:auto}body{box-sizing:border-box;background:var(--dna-bg,#fafafa);color:var(--dna-text,#171717);font-family:var(--dna-font,system-ui,sans-serif)}*{box-sizing:border-box}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}</style>
</head><body>${sanitizeDraft(html)}</body></html>`, [html, variables])

  return (
    <div className="relative h-full min-h-36 w-full overflow-hidden bg-[var(--dna-bg)]">
      <iframe title={title} sandbox="" srcDoc={srcDoc} className="block h-full min-h-36 w-full border-0 bg-transparent" />
      {badge && (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full border border-white/60 bg-neutral-900/80 px-2.5 py-1 text-[8px] font-bold text-white shadow backdrop-blur anim-pop">
          API 实时草图 · React 生成中
        </span>
      )}
    </div>
  )
}
