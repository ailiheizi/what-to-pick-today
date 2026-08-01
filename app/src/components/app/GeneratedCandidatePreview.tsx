import { useEffect, useRef, useState } from 'react'
import type { CandidateArtifact } from '../../lib/harness/types.ts'
import { createSandboxDocument, isSandboxRuntimeMessage, isSandboxSelectionMessage } from '../../lib/harness/sandbox-runtime.ts'

export default function GeneratedCandidatePreview({
  candidate,
  cssVariables,
  title,
  selection,
  onSelect,
  onRuntimeError,
  onHeight,
}: {
  candidate: CandidateArtifact
  cssVariables: Record<string, string>
  title?: string
  selection?: { slotId: string; candidateId: string }
  onSelect?: (selection: { slotId: string; candidateId: string }) => void
  onRuntimeError?: (error: string) => void
  onHeight?: (height: number) => void
}) {
  const selectionSlotId = selection?.slotId
  const selectionCandidateId = selection?.candidateId
  const renderKey = `${candidate.id}:${candidate.files.map((file) => file.content.length).join(':')}:${Object.values(cssVariables).join(':')}`
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [result, setResult] = useState({ key: '', srcDoc: '', error: '', token: '', revisionId: '' })
  const [contentHeight, setContentHeight] = useState(180)

  useEffect(() => {
    let active = true
    const token = crypto.randomUUID()
    const revisionId = crypto.randomUUID()
    const bridge = selectionSlotId && selectionCandidateId
      ? { slotId: selectionSlotId, candidateId: selectionCandidateId, revisionId }
      : undefined
    void createSandboxDocument(candidate, cssVariables, token, bridge, revisionId)
      .then((document) => active && setResult({ key: renderKey, srcDoc: document, error: '', token, revisionId }))
      .catch((reason: unknown) => active && setResult({
        key: renderKey,
        srcDoc: '',
        error: reason instanceof Error ? reason.message : String(reason),
        token,
        revisionId,
      }))
    return () => { active = false }
  }, [candidate, cssVariables, renderKey, selectionCandidateId, selectionSlotId])

  useEffect(() => {
    if (!selectionSlotId || !selectionCandidateId || !onSelect || !result.token || !result.revisionId) return
    const onMessage = (event: MessageEvent) => {
      if (!isSandboxSelectionMessage(event, iframeRef.current?.contentWindow ?? null, result.token, result.revisionId)) return
      onSelect({ slotId: event.data.slotId, candidateId: event.data.candidateId })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onSelect, result.revisionId, result.token, selectionCandidateId, selectionSlotId])

  useEffect(() => {
    if (!result.token || !result.revisionId) return
    const onMessage = (event: MessageEvent) => {
      if (!isSandboxRuntimeMessage(event, iframeRef.current?.contentWindow ?? null, result.token, result.revisionId)) return
      if ((event.data.type === 'ready' || event.data.type === 'resize') && event.data.height) {
        const nextHeight = Math.ceil(event.data.height)
        setContentHeight(nextHeight)
        onHeight?.(nextHeight)
        return
      }
      if (event.data.type !== 'error') return
      const error = event.data.error ?? 'Sandbox runtime error'
      setResult((current) => current.key === renderKey ? { ...current, error } : current)
      onRuntimeError?.(error)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onHeight, onRuntimeError, renderKey, result.revisionId, result.token])

  if (result.key === renderKey && result.error) return <div className="p-3 text-[10px] text-rose-500 font-mono">{result.error}</div>
  if (result.key !== renderKey || !result.srcDoc) return <div className="h-full min-h-24 animate-pulse bg-neutral-100" />
  return (
    <iframe
      ref={iframeRef}
      title={title ?? candidate.id}
      sandbox="allow-scripts"
      srcDoc={result.srcDoc}
      className="block w-full border-0 bg-transparent transition-[height] duration-300"
      style={{ height: contentHeight }}
    />
  )
}
