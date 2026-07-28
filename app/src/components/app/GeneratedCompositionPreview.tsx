import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompositionSandboxEntry } from '../../lib/harness/sandbox-runtime.ts'
import { createCompositionSandboxDocument, isSandboxRuntimeMessage, isSandboxSelectionMessage } from '../../lib/harness/sandbox-runtime.ts'

export default function GeneratedCompositionPreview({
  entries,
  cssVariables,
  directionId,
  layout,
  activeSlotId,
  onSelect,
}: {
  entries: CompositionSandboxEntry[]
  cssVariables: Record<string, string>
  directionId: string
  layout: string
  activeSlotId: string | null
  onSelect: (selection: { slotId: string; candidateId: string }) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const renderKey = useMemo(() => entries.map(({ candidate }) => [
    candidate.id,
    candidate.attemptId,
    candidate.files.map((file) => `${file.path}:${file.content.length}`).join(','),
  ].join(':')).join('|') + `:${directionId}:${layout}:${Object.values(cssVariables).join(':')}`, [cssVariables, directionId, entries, layout])
  const [result, setResult] = useState({ key: '', srcDoc: '', error: '', token: '', revisionId: '' })

  useEffect(() => {
    let current = true
    const token = crypto.randomUUID()
    const revisionId = crypto.randomUUID()
    void createCompositionSandboxDocument(entries, cssVariables, token, revisionId, layout, directionId)
      .then((srcDoc) => current && setResult({ key: renderKey, srcDoc, error: '', token, revisionId }))
      .catch((reason: unknown) => current && setResult({
        key: renderKey,
        srcDoc: '',
        error: reason instanceof Error ? reason.message : String(reason),
        token,
        revisionId,
      }))
    return () => { current = false }
  }, [cssVariables, directionId, entries, layout, renderKey])

  useEffect(() => {
    if (!result.token || !result.revisionId) return
    const onMessage = (event: MessageEvent) => {
      const source = iframeRef.current?.contentWindow ?? null
      if (isSandboxSelectionMessage(event, source, result.token, result.revisionId)) {
        onSelect({ slotId: event.data.slotId, candidateId: event.data.candidateId })
        return
      }
      if (isSandboxRuntimeMessage(event, source, result.token, result.revisionId) && event.data.type === 'error') {
        setResult((current) => current.key === renderKey
          ? { ...current, error: event.data.error ?? '整页组合运行失败' }
          : current)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onSelect, renderKey, result.revisionId, result.token])

  const syncActiveSlot = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({
      source: 'wtpt-parent',
      token: result.token,
      revisionId: result.revisionId,
      type: 'active-slot',
      slotId: activeSlotId,
    }, '*')
  }, [activeSlotId, result.revisionId, result.token])

  useEffect(() => {
    if (result.key === renderKey && result.srcDoc) syncActiveSlot()
  }, [renderKey, result.key, result.srcDoc, syncActiveSlot])

  if (result.key === renderKey && result.error) {
    return <div className="flex min-h-[420px] items-center justify-center p-6 text-center text-[11px] font-mono text-rose-500">{result.error}</div>
  }
  if (result.key !== renderKey || !result.srcDoc) return <div className="min-h-[520px] animate-pulse bg-neutral-100/50" />
  return (
    <iframe
      ref={iframeRef}
      title="已选组件整页组合预览"
      sandbox="allow-scripts"
      srcDoc={result.srcDoc}
      onLoad={syncActiveSlot}
      className="block h-[min(68vh,680px)] min-h-[520px] w-full border-0 bg-transparent"
    />
  )
}
