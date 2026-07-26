import { useEffect, useState } from 'react'
import type { CandidateArtifact } from '../../lib/harness/types.ts'
import { createSandboxDocument } from '../../lib/harness/sandbox-runtime.ts'

export default function GeneratedCandidatePreview({
  candidate,
  cssVariables,
  title,
}: {
  candidate: CandidateArtifact
  cssVariables: Record<string, string>
  title?: string
}) {
  const renderKey = `${candidate.id}:${candidate.files.map((file) => file.content.length).join(':')}:${Object.values(cssVariables).join(':')}`
  const [result, setResult] = useState({ key: '', srcDoc: '', error: '' })

  useEffect(() => {
    let active = true
    void createSandboxDocument(candidate, cssVariables)
      .then((document) => active && setResult({ key: renderKey, srcDoc: document, error: '' }))
      .catch((reason: unknown) => active && setResult({ key: renderKey, srcDoc: '', error: reason instanceof Error ? reason.message : String(reason) }))
    return () => { active = false }
  }, [candidate, cssVariables, renderKey])

  if (result.key === renderKey && result.error) return <div className="p-3 text-[10px] text-rose-500 font-mono">{result.error}</div>
  if (result.key !== renderKey || !result.srcDoc) return <div className="h-full min-h-24 animate-pulse bg-neutral-100" />
  return (
    <iframe
      title={title ?? candidate.id}
      sandbox="allow-scripts"
      srcDoc={result.srcDoc}
      className="block w-full h-full border-0 bg-transparent"
    />
  )
}
